import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { CorrelationId } from '../common/correlation-id.js';
import { ErrorBody } from '../common/error-body.dto.js';
import { Role } from '../auth/auth.types.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import {
  ChangeStatusDto,
  CreateRequestDto,
  ListRequestsQueryDto,
  PaginationQueryDto,
  RequestDetails,
  RequestPage,
} from './requests.dto.js';
import { RequestEventsService } from '../notifications/request-events.service.js';
import { RequestsService } from './requests.service.js';
import { ServiceRequest } from './service-request.entity.js';

@ApiTags('requests')
@ApiBearerAuth()
@ApiDefaultResponse({ type: ErrorBody, description: 'Error' })
@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly events: RequestEventsService,
  ) {}

  @Post()
  @Roles(Role.CUSTOMER)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRequestDto,
  ): Promise<ServiceRequest> {
    return this.requests.create(user, dto);
  }

  // Declared before ':id' so "mine" isn't treated as an id.
  @Get('mine')
  @Roles(Role.CUSTOMER)
  findMine(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<RequestPage> {
    return this.requests.findMine(user, query);
  }

  @Get()
  @Roles(Role.STAFF)
  findAll(@Query() query: ListRequestsQueryDto): Promise<RequestPage> {
    return this.requests.findAll(query);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<RequestDetails> {
    return this.requests.getDetails(id, user);
  }

  @Patch(':id/status')
  @Roles(Role.STAFF)
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId?: string,
  ): Promise<ServiceRequest> {
    return this.requests.changeStatus(id, dto.status, user, correlationId);
  }

  /**
   * Live status updates for an open request page (Server-Sent Events).
   * Sends `event: status` with `{ requestId, status }` after each change and
   * `event: ping` every 25 s. Same access rule as GET /requests/{id}.
   */
  @Sse(':id/events')
  @ApiProduces('text/event-stream')
  async streamEvents(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.requests.findAccessible(id, user);
    return this.events.stream(id);
  }
}
