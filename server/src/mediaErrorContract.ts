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

export type MediaDownloadStatusClass =
  | 'not_found_404'
  | 'gone_410'
  | 'forbidden_403'
  | 'upstream_5xx'
  | 'network_error'
  | 'decrypt_error'
  | 'missing_direct_path'
  | 'missing_media_key'
  | 'unsupported_media'
  | 'unknown';

export type MediaMessageAgeBucket = 'lt_1h' | 'lt_24h' | 'lt_7d' | 'lt_30d' | 'gte_30d' | 'unknown';

export type MediaProviderRejectionDiagnostics = {
  category: MediaProviderRejectionCategory;
  providerErrorCode?: string;
  providerMessageSanitized: string;
  responseFormat: MediaProviderRejectionResponseFormat;
  downloadStatusClass: MediaDownloadStatusClass;
  hasMediaKey?: boolean;
  hasDirectPath?: boolean;
  hasValidMmgUrl?: boolean;
  hasMediaMessage?: boolean;
  hasFullMessage?: boolean;
  reuploadAttempted?: boolean;
  reuploadSucceeded?: boolean;
  reuploadFailed?: boolean;
  messageAgeBucket?: MediaMessageAgeBucket;
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

const normalizeProviderStatus = (value: unknown) => {
  const status = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
};

const downloadStatusClassForStatus = (status: number | undefined): MediaDownloadStatusClass | undefined => {
  if (status === 404) return 'not_found_404';
  if (status === 410) return 'gone_410';
  if (status === 403) return 'forbidden_403';
  if (status !== undefined && status >= 500 && status < 600) return 'upstream_5xx';
  return undefined;
};

/**
 * Read only provider error paths. The root `status` is the Evolution HTTP
 * envelope (normally 400) and is intentionally ignored; nested `status`,
 * `statusCode`, and Boom `output.statusCode` values are eligible evidence.
 */
const collectProviderStatuses = (value: unknown, statuses: number[], depth = 0) => {
  if (depth > 4 || !value || typeof value !== 'object' || Array.isArray(value)) return;
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'statuscode' || (normalizedKey === 'status' && depth > 0)) {
      const status = normalizeProviderStatus(item);
      if (status !== undefined) statuses.push(status);
    }
    if (normalizedKey === 'response' || normalizedKey === 'error' || normalizedKey === 'output') {
      collectProviderStatuses(item, statuses, depth + 1);
    }
  });
};

const optionalBooleanKeys = new Set([
  'hasMediaKey',
  'hasDirectPath',
  'hasValidMmgUrl',
  'hasMediaMessage',
  'hasFullMessage',
  'reuploadAttempted',
  'reuploadSucceeded',
  'reuploadFailed',
]);

const validMessageAgeBuckets = new Set<MediaMessageAgeBucket>([
  'lt_1h',
  'lt_24h',
  'lt_7d',
  'lt_30d',
  'gte_30d',
  'unknown',
]);

const collectOptionalDiagnostics = (value: unknown) => {
  const result: Partial<Pick<
    MediaProviderRejectionDiagnostics,
    | 'hasMediaKey'
    | 'hasDirectPath'
    | 'hasValidMmgUrl'
    | 'hasMediaMessage'
    | 'hasFullMessage'
    | 'reuploadAttempted'
    | 'reuploadSucceeded'
    | 'reuploadFailed'
    | 'messageAgeBucket'
  >> = {};

  const visit = (candidate: unknown, depth = 0) => {
    if (depth > 4 || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
    Object.entries(candidate as Record<string, unknown>).forEach(([key, item]) => {
      if (optionalBooleanKeys.has(key) && typeof item === 'boolean' && !(key in result)) {
        (result as Record<string, unknown>)[key] = item;
      }
      if (key === 'messageAgeBucket' && typeof item === 'string' && validMessageAgeBuckets.has(item as MediaMessageAgeBucket)) {
        result.messageAgeBucket ||= item as MediaMessageAgeBucket;
      }
      if (key === 'response' || key === 'error' || key === 'output') visit(item, depth + 1);
    });
  };

  visit(value);
  return result;
};

const collectDirectStringClues = (value: unknown, clues: string[]) => {
  if (typeof value === 'string') {
    clues.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 8).forEach((item) => {
      if (typeof item === 'string') clues.push(item);
    });
  }
};

/** Read only the response.message field used by Evolution's error envelope. */
const collectEvolutionResponseMessageClues = (value: unknown, clues: string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const response = (value as Record<string, unknown>).response;
  if (!response || typeof response !== 'object' || Array.isArray(response)) return;
  collectDirectStringClues((response as Record<string, unknown>).message, clues);
};

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
  if (/(?:media[\s_-]*key).*(?:missing|absent|undefined|null|empty|invalid|not[\s_-]+provided|not[\s_-]+found)|(?:missing|absent|undefined|null|empty)[^a-z]+media[\s_-]*key/i.test(text)) {
    return 'media_key_missing';
  }
  if (/(?:decrypt|decryption|bad[\s_-]+mac|cipher|integrity)/i.test(text)) {
    return 'decrypt_failed';
  }
  if (/(?:unsupported|not[\s_-]+supported|message[\s_-]+is[\s_-]+not[\s_-]+of[\s_-]+the[\s_-]+media[\s_-]+type|media[\s_-]*(?:type|format).*(?:invalid|not))/i.test(text)) {
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

const downloadStatusClassForText = (value: string): MediaDownloadStatusClass | undefined => {
  const text = value.toLowerCase();
  if (/(?:decrypt|decryption|bad[\s_-]+mac|cipher|integrity|decipher)/i.test(text)) return 'decrypt_error';
  if (/(?:media[\s_-]*key).*(?:missing|absent|undefined|null|empty|invalid|not[\s_-]+provided|not[\s_-]+found)|(?:missing|absent|undefined|null|empty)[^a-z]+media[\s_-]*key|cannot .*?(?:derive|get).*?(?:media[\s_-]*key)|empty media[\s_-]*key/i.test(text)) {
    return 'missing_media_key';
  }
  if (/(?:direct[\s_-]*path).*(?:missing|absent|undefined|null|empty|not[\s_-]+provided|not[\s_-]+found|not present)|(?:missing|absent|undefined|null|empty)[^a-z]+direct[\s_-]*path|no (?:valid )?(?:media )?(?:url|direct[\s_-]*path)|(?:media[\s_-]*url).*(?:missing|absent|undefined|null|empty)/i.test(text)) {
    return 'missing_direct_path';
  }
  if (/(?:unsupported|not[\s_-]+supported|message[\s_-]+is[\s_-]+not[\s_-]+of[\s_-]+the[\s_-]+media[\s_-]+type|media[\s_-]*(?:type|format).*(?:invalid|not))/i.test(text)) {
    return 'unsupported_media';
  }
  if (/(?:network|connection|socket|timeout|timed[\s_-]+out|econn(?:reset|refused|aborted)|enotfound)/i.test(text)) {
    return 'network_error';
  }
  return undefined;
};

/**
 * Classifies an upstream rejection without returning any provider text. The
 * returned message is a fixed safe label; identifiers and sensitive fields in
 * the provider body are used only as in-memory classification clues.
 */
export const classifyMediaProviderRejection = (
  rawBody: string,
  contentType?: string | null,
  upstreamStatus?: number,
): MediaProviderRejectionDiagnostics => {
  const raw = String(rawBody || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      category: 'provider_rejected_unknown',
      providerMessageSanitized: safeMessageByCategory.provider_rejected_unknown,
      responseFormat: 'empty',
      downloadStatusClass: downloadStatusClassForStatus(upstreamStatus) || 'unknown',
    };
  }

  const clues: string[] = [];
  const responseMessageClues: string[] = [];
  const codes: string[] = [];
  let parsed: unknown;
  let responseFormat: MediaProviderRejectionResponseFormat = 'text';
  try {
    parsed = JSON.parse(trimmed);
    responseFormat = 'json';
    collectEvolutionResponseMessageClues(parsed, responseMessageClues);
    collectProviderErrorClues(parsed, clues, codes);
  } catch {
    responseFormat = contentType?.toLowerCase().includes('json') ? 'invalid_json' : 'text';
    clues.push(trimmed);
  }

  const providerErrorCode = codes.find((code) => categoryForProviderCode[code])
    || codes.find((code) => safeGenericProviderCodes.has(code));
  const category = providerErrorCode && categoryForProviderCode[providerErrorCode]
    ? categoryForProviderCode[providerErrorCode]
    : categoryForProviderText([...responseMessageClues, ...clues].join(' '));
  const providerStatuses: number[] = [];
  collectProviderStatuses(parsed, providerStatuses);
  const statusClass = providerStatuses
    .map((status) => downloadStatusClassForStatus(status))
    .find((candidate): candidate is MediaDownloadStatusClass => Boolean(candidate));
  const downloadStatusClass = statusClass
    || downloadStatusClassForStatus(upstreamStatus)
    || downloadStatusClassForText([...responseMessageClues, ...clues].join(' '))
    || 'unknown';
  return {
    category,
    ...(providerErrorCode ? { providerErrorCode } : {}),
    providerMessageSanitized: safeMessageByCategory[category],
    responseFormat,
    downloadStatusClass,
    ...collectOptionalDiagnostics(parsed),
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
