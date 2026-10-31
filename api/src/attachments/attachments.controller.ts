import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiTags } from '@nestjs/swagger';
import { ErrorBody } from '../common/error-body.dto.js';
import { Role } from '../auth/auth.types.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import {
  AttachmentView,
  AttachmentWithUrl,
  CreateUploadUrlDto,
  UploadUrlResponse,
} from './attachments.dto.js';
import { AttachmentsService } from './attachments.service.js';

@ApiTags('attachments')
@ApiBearerAuth()
@ApiDefaultResponse({ type: ErrorBody, description: 'Error' })
@Controller('requests/:id/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('upload-url')
  @Roles(Role.CUSTOMER)
  createUploadUrl(
    @Param('id', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponse> {
    return this.attachments.createUploadUrl(requestId, user, dto);
  }

  @Post(':attachmentId/complete')
  @Roles(Role.CUSTOMER)
  @HttpCode(200)
  complete(
    @Param('id', ParseUUIDPipe) requestId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AttachmentView> {
    return this.attachments.complete(requestId, attachmentId, user);
  }

  @Get()
  list(
    @Param('id', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AttachmentWithUrl[]> {
    return this.attachments.list(requestId, user);
  }
}
