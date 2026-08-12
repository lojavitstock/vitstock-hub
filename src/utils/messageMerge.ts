import { Message } from '../types';

const areInteractiveButtonsEqual = (
  previous?: Message['interactiveButtons'],
  next?: Message['interactiveButtons'],
) => {
  if (previous === next) return true;
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((button, index) => {
    const nextButton = next[index];
    return nextButton?.type === button.type
      && nextButton.label === button.label
      && nextButton.url === button.url
      && nextButton.value === button.value;
  });
};

const areLocationEqual = (
  previous?: NonNullable<Message['metadata']>['location'],
  next?: NonNullable<Message['metadata']>['location'],
) => (
  previous?.latitude === next?.latitude
  && previous?.longitude === next?.longitude
  && previous?.name === next?.name
  && previous?.address === next?.address
  && previous?.url === next?.url
  && Boolean(previous) === Boolean(next)
);

const areContactCardsEqual = (
  previous?: NonNullable<Message['metadata']>['contactCard'],
  next?: NonNullable<Message['metadata']>['contactCard'],
) => (
  previous?.displayName === next?.displayName
  && previous?.phone === next?.phone
  && Boolean(previous) === Boolean(next)
);

const areQuotedMessagesEqual = (
  previous?: NonNullable<Message['metadata']>['quotedMessage'],
  next?: NonNullable<Message['metadata']>['quotedMessage'],
) => (
  previous?.messageId === next?.messageId
  && previous?.authorName === next?.authorName
  && previous?.sender === next?.sender
  && previous?.content === next?.content
  && previous?.mediaType === next?.mediaType
  && previous?.key?.id === next?.key?.id
  && previous?.key?.remoteJid === next?.key?.remoteJid
  && previous?.key?.fromMe === next?.key?.fromMe
  && previous?.key?.participant === next?.key?.participant
  && Boolean(previous) === Boolean(next)
);

const areDocumentsEqual = (
  previous?: NonNullable<Message['metadata']>['document'],
  next?: NonNullable<Message['metadata']>['document'],
) => (
  previous?.fileName === next?.fileName
  && previous?.mimeType === next?.mimeType
  && previous?.fileSize === next?.fileSize
  && Boolean(previous) === Boolean(next)
);

const areMetadataEqual = (
  previous?: Message['metadata'],
  next?: Message['metadata'],
) => {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.providerType === next.providerType
    && previous.trafficSource === next.trafficSource
    && previous.trafficTitle === next.trafficTitle
    && previous.trafficUrl === next.trafficUrl
    && previous.sentByHub === next.sentByHub
    && previous.sentByUserId === next.sentByUserId
    && previous.sentByUserName === next.sentByUserName
    && previous.sentOutsideHub === next.sentOutsideHub
    && previous.clientMessageId === next.clientMessageId
    && areQuotedMessagesEqual(previous.quotedMessage, next.quotedMessage)
    && areDocumentsEqual(previous.document, next.document)
    && previous.reaction === next.reaction
    && previous.systemLabel === next.systemLabel
    && previous.forwarded === next.forwarded
    && areLocationEqual(previous.location, next.location)
    && areContactCardsEqual(previous.contactCard, next.contactCard);
};

/**
 * rawKey is a flat provider key used to decode media. Compare all of its own
 * values without walking arbitrary nested objects or the whole message list.
 */
const areProviderKeysEqual = (previous: any, next: any) => {
  if (previous === next) return true;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return false;

  const previousKeys = Object.keys(previous).sort();
  const nextKeys = Object.keys(next).sort();
  if (previousKeys.length !== nextKeys.length) return false;

  return previousKeys.every((key, index) => (
    key === nextKeys[index] && previous[key] === next[key]
  ));
};

/**
 * Compares fields that affect the timeline, media loading, actions or status.
 * Message identity itself is handled separately by the stable provider id.
 */
export const areMessagesEquivalent = (previous: Message, next: Message) => (
  previous.id === next.id
  && previous.conversationId === next.conversationId
  && previous.sender === next.sender
  && previous.senderName === next.senderName
  && previous.content === next.content
  && previous.mediaUrl === next.mediaUrl
  && previous.mediaType === next.mediaType
  && previous.mediaDuration === next.mediaDuration
  && previous.interactiveTitle === next.interactiveTitle
  && previous.interactiveFooter === next.interactiveFooter
  && areInteractiveButtonsEqual(previous.interactiveButtons, next.interactiveButtons)
  && areMetadataEqual(previous.metadata, next.metadata)
  && areProviderKeysEqual(previous.rawKey, next.rawKey)
  && previous.timestampMs === next.timestampMs
  && previous.timestamp === next.timestamp
  && previous.status === next.status
  && Boolean(previous.isInternalNote) === Boolean(next.isInternalNote)
);

const timestampOf = (message: Message) => message.timestampMs || 0;

const hubClientMessageId = (message: Message) => (
  message.metadata?.sentByHub === true
  && typeof message.metadata.clientMessageId === 'string'
  && message.metadata.clientMessageId.trim().length > 0
    ? message.metadata.clientMessageId
    : undefined
);

const preserveHubAttribution = (current: Message, incoming: Message): Message => {
  if (current.metadata?.sentByHub !== true || incoming.metadata?.sentByHub === true) return incoming;

  // A provider snapshot can confirm the same Evolution id without carrying
  // Hub-only metadata. The existing item is the persisted proof of authorship,
  // so retain it instead of reclassifying a Hub send as WhatsApp Web.
  const metadata = {
    ...(incoming.metadata || {}),
    sentByHub: true,
    sentByUserId: current.metadata.sentByUserId,
    sentByUserName: current.metadata.sentByUserName,
    ...(hubClientMessageId(current) ? { clientMessageId: hubClientMessageId(current) } : {}),
    ...(current.metadata.quotedMessage && !incoming.metadata?.quotedMessage
      ? { quotedMessage: current.metadata.quotedMessage }
      : {}),
  };
  delete metadata.sentOutsideHub;
  return {
    ...incoming,
    senderName: current.senderName,
    content: current.content,
    metadata,
  };
};

const isChronological = (messages: Message[]) => messages.every((message, index) => (
  index === 0 || timestampOf(messages[index - 1]) <= timestampOf(message)
));

/**
 * Merges polling, realtime and paginated pages while preserving structural
 * sharing. Incoming duplicates use the last received version, matching the
 * previous Map-based behavior.
 */
export const mergeConversationMessages = (current: Message[], incoming: Message[]) => {
  if (incoming.length === 0) return current;

  const currentById = new Map(current.map((message) => [message.id, message]));
  const currentByClientMessageId = new Map<string, Message>();
  current.forEach((message) => {
    const clientMessageId = hubClientMessageId(message);
    if (clientMessageId && !currentByClientMessageId.has(clientMessageId)) {
      currentByClientMessageId.set(clientMessageId, message);
    }
  });
  const incomingById = new Map<string, Message>();
  incoming.forEach((message) => incomingById.set(message.id, message));

  // The server returns the client id only for a confirmed Hub send. Do not
  // correlate optimistic messages by content or timestamp: external WhatsApp
  // messages can legitimately look identical.
  const optimisticAliases = new Map<string, string>();
  const aliasByOptimisticId = new Map<string, Message>();
  const optimisticIdsToRemove = new Set<string>();
  const usedOptimisticIds = new Set<string>();
  incomingById.forEach((message) => {
    const clientMessageId = hubClientMessageId(message);
    const candidate = clientMessageId
      ? currentById.get(clientMessageId) || currentByClientMessageId.get(clientMessageId)
      : undefined;
    if (!candidate) return;
    if (candidate.sender !== 'attendant' || candidate.isInternalNote || usedOptimisticIds.has(candidate.id)) return;
    optimisticAliases.set(message.id, candidate.id);
    aliasByOptimisticId.set(candidate.id, message);
    usedOptimisticIds.add(candidate.id);
    if (currentById.has(message.id) && candidate.id !== message.id) optimisticIdsToRemove.add(candidate.id);
  });

  let hasChanges = false;
  const updatedCurrent = current.flatMap((message) => {
    if (optimisticIdsToRemove.has(message.id)) {
      hasChanges = true;
      return [];
    }
    const next = incomingById.get(message.id);
    const aliasedNext = aliasByOptimisticId.get(message.id);
    if (aliasedNext) {
      hasChanges = true;
      return [aliasedNext];
    }
    if (!next) return [message];
    const nextWithAttribution = preserveHubAttribution(message, next);
    if (areMessagesEquivalent(message, nextWithAttribution)) return [message];
    hasChanges = true;
    return [nextWithAttribution];
  });

  const newMessages = Array.from(incomingById.values()).filter((message) => (
    !currentById.has(message.id) && !optimisticAliases.has(message.id)
  ));
  if (newMessages.length > 0) hasChanges = true;
  if (!hasChanges) return current;

  if (newMessages.length === 0 && isChronological(updatedCurrent)) {
    return updatedCurrent;
  }

  if (current.length === 0 && isChronological(newMessages)) {
    return newMessages;
  }

  const firstCurrentTimestamp = timestampOf(updatedCurrent[0] || newMessages[0]);
  const lastCurrentTimestamp = timestampOf(updatedCurrent[updatedCurrent.length - 1] || newMessages[0]);
  const newMessagesAreChronological = isChronological(newMessages);
  const canPrepend = newMessagesAreChronological
    && updatedCurrent.length > 0
    && timestampOf(newMessages[newMessages.length - 1]) <= firstCurrentTimestamp
    && isChronological(updatedCurrent);
  if (canPrepend) return [...newMessages, ...updatedCurrent];

  const canAppend = newMessagesAreChronological
    && updatedCurrent.length > 0
    && timestampOf(newMessages[0]) >= lastCurrentTimestamp
    && isChronological(updatedCurrent);
  if (canAppend) return [...updatedCurrent, ...newMessages];

  return [...updatedCurrent, ...newMessages]
    .sort((left, right) => timestampOf(left) - timestampOf(right));
};
