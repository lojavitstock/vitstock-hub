export type AvatarDebugSource = 'whatsapp' | 'google' | 'stored' | 'snapshot' | 'group' | 'none';

type AvatarSelectionInput = {
  entityId?: unknown;
  remoteJid?: unknown;
  isGroup?: boolean;
  whatsappAvatar?: unknown;
  googleAvatar?: unknown;
  storedAvatar?: unknown;
  snapshotAvatar?: unknown;
  selectedSource: AvatarDebugSource;
  selectedAvatar?: unknown;
  explicitAliasPresent?: boolean;
  path: string;
};

type DebugOptions = { enabled?: boolean };

const emitted = new Set<string>();
const entityTokens = new Map<string, string>();
const MAX_DEDUPED_EVENTS = 1_000;

const hasAvatar = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

// A random per-session token correlates browser logs without exposing contact
// names, phone numbers or provider identifiers. The raw value never leaves
// this process and cannot be reversed from the emitted token.
const entityToken = (value: unknown) => {
  const input = String(value ?? 'unknown');
  const existing = entityTokens.get(input);
  if (existing) return existing;
  const bytes = new Uint32Array(2);
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else {
    bytes[0] = Math.floor(Math.random() * 0xffffffff);
    bytes[1] = Math.floor(Math.random() * 0xffffffff);
  }
  const token = `entity-${bytes[0].toString(16).padStart(8, '0')}${bytes[1].toString(16).padStart(8, '0')}`;
  entityTokens.set(input, token);
  return token;
};

const enabledByEnv = () => Boolean((import.meta as any).env?.VITE_AVATAR_DEBUG === 'true');

function jidType(input: AvatarSelectionInput) {
  if (input.isGroup) return 'GROUP' as const;
  const value = String(input.remoteJid || '').trim().toLowerCase();
  if (value.endsWith('@g.us')) return 'GROUP' as const;
  if (value.endsWith('@lid')) return 'LID' as const;
  if (value.endsWith('@s.whatsapp.net') || value.endsWith('@c.us') || /^\d{8,20}$/.test(value)) return 'PN' as const;
  return 'UNKNOWN' as const;
}

function entity(input: AvatarSelectionInput) {
  return entityToken(input.entityId ?? input.remoteJid);
}

function safePath(value: string) {
  return value.replace(/[^a-zA-Z0-9._:/-]/g, '_').slice(0, 100) || 'unknown';
}

export function traceAvatarSelection(input: AvatarSelectionInput, options: DebugOptions = {}) {
  const debugEnabled = options.enabled ?? enabledByEnv();
  if (!debugEnabled) return false;
  const payload = {
    entity: entity(input),
    jidType: jidType(input),
    whatsappAvatarPresent: hasAvatar(input.whatsappAvatar),
    googleAvatarPresent: hasAvatar(input.googleAvatar),
    storedAvatarPresent: hasAvatar(input.storedAvatar),
    snapshotAvatarPresent: hasAvatar(input.snapshotAvatar),
    selectedSource: input.selectedSource,
    selectedAvatarPresent: hasAvatar(input.selectedAvatar),
    explicitAliasPresent: Boolean(input.explicitAliasPresent),
    path: safePath(input.path),
  };
  const dedupeKey = `${payload.entity}|${payload.selectedSource}|${payload.selectedAvatarPresent}`;
  if (emitted.has(dedupeKey)) return false;
  if (emitted.size >= MAX_DEDUPED_EVENTS) emitted.clear();
  emitted.add(dedupeKey);
  console.info('[AVATAR_DEBUG]', JSON.stringify(payload));
  return true;
}

function safeHostname(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return new URL(value).hostname || undefined;
  } catch {
    return undefined;
  }
}

export function traceAvatarImageError(input: {
  entityId?: unknown;
  avatar?: unknown;
  sourceCategory?: AvatarDebugSource;
}, options: DebugOptions = {}) {
  const debugEnabled = options.enabled ?? enabledByEnv();
  if (!debugEnabled) return false;
  const imagePresent = hasAvatar(input.avatar);
  const hostname = safeHostname(input.avatar);
  const token = entityToken(input.entityId);
  const payload = {
    event: 'image_error',
    entity: token,
    sourceCategory: input.sourceCategory || 'none',
    imagePresent,
    loadResult: 'error',
    ...(hostname ? { hostname } : {}),
  };
  const dedupeKey = `${token}|${payload.sourceCategory}|image_error`;
  if (emitted.has(dedupeKey)) return false;
  if (emitted.size >= MAX_DEDUPED_EVENTS) emitted.clear();
  emitted.add(dedupeKey);
  console.info('[AVATAR_DEBUG]', JSON.stringify(payload));
  return true;
}

export function resetAvatarDebugDedupe() {
  emitted.clear();
  entityTokens.clear();
}
