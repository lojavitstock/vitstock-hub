import type { Message } from '../types';

/**
 * Returns genuinely new incoming messages from a polling/reconciliation page.
 * Existing IDs, outbound messages and internal notes must not create the
 * "new messages" indicator.
 */
export const getNewIncomingMessageIds = (
  previousMessages: Message[],
  incomingMessages: Message[],
  enabled: boolean,
): string[] => {
  if (!enabled) return [];

  const knownIds = new Set(previousMessages.map((message) => message.id));
  const latestKnownTimestamp = previousMessages.reduce(
    (latest, message) => Math.max(latest, message.timestampMs || 0),
    0,
  );
  const newIds = new Set<string>();

  incomingMessages.forEach((message) => {
    if (message.sender !== 'contact' || message.isInternalNote || knownIds.has(message.id)) return;
    // A page can contain older history while a cached conversation is open.
    // Only messages at/after the latest known activity are eligible for the
    // live indicator; the merge still keeps those historical messages.
    if (
      latestKnownTimestamp > 0
      && message.timestampMs
      && message.timestampMs < latestKnownTimestamp
    ) return;
    newIds.add(message.id);
  });

  return [...newIds];
};
