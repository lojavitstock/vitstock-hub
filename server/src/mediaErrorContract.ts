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

export const parseMediaProviderJson = (rawBody: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
};
