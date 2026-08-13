type ScrollTraceDetail = string | number | boolean | null | undefined;

type ScrollTraceInput = {
  conversationId: string;
  container: HTMLDivElement | null;
  stickyToBottom: boolean;
  messageCount: number;
  reason: string;
  details?: Record<string, ScrollTraceDetail>;
};

const isScrollTraceEnabled = () => import.meta.env.VITE_SCROLL_TRACE === 'true';

const rounded = (value: number) => Math.round(value);

const visibleMessageIds = (container: HTMLDivElement) => {
  const containerBounds = container.getBoundingClientRect();
  const visible = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]')).filter((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.bottom >= containerBounds.top && bounds.top <= containerBounds.bottom;
  });

  return {
    firstVisibleMessageId: visible[0]?.dataset.messageId,
    lastVisibleMessageId: visible.at(-1)?.dataset.messageId,
  };
};

/**
 * Opt-in diagnostic telemetry for unexpected timeline movement. It is kept
 * outside the normal scroll handler so production does no extra DOM work.
 */
export const traceTimelineScroll = ({
  conversationId,
  container,
  stickyToBottom,
  messageCount,
  reason,
  details,
}: ScrollTraceInput) => {
  if (!isScrollTraceEnabled() || !container) return;
  const distanceFromBottom = Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);
  console.debug('[SCROLL_TRACE]', JSON.stringify({
    timestampMs: Date.now(),
    reason,
    conversationId,
    scrollTop: rounded(container.scrollTop),
    scrollHeight: rounded(container.scrollHeight),
    clientHeight: rounded(container.clientHeight),
    distanceFromBottom: rounded(distanceFromBottom),
    stickyToBottom,
    messageCount,
    ...visibleMessageIds(container),
    ...details,
  }));
};
