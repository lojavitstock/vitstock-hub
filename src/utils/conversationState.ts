import type { Conversation } from '../types';

/**
 * Indicates that the customer's last relevant interaction still needs an
 * answer. This intentionally does not depend on unreadCount: reading a
 * conversation must not mark it as answered.
 */
export const conversationNeedsResponse = (conversation: Conversation) => (
  conversation.needsResponse
  ?? (conversation.status !== 'resolved' && conversation.lastMessageFromMe === false)
);
