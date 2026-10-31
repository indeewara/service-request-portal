import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

/**
 * Thin wrapper over S3 (LocalStack locally). On real AWS, leave S3_ENDPOINT and
 * the keys unset: the SDK then uses the default endpoint and the task's IAM role.
 */
@Injectable()
export class StorageService {
  readonly bucket: string;
  // Used by the API itself (inside Docker this is http://localstack:4566).
  private readonly client: S3Client;
  // Signs URLs handed to browsers, so they must carry the public host.
  private readonly signer: S3Client;

  constructor() {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error('S3_BUCKET is not set');
    this.bucket = bucket;

    const { S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT } = process.env;
    const base: S3ClientConfig = {
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: Boolean(S3_ENDPOINT),
      credentials:
        S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
          ? { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }
          : undefined,
    };
    this.client = new S3Client({ ...base, endpoint: S3_ENDPOINT });
    this.signer = new S3Client({
      ...base,
      endpoint: process.env.S3_PUBLIC_ENDPOINT ?? S3_ENDPOINT,
    });
  }

  /** Pre-signed POST: S3 itself enforces the size range and the exact Content-Type. */
  presignUpload(key: string, contentType: string, maxBytes: number, expiresIn: number) {
    return createPresignedPost(this.signer, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: expiresIn,
    });
  }

  presignDownload(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  /** Throws if the bucket is unreachable or missing. Used by /health. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Size and type of a stored object, or null if it was never uploaded. */
  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      if ((err as Error).name === 'NotFound') return null;
      throw err;
    }
  }

  async readStart(key: string, length: number): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${length - 1}`,
      }),
    );
    return (await res.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
