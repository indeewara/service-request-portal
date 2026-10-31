import { Injectable, Logger, MessageEvent, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';
import { RequestStatus } from '../common/request-status.js';
import { redisUrl } from './redis.js';

const CHANNEL = 'request-status';
// Below the ALB's 60s idle timeout, so open streams aren't cut.
const HEARTBEAT_MS = 25_000;

export interface StatusChangedEvent {
  requestId: string;
  status: RequestStatus;
}

/**
 * Live status updates. Every API instance publishes to and subscribes to one
 * Redis channel, so an event reaches the instance holding the customer's
 * connection. Events carry ids and status only; the page re-fetches details.
 */
@Injectable()
export class RequestEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(RequestEventsService.name);
  private readonly pub = new Redis(redisUrl());
  // ponytail: one channel, every instance filters all events; per-request channels if volume grows.
  private readonly sub = new Redis(redisUrl());
  private readonly events = new Subject<StatusChangedEvent>();

  constructor() {
    for (const client of [this.pub, this.sub]) {
      client.on('error', (err) =>
        this.logger.error({ msg: 'Live updates Redis error', error: err.message }),
      );
    }
    this.sub.subscribe(CHANNEL).catch(() => this.logger.warn('Live updates subscribe failed'));
    this.sub.on('message', (_channel, raw: string) => {
      this.events.next(JSON.parse(raw) as StatusChangedEvent);
    });
  }

  /** Call after the transaction commits. Best effort: a missed event is fixed by the page's refetch on reconnect. */
  async publish(event: StatusChangedEvent): Promise<void> {
    try {
      await this.pub.publish(CHANNEL, JSON.stringify(event));
    } catch {
      this.logger.warn({ msg: 'Live update publish failed', requestId: event.requestId });
    }
  }

  stream(requestId: string): Observable<MessageEvent> {
    return merge(
      this.events.pipe(
        filter((e) => e.requestId === requestId),
        map((e) => ({ type: 'status', data: e })),
      ),
      interval(HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: '' }))),
    );
  }

  async onModuleDestroy() {
    this.events.complete();
    await Promise.all([this.pub.quit(), this.sub.quit()]);
  }
}
