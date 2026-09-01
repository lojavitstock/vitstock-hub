import { canonicalPhone } from './contactDomain.js';
import { isWhatsAppGroup, isWhatsAppLid, providerPhoneDigits } from './whatsappIdentity.js';

type InboxChat = Record<string, any>;

const weakNames = new Set(['', 'Contato', 'Participante', 'WhatsApp Business', 'Você']);

const stringValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const usableName = (value: unknown) => {
  const name = stringValue(value);
  if (!name || weakNames.has(name) || /^Participante …\S+$/.test(name) || /^\+?[\d\s().-]+$/.test(name)) return '';
  return name;
};

const remoteJidOf = (chat: InboxChat) => stringValue(chat.remoteJid || chat.id);

const canonicalPhoneKey = (chat: InboxChat) => {
  const digits = providerPhoneDigits(chat) || providerPhoneDigits({ remoteJid: stringValue(chat.phone) });
  if (!digits) return '';
  const canonical = canonicalPhone(digits, { defaultCountry: 'BR' });
  const normalized = canonical?.replace(/\D/g, '') || digits;
  return normalized;
};

export type CanonicalInboxIdentity = {
  key: string;
  remoteJid: string;
  canonicalPhone: string;
  explicit: boolean;
};

/**
 * Returns a merge key only when the provider supplied a real phone identity
 * (PN or an explicit LID→PN alias). An opaque LID remains a separate key.
 */
export function canonicalInboxIdentity(chat: InboxChat): CanonicalInboxIdentity {
  const remoteJid = remoteJidOf(chat);
  const lowerRemoteJid = remoteJid.toLowerCase();
  if (isWhatsAppGroup(remoteJid)) {
    return { key: `group:${lowerRemoteJid}`, remoteJid, canonicalPhone: '', explicit: true };
  }

  const phone = canonicalPhoneKey(chat);
  if (phone) {
    return { key: `phone:${phone}`, remoteJid, canonicalPhone: phone, explicit: true };
  }

  return { key: `jid:${lowerRemoteJid}`, remoteJid, canonicalPhone: '', explicit: false };
}

const activityTimestamp = (chat: InboxChat) => {
  const messageTimestamp = Number(chat.lastMessage?.messageTimestamp);
  if (Number.isFinite(messageTimestamp) && messageTimestamp > 0) return messageTimestamp * 1000;
  const lastMessageAt = Number(chat.lastMessageAt);
  if (Number.isFinite(lastMessageAt) && lastMessageAt > 0) return lastMessageAt;
  const updatedAt = Date.parse(stringValue(chat.updatedAt));
  return Number.isFinite(updatedAt) ? updatedAt : 0;
};

const stateTimestamp = (chat: InboxChat) => {
  const updatedAt = Date.parse(stringValue(chat.updatedAt));
  return Number.isFinite(updatedAt) ? updatedAt : activityTimestamp(chat);
};

const hasValue = (value: unknown) => (
  (typeof value === 'string' && value.trim().length > 0)
  || (typeof value === 'number' && Number.isFinite(value))
  || typeof value === 'boolean'
);

const mergeTags = (items: InboxChat[]) => {
  const tags = new Map<string, any>();
  items.forEach((chat) => {
    const values = [chat.conversationTags, chat.contact?.tags].flatMap((value) => Array.isArray(value) ? value : []);
    values.forEach((tag: any) => {
      const id = stringValue(tag?.id) || stringValue(tag?.name);
      if (id && !tags.has(id)) tags.set(id, tag);
    });
  });
  return Array.from(tags.values());
};

const mergeContactData = (
  items: Array<{ chat: InboxChat; index: number }>,
  primary: InboxChat,
  identity: CanonicalInboxIdentity,
) => {
  const contacts = items.map(({ chat }) => chat.contact).filter((value) => value && typeof value === 'object');
  if (contacts.length === 0) return undefined;
  const base = { ...(primary.contact || contacts[0]) };
  const name = contacts.map((contact: any) => usableName(contact.name)).find(Boolean)
    || stringValue(base.name)
    || items.map(({ chat }) => usableName(chat.name) || usableName(chat.pushName)).find(Boolean);
  const avatar = contacts.map((contact: any) => stringValue(contact.avatar)).find(Boolean)
    || stringValue(base.avatar)
    || items.map(({ chat }) => stringValue(chat.profilePicUrl || chat.profilePictureUrl)).find(Boolean);
  const result = {
    ...base,
    ...(name ? { name } : {}),
    ...(avatar ? { avatar } : {}),
    ...(identity.canonicalPhone ? { phone: `+${identity.canonicalPhone}` } : {}),
    tags: mergeTags(items.map(({ chat }) => ({ contact: chat.contact }))),
  };
  return result;
};

const identityRank = (chat: InboxChat) => {
  const remoteJid = remoteJidOf(chat);
  const directPn = remoteJid && !isWhatsAppLid(remoteJid) && !isWhatsAppGroup(remoteJid);
  const explicitAlias = Boolean(providerPhoneDigits(chat));
  const name = usableName(chat.name) || usableName(chat.pushName) || usableName(chat.contact?.name);
  const avatar = stringValue(chat.profilePicUrl || chat.profilePictureUrl || chat.contact?.avatar);
  const metadata = chat.lastMessage?.metadata;
  return (directPn ? 100 : explicitAlias ? 80 : 0)
    + (name ? 10 : 0)
    + (avatar ? 5 : 0)
    + (metadata ? 2 : 0)
    + (Array.isArray(chat.conversationTags) && chat.conversationTags.length ? 1 : 0);
};

const choosePrimary = (items: Array<{ chat: InboxChat; index: number }>) => items
  .slice()
  .sort((left, right) => (
    identityRank(right.chat) - identityRank(left.chat)
    || stateTimestamp(right.chat) - stateTimestamp(left.chat)
    || left.index - right.index
    || remoteJidOf(left.chat).localeCompare(remoteJidOf(right.chat))
  ))[0];

const chooseActivity = (items: Array<{ chat: InboxChat; index: number }>) => items
  .slice()
  .sort((left, right) => (
    activityTimestamp(right.chat) - activityTimestamp(left.chat)
    || stateTimestamp(right.chat) - stateTimestamp(left.chat)
    || left.index - right.index
  ))[0];

const chooseState = (items: Array<{ chat: InboxChat; index: number }>) => items
  .slice()
  .sort((left, right) => (
    stateTimestamp(right.chat) - stateTimestamp(left.chat)
    || activityTimestamp(right.chat) - activityTimestamp(left.chat)
    || left.index - right.index
  ))[0];

const mergeBucket = (items: Array<{ chat: InboxChat; index: number }>, identity: CanonicalInboxIdentity) => {
  const primaryEntry = choosePrimary(items)!;
  const activityEntry = chooseActivity(items)!;
  const stateEntry = chooseState(items)!;
  const primary = primaryEntry.chat;
  const activity = activityEntry.chat;
  const state = stateEntry.chat;
  const merged: InboxChat = { ...primary };

  // Keep a stable provider identity, preferring the PN representation when it
  // is explicitly known. The activity payload is merged independently below.
  const canonicalRemoteJid = remoteJidOf(primary);
  merged.id = canonicalRemoteJid;
  merged.remoteJid = canonicalRemoteJid;
  if (identity.canonicalPhone) merged.remoteJidAlt = `${identity.canonicalPhone}@s.whatsapp.net`;

  const name = items.map(({ chat }) => usableName(chat.name) || usableName(chat.pushName) || usableName(chat.contact?.name)).find(Boolean);
  if (name) {
    merged.name = name;
    if (!merged.pushName || !usableName(merged.pushName)) merged.pushName = name;
  }
  const avatar = items.map(({ chat }) => stringValue(chat.profilePicUrl || chat.profilePictureUrl || chat.contact?.avatar)).find(Boolean);
  if (avatar) merged.profilePicUrl = avatar;
  if (identity.canonicalPhone) merged.phone = `+${identity.canonicalPhone}`;
  const mergedContact = mergeContactData(items, primary, identity);
  if (mergedContact) merged.contact = mergedContact;

  if (hasValue(activity.lastMessage)) merged.lastMessage = activity.lastMessage;
  if (hasValue(activity.updatedAt)) merged.updatedAt = activity.updatedAt;
  if (hasValue(activity.lastMessageAt)) merged.lastMessageAt = activity.lastMessageAt;
  if (activity.lastMessage) merged.lastMessage = activity.lastMessage;
  if (activity.lastMessage?.messageTimestamp) merged.lastMessage = activity.lastMessage;
  if (hasValue(state.unreadCount)) merged.unreadCount = state.unreadCount;
  if (hasValue(state.needsResponse)) merged.needsResponse = state.needsResponse;
  if (hasValue(state.status)) merged.status = state.status;
  if (state.assignedAttendant) merged.assignedAttendant = state.assignedAttendant;
  if (state.lease) merged.lease = state.lease;
  const assignmentEntry = items
    .filter(({ chat }) => chat.assignedAttendant)
    .sort((left, right) => stateTimestamp(right.chat) - stateTimestamp(left.chat) || left.index - right.index)[0];
  if (assignmentEntry) merged.assignedAttendant = assignmentEntry.chat.assignedAttendant;
  const leaseEntry = items
    .filter(({ chat }) => chat.lease)
    .sort((left, right) => stateTimestamp(right.chat) - stateTimestamp(left.chat) || left.index - right.index)[0];
  if (leaseEntry) merged.lease = leaseEntry.chat.lease;
  if (state.conversationTags || primary.conversationTags) merged.conversationTags = mergeTags(items.map(({ chat }) => chat));

  if (activity.lastMessage) {
    merged.lastMessage = {
      ...activity.lastMessage,
      ...(activity.lastMessage.key ? { key: { ...activity.lastMessage.key } } : {}),
    };
  }
  return merged;
};

/**
 * Collapse only conversations with explicit PN/canonical-phone evidence. The
 * implementation is O(n) for bucket construction and O(k log k) per identity
 * bucket, where k is the number of aliases for that identity.
 */
export function projectCanonicalInboxChats(chats: InboxChat[]) {
  const buckets = new Map<string, Array<{ chat: InboxChat; index: number }>>();
  chats.forEach((chat, index) => {
    const identity = canonicalInboxIdentity(chat);
    const bucket = buckets.get(identity.key) || [];
    bucket.push({ chat, index });
    buckets.set(identity.key, bucket);
  });

  return Array.from(buckets.entries())
    .map(([key, items]) => {
      const firstItem = items[0]!;
      const identity = canonicalInboxIdentity(firstItem.chat);
      return { chat: mergeBucket(items, identity), index: Math.min(...items.map((item) => item.index)), key };
    })
    .sort((left, right) => activityTimestamp(right.chat) - activityTimestamp(left.chat) || left.index - right.index)
    .map(({ chat }) => chat);
}
