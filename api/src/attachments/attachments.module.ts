import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestsModule } from '../requests/requests.module.js';
import { Attachment } from './attachment.entity.js';
import { AttachmentsController } from './attachments.controller.js';
import { AttachmentsService } from './attachments.service.js';
import { StorageService } from './storage.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Attachment]), RequestsModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, StorageService],
  // Health checks storage through this.
  exports: [StorageService],
})
export class AttachmentsModule {}
