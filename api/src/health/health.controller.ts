import { Controller, Get, Logger, Res } from '@nestjs/common';
import { ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { StorageService } from '../attachments/storage.service.js';
import { Public } from '../auth/decorators.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CheckStatus, HealthChecks, HealthResponse } from './health.dto.js';

const CHECK_TIMEOUT_MS = 2_000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /** For the load balancer and humans: 200 if every dependency answers, else 503. */
  @Public()
  @Get()
  @ApiServiceUnavailableResponse({ type: HealthResponse, description: 'A dependency is down' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const [database, redis, storage] = await Promise.all([
      this.probe('database', () => this.dataSource.query('SELECT 1')),
      // A real queue read over the queue's own connection: proves Redis and the queue together.
      this.probe('redis', () => this.notifications.queue.getJobCounts('waiting')),
      this.probe('storage', () => this.storage.ping()),
    ]);
    const checks: HealthChecks = { database, redis, storage };
    const ok = Object.values(checks).every((s) => s === 'up');
    if (!ok) res.status(503);
    return { status: ok ? 'ok' : 'error', checks };
  }

  /** Runs one check with a timeout. Details go to the log, never the public response. */
  private async probe(name: string, check: () => Promise<unknown>): Promise<CheckStatus> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS);
        }),
      ]);
      return 'up';
    } catch (err) {
      this.logger.warn({ msg: 'Health check failed', check: name, error: (err as Error).message });
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
