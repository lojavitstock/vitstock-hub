import { unwrapProviderMessage } from './providerMessagePolicy.js';

export type StoredMessageReaction = {
  emoji: string;
  /** Stable actor identity used only to replace/remove that actor's reaction. */
  actorId: string;
  /** Provider participant JID when Evolution exposes it. */
  participant?: string;
  fromMe?: boolean;
};

export type ProviderReactionUpdate = {
  targetMessageId: string;
  targetRemoteJid?: string;
  emoji: string;
  actorId: string;
  participant?: string;
  fromMe: boolean;
};

const nonEmptyText = (value: unknown) => typeof value === 'string' && value.trim()
  ? value.trim()
  : undefined;

export const isProviderReactionEvent = (record: any) => Boolean(
  unwrapProviderMessage(record?.message)?.reactionMessage,
);

/**
 * Evolution/Baileys keeps the reacted message key inside reactionMessage.key.
 * The outer record key identifies the actor/event, never the reacted message.
 */
export const providerReactionUpdate = (record: any): ProviderReactionUpdate | undefined => {
  const message = unwrapProviderMessage(record?.message);
  const reaction = message?.reactionMessage;
  const targetMessageId = nonEmptyText(reaction?.key?.id);
  if (!reaction || !targetMessageId) return undefined;

  const fromMe = record?.key?.fromMe === true;
  const participant = nonEmptyText(
    record?.key?.participant
    || record?.participant
    || record?.participantPn
    || record?.senderPn,
  );
  const actorId = participant || (fromMe
    ? '__vitstock_self__'
    : nonEmptyText(record?.key?.remoteJid || record?.remoteJid));
  if (!actorId) return undefined;

  return {
    targetMessageId,
    targetRemoteJid: nonEmptyText(reaction?.key?.remoteJid),
    emoji: typeof reaction.text === 'string' ? reaction.text.trim() : '',
    actorId,
    ...(participant ? { participant } : {}),
    fromMe,
  };
};

export const normalizeStoredReactions = (value: unknown): StoredMessageReaction[] => (
  Array.isArray(value)
    ? value.flatMap((item) => {
      const emoji = nonEmptyText(item?.emoji);
      const actorId = nonEmptyText(item?.actorId);
      if (!emoji || !actorId) return [];
      const participant = nonEmptyText(item?.participant);
      return [{
        emoji,
        actorId,
        ...(participant ? { participant } : {}),
        ...(typeof item?.fromMe === 'boolean' ? { fromMe: item.fromMe } : {}),
      }];
    })
    : []
);

/** A participant may hold one reaction per message; empty text removes it. */
export const applyProviderReaction = (
  current: StoredMessageReaction[],
  update: ProviderReactionUpdate,
): StoredMessageReaction[] => {
  const existing = current.find((reaction) => reaction.actorId === update.actorId);
  if (
    existing
    && existing.emoji === update.emoji
    && existing.participant === update.participant
    && existing.fromMe === update.fromMe
  ) return current;
  if (!existing && !update.emoji) return current;
  const withoutActor = current.filter((reaction) => reaction.actorId !== update.actorId);
  if (!update.emoji) return withoutActor;
  return [...withoutActor, {
    emoji: update.emoji,
    actorId: update.actorId,
    ...(update.participant ? { participant: update.participant } : {}),
    fromMe: update.fromMe,
  }];
};
