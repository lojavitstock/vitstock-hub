import type { Message } from '../types';

export const COMMON_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export const HUB_REACTOR_KEY = '__vitstock_self__';

export type CommonReactionEmoji = typeof COMMON_REACTION_EMOJIS[number];

export const canReactToMessage = (message: Message) => Boolean(
  !message.isInternalNote
  && message.status !== 'pending'
  && typeof message.rawKey?.id === 'string'
  && message.rawKey.id.trim().length > 0,
);

export const nextHubReactionEmoji = (message: Message, emoji: CommonReactionEmoji) => (
  message.metadata?.reactions?.find((reaction) => reaction.reactorKey === HUB_REACTOR_KEY)?.emoji === emoji
    ? null
    : emoji
);

/** Updates only the target message metadata; conversation activity is untouched. */
export const withOptimisticHubReaction = (
  message: Message,
  emoji: CommonReactionEmoji | null,
  input: { actorId?: string; actorName?: string; updatedAt: number },
): Message => {
  const current = message.metadata?.reactions || [];
  const withoutHubReaction = current.filter((reaction) => reaction.reactorKey !== HUB_REACTOR_KEY);
  const reactions = emoji
    ? [...withoutHubReaction, {
        emoji,
        reactorKey: HUB_REACTOR_KEY,
        actorId: input.actorId || HUB_REACTOR_KEY,
        ...(input.actorName ? { actorName: input.actorName } : {}),
        fromMe: true,
        updatedAt: input.updatedAt,
      }]
    : withoutHubReaction;
  const metadata = { ...(message.metadata || {}) };
  if (reactions.length) metadata.reactions = reactions;
  else delete metadata.reactions;
  return { ...message, metadata };
};
