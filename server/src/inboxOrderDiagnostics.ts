import { createHash } from 'node:crypto';
import { providerPhoneDigits } from './whatsappIdentity.js';

export type InboxOrderTraceTrigger =
  | 'initial_load'
  | 'polling'
  | 'realtime_reconnect'
  | 'message_upsert'
  | 'conversation_updated'
  | 'mark_read_response'
  | 'manual_refresh'
  | 'unknown';

type InboxChat = Record<string, any>;

const emitted = new Set<string>();
const MAX_DEDUPED_EVENTS = 1_000;

const shortHash = (value: unknown) => createHash('sha256')
  .update(String(value ?? 'unknown'))
  .digest('hex')
  .slice(0, 12);

const entityKey = (chat: InboxChat) => chat?.remoteJid || chat?.id || 'unknown';

const numberTimestampMs = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < 10_000_000_000 ? Math.floor(numeric * 1000) : Math.floor(numeric);
};

const dateTimestampMs = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const messageTimestampMs = (chat: InboxChat) => numberTimestampMs(chat?.lastMessage?.messageTimestamp);

const lastMessageAtMs = (chat: InboxChat) => numberTimestampMs(chat?.lastMessageAt);

const updatedAtMs = (chat: InboxChat) => dateTimestampMs(chat?.updatedAt);

const orderingTimestamp = (chat: InboxChat) => {
  const provider = messageTimestampMs(chat);
  if (provider > 0) return { value: provider, source: 'lastMessage.messageTimestamp' as const };
  const lastMessageAt = lastMessageAtMs(chat);
  if (lastMessageAt > 0) return { value: lastMessageAt, source: 'lastMessageAt' as const };
  const updatedAt = updatedAtMs(chat);
  return { value: updatedAt, source: 'updatedAt' as const };
};

const indexByIdentity = (chats: InboxChat[]) => new Map(chats.map((chat, index) => [entityKey(chat), index]));

const localByIdentity = (chats: InboxChat[] = []) => {
  const byKey = new Map<string, InboxChat>();
  chats.forEach((chat) => {
    const key = entityKey(chat);
    if (key) byKey.set(key, chat);
    const phone = providerPhoneDigits(chat);
    if (phone) byKey.set(`phone:${phone}`, chat);
  });
  return byKey;
};

/**
 * Logs only actual backend projection reorders or snapshots that must fall
 * back to updatedAt. It never emits raw provider identifiers or content.
 */
export function traceInboxOrderProjection(
  previous: InboxChat[],
  next: InboxChat[],
  options: { localChats?: InboxChat[]; enabled?: boolean; trigger?: InboxOrderTraceTrigger } = {},
) {
  const enabled = options.enabled ?? process.env.INBOX_ORDER_DEBUG === 'true';
  if (!enabled) return 0;

  const previousIndexes = indexByIdentity(previous);
  const nextIndexes = indexByIdentity(next);
  const local = localByIdentity(options.localChats);
  let emittedCount = 0;

  next.forEach((chat) => {
    const key = entityKey(chat);
    const fromIndex = previousIndexes.get(key) ?? -1;
    const toIndex = nextIndexes.get(key) ?? -1;
    const ordering = orderingTimestamp(chat);
    const changedIndex = fromIndex !== toIndex;
    const suspiciousTimestamp = ordering.source === 'updatedAt' && ordering.value > 0;
    if (!changedIndex && !suspiciousTimestamp) return;

    const localChat = local.get(key) || local.get(`phone:${providerPhoneDigits(chat)}`);
    const payload = {
      event: 'projection_order',
      entity: `entity-${shortHash(key)}`,
      fromIndex,
      toIndex,
      providerMessageTimestamp: messageTimestampMs(chat) || undefined,
      localMessageTimestamp: localChat ? (messageTimestampMs(localChat) || lastMessageAtMs(localChat) || undefined) : undefined,
      finalMessageTimestamp: ordering.value || undefined,
      lastMessageAt: lastMessageAtMs(chat) || undefined,
      updatedAt: updatedAtMs(chat) || undefined,
      orderingTimestampChosenFrom: ordering.source,
      trigger: options.trigger || 'unknown',
    };
    const dedupeKey = JSON.stringify(payload);
    if (emitted.has(dedupeKey)) return;
    if (emitted.size >= MAX_DEDUPED_EVENTS) emitted.clear();
    emitted.add(dedupeKey);
    console.info('[INBOX_ORDER_TRACE]', JSON.stringify(payload));
    emittedCount += 1;
  });

  return emittedCount;
}

export function resetInboxOrderDebugDedupe() {
  emitted.clear();
}
