/**
 * The frontend allows 10,000,000 raw bytes. Base64 expands that payload to
 * roughly 13.34 MB; the JSON envelope needs a small amount of additional
 * headroom, so only the media route uses a 16 MiB parser limit.
 */
export const MAX_MEDIA_FILE_BYTES = 10_000_000;
export const MAX_MEDIA_BASE64_CHARS = 14_000_000;
export const MAX_MEDIA_REQUEST_BYTES = 16 * 1024 * 1024;
