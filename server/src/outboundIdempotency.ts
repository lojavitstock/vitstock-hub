export type OutboundMessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/**
 * The database advisory lock is keyed by the tenant and the explicit client
 * message id. It deliberately does not use message text, time or phone data.
 */
export const outboundIdempotencyLockKey = (companyId: string, clientMessageId: string) => (
  `vitstock:outbound:${companyId}:${clientMessageId}`
);

/**
 * A previously accepted request must be reused. Only an explicit failed state
 * may be retried with the same clientMessageId.
 */
export const outboundDispatchAction = (status: OutboundMessageStatus | undefined) => {
  if (!status) return 'create' as const;
  return status === 'failed' ? 'retry' as const : 'reuse' as const;
};

/** Shares the provider dispatch while an identical request is still running. */
export const createOutboundRequestCoordinator = <T>() => {
  const inFlight = new Map<string, Promise<T>>();
  return {
    run(key: string, request: () => Promise<T>) {
      const current = inFlight.get(key);
      if (current) return current;
      const pending = Promise.resolve().then(request);
      inFlight.set(key, pending);
      void pending.finally(() => inFlight.delete(key)).catch(() => undefined);
      return pending;
    },
  };
};
