import type { Message } from '../types';
import type { RealtimeEventPayload } from './realtimeUpdates';

const MAX_REMEMBERED_MESSAGE_IDS = 2000;
const CROSS_TAB_STORAGE_KEY = 'vitstock:notification-dedupe:v1';
const DEFAULT_CROSS_TAB_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CROSS_TAB_MAX_RECORDS = 500;

export type NotificationPresentation = 'none' | 'toast' | 'desktop';
export const notificationPermissionAllowsDesktop = (permission: string): boolean => permission === 'granted';

export const isNotifiableInboundMessage = (event: RealtimeEventPayload): event is RealtimeEventPayload & { message: Message } => (
  event.type === 'message.upsert'
  && event.fromMe !== true
  && event.reaction !== true
  && event.incrementUnread !== false
  && event.message?.sender === 'contact'
  && event.message.isInternalNote !== true
  && Boolean(event.message.id?.trim())
);

/** Only explicit conversation identities are valid navigation targets. */
export const getNotificationConversationId = (event: RealtimeEventPayload): string | null => {
  const messageConversationId = event.message?.conversationId?.trim();
  if (messageConversationId) return messageConversationId;
  const eventRemoteJid = event.remoteJid?.trim();
  return eventRemoteJid || null;
};

export const chooseNotificationPresentation = (options: {
  visible: boolean;
  focused: boolean;
  activeConversationId: string | null;
  notificationConversationId: string | null;
}): NotificationPresentation => {
  if (!options.visible || !options.focused) return 'desktop';
  if (options.notificationConversationId && options.notificationConversationId !== options.activeConversationId) return 'toast';
  return 'none';
};

const MEDIA_LABELS: Record<NonNullable<Message['mediaType']>, string> = {
  image: 'Imagem',
  audio: 'Mensagem de áudio',
  video: 'Vídeo',
  document: 'Documento',
  sticker: 'Figurinha',
};

export const getNotificationPreview = (message: Message, maxLength = 120): string => {
  if (message.metadata?.location) return 'Localização';
  if (message.mediaType) return MEDIA_LABELS[message.mediaType];
  const content = String(message.content || '').trim();
  if (!content || /^\+?[\d\s().-]+@(?:lid|s\.whatsapp\.net|c\.us|g\.us)$/i.test(content)) return 'Nova mensagem';
  const characters = Array.from(content);
  return characters.length > maxLength ? `${characters.slice(0, maxLength).join('')}…` : content;
};

export const buildConversationNavigationTarget = (conversationId: string): string => (
  `/atendimento?conversation=${encodeURIComponent(conversationId)}`
);

export const consumeConversationQuery = (options: {
  search: string;
  hasLoadedConversations: boolean;
  conversationIds: Iterable<string>;
  refreshAttempted?: boolean;
}): { ready: boolean; shouldRefresh: boolean; conversationId: string | null; search: string } => {
  const params = new URLSearchParams(options.search);
  if (!params.has('conversation') || !options.hasLoadedConversations) {
    return { ready: false, shouldRefresh: false, conversationId: null, search: options.search };
  }

  const requestedId = params.get('conversation');
  const knownIds = new Set(options.conversationIds);
  const conversationId = requestedId && knownIds.has(requestedId) ? requestedId : null;
  if (requestedId && !conversationId && !options.refreshAttempted) {
    return { ready: false, shouldRefresh: true, conversationId: null, search: options.search };
  }
  params.delete('conversation');
  const rest = params.toString();
  return { ready: true, shouldRefresh: false, conversationId, search: rest ? `?${rest}` : '' };
};

export const fingerprintNotificationMessageId = async (messageId: string): Promise<string | null> => {
  if (!messageId || !globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') return null;
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(messageId));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
};

type NotificationStorage = Pick<Storage, 'getItem' | 'setItem'>;
type StoredNotification = { fingerprint: string; expiresAt: number };

export const createCrossTabMessageNotificationDeduper = (
  storage?: NotificationStorage,
  options: { now?: () => number; ttlMs?: number; maxRecords?: number } = {},
) => {
  const now = options.now || Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_CROSS_TAB_TTL_MS;
  const maxRecords = options.maxRecords ?? DEFAULT_CROSS_TAB_MAX_RECORDS;
  const localSeen = new Map<string, number>();

  return {
    shouldNotify(fingerprint: string) {
      if (!fingerprint) return false;
      const currentTime = now();
      const localExpiry = localSeen.get(fingerprint);
      if (localExpiry && localExpiry > currentTime) return false;
      if (localExpiry) localSeen.delete(fingerprint);
      if (!storage) {
        localSeen.set(fingerprint, currentTime + ttlMs);
        return true;
      }

      try {
        const parsed: unknown = JSON.parse(storage.getItem(CROSS_TAB_STORAGE_KEY) || '[]');
        const existing = Array.isArray(parsed)
          ? parsed.filter((item): item is StoredNotification => (
            Boolean(item)
            && typeof item === 'object'
            && typeof item.fingerprint === 'string'
            && typeof item.expiresAt === 'number'
            && item.expiresAt > currentTime
          ))
          : [];
        const duplicate = existing.find((item) => item.fingerprint === fingerprint);
        if (duplicate) {
          localSeen.set(fingerprint, duplicate.expiresAt);
          return false;
        }

        const next = [...existing, { fingerprint, expiresAt: currentTime + ttlMs }].slice(-maxRecords);
        storage.setItem(CROSS_TAB_STORAGE_KEY, JSON.stringify(next));
        localSeen.set(fingerprint, currentTime + ttlMs);
        return true;
      } catch {
        // Storage can be disabled by browser policy; retain at least per-tab dedupe.
        localSeen.set(fingerprint, currentTime + ttlMs);
        return true;
      }
    },
  };
};

export const createMessageNotificationDeduper = () => {
  const seenIds = new Set<string>();
  const insertionOrder: string[] = [];

  return {
    shouldNotify(message?: Message) {
      if (!message || message.sender !== 'contact' || message.isInternalNote || !message.id) return false;
      if (seenIds.has(message.id)) return false;
      seenIds.add(message.id);
      insertionOrder.push(message.id);
      if (insertionOrder.length > MAX_REMEMBERED_MESSAGE_IDS) {
        const oldestId = insertionOrder.shift();
        if (oldestId) seenIds.delete(oldestId);
      }
      return true;
    },
  };
};
