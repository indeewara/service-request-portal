import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, MoreThan, Repository } from 'typeorm';
import { AuthUser } from '../auth/auth.types.js';
import { RequestsService } from '../requests/requests.service.js';
import {
  hasImageSignature,
  IMAGE_TYPES,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_REQUEST,
  SIGNATURE_LENGTH,
  URL_TTL_SECONDS,
} from './attachment-rules.js';
import { Attachment, AttachmentStatus } from './attachment.entity.js';
import { CreateUploadUrlDto } from './attachments.dto.js';
import { StorageService } from './storage.service.js';

const toView = ({ id, contentType, sizeBytes, status, createdAt }: Attachment) => ({
  id,
  contentType,
  sizeBytes,
  status,
  createdAt,
});

// Serialises photo changes per request, so concurrent calls can't exceed the limit.
const lockRequest = (m: EntityManager, requestId: string) =>
  m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [requestId]);

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Attachment)
    private readonly attachments: Repository<Attachment>,
    private readonly requests: RequestsService,
    private readonly storage: StorageService,
  ) {}

  async createUploadUrl(requestId: string, user: AuthUser, dto: CreateUploadUrlDto) {
    await this.requests.findAccessible(requestId, user);

    const attachment = await this.dataSource.transaction(async (m) => {
      await lockRequest(m, requestId);
      // Uploaded photos plus pending ones whose upload URL is still valid.
      const urlStillValid = new Date(Date.now() - URL_TTL_SECONDS * 1000);
      const inUse = await m.count(Attachment, {
        where: [
          { requestId, status: AttachmentStatus.UPLOADED },
          { requestId, createdAt: MoreThan(urlStillValid) },
        ],
      });
      if (inUse >= MAX_PHOTOS_PER_REQUEST) {
        throw new ConflictException(
          `A request can have at most ${MAX_PHOTOS_PER_REQUEST} photos`,
        );
      }

      const id = randomUUID();
      const extension = IMAGE_TYPES[dto.contentType].extension;
      return m.save(
        m.create(Attachment, {
          id,
          requestId,
          objectKey: `requests/${requestId}/${id}.${extension}`,
          contentType: dto.contentType,
          sizeBytes: dto.size,
          status: AttachmentStatus.PENDING,
          uploadedBy: user.id,
        }),
      );
    });

    const { url, fields } = await this.storage.presignUpload(
      attachment.objectKey,
      attachment.contentType,
      MAX_PHOTO_BYTES,
      URL_TTL_SECONDS,
    );
    return { attachmentId: attachment.id, url, fields, expiresIn: URL_TTL_SECONDS };
  }

  /** Called by the browser after the direct upload: verifies the file actually in S3. */
  async complete(requestId: string, attachmentId: string, user: AuthUser) {
    await this.requests.findAccessible(requestId, user);

    // A rejected file is deleted inside the transaction, which must commit, so
    // the error is thrown only after it (throwing inside would undo the delete).
    let rejection: Error | undefined;
    const view = await this.dataSource.transaction(async (m) => {
      await lockRequest(m, requestId);
      const attachment = await m.findOneBy(Attachment, { id: attachmentId, requestId });
      if (!attachment) throw new NotFoundException('Attachment not found');
      if (attachment.status === AttachmentStatus.UPLOADED) return toView(attachment);

      const object = await this.storage.head(attachment.objectKey);
      if (!object) throw new ConflictException('The file has not been uploaded yet');

      const reject = async (error: Error) => {
        await this.storage.delete(attachment.objectKey);
        await m.delete(Attachment, attachment.id);
        rejection = error;
        return null;
      };

      const uploaded = await m.countBy(Attachment, {
        requestId,
        status: AttachmentStatus.UPLOADED,
      });
      if (uploaded >= MAX_PHOTOS_PER_REQUEST) {
        return reject(
          new ConflictException(
            `A request can have at most ${MAX_PHOTOS_PER_REQUEST} photos`,
          ),
        );
      }

      const start = await this.storage.readStart(attachment.objectKey, SIGNATURE_LENGTH);
      const valid =
        object.size <= MAX_PHOTO_BYTES &&
        object.contentType === attachment.contentType &&
        hasImageSignature(start, attachment.contentType);
      if (!valid) {
        return reject(
          new UnprocessableEntityException('The file is not a valid JPEG or PNG image'),
        );
      }

      attachment.status = AttachmentStatus.UPLOADED;
      attachment.sizeBytes = object.size;
      return toView(await m.save(attachment));
    });
    if (rejection) throw rejection;
    return view!;
  }

  /** Uploaded photos with short-lived download URLs. The bucket itself is private. */
  async list(requestId: string, user: AuthUser) {
    await this.requests.findAccessible(requestId, user);
    const rows = await this.attachments.find({
      where: { requestId, status: AttachmentStatus.UPLOADED },
      order: { createdAt: 'ASC' },
    });
    return Promise.all(
      rows.map(async (a) => ({
        ...toView(a),
        url: await this.storage.presignDownload(a.objectKey, URL_TTL_SECONDS),
      })),
    );
  }
}
