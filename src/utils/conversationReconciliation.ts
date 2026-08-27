import { Conversation, Tag } from '../types';
import { phoneVariants } from './phone';

const areTagsEqual = (previous: Tag[], next: Tag[]) => (
  previous.length === next.length
  && previous.every((tag, index) => {
    const nextTag = next[index];
    return nextTag?.id === tag.id
      && nextTag.name === tag.name
      && nextTag.color === tag.color
      && nextTag.systemKey === tag.systemKey;
  })
);

/**
 * lastMessageKey is a flat provider key used when marking a conversation read.
 * Compare its own fields without a generic/deep equality walk so a changed
 * provider key cannot be hidden behind an otherwise equivalent conversation.
 */
const areLastMessageKeysEqual = (
  previous?: Conversation['lastMessageKey'],
  next?: Conversation['lastMessageKey'],
) => {
  if (previous === next) return true;
  if (!previous || !next) return false;

  const previousKeys = Object.keys(previous).sort();
  const nextKeys = Object.keys(next).sort();
  if (previousKeys.length !== nextKeys.length) return false;

  return previousKeys.every((key, index) => (
    key === nextKeys[index] && previous[key] === next[key]
  ));
};

const areAssignedAttendantsEqual = (
  previous?: Conversation['assignedAttendant'],
  next?: Conversation['assignedAttendant'],
) => (
  previous?.id === next?.id
  && previous?.name === next?.name
  && Boolean(previous) === Boolean(next)
);

const areLeasesEqual = (previous?: Conversation['lease'], next?: Conversation['lease']) => (
  previous?.ownerUserId === next?.ownerUserId
  && previous?.ownerName === next?.ownerName
  && previous?.expiresAt === next?.expiresAt
  && Boolean(previous) === Boolean(next)
);

const isWeakContactName = (value: string | undefined) => {
  const name = String(value || '').trim();
  return !name
    || ['Contato', 'Participante', 'WhatsApp Business', 'Você'].includes(name)
    || /^\+?[\d\s().-]+$/.test(name);
};

/**
 * A sparse provider snapshot must not erase a richer identity already known
 * for the same conversation. Explicitly supplied names/avatars still win.
 */
export const mergeContactIdentity = (
  previous: Conversation['contact'],
  next: Conversation['contact'],
): Conversation['contact'] => {
  const preserveName = isWeakContactName(next.name) && !isWeakContactName(previous.name);
  const preserveContactId = preserveName && Boolean(previous.id);
  const preserved = {
    ...next,
    ...(preserveContactId ? { id: previous.id } : {}),
    ...(preserveName ? { name: previous.name } : {}),
    ...(!next.avatar && previous.avatar ? { avatar: previous.avatar } : {}),
  };
  return preserved;
};

/**
 * Compares only fields that Atendimento reads for rendering or actions:
 * contact identity/avatar/tags, list preview/status, assignment and the
 * provider key used by the read action.
 */
export const areConversationsEquivalent = (previous: Conversation, next: Conversation) => (
  previous.id === next.id
  && previous.isGroup === next.isGroup
  && previous.groupName === next.groupName
  && previous.groupAvatar === next.groupAvatar
  && previous.contact.id === next.contact.id
  && previous.contact.name === next.contact.name
  && previous.contact.phone === next.contact.phone
  && previous.contact.avatar === next.contact.avatar
  && areTagsEqual(previous.contact.tags, next.contact.tags)
  && previous.lastMessage === next.lastMessage
  && previous.lastMessageTimestamp === next.lastMessageTimestamp
  && previous.lastMessageAt === next.lastMessageAt
  && previous.lastMessageFromMe === next.lastMessageFromMe
  && areLastMessageKeysEqual(previous.lastMessageKey, next.lastMessageKey)
  && previous.unreadCount === next.unreadCount
  && previous.needsResponse === next.needsResponse
  && areTagsEqual(previous.conversationTags || [], next.conversationTags || [])
  && previous.trafficSource === next.trafficSource
  && previous.status === next.status
  && areAssignedAttendantsEqual(previous.assignedAttendant, next.assignedAttendant)
  && areLeasesEqual(previous.lease, next.lease)
  && previous.department === next.department
);

/**
 * Reconciles a new inbox snapshot with the current state using structural
 * sharing. The backend order is preserved; unchanged conversations reuse the
 * previous object, and an entirely equivalent snapshot reuses the array too.
 */
export const reconcileConversations = (
  previous: Conversation[],
  next: Conversation[],
): Conversation[] => {
  if (previous === next) return previous;

  const sameLengthAndOrder = previous.length === next.length
    && next.every((conversation, index) => {
      const previousConversation = previous[index];
      return Boolean(previousConversation)
        && previousConversation.id === conversation.id
        && areConversationsEquivalent(previousConversation, conversation);
    });
  if (sameLengthAndOrder) return previous;

  const previousById = new Map(previous.map((conversation) => [conversation.id, conversation]));
  let changed = previous.length !== next.length
    || next.some((conversation, index) => previous[index]?.id !== conversation.id);
  const reconciled = next.map((conversation) => {
    const previousConversation = previousById.get(conversation.id);
    const candidate = previousConversation
      ? {
          ...conversation,
          contact: mergeContactIdentity(previousConversation.contact, conversation.contact),
          groupName: conversation.groupName || previousConversation.groupName,
          groupAvatar: conversation.groupAvatar || previousConversation.groupAvatar,
        }
      : conversation;
    if (previousConversation && areConversationsEquivalent(previousConversation, candidate)) {
      return previousConversation;
    }
    changed = true;
    return candidate;
  });

  return changed ? reconciled : previous;
};

const activityTimestamp = (conversation: Conversation) => conversation.lastMessageAt || 0;

const preserveNewerActivity = (previous: Conversation, next: Conversation) => {
  if (activityTimestamp(previous) <= activityTimestamp(next)) return { conversation: next, preserved: false };

  return {
    conversation: {
      ...next,
      lastMessage: previous.lastMessage,
      lastMessageTimestamp: previous.lastMessageTimestamp,
      lastMessageAt: previous.lastMessageAt,
      lastMessageFromMe: previous.lastMessageFromMe,
      lastMessageKey: previous.lastMessageKey,
      unreadCount: previous.unreadCount,
      needsResponse: previous.needsResponse,
    },
    preserved: true,
  };
};

/**
 * The inbox snapshot only contains active leases. Keep the last observed
 * lease when it disappears so expiry does not replace the active Conversation
 * object (and therefore cannot reset its timeline). UI access still derives
 * activity from expiresAt, so an expired lease is immediately non-blocking.
 */
const preserveObservedLease = (previous: Conversation, next: Conversation) => {
  const previousLease = previous.lease;
  if (!previousLease) return next;
  if (next.lease && next.lease.expiresAt > previousLease.expiresAt) return next;
  return { ...next, lease: previousLease };
};

const sameConversationActivity = (previous: Conversation, next: Conversation) => (
  activityTimestamp(previous) === activityTimestamp(next)
  && previous.lastMessageFromMe === next.lastMessageFromMe
  && (previous.lastMessageKey?.id && next.lastMessageKey?.id
    ? previous.lastMessageKey.id === next.lastMessageKey.id
    : previous.lastMessage === next.lastMessage)
);

/**
 * Reconciles an inbox snapshot without allowing an older activity snapshot to
 * replace a newer local/SSE activity. Phone matching covers @lid and
 * @s.whatsapp.net representations of the same contact.
 */
export const reconcileConversationsMonotonic = (
  previous: Conversation[],
  next: Conversation[],
): Conversation[] => {
  if (previous.length === 0 || next.length === 0) return reconcileConversations(previous, next);

  const previousById = new Map(previous.map((conversation) => [conversation.id, conversation]));
  const previousByPhone = new Map<string, Conversation>();
  previous.forEach((conversation) => {
    const phone = conversation.contact.phone.replace(/\D/g, '');
    phoneVariants(phone).forEach((variant) => {
      if (variant && !previousByPhone.has(variant)) previousByPhone.set(variant, conversation);
    });
  });

  const locallyNewerIds = new Set<string>();
  const protectedSnapshot = next.map((conversation) => {
    const phone = conversation.contact.phone.replace(/\D/g, '');
    const previousConversation = previousById.get(conversation.id)
      || phoneVariants(phone).map((variant) => previousByPhone.get(variant)).find(Boolean);
    if (!previousConversation) return conversation;

    const withLease = preserveObservedLease(previousConversation, conversation);
    const withIdentity = {
      ...withLease,
      contact: mergeContactIdentity(previousConversation.contact, withLease.contact),
      groupName: withLease.groupName || previousConversation.groupName,
      groupAvatar: withLease.groupAvatar || previousConversation.groupAvatar,
    };
    const protectedActivity = preserveNewerActivity(previousConversation, withIdentity);
    if (protectedActivity.preserved) locallyNewerIds.add(conversation.id);
    const nextConversation = protectedActivity.conversation;
    // Reading is a local state transition that can arrive before the next
    // inbox snapshot. A duplicate snapshot for the same activity must not
    // restore the unread highlight that was already cleared on screen.
    if (
      previousConversation.unreadCount === 0
      && conversation.unreadCount > 0
      && sameConversationActivity(previousConversation, conversation)
    ) {
      return { ...nextConversation, unreadCount: 0 };
    }
    return nextConversation;
  });

  if (locallyNewerIds.size === 0) return reconcileConversations(previous, protectedSnapshot);

  const orderedSnapshot = protectedSnapshot
    .map((conversation, index) => ({ conversation, index }))
    .sort((left, right) => (
      activityTimestamp(right.conversation) - activityTimestamp(left.conversation)
      || left.index - right.index
    ))
    .map(({ conversation }) => conversation);
  return reconcileConversations(previous, orderedSnapshot);
};
