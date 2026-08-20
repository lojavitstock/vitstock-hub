type OutboundTraceDetail = string | number | boolean | null | undefined;

type OutboundTraceContext = {
  clientMessageId: string;
  conversationId: string;
  kind: 'text' | 'media';
  submitSource?: 'click' | 'keyboard';
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
