import { unwrapProviderMessage } from './providerMessagePolicy.js';

export const HUB_REACTOR_KEY = '__vitstock_self__';

export type StoredMessageReaction = {
  emoji: string;
  /** Canonical key for one reactor on one message. */
  reactorKey: string;
  /** Kept for compatibility with reactions persisted before reactorKey. */
  actorId: string;
  actorName?: string;
  participant?: string;
  fromMe?: boolean;
  /** Provider event timestamp in milliseconds. Zero means a legacy record. */
  updatedAt: number;
};

export type ProviderReactionUpdate = {
  targetMessageId: string;
  targetRemoteJid?: string;
  emoji: string;
  reactorKey: string;
  participant?: string;
  fromMe: boolean;
  updatedAt: number;
  actorId?: string;
  actorName?: string;
};

const nonEmptyText = (value: unknown) => typeof value === 'string' && value.trim()
  ? value.trim()
  : undefined;

const timestampMs = (value: unknown) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? Math.floor(numeric * 1000) : Math.floor(numeric);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const jidLocalPart = (value: string) => value
  .trim()
  .toLowerCase()
  .split('@')[0]
  ?.replace(/:\d+$/, '')
  .replace(/\D/g, '') || '';

const canonicalJidKey = (value: string) => {
  const local = jidLocalPart(value);
  return local ? `jid:${local}` : `jid:${value.trim().toLowerCase()}`;
};

const isPhoneJid = (value: string) => {
  const lower = value.trim().toLowerCase();
  return Boolean(jidLocalPart(value)) && !lower.endsWith('@lid');
};

const reactorDetails = (record: any, fromMe: boolean) => {
  if (fromMe) return { reactorKey: HUB_REACTOR_KEY };

  const candidates = [
    record?.key?.participant,
    record?.key?.participantPn,
    record?.participant,
    record?.participantPn,
    record?.senderPn,
    record?.key?.senderPn,
    record?.key?.remoteJidAlt,
    record?.remoteJidAlt,
    record?.key?.remoteJid,
    record?.remoteJid,
  ].flatMap((value) => {
    const text = nonEmptyText(value);
    return text ? [text] : [];
  });
  const participant = candidates[0];
  // Evolution may provide both @lid and a phone JID for the same person.
  // Prefer the phone JID when available, but canonicalize the local JID part
  // so @s.whatsapp.net/@c.us formatting differences cannot duplicate a badge.
  const identity = candidates.find(isPhoneJid) || participant;
  if (!identity) return undefined;
  return { reactorKey: canonicalJidKey(identity), ...(participant ? { participant } : {}) };
};

export const isProviderReactionEvent = (record: any) => Boolean(
  unwrapProviderMessage(record?.message)?.reactionMessage,
);

/**
 * Evolution/Baileys keeps the reacted message key inside reactionMessage.key.
 * The outer record key identifies the reaction actor/event, never the target.
 */
export const providerReactionUpdate = (record: any): ProviderReactionUpdate | undefined => {
  const message = unwrapProviderMessage(record?.message);
  const reaction = message?.reactionMessage;
  const targetMessageId = nonEmptyText(reaction?.key?.id);
  if (!reaction || !targetMessageId) return undefined;

  const fromMe = record?.key?.fromMe === true;
  const reactor = reactorDetails(record, fromMe);
  if (!reactor) return undefined;

  return {
    targetMessageId,
    targetRemoteJid: nonEmptyText(reaction?.key?.remoteJid),
    emoji: typeof reaction.text === 'string' ? reaction.text.trim() : '',
    reactorKey: reactor.reactorKey,
    ...(reactor.participant ? { participant: reactor.participant } : {}),
    fromMe,
    updatedAt: timestampMs(
      record?.messageTimestamp
      ?? record?.messageTimestampMs
      ?? record?.timestamp
      ?? message?.messageTimestamp,
    ),
  };
};

const sameStoredReaction = (left: StoredMessageReaction, right: StoredMessageReaction) => (
  left.emoji === right.emoji
  && left.reactorKey === right.reactorKey
  && left.actorId === right.actorId
  && left.actorName === right.actorName
  && left.participant === right.participant
  && left.fromMe === right.fromMe
  && left.updatedAt === right.updatedAt
);

export const areStoredReactionsEqual = (left: StoredMessageReaction[], right: StoredMessageReaction[]) => (
  left.length === right.length && left.every((reaction, index) => sameStoredReaction(reaction, right[index]!))
);

/** Converts legacy arrays to a single deterministic entry per reactor. */
export const normalizeStoredReactions = (value: unknown): StoredMessageReaction[] => {
  if (!Array.isArray(value)) return [];
  const byReactor = new Map<string, StoredMessageReaction>();
  value.forEach((item) => {
    const emoji = nonEmptyText(item?.emoji);
    const participant = nonEmptyText(item?.participant);
    const legacyActor = nonEmptyText(item?.reactorKey) || nonEmptyText(item?.actorId);
    const reactorKey = legacyActor === HUB_REACTOR_KEY
      ? legacyActor
      : canonicalJidKey(participant || legacyActor || '');
    if (!emoji || !reactorKey || reactorKey === 'jid:') return;
    const next: StoredMessageReaction = {
      emoji,
      reactorKey,
      actorId: nonEmptyText(item?.actorId) || reactorKey,
      ...(nonEmptyText(item?.actorName) ? { actorName: nonEmptyText(item?.actorName) } : {}),
      ...(participant ? { participant } : {}),
      ...(typeof item?.fromMe === 'boolean' ? { fromMe: item.fromMe } : {}),
      updatedAt: timestampMs(item?.updatedAt),
    };
    const current = byReactor.get(reactorKey);
    // Arrays written by previous versions append the newest value. For an
    // equal/legacy timestamp, retaining the latter entry repairs that state.
    if (!current || next.updatedAt >= current.updatedAt) byReactor.set(reactorKey, next);
  });
  return [...byReactor.values()];
};

/** One participant may hold one current reaction per target message. */
export const applyProviderReaction = (
  current: StoredMessageReaction[],
  update: ProviderReactionUpdate,
): StoredMessageReaction[] => {
  const existing = current.find((reaction) => reaction.reactorKey === update.reactorKey);
  // Polling can resend older reaction events. Never let one replace a newer
  // persisted state. Equal timestamps with distinct events are kept stable as
  // well: Evolution timestamps are normally event times, not arrival times.
  if (existing && existing.updatedAt > 0 && update.updatedAt <= existing.updatedAt) return current;
  if (!existing && !update.emoji) return current;
  const withoutReactor = current.filter((reaction) => reaction.reactorKey !== update.reactorKey);
  if (!update.emoji) return withoutReactor;
  return [...withoutReactor, {
    emoji: update.emoji,
    reactorKey: update.reactorKey,
    actorId: update.actorId || existing?.actorId || update.reactorKey,
    ...(update.actorName || existing?.actorName ? { actorName: update.actorName || existing?.actorName } : {}),
    ...(update.participant ? { participant: update.participant } : {}),
    fromMe: update.fromMe,
    updatedAt: update.updatedAt,
  }];
};
