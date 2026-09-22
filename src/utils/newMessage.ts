import { Conversation } from '../types';

export const isPhoneSearchQuery = (value: string) => {
  const query = value.trim();
  return query.length > 0 && /^[+()\d\s.-]+$/.test(query);
};

export const normalizeManualPhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return /^\d{8,20}$/.test(digits) ? digits : '';
};

export const recentPrivateConversations = (conversations: Conversation[], limit = 8) => {
  const byId = new Map<string, Conversation>();
  conversations
    .filter((conversation) => !conversation.isGroup && !conversation.isPending)
    .slice()
    .sort((left, right) => (right.lastMessageAt || 0) - (left.lastMessageAt || 0))
    .forEach((conversation) => {
      if (!byId.has(conversation.id)) byId.set(conversation.id, conversation);
    });
  return Array.from(byId.values()).slice(0, limit);
};
