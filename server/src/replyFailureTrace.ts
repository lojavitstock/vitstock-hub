import { evolutionRecipientDiagnostics, sanitizeEvolutionProviderError } from './evolutionProviderDiagnostics.js';

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
  failureOrigin: 'request_validation' | 'backend_rejected' | 'evolution_network' | 'evolution_rejected';
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

const maskedIdentifier = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length <= 6) return `…${normalized.slice(-2)}`;
  return `${normalized.slice(0, 3)}…${normalized.slice(-3)}`;
};

const validTraceId = (value: unknown) => (
  typeof value === 'string'
  && value.trim().length >= 8
  && value.trim().length <= 128
  && /^[A-Za-z0-9._:-]+$/.test(value.trim())
    ? value.trim()
    : undefined
);

const jidKind = (value: unknown): 'PN' | 'LID' | 'GROUP' | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.endsWith('@g.us')) return 'GROUP';
  if (normalized.endsWith('@lid')) return 'LID';
  return 'PN';
};

const quoteSource = (quote: any) => quote?.providerKeySource === 'providerKey' ? 'providerKey' : 'legacyFallback';

const quoteStructurallyValid = (quote: any) => Boolean(
  quote?.key
  && typeof quote.key.id === 'string'
  && quote.key.id.trim()
  && typeof quote.key.remoteJid === 'string'
  && quote.key.remoteJid.trim()
  && typeof quote.key.fromMe === 'boolean',
);

const redactProviderJids = (value: string) => value.replace(
  /[A-Za-z0-9._:-]+@(s\.whatsapp\.net|lid|g\.us)/gi,
  '[redacted-jid]',
);

/**
 * Build one safe event for a failed outbound reply. This deliberately keeps
 * identifiers masked and only accepts provider error fields already reduced
 * by sanitizeEvolutionProviderError.
 */
export const buildReplyFailureTrace = (input: ReplyFailureTraceInput) => {
  const quote = input.quote;
  const quoteKey = quote?.key;
  const recipientDiagnostics = input.recipient
    ? evolutionRecipientDiagnostics({
      number: input.recipient.number || '',
      remoteJid: input.recipient.remoteJid,
    })
    : undefined;
  const source = quoteSource(quote);
  const safeProviderError = input.providerError === undefined
    ? undefined
    : sanitizeEvolutionProviderError(
      redactProviderJids(typeof input.providerError === 'string' ? input.providerError : JSON.stringify(input.providerError)),
    );
  return {
    event: 'reply_send_failure',
    timestamp: new Date().toISOString(),
    replyTraceId: validTraceId(input.replyTraceId),
    companyId: maskedIdentifier(input.companyId),
    conversationId: maskedIdentifier(input.conversationId),
    localMessageId: maskedIdentifier(input.localMessageId),
    clientMessageId: maskedIdentifier(input.clientMessageId),
    requestId: maskedIdentifier(input.requestId),
    replyTarget: {
      hubMessageId: maskedIdentifier(quote?.messageId),
      evolutionMessageIdPresent: source === 'providerKey' && Boolean(quoteKey?.id),
      providerKeyPresent: source === 'providerKey',
      providerKeyRemoteJidType: jidKind(quoteKey?.remoteJid),
      participantPresent: Boolean(quoteKey?.participant || quoteKey?.participantAlt || quoteKey?.participantPn),
      fromMe: typeof quoteKey?.fromMe === 'boolean' ? quoteKey.fromMe : undefined,
      messageType: quote?.mediaType || input.messageType,
    },
    outbound: {
      recipientType: recipientDiagnostics?.recipientType,
      numberKind: recipientDiagnostics?.numberKind,
      remoteJidKind: recipientDiagnostics?.remoteJidKind,
      quotePresent: Boolean(quote),
      quoteSource: quote ? source : undefined,
      payloadQuoteStructurallyValid: quote ? quoteStructurallyValid(quote) : undefined,
    },
    media: input.media,
    backend: {
      status: input.backendStatus,
      errorCode: input.errorCode,
      failureOrigin: input.failureOrigin,
    },
    evolution: {
      replyTraceId: validTraceId(input.replyTraceId),
      httpStatus: input.evolutionStatus,
      statusText: input.evolutionStatusText,
      providerError: safeProviderError,
    },
  };
};
