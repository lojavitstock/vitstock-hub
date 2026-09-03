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
  const quoteSource = input.quote?.providerKeySource === 'providerKey' ? 'providerKey' : 'legacyFallback';
  console.warn('[REPLY_FAILURE_TRACE]', JSON.stringify({
    runtime: 'frontend',
    event: 'reply_send_failure',
    timestamp: new Date().toISOString(),
    replyTraceId: input.replyTraceId,
    conversationId: diagnosticId(input.conversationId),
    localMessageId: diagnosticId(input.localMessageId),
    replyTarget: {
      hubMessageId: diagnosticId(input.quote?.messageId),
      evolutionMessageIdPresent: quoteSource === 'providerKey' && Boolean(quoteKey?.id),
      providerKeyPresent: quoteSource === 'providerKey',
      providerKeyRemoteJidType: jidKind(quoteKey?.remoteJid),
      participantPresent: Boolean(quoteKey?.participant || quoteKey?.participantAlt || quoteKey?.participantPn),
      fromMe: typeof quoteKey?.fromMe === 'boolean' ? quoteKey.fromMe : undefined,
      messageType: input.quote?.mediaType || input.kind,
    },
    outbound: {
      recipientType: jidKind(input.conversationId),
      quotePresent: true,
      quoteSource,
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
