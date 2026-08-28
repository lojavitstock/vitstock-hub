/**
 * Media is sent as base64 inside JSON. Keep the file and encoded contracts in
 * sync with the API route so a rejected file never creates a pending message.
 */
export const MAX_MEDIA_FILE_BYTES = 10_000_000;
export const MAX_MEDIA_BASE64_CHARS = 14_000_000;

export const formatMediaSize = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

export const isMediaFileSizeAllowed = (bytes: number) => (
  Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_MEDIA_FILE_BYTES
);

export const isMediaBase64SizeAllowed = (chars: number) => (
  Number.isFinite(chars) && chars > 0 && chars <= MAX_MEDIA_BASE64_CHARS
);
