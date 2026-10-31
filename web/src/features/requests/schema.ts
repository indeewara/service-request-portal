import { z } from 'zod';

// Same limits the API and S3 enforce; checked here first so users get instant feedback.
export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;

/** The text fields. Used by the form in the browser and again by the server action. */
export const requestFieldsSchema = z.object({
  category: z.enum(['DAMAGED_DELIVERY', 'WRONG_ITEM', 'QUALITY_ISSUE', 'OTHER'], {
    error: 'Choose a category',
  }),
  orderNumber: z
    .string()
    .trim()
    .min(1, 'Enter the order number')
    .max(50, 'Order number must be 50 characters or fewer'),
  description: z
    .string()
    .trim()
    .min(1, 'Describe the problem')
    .max(2000, 'Description must be 2000 characters or fewer'),
});

export type RequestFields = z.infer<typeof requestFieldsSchema>;
export type FieldName = keyof RequestFields | 'photos';
export type FieldErrors = Partial<Record<FieldName, string>>;

export function photosError(files: File[]): string | undefined {
  if (files.length > MAX_PHOTOS) return `Choose up to ${MAX_PHOTOS} photos`;
  const wrongType = files.find((f) => !(PHOTO_TYPES as readonly string[]).includes(f.type));
  if (wrongType) return `${wrongType.name} is not a JPEG or PNG image`;
  const tooBig = files.find((f) => f.size > MAX_PHOTO_BYTES);
  if (tooBig) return `${tooBig.name} is larger than 5 MB`;
  return undefined;
}

/** Whole-form check: either clean values or one message per invalid field. */
export function validateRequestForm(
  values: Record<string, unknown>,
  files: File[],
): { ok: true; data: RequestFields } | { ok: false; errors: FieldErrors } {
  const parsed = requestFieldsSchema.safeParse(values);
  const errors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as FieldName;
      errors[field] ??= issue.message;
    }
  }
  const photos = photosError(files);
  if (photos) errors.photos = photos;
  return parsed.success && !photos ? { ok: true, data: parsed.data } : { ok: false, errors };
}
