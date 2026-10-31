import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { AttachmentStatus } from './attachment.entity.js';
import {
  IMAGE_TYPES,
  type ImageContentType,
  MAX_PHOTO_BYTES,
} from './attachment-rules.js';

export class CreateUploadUrlDto {
  @ApiProperty({ enum: Object.keys(IMAGE_TYPES) })
  @IsIn(Object.keys(IMAGE_TYPES))
  contentType: ImageContentType;

  /** Declared size in bytes, for early feedback. S3 enforces the real limit. */
  @Max(MAX_PHOTO_BYTES)
  @Min(1)
  @IsInt()
  size: number;
}

export class UploadUrlResponse {
  attachmentId: string;
  /** POST the file here as multipart/form-data: every field below, then `file` last. */
  url: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  fields: Record<string, string>;
  /** Seconds until the upload URL expires. */
  expiresIn: number;
}

export class AttachmentView {
  id: string;
  @ApiProperty({ enum: Object.keys(IMAGE_TYPES) })
  contentType: ImageContentType;
  sizeBytes: number;
  status: AttachmentStatus;
  createdAt: Date;
}

export class AttachmentWithUrl extends AttachmentView {
  /** Pre-signed download URL, valid for 5 minutes. */
  url: string;
}
