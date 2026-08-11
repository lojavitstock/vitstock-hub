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

const comparableOutboundContent = (message: Message) => {
  const content = message.content.trim();
  if (message.sender !== 'attendant') return content;
  // O backend envia o nome do atendente na primeira linha para a Evolution,
  // enquanto a linha otimista já o exibe separadamente via senderName.
  return content.replace(/^\*[^*\r\n]+\*\s*(?:\r?\n|$)/, '').trim();
};

const canReconcileOptimisticOutbound = (current: Message, incoming: Message) => {
  if (current.sender !== 'attendant' || incoming.sender !== 'attendant') return false;
  if (current.isInternalNote || incoming.isInternalNote) return false;
  if (current.status !== 'pending' && current.status !== 'failed') return false;
  if (current.rawKey || !incoming.rawKey) return false;
  if (comparableOutboundContent(current) !== comparableOutboundContent(incoming)) return false;
  if (current.mediaType !== incoming.mediaType) return false;
  const currentTimestamp = timestampOf(current);
  const incomingTimestamp = timestampOf(incoming);
  return currentTimestamp > 0 && incomingTimestamp > 0
    && Math.abs(currentTimestamp - incomingTimestamp) <= 5 * 60 * 1000;
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
  const incomingById = new Map<string, Message>();
  incoming.forEach((message) => incomingById.set(message.id, message));

  // O webhook pode chegar antes da resposta do POST de envio. Nesse caso,
  // correlacionamos o ID real do provedor com a mensagem otimista pendente
  // para substituir uma única linha, em vez de criar uma duplicata visual.
  const optimisticAliases = new Map<string, string>();
  const aliasByOptimisticId = new Map<string, Message>();
  const usedOptimisticIds = new Set<string>();
  incomingById.forEach((message) => {
    if (currentById.has(message.id)) return;
    const candidate = current.find((item) => (
      !usedOptimisticIds.has(item.id) && canReconcileOptimisticOutbound(item, message)
    ));
    if (!candidate) return;
    optimisticAliases.set(message.id, candidate.id);
    aliasByOptimisticId.set(candidate.id, message);
    usedOptimisticIds.add(candidate.id);
  });

  let hasChanges = false;
  const updatedCurrent = current.map((message) => {
    const next = incomingById.get(message.id);
    const aliasedNext = aliasByOptimisticId.get(message.id);
    if (aliasedNext) {
      hasChanges = true;
      return aliasedNext;
    }
    if (!next) return message;
    if (areMessagesEquivalent(message, next)) return message;
    hasChanges = true;
    return next;
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
