import { createHmac } from 'node:crypto';
import { config } from './config.js';
import { evolutionRecipientDiagnostics } from './evolutionProviderDiagnostics.js';

export type ReplyFailureTraceInput = {
  replyTraceId?: string;
  companyId?: string;
  conversationId?: string;
  localMessageId?: string;
  clientMessageId?: string;
  requestId?: string;
  quote?: any;
  recipient?: { number?: string; remoteJid?: string };
  messageType: string;
  backendStatus?: number;
  errorCode?: string;
  failureOrigin: 'request_validation' | 'backend_rejected' | 'persistence' | 'evolution_network' | 'evolution_rejected' | 'unknown';
  evolutionStatus?: number;
  evolutionStatusText?: string;
  providerError?: unknown;
  media?: {
    mediatype?: string;
    mimetype?: string;
    extension?: string;
    base64Length?: number;
    hasCaption?: boolean;
    captionLength?: number;
  };
};

type ReplyProviderKeySource = 'raw' | 'metadata' | 'legacy' | 'none';
type ReplySourceAge = 'RECENT' | 'OLDER' | 'LEGACY' | 'UNKNOWN';
type ReplyAgeBucket = 'LT_5M' | '5M_TO_1H' | '1H_TO_24H' | '1D_TO_7D' | '7D_TO_30D' | 'GT_30D' | 'UNKNOWN';

/** Stable across backend workers while the existing server secret stays constant. */
export const fingerprintReplyTraceValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value) return undefined;
  return createHmac('sha256', config.SESSION_SECRET).update('reply-trace:').update(value).digest('hex').slice(0, 20);
};

export const replyTraceIdentifier = (value: unknown) => {
  const present = typeof value === 'string' && value.length > 0;
  return {
    present,
    ...(present ? { length: value.length, fingerprint: fingerprintReplyTraceValue(value) } : {}),
  };
};

export const replyTraceLogFields = (value: unknown) => {
  const identifier = replyTraceIdentifier(value);
  return {
    replyTraceIdPresent: identifier.present,
    ...(identifier.present ? {
      replyTraceIdLength: identifier.length,
      replyTraceFingerprint: identifier.fingerprint,
    } : {}),
  };
};

export const replyTraceJidKind = (value: unknown): 'PN' | 'LID' | 'GROUP' | 'OTHER' | 'ABSENT' => {
  if (typeof value !== 'string' || !value.trim()) return 'ABSENT';
  const normalized = value.trim().toLowerCase();
  if (normalized.endsWith('@g.us')) return 'GROUP';
  if (normalized.endsWith('@lid')) return 'LID';
  if (normalized.endsWith('@s.whatsapp.net')) return 'PN';
  return 'OTHER';
};

const quoteSource = (quote: any): ReplyProviderKeySource => {
  switch (quote?.providerKeySource) {
    case 'raw': return 'raw';
    case 'metadata':
    case 'providerKey': return 'metadata';
    case 'none': return 'none';
    case 'legacy':
    case 'legacyFallback': return 'legacy';
    default: return 'none';
  }
};

const messageIdSource = (quote: any): 'rawKey' | 'providerKey' | 'messageIdFallback' | 'unknown' => {
  switch (quote?.providerKeySource) {
    case 'raw': return 'rawKey';
    case 'metadata':
    case 'providerKey': return 'providerKey';
    case 'legacy':
    case 'legacyFallback': return 'messageIdFallback';
    default: return 'unknown';
  }
};

const sourceAge = (quote: any): ReplySourceAge => (
  quote?.sourceAge === 'RECENT'
    || quote?.sourceAge === 'OLDER'
    || quote?.sourceAge === 'LEGACY'
    ? quote.sourceAge
    : 'UNKNOWN'
);

const quoteStructurallyValid = (quote: any) => Boolean(
  quote?.key
  && typeof quote.key.id === 'string'
  && quote.key.id.trim()
  && typeof quote.key.remoteJid === 'string'
  && quote.key.remoteJid.trim()
  && typeof quote.key.fromMe === 'boolean',
);

const safeMessageType = (value: unknown) => (
  ['text', 'image', 'video', 'document', 'audio', 'sticker', 'location', 'other'].includes(String(value))
    ? String(value)
    : 'unknown'
);

const SAFE_BACKEND_ERROR_CODES = new Set([
  'invalid_message_payload', 'invalid_media_payload', 'conversation_lease_active',
  'evolution_unavailable', 'evolution_provider_error', 'persistence_failed',
  'destination_not_authorized', 'unsupported_provider_entity', 'conversation_not_found',
]);

const safeBackendErrorCode = (value: unknown) => (
  typeof value === 'string' && SAFE_BACKEND_ERROR_CODES.has(value) ? value : undefined
);

const normalizeFailureOrigin = (value: ReplyFailureTraceInput['failureOrigin']) => {
  switch (value) {
    case 'request_validation': return 'validation';
    case 'evolution_rejected': return 'provider';
    case 'evolution_network': return 'network';
    case 'persistence': return 'persistence';
    default: return 'unknown';
  }
};

const safeProviderErrorCode = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const candidate = record.code ?? record.errorCode ?? record.error;
  if (typeof candidate !== 'string') return undefined;
  const normalized = candidate.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const knownCodes = new Set([
    'bad_request', 'invalid_message', 'invalid_message_payload', 'invalid_jid', 'invalid_number',
    'invalid_recipient', 'message_not_found', 'not_found', 'unauthorized', 'forbidden',
    'rate_limited', 'too_many_requests', 'internal_server_error',
  ]);
  return knownCodes.has(normalized) ? normalized : undefined;
};

const safeProviderErrorClass = (value: unknown, failureOrigin?: ReplyFailureTraceInput['failureOrigin']) => {
  if (typeof value === 'string' && ['http_rejected', 'network_error', 'timeout', 'unknown'].includes(value)) return value;
  if (failureOrigin === 'evolution_network') return 'network_error';
  if (failureOrigin === 'evolution_rejected') return 'http_rejected';
  return undefined;
};

const sameOrUnknown = (left: unknown, right: unknown) => (
  typeof left === 'string' && typeof right === 'string' ? left === right : 'unknown'
);

const safeAddressingMode = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return 'ABSENT';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'pn' || normalized === 'lid') return normalized.toUpperCase();
  return 'OTHER';
};

const fieldSummary = (value: unknown) => ({
  ...replyTraceIdentifier(value),
  jidType: replyTraceJidKind(value),
});

export const replySourceAgeBucket = (timestampMs: unknown, nowMs = Date.now()): ReplyAgeBucket => {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) || timestampMs <= 0 || !Number.isFinite(nowMs)) return 'UNKNOWN';
  const ageMs = Math.max(0, nowMs - timestampMs);
  if (ageMs < 5 * 60_000) return 'LT_5M';
  if (ageMs < 60 * 60_000) return '5M_TO_1H';
  if (ageMs < 24 * 60 * 60_000) return '1H_TO_24H';
  if (ageMs < 7 * 24 * 60 * 60_000) return '1D_TO_7D';
  if (ageMs < 30 * 24 * 60 * 60_000) return '7D_TO_30D';
  return 'GT_30D';
};

export const buildReplyTraceDetails = (
  quote: any,
  messageType = 'text',
  context: { conversationRemoteJid?: string; sourceAgeBucket?: ReplyAgeBucket; sourcePersistenceOrigin?: 'unknown' } = {},
) => {
  const quoteKey = quote?.key;
  const providerKeySource = quoteSource(quote);
  const idSource = messageIdSource(quote);
  const fromMe = typeof quoteKey?.fromMe === 'boolean' ? quoteKey.fromMe : 'ABSENT';
  const sourceMediaType = safeMessageType(quote?.sourceMediaType || quote?.mediaType || messageType);
  const keyId = quoteKey?.id;
  const quoteMessageId = quote?.messageId;
  const quotedRemoteJid = quoteKey?.remoteJid;
  const conversationRemoteJid = context.conversationRemoteJid;
  const participant = quoteKey?.participant;
  const participantAlt = quoteKey?.participantAlt;
  const senderPn = quoteKey?.senderPn;
  const participantPn = quoteKey?.participantPn;
  const remoteJidAlt = quoteKey?.remoteJidAlt;
  const quotedKey = {
    idPresent: Boolean(keyId),
    idFingerprint: replyTraceIdentifier(keyId).fingerprint,
    idLength: replyTraceIdentifier(keyId).length,
    idSource,
    remoteJidPresent: Boolean(quotedRemoteJid),
    remoteJidType: replyTraceJidKind(quotedRemoteJid),
    remoteJidFingerprint: replyTraceIdentifier(quotedRemoteJid).fingerprint,
    fromMePresent: typeof quoteKey?.fromMe === 'boolean',
    fromMeValue: fromMe === 'ABSENT' ? undefined : fromMe,
    participantPresent: Boolean(participant),
    participantType: replyTraceJidKind(participant),
    participantFingerprint: replyTraceIdentifier(participant).fingerprint,
    remoteJidAltPresent: Boolean(remoteJidAlt),
    remoteJidAltType: replyTraceJidKind(remoteJidAlt),
    remoteJidAltFingerprint: replyTraceIdentifier(remoteJidAlt).fingerprint,
    participantAltPresent: Boolean(participantAlt),
    participantAltType: replyTraceJidKind(participantAlt),
    participantAltFingerprint: replyTraceIdentifier(participantAlt).fingerprint,
    senderPnPresent: Boolean(senderPn),
    senderPnType: replyTraceJidKind(senderPn),
    senderPnFingerprint: replyTraceIdentifier(senderPn).fingerprint,
    participantPnPresent: Boolean(participantPn),
    participantPnType: replyTraceJidKind(participantPn),
    participantPnFingerprint: replyTraceIdentifier(participantPn).fingerprint,
    addressingModePresent: Boolean(quoteKey?.addressingMode),
    addressingMode: safeAddressingMode(quoteKey?.addressingMode),
  };
  const sourceDirection = fromMe === true ? 'outbound' : fromMe === false ? 'inbound' : 'unknown';
  return {
    messageType: sourceMediaType,
    sourceMessageType: sourceMediaType,
    sourceMediaType,
    sourceDirection,
    sourceAge: sourceAge(quote),
    sourceAgeBucket: context.sourceAgeBucket || 'UNKNOWN',
    sourcePersistenceOrigin: context.sourcePersistenceOrigin || 'unknown',
    providerKeySource,
    messageIdSource: idSource,
    providerMessageIdPresent: idSource === 'providerKey' && Boolean(keyId),
    quotedKeyId: replyTraceIdentifier(keyId),
    quotedMessageId: replyTraceIdentifier(quoteMessageId),
    keyIdMatchesMessageIdExactly: typeof keyId === 'string' && typeof quoteMessageId === 'string'
      ? keyId === quoteMessageId
      : undefined,
    quotedRemoteJid: fieldSummary(quotedRemoteJid),
    quotedRemoteJidAlt: fieldSummary(quoteKey?.remoteJidAlt),
    conversationRemoteJid: fieldSummary(conversationRemoteJid),
    sourceRemoteJid: fieldSummary(quotedRemoteJid),
    sourceRemoteJidAlt: fieldSummary(remoteJidAlt),
    conversationJid: fieldSummary(conversationRemoteJid),
    quotedRemoteJidMatchesConversationExactly: sameOrUnknown(quotedRemoteJid, conversationRemoteJid),
    sourceRemoteJidSameAsConversation: sameOrUnknown(quotedRemoteJid, conversationRemoteJid),
    sourceRemoteJidAltSameAsConversation: sameOrUnknown(remoteJidAlt, conversationRemoteJid),
    fromMe,
    fromMePresent: quotedKey.fromMePresent,
    fromMeValue: quotedKey.fromMeValue,
    quotedKey,
    participant: fieldSummary(participant),
    participantAlt: fieldSummary(participantAlt),
    senderPn: fieldSummary(senderPn),
    participantPn: fieldSummary(participantPn),
    addressingMode: safeAddressingMode(quoteKey?.addressingMode),
    participantPresent: Boolean(participant || participantAlt || participantPn),
    quotedKeyIdPresent: Boolean(keyId),
    quotedRemoteJidPresent: Boolean(quotedRemoteJid),
    quotedParticipantPresent: Boolean(participant || participantAlt || participantPn),
  };
};

const safeValidationIssues = (issues: unknown) => (Array.isArray(issues) ? issues : []).slice(0, 12).map((issue: any) => ({
  path: Array.isArray(issue?.path)
    ? issue.path.map((part: unknown) => typeof part === 'number'
      ? part
      : typeof part === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(part) ? part : '[field]').join('.').slice(0, 120)
    : '',
  code: typeof issue?.code === 'string' && /^[a-z_]{1,40}$/.test(issue.code) ? issue.code : 'unknown',
  ...(typeof issue?.expected === 'string' && /^[a-z_]{1,24}$/.test(issue.expected) ? { expected: issue.expected } : {}),
  ...(typeof issue?.received === 'string' && /^[a-z_]{1,24}$/.test(issue.received) ? { received: issue.received } : {}),
}));

export const buildReplyValidationTrace = (input: {
  outcome: 'started' | 'accepted' | 'rejected';
  replyTraceId?: string;
  quote?: unknown;
  conversationRemoteJid?: string;
  messageType?: string;
  issues?: unknown;
  httpStatus?: number;
  errorCode?: string;
}) => ({
  event: input.outcome === 'rejected' ? 'reply_send_validation_failure' : 'reply_send_validation_stage',
  outcome: input.outcome,
  stage: `validation.${input.outcome}`,
  httpStatus: input.outcome === 'rejected' ? input.httpStatus ?? 400 : undefined,
  errorCode: input.outcome === 'rejected' ? safeBackendErrorCode(input.errorCode || 'invalid_message_payload') : undefined,
  timestamp: new Date().toISOString(),
  ...replyTraceLogFields(input.replyTraceId),
  replyTarget: buildReplyTraceDetails(input.quote, input.messageType, {
    conversationRemoteJid: input.conversationRemoteJid,
    sourcePersistenceOrigin: 'unknown',
  }),
  zodIssues: input.outcome === 'rejected' ? safeValidationIssues(input.issues) : undefined,
});

export const buildReplyProviderTrace = (input: {
  phase: 'request' | 'response';
  endpoint: 'sendText' | 'sendMedia';
  replyTraceId?: string;
  quote?: unknown;
  conversationRemoteJid?: string;
  messageType?: string;
  ok?: boolean;
  httpStatus?: number;
  elapsedMs?: number;
  failureOrigin?: 'evolution_network' | 'evolution_rejected' | 'unknown';
  providerErrorClass?: string;
  providerError?: unknown;
}) => ({
  event: `reply_send_provider_${input.phase}`,
  timestamp: new Date().toISOString(),
  ...replyTraceLogFields(input.replyTraceId),
  endpoint: input.endpoint,
  destinationJidType: replyTraceJidKind(input.conversationRemoteJid),
  destinationFingerprint: replyTraceIdentifier(input.conversationRemoteJid).fingerprint,
  replyTarget: buildReplyTraceDetails(input.quote, input.messageType, {
    conversationRemoteJid: input.conversationRemoteJid,
    sourcePersistenceOrigin: 'unknown',
  }),
  ok: input.ok,
  httpStatus: input.httpStatus,
  elapsedMs: input.elapsedMs,
  failureOrigin: input.failureOrigin === 'evolution_rejected'
    ? 'provider'
    : input.failureOrigin === 'evolution_network' ? 'network' : undefined,
  success: input.ok,
  sanitizedProviderErrorCode: safeProviderErrorCode(input.providerError),
  sanitizedProviderErrorClass: safeProviderErrorClass(input.providerErrorClass, input.failureOrigin),
});

export const buildReplySuccessTrace = (input: {
  replyTraceId?: string;
  companyId?: string;
  conversationId?: string;
  localMessageId?: string;
  clientMessageId?: string;
  requestId?: string;
  quote?: unknown;
  conversationRemoteJid?: string;
  messageType?: string;
  httpStatus?: number;
  recipient?: { number?: string; remoteJid?: string };
}) => ({
  event: 'reply_send_success',
  timestamp: new Date().toISOString(),
  ...replyTraceLogFields(input.replyTraceId),
  companyId: replyTraceIdentifier(input.companyId),
  conversationId: replyTraceIdentifier(input.conversationId),
  localMessageId: replyTraceIdentifier(input.localMessageId),
  clientMessageId: replyTraceIdentifier(input.clientMessageId),
  requestId: replyTraceIdentifier(input.requestId),
  replyTarget: {
    hubMessageId: replyTraceIdentifier((input.quote as any)?.messageId),
    evolutionMessageIdPresent: messageIdSource(input.quote) === 'providerKey' && Boolean((input.quote as any)?.key?.id),
    providerKeyPresent: messageIdSource(input.quote) === 'providerKey',
    ...buildReplyTraceDetails(input.quote, input.messageType, {
    conversationRemoteJid: input.conversationRemoteJid,
    sourcePersistenceOrigin: 'unknown',
    }),
  },
  outbound: {
    recipientType: input.recipient
      ? evolutionRecipientDiagnostics({ number: input.recipient.number || '', remoteJid: input.recipient.remoteJid }).recipientType
      : undefined,
    quotePresent: Boolean(input.quote),
    quoteSource: input.quote ? quoteSource(input.quote) : undefined,
    payloadQuoteStructurallyValid: input.quote ? quoteStructurallyValid(input.quote) : undefined,
  },
  backend: { status: 200, failureOrigin: 'none' },
  evolution: { ...replyTraceLogFields(input.replyTraceId), httpStatus: input.httpStatus },
});

/**
 * Build one safe event for a failed outbound reply. The key is process-scoped,
 * so repeated identifiers can be correlated without logging their raw values.
 */
export const buildReplyFailureTrace = (input: ReplyFailureTraceInput) => {
  const quote = input.quote;
  const recipientDiagnostics = input.recipient
    ? evolutionRecipientDiagnostics({
      number: input.recipient.number || '',
      remoteJid: input.recipient.remoteJid,
    })
    : undefined;
  const source = quoteSource(quote);
  const replyDetails = buildReplyTraceDetails(quote, input.messageType, {
    conversationRemoteJid: input.conversationId,
    sourcePersistenceOrigin: 'unknown',
  });
  return {
    event: 'reply_send_failure',
    timestamp: new Date().toISOString(),
    ...replyTraceLogFields(input.replyTraceId),
    companyId: replyTraceIdentifier(input.companyId),
    conversationId: replyTraceIdentifier(input.conversationId),
    localMessageId: replyTraceIdentifier(input.localMessageId),
    clientMessageId: replyTraceIdentifier(input.clientMessageId),
    requestId: replyTraceIdentifier(input.requestId),
    replyTarget: {
      hubMessageId: replyTraceIdentifier(quote?.messageId),
      evolutionMessageIdPresent: replyDetails.providerMessageIdPresent,
      providerKeyPresent: source === 'metadata',
      ...replyDetails,
    },
    outbound: {
      recipientType: recipientDiagnostics?.recipientType,
      numberKind: recipientDiagnostics?.numberKind,
      remoteJidKind: recipientDiagnostics?.remoteJidKind,
      quotePresent: Boolean(quote),
      quoteSource: quote ? source : undefined,
      payloadQuoteStructurallyValid: quote ? quoteStructurallyValid(quote) : undefined,
    },
    media: input.media ? {
      mediatype: safeMessageType(input.media.mediatype),
      mimetype: typeof input.media.mimetype === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(input.media.mimetype)
        ? input.media.mimetype.slice(0, 100)
        : undefined,
      extension: typeof input.media.extension === 'string' && /^[a-z0-9]{1,12}$/i.test(input.media.extension)
        ? input.media.extension.toLowerCase()
        : undefined,
      base64Length: input.media.base64Length,
      hasCaption: input.media.hasCaption,
      captionLength: input.media.captionLength,
    } : undefined,
    backend: {
      status: input.backendStatus,
      errorCode: safeBackendErrorCode(input.errorCode),
      failureOrigin: normalizeFailureOrigin(input.failureOrigin),
    },
    evolution: {
      ...replyTraceLogFields(input.replyTraceId),
      httpStatus: input.evolutionStatus,
      sanitizedProviderErrorCode: safeProviderErrorCode(input.providerError),
      sanitizedProviderErrorClass: safeProviderErrorClass(undefined, input.failureOrigin),
    },
  };
};
