import { createHash } from 'node:crypto';

export type AvatarDebugSource = 'whatsapp' | 'google' | 'stored' | 'snapshot' | 'group' | 'none';
export type AvatarDebugCache = 'hit' | 'miss';

type AvatarSelectionInput = {
  entityId?: unknown;
  remoteJid?: unknown;
  participantJid?: unknown;
  isGroup?: boolean;
  whatsappAvatar?: unknown;
  googleAvatar?: unknown;
  storedAvatar?: unknown;
  snapshotAvatar?: unknown;
  selectedSource: AvatarDebugSource;
  selectedAvatar?: unknown;
  explicitAliasPresent?: boolean;
  cache?: AvatarDebugCache;
  path: string;
};

const emittedSelections = new Set<string>();
const MAX_DEDUPED_SELECTIONS = 1_000;

const hasAvatar = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

const shortHash = (value: unknown) => createHash('sha256')
  .update(String(value ?? 'unknown'))
  .digest('hex')
  .slice(0, 12);

function jidType(input: AvatarSelectionInput) {
  if (input.isGroup) return 'GROUP' as const;
  const value = String(input.remoteJid || input.participantJid || '').trim().toLowerCase();
  if (value.endsWith('@g.us')) return 'GROUP' as const;
  if (value.endsWith('@lid')) return 'LID' as const;
  if (value.endsWith('@s.whatsapp.net') || value.endsWith('@c.us') || /^\d{8,20}$/.test(value)) return 'PN' as const;
  return 'UNKNOWN' as const;
}

function sanitizedEntity(input: AvatarSelectionInput) {
  const value = input.entityId ?? input.remoteJid ?? input.participantJid;
  return `entity-${shortHash(value)}`;
}

function sanitizedPath(value: string) {
  return value.replace(/[^a-zA-Z0-9._:/-]/g, '_').slice(0, 100) || 'unknown';
}

/**
 * Opt-in, sanitized runtime trace for avatar source selection. The emitted
 * payload intentionally contains no URL, phone, JID, name or provider ID.
 */
export function traceAvatarSelection(input: AvatarSelectionInput, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? process.env.AVATAR_DEBUG === 'true';
  if (!enabled) return false;

  const payload = {
    entity: sanitizedEntity(input),
    jidType: jidType(input),
    whatsappAvatarPresent: hasAvatar(input.whatsappAvatar),
    googleAvatarPresent: hasAvatar(input.googleAvatar),
    storedAvatarPresent: hasAvatar(input.storedAvatar),
    snapshotAvatarPresent: hasAvatar(input.snapshotAvatar),
    selectedSource: input.selectedSource,
    selectedAvatarPresent: hasAvatar(input.selectedAvatar),
    explicitAliasPresent: Boolean(input.explicitAliasPresent),
    ...(input.cache ? { cacheHit: input.cache === 'hit', cacheMiss: input.cache === 'miss' } : {}),
    path: sanitizedPath(input.path),
  };
  const dedupeKey = `${payload.entity}|${payload.selectedSource}|${payload.selectedAvatarPresent}`;
  if (emittedSelections.has(dedupeKey)) return false;
  if (emittedSelections.size >= MAX_DEDUPED_SELECTIONS) emittedSelections.clear();
  emittedSelections.add(dedupeKey);
  console.info('[AVATAR_DEBUG]', JSON.stringify(payload));
  return true;
}

export function resetAvatarDebugDedupe() {
  emittedSelections.clear();
}
