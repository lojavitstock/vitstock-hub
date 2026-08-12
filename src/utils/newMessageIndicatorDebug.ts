/** Temporary Preview instrumentation for the new-message indicator. */
export const isNewMessageIndicatorDebugEnabled = () => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return import.meta.env.DEV
    || import.meta.env.VITE_DEBUG_NEW_MESSAGE_INDICATOR === 'true'
    || import.meta.env.VITE_VERCEL_ENV === 'preview'
    || hostname.endsWith('.vercel.app');
};

export const debugNewMessageIndicator = (payload: Record<string, unknown>) => {
  if (!isNewMessageIndicatorDebugEnabled()) return;
  // Payloads intentionally contain only IDs, booleans, counters and layout data.
  console.info('[NEW_MESSAGE_INDICATOR]', JSON.stringify(payload));
};
