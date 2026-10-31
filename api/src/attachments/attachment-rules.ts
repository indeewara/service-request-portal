export const MAX_PHOTOS_PER_REQUEST = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Lifetime of both upload and download pre-signed URLs. */
export const URL_TTL_SECONDS = 300;

// Allowed types, with the file's first bytes ("magic number") so a renamed
// text file can't pass as a photo just by claiming `image/png`.
export const IMAGE_TYPES = {
  'image/jpeg': { extension: 'jpg', signature: [0xff, 0xd8, 0xff] },
  'image/png': {
    extension: 'png',
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
} as const;

export type ImageContentType = keyof typeof IMAGE_TYPES;

export const SIGNATURE_LENGTH = 8;

export function hasImageSignature(
  bytes: Uint8Array,
  contentType: ImageContentType,
): boolean {
  return IMAGE_TYPES[contentType].signature.every((b, i) => bytes[i] === b);
}
