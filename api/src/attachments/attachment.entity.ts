import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { ImageContentType } from './attachment-rules.js';

export enum AttachmentStatus {
  /** Upload URL issued; the file may not be in S3 yet. */
  PENDING = 'PENDING',
  /** File confirmed in S3 and checked. Only these are shown. */
  UPLOADED = 'UPLOADED',
}

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({ name: 'object_key', type: 'text' })
  objectKey: string;

  @Column({ name: 'content_type', type: 'text' })
  contentType: ImageContentType;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes: number;

  @Column({ type: 'enum', enum: AttachmentStatus, enumName: 'attachment_status' })
  status: AttachmentStatus;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
