import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { AuthUser } from '../auth/auth.types.js';
import { assertCanAccessRequest } from '../auth/request-access.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RequestEventsService } from '../notifications/request-events.service.js';
import { OrdersService } from '../orders/orders.service.js';
import {
  CreateRequestDto,
  ListRequestsQueryDto,
  PaginationQueryDto,
} from './requests.dto.js';
import { RequestStatus, ServiceRequest } from './service-request.entity.js';
import { StatusHistory } from './status-history.entity.js';
import { assertValidTransition } from './status-workflow.js';

@Injectable()
export class RequestsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ServiceRequest)
    private readonly requests: Repository<ServiceRequest>,
    @InjectRepository(StatusHistory)
    private readonly history: Repository<StatusHistory>,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly events: RequestEventsService,
  ) {}

  async create(user: AuthUser, dto: CreateRequestDto) {
    if (!(await this.orders.exists(dto.orderNumber))) {
      throw new UnprocessableEntityException('Order number not found');
    }
    return this.dataSource.transaction(async (m) => {
      const request = await m.save(
        m.create(ServiceRequest, {
          ...dto,
          customerId: user.id,
          status: RequestStatus.NEW,
        }),
      );
      await m.insert(StatusHistory, {
        requestId: request.id,
        fromStatus: null,
        toStatus: RequestStatus.NEW,
        changedBy: user.id,
      });
      return request;
    });
  }

  async findMine(user: AuthUser, { page, pageSize }: PaginationQueryDto) {
    const [items, total] = await this.requests.findAndCount({
      where: { customerId: user.id },
      // id breaks ties, so a row can't appear on two pages or none.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  // ponytail: OFFSET pagination, fine at launch volume; switch to keyset on created_at when deep pages slow down (see DATABASE.md).
  async findAll(query: ListRequestsQueryDto) {
    const { page, pageSize, status, category, from, to } = query;
    const qb = this.requests
      .createQueryBuilder('r')
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (status) qb.andWhere('r.status = :status', { status });
    if (category) qb.andWhere('r.category = :category', { category });
    if (from) qb.andWhere('r.createdAt >= CAST(:from AS date)', { from });
    if (to) {
      qb.andWhere(`r.createdAt < CAST(:to AS date) + interval '1 day'`, { to });
    }
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  /**
   * The only way to load a single request for a caller. Anything scoped to one
   * request (details, photos, live updates) must go through here.
   */
  async findAccessible(id: string, user: AuthUser): Promise<ServiceRequest> {
    const request = await this.requests.findOneBy({ id });
    if (!request) throw new NotFoundException('Request not found');
    assertCanAccessRequest(user, request);
    return request;
  }

  async getDetails(id: string, user: AuthUser) {
    const request = await this.findAccessible(id, user);
    const history = await this.history.find({
      where: { requestId: id },
      order: { changedAt: 'ASC' },
    });
    return { ...request, history };
  }

  async changeStatus(
    id: string,
    to: RequestStatus,
    user: AuthUser,
    correlationId?: string,
  ) {
    const { request, notificationId } = await this.dataSource.transaction(
      async (m) => {
        // Row lock so two staff changing the same request can't both pass the transition check.
        const request = await m.findOne(ServiceRequest, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!request) throw new NotFoundException('Request not found');
        assertValidTransition(request.status, to);

        const statusHistoryId = randomUUID();
        await m.insert(StatusHistory, {
          id: statusHistoryId,
          requestId: id,
          fromStatus: request.status,
          toStatus: to,
          changedBy: user.id,
        });
        request.status = to;
        const saved = await m.save(request);

        // Same transaction: the change and the email it owes commit together.
        const notificationId = await this.notifications.recordStatusChange(m, {
          requestId: id,
          statusHistoryId,
          recipientId: request.customerId,
          toStatus: to,
          orderNumber: request.orderNumber,
        });
        return { request: saved, notificationId };
      },
    );

    await this.notifications.enqueueAfterCommit(notificationId, correlationId);
    await this.events.publish({ requestId: id, status: to });
    return request;
  }
}
