import { Conversation } from '../types';

export const isPhoneSearchQuery = (value: string) => {
  const query = value.trim();
  return query.length > 0 && /^[+()\d\s.-]+$/.test(query);
};

export const normalizeManualPhone = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw || !/^(?:\+|00)?[\d\s().-]+$/.test(raw)) return '';
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);
  if (digits.length > 15) return '';
  if (raw.startsWith('+') || raw.startsWith('00')) return digits.length >= 9 ? digits : '';
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.startsWith('55') && (digits.length === 12 || digits.length === 13) ? digits : '';
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
