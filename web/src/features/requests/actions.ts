'use server';

import { z } from 'zod';
import { ApiError } from '@/shared/api/client';
import { requestsApi } from '@/shared/api/endpoints';
import type { UploadTarget } from '@/shared/api/types';
import { PHOTO_TYPES, MAX_PHOTO_BYTES, requestFieldsSchema, type FieldErrors } from './schema';

// Server actions are public endpoints: every argument is re-validated here.
const id = z.uuid();

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: FieldErrors };

const failure = (err: unknown): { ok: false; error: string } => {
  if (err instanceof ApiError) return { ok: false, error: err.message };
  throw err; // includes Next.js redirects (expired session)
};

export async function createRequest(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = requestFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the form and try again.' };
  try {
    const created = await requestsApi.create(parsed.data);
    return { ok: true, id: created.id };
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) {
      const message = "We couldn't find this order number. Check it and try again.";
      return { ok: false, error: message, fieldErrors: { orderNumber: message } };
    }
    return failure(err);
  }
}

const photoSchema = z.object({
  contentType: z.enum(PHOTO_TYPES),
  size: z.number().int().min(1).max(MAX_PHOTO_BYTES),
});

export async function getUploadTarget(
  requestId: string,
  photo: unknown,
): Promise<ActionResult<{ target: UploadTarget }>> {
  const parsed = photoSchema.safeParse(photo);
  if (!id.safeParse(requestId).success || !parsed.success) {
    return { ok: false, error: 'Only JPEG or PNG images up to 5 MB.' };
  }
  try {
    return { ok: true, target: await requestsApi.uploadUrl(requestId, parsed.data) };
  } catch (err) {
    return failure(err);
  }
}

export async function completeUpload(requestId: string, attachmentId: string): Promise<ActionResult> {
  if (!id.safeParse(requestId).success || !id.safeParse(attachmentId).success) {
    return { ok: false, error: 'Unknown upload.' };
  }
  try {
    await requestsApi.completeUpload(requestId, attachmentId);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}
