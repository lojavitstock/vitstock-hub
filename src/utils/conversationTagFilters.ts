import type { Conversation, Tag } from '../types';

export type ConversationFilter = 'all' | 'unread' | 'unanswered' | 'traffic' | `tag:${string}` | 'groups' | 'delivery' | 'resolved';

export const isTrafficConversation = (conversation: Conversation) => (
  Boolean(conversation.trafficSource)
  || (conversation.conversationTags || []).some((tag) => tag.systemKey === 'traffic')
);

export const matchesConversationFilter = (conversation: Conversation, filter: ConversationFilter, needsResponse: (conversation: Conversation) => boolean) => {
  if (filter === 'all') return true;
  if (filter === 'unread') return conversation.unreadCount > 0;
  if (filter === 'unanswered') return needsResponse(conversation);
  if (filter === 'traffic') return isTrafficConversation(conversation);
  if (filter === 'groups') return conversation.isGroup === true;
  if (filter === 'delivery') return conversation.status === 'pending';
  if (filter === 'resolved') return conversation.status === 'resolved';
  if (filter.startsWith('tag:')) return (conversation.conversationTags || []).some((tag) => tag.id === filter.slice(4));
  return false;
};

export const conversationTagCount = (conversations: Conversation[], tag: Tag) => (
  conversations.filter((conversation) => tag.systemKey === 'traffic' ? isTrafficConversation(conversation) : (conversation.conversationTags || []).some((item) => item.id === tag.id)).length
);
