export type MediaErrorBody = {
  error:
    | 'MEDIA_REQUEST_INVALID'
    | 'MEDIA_KEY_INVALID'
    | 'MEDIA_PROVIDER_REJECTED'
    | 'MEDIA_UNAVAILABLE'
    | 'MEDIA_RATE_LIMITED'
    | 'MEDIA_UPSTREAM_ERROR'
    | 'MEDIA_UPSTREAM_TIMEOUT'
    | 'MEDIA_UPSTREAM_UNAVAILABLE'
    | 'MEDIA_UPSTREAM_INVALID_RESPONSE';
  reason: string;
  temporary: boolean;
};

export type MediaFailure = {
  statusCode: number;
  body: MediaErrorBody;
};

export type MediaProviderRejectionCategory =
  | 'message_not_found'
  | 'media_key_missing'
  | 'decrypt_failed'
  | 'download_failed'
  | 'unsupported_media'
  | 'expired'
  | 'provider_rejected_unknown';

export type MediaProviderRejectionResponseFormat = 'json' | 'text' | 'empty' | 'invalid_json';

export type MediaProviderRejectionDiagnostics = {
  category: MediaProviderRejectionCategory;
  providerErrorCode?: string;
  providerMessageSanitized: string;
  responseFormat: MediaProviderRejectionResponseFormat;
};

const failure = (
  statusCode: number,
  error: MediaErrorBody['error'],
  reason: string,
  temporary: boolean,
): MediaFailure => ({
  statusCode,
  body: { error, reason, temporary },
});

export const mediaRequestInvalid = () => failure(400, 'MEDIA_REQUEST_INVALID', 'invalid_request', false);

export const mediaKeyInvalid = () => failure(422, 'MEDIA_KEY_INVALID', 'invalid_key', false);

export const mediaFailureForUpstreamStatus = (status: number): MediaFailure => {
  if (status === 404) return failure(404, 'MEDIA_UNAVAILABLE', 'not_found', false);
  if (status === 410) return failure(410, 'MEDIA_UNAVAILABLE', 'expired', false);
  if (status === 429) return failure(429, 'MEDIA_RATE_LIMITED', 'rate_limited', true);
  if (status >= 400 && status < 500) {
    return failure(status, 'MEDIA_PROVIDER_REJECTED', status === 400 ? 'invalid_key' : 'provider_rejected', true);
  }
  if (status >= 500 && status < 600) {
    return failure(502, 'MEDIA_UPSTREAM_ERROR', 'provider_error', true);
  }
  return failure(502, 'MEDIA_UPSTREAM_ERROR', 'invalid_status', true);
};

export const mediaFailureForTransport = (kind: 'timeout' | 'network'): MediaFailure => (
  kind === 'timeout'
    ? failure(504, 'MEDIA_UPSTREAM_TIMEOUT', 'timeout', true)
    : failure(502, 'MEDIA_UPSTREAM_UNAVAILABLE', 'network', true)
);

export const mediaFailureForInvalidProviderResponse = () => (
  failure(502, 'MEDIA_UPSTREAM_INVALID_RESPONSE', 'invalid_response', true)
);

const categoryForProviderCode: Record<string, MediaProviderRejectionCategory | undefined> = {
  MESSAGE_NOT_FOUND: 'message_not_found',
  MESSAGE_NOT_EXIST: 'message_not_found',
  NOT_FOUND: 'message_not_found',
  MEDIA_NOT_FOUND: 'message_not_found',
  MEDIA_KEY_MISSING: 'media_key_missing',
  MEDIA_KEY_NOT_FOUND: 'media_key_missing',
  MEDIA_KEY_INVALID: 'media_key_missing',
  DECRYPT_FAILED: 'decrypt_failed',
  DECRYPT_ERROR: 'decrypt_failed',
  DECRYPTION_FAILED: 'decrypt_failed',
  BAD_MAC: 'decrypt_failed',
  DOWNLOAD_FAILED: 'download_failed',
  DOWNLOAD_ERROR: 'download_failed',
  MEDIA_DOWNLOAD_FAILED: 'download_failed',
  UNSUPPORTED_MEDIA: 'unsupported_media',
  MEDIA_NOT_SUPPORTED: 'unsupported_media',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media',
  EXPIRED: 'expired',
  MEDIA_EXPIRED: 'expired',
  MEDIA_URL_EXPIRED: 'expired',
};

const safeGenericProviderCodes = new Set([
  'BAD_REQUEST',
  'INVALID_REQUEST',
  'INVALID_MEDIA',
  'MEDIA_ERROR',
]);

const safeMessageByCategory: Record<MediaProviderRejectionCategory, string> = {
  message_not_found: 'provider message not found',
  media_key_missing: 'provider media key missing',
  decrypt_failed: 'provider media decryption failed',
  download_failed: 'provider media download failed',
  unsupported_media: 'provider unsupported media',
  expired: 'provider media expired',
  provider_rejected_unknown: 'provider rejection',
};

const providerErrorClueKeys = new Set([
  'code',
  'error',
  'errorcode',
  'message',
  'reason',
  'details',
  'type',
  'statustext',
]);

const providerCodeKeys = new Set(['code', 'errorcode', 'type']);

const normalizeProviderCode = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/[\s-]+/g, '_').toUpperCase();
  return /^[A-Z][A-Z0-9_.]{1,63}$/.test(normalized) ? normalized : undefined;
};

const collectProviderErrorClues = (value: unknown, clues: string[], codes: string[], depth = 0) => {
  if (depth > 3 || clues.length >= 12) return;
  if (typeof value === 'string') {
    clues.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 8).forEach((item) => collectProviderErrorClues(item, clues, codes, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    const normalizedKey = key.toLowerCase();
    if (!providerErrorClueKeys.has(normalizedKey)) return;
    if (providerCodeKeys.has(normalizedKey)) {
      const code = normalizeProviderCode(item);
      if (code) codes.push(code);
    }
    collectProviderErrorClues(item, clues, codes, depth + 1);
  });
};

const categoryForProviderText = (value: string): MediaProviderRejectionCategory => {
  const text = value.toLowerCase();
  if (/message.*(?:not[\s_-]+found|does not exist|missing|undefined)|not[\s_-]+found.*message/i.test(text)) {
    return 'message_not_found';
  }
  if (/(?:media[\s_-]*key).*(?:missing|absent|undefined|null|invalid|not[\s_-]+provided|not[\s_-]+found)|(?:missing|absent|undefined|null)[^a-z]+media[\s_-]*key/i.test(text)) {
    return 'media_key_missing';
  }
  if (/(?:decrypt|decryption|bad[\s_-]+mac|cipher|integrity)/i.test(text)) {
    return 'decrypt_failed';
  }
  if (/(?:unsupported|not[\s_-]+supported|media[\s_-]*(?:type|format).*(?:invalid|not))/i.test(text)) {
    return 'unsupported_media';
  }
  if (/(?:expired|expiration|expiry|stale)/i.test(text)) {
    return 'expired';
  }
  if (/(?:download|fetch|retrieve).*(?:fail|error|unable)|(?:fail|error|unable).*(?:download|fetch|retrieve)/i.test(text)) {
    return 'download_failed';
  }
  return 'provider_rejected_unknown';
};

/**
 * Classifies an upstream rejection without returning any provider text. The
 * returned message is a fixed safe label; identifiers and sensitive fields in
 * the provider body are used only as in-memory classification clues.
 */
export const classifyMediaProviderRejection = (
  rawBody: string,
  contentType?: string | null,
): MediaProviderRejectionDiagnostics => {
  const raw = String(rawBody || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      category: 'provider_rejected_unknown',
      providerMessageSanitized: safeMessageByCategory.provider_rejected_unknown,
      responseFormat: 'empty',
    };
  }

  const clues: string[] = [];
  const codes: string[] = [];
  let responseFormat: MediaProviderRejectionResponseFormat = 'text';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    responseFormat = 'json';
    collectProviderErrorClues(parsed, clues, codes);
  } catch {
    responseFormat = contentType?.toLowerCase().includes('json') ? 'invalid_json' : 'text';
    clues.push(trimmed);
  }

  const providerErrorCode = codes.find((code) => categoryForProviderCode[code])
    || codes.find((code) => safeGenericProviderCodes.has(code));
  const category = providerErrorCode && categoryForProviderCode[providerErrorCode]
    ? categoryForProviderCode[providerErrorCode]
    : categoryForProviderText(clues.join(' '));
  return {
    category,
    ...(providerErrorCode ? { providerErrorCode } : {}),
    providerMessageSanitized: safeMessageByCategory[category],
    responseFormat,
  };
};

export const parseMediaProviderJson = (rawBody: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
};
