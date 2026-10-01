import type { Message } from '../types';

type OutboundTraceContext = {
  clientMessageId: string;
  conversationId: string;
  kind: 'text' | 'media';
  replyTraceId?: string;
  submitSource?: 'click' | 'keyboard';
  quote?: any;
  sourceMessage?: Message;
};

type TraceSource = Pick<Message, 'id' | 'conversationId' | 'timestampMs' | 'rawKey' | 'metadata' | 'sender' | 'mediaType'>;

const isOutboundTraceEnabled = () => import.meta.env?.VITE_OUTBOUND_TRACE === 'true';
const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

const createSessionSalt = () => {
  try {
    if (typeof globalThis.crypto?.getRandomValues !== 'function') return undefined;
    return globalThis.crypto.getRandomValues(new Uint8Array(32));
  } catch {
    return undefined;
  }
};

const sessionSalt = createSessionSalt();

const fingerprint = async (value: unknown): Promise<string | undefined> => {
  if (typeof value !== 'string' || !value || !sessionSalt || typeof globalThis.crypto?.subtle?.digest !== 'function') return undefined;
  try {
    const encoded = new TextEncoder().encode(value);
    const bytes = new Uint8Array(sessionSalt.length + encoded.length);
    bytes.set(sessionSalt, 0);
    bytes.set(encoded, sessionSalt.length);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest.slice(0, 10), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
};

const identifier = async (value: unknown) => {
  const present = typeof value === 'string' && value.length > 0;
  return {
    present,
    ...(present ? { length: value.length, fingerprint: await fingerprint(value) } : {}),
  };
};

const replyTraceLogFields = async (value: unknown) => {
  const details = await identifier(value);
  return {
    replyTraceIdPresent: details.present,
    ...(details.present ? {
      replyTraceIdLength: details.length,
      replyTraceFingerprint: details.fingerprint,
    } : {}),
  };
};

const jidKind = (value: unknown): 'PN' | 'LID' | 'GROUP' | 'OTHER' | 'ABSENT' => {
  if (typeof value !== 'string' || !value.trim()) return 'ABSENT';
  const normalized = value.trim().toLowerCase();
  if (normalized.endsWith('@g.us')) return 'GROUP';
  if (normalized.endsWith('@lid')) return 'LID';
  if (normalized.endsWith('@s.whatsapp.net')) return 'PN';
  return 'OTHER';
};

const identifierField = async (value: unknown) => ({
  ...(await identifier(value)),
  jidType: jidKind(value),
});

const validMessageType = (value: unknown) => (
  ['text', 'image', 'video', 'document', 'audio', 'sticker', 'location', 'other'].includes(String(value))
    ? String(value)
    : 'unknown'
);

const sourceAgeBucket = (timestampMs: unknown, nowMs = Date.now()) => {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) || timestampMs <= 0 || !Number.isFinite(nowMs)) return 'UNKNOWN';
  const ageMs = Math.max(0, nowMs - timestampMs);
  if (ageMs < 5 * 60_000) return 'LT_5M';
  if (ageMs < 60 * 60_000) return '5M_TO_1H';
  if (ageMs < 24 * 60 * 60_000) return '1H_TO_24H';
  if (ageMs < 7 * 24 * 60 * 60_000) return '1D_TO_7D';
  if (ageMs < 30 * 24 * 60 * 60_000) return '7D_TO_30D';
  return 'GT_30D';
};

const sameOrUnknown = (left: unknown, right: unknown) => (
  typeof left === 'string' && typeof right === 'string' ? left === right : 'unknown'
);

const SAFE_HUB_ERROR_CODES = new Set([
  'invalid_message_payload', 'invalid_media_payload', 'conversation_lease_active',
  'evolution_unavailable', 'evolution_provider_error', 'persistence_failed',
  'destination_not_authorized', 'unsupported_provider_entity', 'conversation_not_found',
]);

const sourceKeyFor = (source?: TraceSource) => {
  if (!source) return undefined;
  if (source.rawKey && typeof source.rawKey === 'object') return source.rawKey;
  if (source.metadata?.providerKey && typeof source.metadata.providerKey === 'object') return source.metadata.providerKey;
  return undefined;
};

const messageIdSourceFor = (source: TraceSource | undefined, quote: any) => {
  if (source) {
    const key = sourceKeyFor(source);
    if (typeof key?.id === 'string' && key.id) return source.rawKey === key ? 'rawKey' : 'providerKey';
    if (typeof source.id === 'string' && source.id) return 'messageIdFallback';
    return 'unknown';
  }
  switch (quote?.providerKeySource) {
    case 'raw': return 'rawKey';
    case 'metadata':
    case 'providerKey': return 'providerKey';
    case 'legacy':
    case 'legacyFallback': return 'messageIdFallback';
    default: return 'unknown';
  }
};

/** Safe source/quote summary for diagnostics; it never mutates the send payload. */
export const buildFrontendReplyTraceSummary = async (input: {
  quote?: any;
  sourceMessage?: TraceSource;
  conversationId?: string;
  nowMs?: number;
}) => {
  const sourceKey = sourceKeyFor(input.sourceMessage);
  const quoteKey = sourceKey || input.quote?.key;
  const payloadQuoteKey = input.quote?.key;
  const sourceConversationId = input.sourceMessage?.conversationId;
  const sourceId = input.sourceMessage?.id || input.quote?.messageId;
  const quoteId = payloadQuoteKey?.id || input.quote?.messageId || sourceKey?.id;
  const quoteMessageId = input.quote?.messageId;
  const fromMeValue = typeof sourceKey?.fromMe === 'boolean'
    ? sourceKey.fromMe
    : typeof input.quote?.key?.fromMe === 'boolean' ? input.quote.key.fromMe : undefined;
  const fromMeSource = typeof sourceKey?.fromMe === 'boolean'
    ? input.sourceMessage?.rawKey === sourceKey ? 'rawKey' : 'providerKey'
    : typeof input.quote?.key?.fromMe === 'boolean' ? 'quotedKey' : 'unknown';
  const jid = payloadQuoteKey?.remoteJid;
  const participant = quoteKey?.participant;
  const participantAlt = quoteKey?.participantAlt;
  const senderPn = quoteKey?.senderPn;
  const participantPn = quoteKey?.participantPn;
  const messageIdSource = messageIdSourceFor(input.sourceMessage, input.quote);
  const quotedKey = {
    idPresent: Boolean(quoteId),
    idFingerprint: (await identifier(quoteId)).fingerprint,
    idLength: (await identifier(quoteId)).length,
    idSource: messageIdSource,
    remoteJidPresent: Boolean(jid),
    remoteJidType: jidKind(jid),
    remoteJidFingerprint: (await identifier(jid)).fingerprint,
    fromMePresent: typeof fromMeValue === 'boolean',
    fromMeValue: fromMeValue ?? 'ABSENT',
    fromMeSource,
    participantPresent: Boolean(participant),
    participantType: jidKind(participant),
    participantFingerprint: (await identifier(participant)).fingerprint,
    remoteJidAltPresent: Boolean(quoteKey?.remoteJidAlt),
    remoteJidAltType: jidKind(quoteKey?.remoteJidAlt),
    remoteJidAltFingerprint: (await identifier(quoteKey?.remoteJidAlt)).fingerprint,
    participantAltPresent: Boolean(participantAlt),
    participantAltType: jidKind(participantAlt),
    participantAltFingerprint: (await identifier(participantAlt)).fingerprint,
    senderPnPresent: Boolean(senderPn),
    senderPnType: jidKind(senderPn),
    senderPnFingerprint: (await identifier(senderPn)).fingerprint,
    participantPnPresent: Boolean(participantPn),
    participantPnType: jidKind(participantPn),
    participantPnFingerprint: (await identifier(participantPn)).fingerprint,
    addressingModePresent: Boolean(quoteKey?.addressingMode),
    addressingMode: typeof quoteKey?.addressingMode === 'string' && ['pn', 'lid'].includes(quoteKey.addressingMode.toLowerCase())
      ? quoteKey.addressingMode.toUpperCase()
      : quoteKey?.addressingMode ? 'OTHER' : 'ABSENT',
  };
  const conversationJidFingerprint = (await identifier(input.conversationId)).fingerprint;
  return {
    messageType: validMessageType(input.quote?.sourceMediaType || input.quote?.mediaType || input.sourceMessage?.mediaType),
    sourceMessageType: validMessageType(input.quote?.sourceMediaType || input.quote?.mediaType || input.sourceMessage?.mediaType),
    sourcePersistenceOrigin: 'unknown',
    messageIdSource,
    providerMessageIdPresent: messageIdSource === 'providerKey' && Boolean(quoteKey?.id),
    sourceMessageId: await identifier(sourceId),
    sourceMessageIdFingerprint: (await identifier(sourceId)).fingerprint,
    quotedKeyId: await identifier(quoteId),
    quotedMessageId: await identifier(quoteMessageId),
    keyIdMatchesMessageIdExactly: typeof quoteId === 'string' && typeof quoteMessageId === 'string' ? quoteId === quoteMessageId : undefined,
    conversationRemoteJid: await identifierField(input.conversationId),
    sourceConversationRemoteJid: await identifierField(sourceConversationId),
    sourceRemoteJid: await identifierField(sourceKey?.remoteJid),
    quotedRemoteJid: await identifierField(jid),
    quotedRemoteJidAlt: await identifierField(quoteKey?.remoteJidAlt),
    quotedRemoteJidMatchesConversationExactly: sameOrUnknown(jid, input.conversationId),
    sourceConversationMatchesQuotedRemoteJidExactly: typeof sourceConversationId === 'string' && typeof jid === 'string'
      ? sourceConversationId === jid
      : undefined,
    sourceRemoteJidMatchesConversationExactly: sameOrUnknown(sourceKey?.remoteJid, input.conversationId),
    sourceRemoteJidSameAsConversation: sameOrUnknown(sourceKey?.remoteJid, input.conversationId),
    sourceRemoteJidAltSameAsConversation: sameOrUnknown(sourceKey?.remoteJidAlt, input.conversationId),
    fromMe: typeof fromMeValue === 'boolean' ? fromMeValue : 'ABSENT',
    fromMePresent: typeof fromMeValue === 'boolean',
    fromMeValue: fromMeValue ?? 'ABSENT',
    sourceDirection: fromMeValue === true ? 'outbound' : fromMeValue === false ? 'inbound' : 'unknown',
    quotedKey,
    conversationJidType: jidKind(input.conversationId),
    conversationJidFingerprint,
    sourceAgeBucket: sourceAgeBucket(input.sourceMessage?.timestampMs, input.nowMs),
    participant: await identifierField(participant),
    participantAlt: await identifierField(participantAlt),
    senderPn: await identifierField(senderPn),
    participantPn: await identifierField(participantPn),
    addressingMode: typeof quoteKey?.addressingMode === 'string' && ['pn', 'lid'].includes(quoteKey.addressingMode.toLowerCase())
      ? quoteKey.addressingMode.toUpperCase()
      : quoteKey?.addressingMode ? 'OTHER' : 'ABSENT',
    fields: {
      sourceMessageIdPresent: Boolean(sourceId),
      quoteKeyIdPresent: Boolean(quoteId),
      quotedRemoteJidPresent: Boolean(jid),
      remoteJidAltPresent: Boolean(quoteKey?.remoteJidAlt),
      participantPresent: Boolean(participant),
      participantAltPresent: Boolean(participantAlt),
      senderPnPresent: Boolean(senderPn),
      participantPnPresent: Boolean(participantPn),
      fromMePresent: typeof fromMeValue === 'boolean',
      addressingModePresent: Boolean(quoteKey?.addressingMode),
    },
  };
};

const SAFE_DETAIL_KEYS = new Set([
  'ok', 'status', 'errorCode', 'elapsedMs', 'statusCode', 'attempt', 'state', 'kind', 'messageType',
  'submitSource', 'sourcePath', 'deduplicated', 'hasQuote', 'quotePresent', 'payloadQuoteStructurallyValid',
  'httpStarted', 'httpCompleted', 'captionLength', 'base64Length', 'mediatype', 'mimetype',
]);
const IDENTIFIER_DETAIL_KEY = /(id|jid|phone|number|participant|alias)$/i;

const safeDetails = async (details?: Record<string, unknown>) => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (IDENTIFIER_DETAIL_KEY.test(key)) {
      if (typeof value === 'string') output[`${key}Fingerprint`] = await fingerprint(value);
      output[`${key}Present`] = value !== undefined && value !== null && value !== '';
      if (typeof value === 'string') output[`${key}Length`] = value.length;
      continue;
    }
    if (!SAFE_DETAIL_KEYS.has(key) || !(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)) continue;
    if (typeof value === 'string' && key === 'errorCode') {
      if (SAFE_HUB_ERROR_CODES.has(value)) output[key] = value;
    } else if (typeof value === 'string' && key === 'sourcePath') {
      if (/^[a-z0-9_./-]{1,100}$/i.test(value)) output[key] = value;
    } else {
      output[key] = value;
    }
  }
  return output;
};

const emitSafeTrace = async (level: 'info' | 'warn', event: Record<string, unknown>, identifierValues: Record<string, unknown>) => {
  const identifiers = Object.fromEntries(await Promise.all(Object.entries(identifierValues).map(async ([key, value]) => [key, await identifier(value)])));
  const payload = { ...event, ...identifiers };
  console[level]('[OUTBOUND_TRACE]', JSON.stringify(payload));
};

/** Opt-in browser-side timing. Identifiers are session-keyed fingerprints only. */
export const createOutboundTrace = (context: OutboundTraceContext) => {
  const startedAt = now();
  return (stage: string, details?: Record<string, unknown>) => {
    if (!isOutboundTraceEnabled()) return;
    void (async () => {
      const safe = await safeDetails(details);
      const reply = context.quote
        ? await buildFrontendReplyTraceSummary({ quote: context.quote, sourceMessage: context.sourceMessage, conversationId: context.conversationId })
        : undefined;
      await emitSafeTrace('info', {
        runtime: 'frontend',
        timestampMs: Date.now(),
        elapsedMs: Math.round(now() - startedAt),
        stage: /^[a-z0-9_.-]{1,64}$/i.test(stage) ? stage : 'unknown',
        kind: context.kind,
        ...await replyTraceLogFields(context.replyTraceId),
        submitSource: context.submitSource,
        conversationJidType: jidKind(context.conversationId),
        conversationJidFingerprint: (await identifier(context.conversationId)).fingerprint,
        reply,
        ...safe,
      }, { clientMessageId: context.clientMessageId, conversationId: context.conversationId });
    })();
  };
};

/** Generates a non-secret correlation id for one reply attempt. */
export const createReplyTraceId = () => {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `reply-${uuid}`;
};

/** Failure diagnostics contain no raw message text, media, or identifiers. */
export const traceReplySendFailure = (input: {
  replyTraceId: string;
  conversationId: string;
  localMessageId: string;
  quote: any;
  sourceMessage?: TraceSource;
  kind: 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker';
  status?: number;
  errorCode?: string;
}) => {
  if (!isOutboundTraceEnabled()) return;
  void (async () => {
    const replyTarget = await buildFrontendReplyTraceSummary({
      quote: input.quote,
      sourceMessage: input.sourceMessage,
      conversationId: input.conversationId,
    });
    const errorCode = typeof input.errorCode === 'string' && SAFE_HUB_ERROR_CODES.has(input.errorCode)
      ? input.errorCode
      : undefined;
    await emitSafeTrace('warn', {
      runtime: 'frontend',
      event: 'reply_send_failure',
      timestamp: new Date().toISOString(),
      ...await replyTraceLogFields(input.replyTraceId),
      replyTarget,
      outbound: {
        recipientType: jidKind(input.conversationId),
        quotePresent: true,
        payloadQuoteStructurallyValid: Boolean(input.quote?.key?.id && input.quote?.key?.remoteJid && typeof input.quote?.key?.fromMe === 'boolean'),
      },
      backend: { status: input.status, errorCode },
    }, { conversationId: input.conversationId, localMessageId: input.localMessageId });
  })();
};

/** Emits only an explicit Hub correlation from realtime; incoming messages are skipped. */
export const traceOutboundRealtimeAck = (input: {
  conversationId: string;
  clientMessageId?: string;
  evolutionMessageId?: string;
  status?: string;
}) => {
  if (!isOutboundTraceEnabled() || !input.clientMessageId) return;
  void emitSafeTrace('info', {
    runtime: 'frontend',
    timestampMs: Date.now(),
    stage: 'sse.ack',
    status: typeof input.status === 'string' && /^[a-z0-9_-]{1,40}$/i.test(input.status) ? input.status : undefined,
  }, {
    conversationId: input.conversationId,
    clientMessageId: input.clientMessageId,
    evolutionMessageId: input.evolutionMessageId,
  });
};
