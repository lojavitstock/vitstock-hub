import type { Message } from '../types';

export const CONVERSATION_MESSAGE_CACHE_LIMIT = 40;

export type ConversationMessagesCacheEntry = {
  messages: Message[];
  hasMoreMessages: boolean;
  historyExpanded: boolean;
  latestTimestamp?: number;
};

export type ConversationMessagesCache = Map<string, ConversationMessagesCacheEntry>;

/**
 * Keeps the most recently accessed conversations and drops the oldest entry
 * when the session cache reaches its bounded limit.
 */
export const writeConversationMessagesCache = (
  cache: ConversationMessagesCache,
  conversationKey: string,
  entry: ConversationMessagesCacheEntry,
) => {
  cache.delete(conversationKey);
  cache.set(conversationKey, entry);

  while (cache.size > CONVERSATION_MESSAGE_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
};

export const readConversationMessagesCache = (
  cache: ConversationMessagesCache,
  conversationKey: string,
) => {
  const entry = cache.get(conversationKey);
  if (!entry) return undefined;
  writeConversationMessagesCache(cache, conversationKey, entry);
  return entry;
};
