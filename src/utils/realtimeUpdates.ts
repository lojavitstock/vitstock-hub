import type { Conversation, Message } from '../types';
import { phoneVariants } from './phone';
import { mergeConversationMessages } from './messageMerge';
import { reconcileConversations } from './conversationReconciliation';

export type RealtimeEventPayload = {
  type: string;
  remoteJid?: string;
  phone?: string;
  messageId?: string;
  timestampMs?: number;
  fromMe?: boolean;
  reaction?: boolean;
  status?: string;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  leaseOwnerUserId?: string | null;
  leaseOwnerName?: string | null;
  leaseExpiresAt?: string | null;
  messageTimestamp?: number;
  message?: Message;
  [key: string]: unknown;
};

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const normalizePhone = (value?: string) => String(value || '').replace(/\D/g, '');

const eventMatchesConversation = (conversation: Conversation, event: RealtimeEventPayload) => {
  const messageRawKey = event.message?.rawKey;
  const eventConversationIds = [
    event.message?.conversationId,
    event.remoteJid,
    typeof messageRawKey === 'object' && messageRawKey ? messageRawKey.remoteJid : undefined,
    typeof messageRawKey === 'object' && messageRawKey ? messageRawKey.remoteJidAlt : undefined,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (eventConversationIds.includes(conversation.id)) return true;

  const eventPhone = normalizePhone(event.phone);
  const conversationPhone = normalizePhone(conversation.contact.phone);
  return Boolean(eventPhone && conversationPhone
    && phoneVariants(eventPhone).some((variant) => phoneVariants(conversationPhone).includes(variant)));
};

const normalizeMessageStatus = (value: unknown): Message['status'] | undefined => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'pending') return 'pending';
  if (raw === 'sent' || raw === 'server_ack') return 'sent';
  if (raw === 'delivered' || raw === 'delivery_ack') return 'delivered';
  if (raw === 'read' || raw === 'played') return 'read';
  if (raw === 'failed' || raw === 'error' || raw === 'rejected') return 'failed';

  const numeric = Number(raw);
  if (numeric === 0) return 'failed';
  if (numeric === 2 || numeric === 3) return 'delivered';
  if (numeric === 4 || numeric === 5) return 'read';
  return undefined;
};

const formatMessageTime = (timestampMs?: number, fallback?: string) => (
  timestampMs && Number.isFinite(timestampMs)
    ? new Date(timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : fallback || 'Agora'
);

const mediaPreview = (mediaType?: Message['mediaType']) => {
  if (mediaType === 'image') return '[Imagem]';
  if (mediaType === 'audio') return '[Mensagem de áudio]';
  if (mediaType === 'video') return '[Vídeo]';
  if (mediaType === 'document') return '[Documento]';
  if (mediaType === 'sticker') return '[Figurinha]';
  return '';
};

const comparableMessagePreview = (message: Message) => (
  message.content.trim().replace(/^\*[^*\r\n]+\*\s*(?:\r?\n|$)/, '').trim()
);

const messageKeyForConversation = (message: Message, event: RealtimeEventPayload, conversation: Conversation) => {
  const rawKey = message.rawKey;
  if (rawKey && typeof rawKey === 'object' && typeof rawKey.id === 'string') return rawKey;
  return {
    id: message.id,
    remoteJid: event.remoteJid || conversation.id,
    fromMe: message.sender === 'attendant',
  };
};

const updateConversationFromMessage = (
  conversation: Conversation,
  event: RealtimeEventPayload,
): Conversation | null => {
  const message = event.message;
  if (!message?.id || !eventMatchesConversation(conversation, event)) return null;

  const timestampMs = Number(message.timestampMs ?? event.timestampMs ?? 0);
  const isIncoming = message.sender === 'contact';
  const messagePreview = comparableMessagePreview(message);
  const expectedPreview = conversation.isGroup
    ? `${isIncoming ? (message.senderName || 'Participante') : (message.senderName || 'Atendente')}: ${messagePreview}`
    : messagePreview;
  const isSameActivity = conversation.lastMessageFromMe === !isIncoming
    && expectedPreview === conversation.lastMessage.trim();
  const isOlderActivity = Boolean(conversation.lastMessageAt && timestampMs > 0 && timestampMs < conversation.lastMessageAt);
  if (isOlderActivity && !isSameActivity) return conversation;

  // A provider event can use a second-based timestamp while the optimistic
  // item uses milliseconds. Confirm its key without regressing the activity
  // timestamp, preview, unread state or list position.
  if (isOlderActivity && isSameActivity) {
    const nextKey = messageKeyForConversation(message, event, conversation);
    if (conversation.lastMessageKey?.id === nextKey.id) return conversation;
    return { ...conversation, lastMessageKey: nextKey };
  }

  const isSameMessage = conversation.lastMessageKey?.id === message.id;
  const nextStatus = conversation.status === 'resolved' && isIncoming ? 'open' : conversation.status;
  const nextUnreadCount = isIncoming && !isSameMessage
    ? conversation.unreadCount + 1
    : conversation.unreadCount;
  const next: Conversation = {
    ...conversation,
    lastMessage: conversation.isGroup
      ? `${message.sender === 'attendant' ? (message.senderName || 'Atendente') : (message.senderName || 'Participante')}: ${message.content || mediaPreview(message.mediaType) || conversation.lastMessage}`
      : message.content || mediaPreview(message.mediaType) || conversation.lastMessage,
    lastMessageTimestamp: formatMessageTime(timestampMs, message.timestamp),
    lastMessageAt: timestampMs || conversation.lastMessageAt,
    lastMessageFromMe: !isIncoming,
    lastMessageKey: messageKeyForConversation(message, event, conversation),
    unreadCount: nextUnreadCount,
    status: nextStatus,
    needsResponse: isIncoming ? true : false,
  };
  return next;
};

const updateConversationFromStatus = (
  conversation: Conversation,
  event: RealtimeEventPayload,
): Conversation | null => {
  let next: Conversation = conversation;
  let changed = false;

  if (hasOwn(event, 'assignedUserId')) {
    if (event.assignedUserId === null) {
      changed = Boolean(conversation.assignedAttendant) || conversation.contact.tags.length > 0;
      next = {
        ...next,
        assignedAttendant: undefined,
        contact: { ...next.contact, tags: [] },
      };
    } else if (typeof event.assignedUserId === 'string' && typeof event.assignedUserName === 'string' && event.assignedUserName.trim()) {
      changed = conversation.assignedAttendant?.id !== event.assignedUserId
        || conversation.assignedAttendant.name !== event.assignedUserName
        || conversation.contact.tags[0]?.id !== `assigned-${event.assignedUserId}`;
      next = {
        ...next,
        assignedAttendant: { id: event.assignedUserId, name: event.assignedUserName },
        contact: {
          ...next.contact,
          tags: [{ id: `assigned-${event.assignedUserId}`, name: event.assignedUserName, color: '#A78BFA' }],
        },
      };
    } else {
      return null;
    }
  }

  if (hasOwn(event, 'leaseOwnerUserId')) {
    if (event.leaseOwnerUserId === null) {
      changed = changed || Boolean(next.lease);
      next = { ...next, lease: undefined };
    } else if (
      typeof event.leaseOwnerUserId === 'string'
      && typeof event.leaseOwnerName === 'string'
      && typeof event.leaseExpiresAt === 'string'
    ) {
      const expiresAt = Date.parse(event.leaseExpiresAt);
      if (!Number.isFinite(expiresAt)) return null;
      changed = changed
        || next.lease?.ownerUserId !== event.leaseOwnerUserId
        || next.lease?.ownerName !== event.leaseOwnerName
        || next.lease?.expiresAt !== expiresAt;
      next = {
        ...next,
        lease: {
          ownerUserId: event.leaseOwnerUserId,
          ownerName: event.leaseOwnerName,
          expiresAt,
        },
      };
    } else {
      return null;
    }
  }

  if (event.status === 'open' || event.status === 'pending' || event.status === 'resolved') {
    const nextNeedsResponse = event.status === 'resolved'
      ? false
      : next.lastMessageFromMe
        ? false
        : next.needsResponse ?? next.lastMessageFromMe === false;
    changed = changed
      || conversation.status !== event.status
      || next.needsResponse !== nextNeedsResponse;
    next = {
      ...next,
      status: event.status,
      needsResponse: nextNeedsResponse,
    };
  } else if (hasOwn(event, 'status')) {
    return null;
  }

  if (hasOwn(event, 'messageTimestamp')) {
    const messageTimestamp = Number(event.messageTimestamp);
    if (!Number.isFinite(messageTimestamp)) return null;
    if (next.lastMessageAt && next.lastMessageAt <= messageTimestamp && next.unreadCount > 0) {
      changed = true;
      next = { ...next, unreadCount: 0 };
    }
  }

  return changed ? next : conversation;
};

/**
 * Applies only fields that the current conversation.updated payload actually
 * carries. Returning null means the event is insufficient and must use the
 * existing inbox refetch fallback.
 */
export const reconcileRealtimeConversation = (
  previous: Conversation[],
  event: RealtimeEventPayload,
): Conversation[] | null => {
  if (event.type !== 'conversation.updated' && event.type !== 'message.upsert') return null;
  // A reaction updates metadata on an existing message. It is never a new
  // conversation activity and must not move the chat or alter unread state.
  if (event.type === 'message.upsert' && event.reaction === true) return previous;

  const index = previous.findIndex((conversation) => eventMatchesConversation(conversation, event));
  if (index < 0) return null;

  const current = previous[index];
  const updated = event.type === 'message.upsert'
    ? updateConversationFromMessage(current, event)
    : updateConversationFromStatus(current, event);
  if (!updated) return null;
  if (updated === current) return previous;

  const next = previous.slice();
  next[index] = updated;
  // Evolution returns chats with the most recent activity first. Keep that
  // observable ordering when an incremental message arrives.
  const eventTimestamp = Number(event.message?.timestampMs ?? event.timestampMs ?? 0);
  const shouldReorder = event.type === 'message.upsert'
    && (!current.lastMessageAt || eventTimestamp >= current.lastMessageAt);
  if (shouldReorder && index > 0) {
    next.splice(index, 1);
    next.unshift(updated);
  }
  return reconcileConversations(previous, next);
};

/**
 * Applies a complete realtime message or a status-only event to the active
 * timeline. A valid status event with an unloaded message is handled as a
 * no-op; fetching the whole history would add work without changing UI.
 */
export const reconcileRealtimeMessages = (
  current: Message[],
  activeConversationId: string,
  event: RealtimeEventPayload,
): Message[] | null => {
  if (event.type === 'message.upsert') {
    const message = event.message;
    // A reaction is a metadata-only update. Missing/out-of-window targets are
    // intentionally a no-op, never a reason to reload or reset this timeline.
    if (event.reaction === true) {
      if (!message?.id) return current;
      if (!current.some((item) => item.id === message.id)) return current;
      return mergeConversationMessages(current, [message]);
    }
    if (!message?.id || (message.conversationId && message.conversationId !== activeConversationId)) return null;
    // mergeConversationMessages correlates a provider ID that arrives before
    // the POST response with the matching optimistic outbound message.
    return mergeConversationMessages(current, [message]);
  }

  if (event.type !== 'message.status' || !event.messageId) return null;
  const status = normalizeMessageStatus(event.status);
  if (!status) return null;
  const currentMessage = current.find((message) => message.id === event.messageId);
  if (!currentMessage || currentMessage.status === status) return current;
  return mergeConversationMessages(current, [{ ...currentMessage, status }]);
};
