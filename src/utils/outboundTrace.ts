type OutboundTraceDetail = string | number | boolean | null | undefined;

type OutboundTraceContext = {
  clientMessageId: string;
  conversationId: string;
  kind: 'text' | 'media';
  replyTraceId?: string;
  submitSource?: 'click' | 'keyboard';
};

const diagnosticId = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= 6 ? `…${normalized.slice(-2)}` : `${normalized.slice(0, 3)}…${normalized.slice(-3)}`;
};

const jidKind = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.endsWith('@g.us')) return 'GROUP';
  if (normalized.endsWith('@lid')) return 'LID';
  return 'PN';
};

const quoteSource = (quote: any): 'raw' | 'metadata' | 'legacy' | 'none' => {
  switch (quote?.providerKeySource) {
    case 'raw': return 'raw';
    case 'metadata':
    case 'providerKey': return 'metadata';
    case 'none': return 'none';
    case 'legacy':
    case 'legacyFallback': return 'legacy';
    default: return quote?.key ? 'legacy' : 'none';
  }
};

const quoteSourceAge = (quote: any) => (
  quote?.sourceAge === 'RECENT'
    || quote?.sourceAge === 'OLDER'
    || quote?.sourceAge === 'LEGACY'
    ? quote.sourceAge
    : 'UNKNOWN'
);

const isOutboundTraceEnabled = () => import.meta.env.VITE_OUTBOUND_TRACE === 'true';

const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

/** Opt-in browser-side timing; it never includes message text or media. */
export const createOutboundTrace = (context: OutboundTraceContext) => {
  const startedAt = now();
  return (stage: string, details?: Record<string, OutboundTraceDetail>) => {
    if (!isOutboundTraceEnabled()) return;
    console.info('[OUTBOUND_TRACE]', JSON.stringify({
      runtime: 'frontend',
      timestampMs: Date.now(),
      elapsedMs: Math.round(now() - startedAt),
      stage,
      ...context,
      ...details,
    }));
  };
};

/** Generates a non-secret correlation id for one reply attempt. */
export const createReplyTraceId = () => {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `reply-${uuid}`;
};

/** Emits only when a quoted send fails; content and media are never logged. */
export const traceReplySendFailure = (input: {
  replyTraceId: string;
  conversationId: string;
  localMessageId: string;
  quote: any;
  kind: 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker';
  status?: number;
  errorCode?: string;
}) => {
  if (!isOutboundTraceEnabled()) return;
  const quoteKey = input.quote?.key;
  const providerKeySource = quoteSource(input.quote);
  const fromMe = typeof quoteKey?.fromMe === 'boolean' ? quoteKey.fromMe : undefined;
  console.warn('[REPLY_FAILURE_TRACE]', JSON.stringify({
    runtime: 'frontend',
    event: 'reply_send_failure',
    timestamp: new Date().toISOString(),
    replyTraceId: input.replyTraceId,
    conversationId: diagnosticId(input.conversationId),
    localMessageId: diagnosticId(input.localMessageId),
    replyTarget: {
      hubMessageId: diagnosticId(input.quote?.messageId),
      evolutionMessageIdPresent: (providerKeySource === 'raw' || providerKeySource === 'metadata') && Boolean(quoteKey?.id),
      providerKeyPresent: providerKeySource === 'raw' || providerKeySource === 'metadata',
      providerKeySource,
      providerMessageIdPresent: (providerKeySource === 'raw' || providerKeySource === 'metadata') && Boolean(quoteKey?.id),
      providerKeyRemoteJidType: jidKind(quoteKey?.remoteJid),
      participantPresent: Boolean(quoteKey?.participant || quoteKey?.participantAlt || quoteKey?.participantPn),
      sourceDirection: fromMe === true ? 'FROM_ME' : fromMe === false ? 'INBOUND' : 'UNKNOWN',
      sourceAge: quoteSourceAge(input.quote),
      fromMe,
      messageType: input.quote?.sourceMediaType || input.quote?.mediaType || input.kind,
    },
    outbound: {
      recipientType: jidKind(input.conversationId),
      quotePresent: true,
      quoteSource: providerKeySource,
      payloadQuoteStructurallyValid: Boolean(quoteKey?.id && quoteKey?.remoteJid && typeof quoteKey?.fromMe === 'boolean'),
    },
    backend: { status: input.status, errorCode: input.errorCode },
  }));
};

/** Emits only an explicit Hub correlation from realtime; incoming messages are skipped. */
export const traceOutboundRealtimeAck = (input: {
  conversationId: string;
  clientMessageId?: string;
  evolutionMessageId?: string;
  status?: string;
}) => {
  if (!isOutboundTraceEnabled() || !input.clientMessageId) return;
  console.info('[OUTBOUND_TRACE]', JSON.stringify({
    runtime: 'frontend',
    timestampMs: Date.now(),
    stage: 'sse.ack',
    ...input,
  }));
};
