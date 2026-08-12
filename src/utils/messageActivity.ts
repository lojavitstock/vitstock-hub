import type { Message } from '../types';

export type NewMessageClassification = {
  identityKeys: string[];
  alreadyKnown: boolean;
  consideredInbound: boolean;
  consideredNew: boolean;
  reasonRejected?: 'fromMe' | 'already-known' | 'wrong-conversation' | 'not-inbound' | 'history' | 'other';
};

export const getMessageIdentityValues = (message: Message): string[] => {
  const identities = new Set<string>();
  if (message.id) identities.add(message.id);
  const rawKey = message.rawKey;
  if (rawKey && typeof rawKey === 'object') {
    if (typeof rawKey.id === 'string' && rawKey.id) identities.add(rawKey.id);
    if (typeof rawKey.messageId === 'string' && rawKey.messageId) identities.add(rawKey.messageId);
  }
  return [...identities];
};

const sameMessageIdentity = (previous: Message, incoming: Message) => {
  const known = new Set(getMessageIdentityValues(previous));
  return getMessageIdentityValues(incoming).some((identity) => known.has(identity));
};

export const classifyIncomingMessage = (
  previousMessages: Message[],
  incoming: Message,
  activeConversationId?: string,
): NewMessageClassification => {
  const identityKeys = getMessageIdentityValues(incoming);
  const alreadyKnown = previousMessages.some((previous) => sameMessageIdentity(previous, incoming));
  const consideredInbound = incoming.sender === 'contact' && !incoming.isInternalNote;
  const wrongConversation = Boolean(
    activeConversationId
    && incoming.conversationId
    && incoming.conversationId !== activeConversationId,
  );
  const latestKnownTimestamp = previousMessages.reduce(
    (latest, message) => Math.max(latest, message.timestampMs || 0),
    0,
  );
  const isHistory = Boolean(
    latestKnownTimestamp > 0
    && incoming.timestampMs
    && incoming.timestampMs < latestKnownTimestamp,
  );
  const consideredNew = consideredInbound && !alreadyKnown && !wrongConversation && !isHistory;

  let reasonRejected: NewMessageClassification['reasonRejected'];
  if (!consideredNew) {
    if (incoming.sender === 'attendant') reasonRejected = 'fromMe';
    else if (alreadyKnown) reasonRejected = 'already-known';
    else if (wrongConversation) reasonRejected = 'wrong-conversation';
    else if (!consideredInbound) reasonRejected = 'not-inbound';
    else if (isHistory) reasonRejected = 'history';
    else reasonRejected = 'other';
  }

  return { identityKeys, alreadyKnown, consideredInbound, consideredNew, reasonRejected };
};

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

  const knownIds = new Set(previousMessages.flatMap(getMessageIdentityValues));
  const latestKnownTimestamp = previousMessages.reduce(
    (latest, message) => Math.max(latest, message.timestampMs || 0),
    0,
  );
  const newIds = new Set<string>();

  incomingMessages.forEach((message) => {
    if (
      message.sender !== 'contact'
      || message.isInternalNote
      || knownIds.has(message.id)
      || previousMessages.some((previous) => sameMessageIdentity(previous, message))
    ) return;
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
