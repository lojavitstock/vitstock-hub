import type { Conversation, Tag } from '../types';

const tagKey = (tag: Tag) => tag.systemKey ? `system:${tag.systemKey}` : `id:${tag.id}`;

/**
 * Returns the tags that are effectively associated with a conversation.
 *
 * Conversation tags are the persisted source of truth. A real traffic source
 * is also represented here with the shared system tag definition so the
 * sidebar and the conversation tag popover render the same collection without
 * turning assignments or contact tags into conversation tags.
 */
export const normalizeConversationTags = (
  conversation: Conversation | null | undefined,
  availableTags: Tag[] = [],
): Tag[] => {
  if (!conversation) return [];

  const tagsByKey = new Map<string, Tag>();
  const addTag = (tag: Tag | undefined) => {
    if (!tag || typeof tag.id !== 'string' || typeof tag.name !== 'string' || typeof tag.color !== 'string') return;
    const key = tagKey(tag);
    if (!tagsByKey.has(key)) tagsByKey.set(key, tag);
  };

  (conversation.conversationTags || []).forEach(addTag);

  if (conversation.trafficSource?.trim()
    && !(conversation.conversationTags || []).some((tag) => tag.systemKey === 'traffic')) {
    addTag(availableTags.find((tag) => tag.systemKey === 'traffic') || {
      id: 'traffic',
      name: 'Tráfego',
      color: '#F97316',
      systemKey: 'traffic',
    });
  }

  return Array.from(tagsByKey.values());
};
