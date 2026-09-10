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

export type AvatarTargetTraceInput = {
  entityId?: unknown;
  remoteJid?: unknown;
  isGroup?: boolean;
  remoteJidAltPresent?: boolean;
  senderPnPresent?: boolean;
  participantPnPresent?: boolean;
  providerPhonePresent?: boolean;
  snapshotProfilePicPresent?: boolean;
  snapshotProfilePicturePresent?: boolean;
  whatsappIdentityPresent?: boolean;
  whatsappIdentityAvatarPresent?: boolean;
  whatsappStoredNamePresent?: boolean;
  whatsappStoredAvatarPresent?: boolean;
  contactRecordPresent?: boolean;
  contactAvatarPresent?: boolean;
  googleLinkPresent?: boolean;
  selectedSource: AvatarDebugSource;
  selectedAvatar?: unknown;
};

export type AvatarProfileFetchResult = 'success' | 'empty' | 'provider_4xx' | 'provider_5xx' | 'timeout' | 'error';

const emittedSelections = new Set<string>();
const MAX_DEDUPED_SELECTIONS = 1_000;

const hasAvatar = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

const shortHash = (value: unknown) => createHash('sha256')
  .update(String(value ?? 'unknown'))
  .digest('hex')
  .slice(0, 12);

function jidType(input: Pick<AvatarSelectionInput, 'remoteJid' | 'participantJid' | 'isGroup'>) {
  if (input.isGroup) return 'GROUP' as const;
  const value = String(input.remoteJid || input.participantJid || '').trim().toLowerCase();
  if (value.endsWith('@g.us')) return 'GROUP' as const;
  if (value.endsWith('@lid')) return 'LID' as const;
  if (value.endsWith('@s.whatsapp.net') || value.endsWith('@c.us') || /^\d{8,20}$/.test(value)) return 'PN' as const;
  return 'UNKNOWN' as const;
}

function sanitizedEntity(input: Pick<AvatarSelectionInput, 'entityId' | 'remoteJid' | 'participantJid'>) {
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

/**
 * Opt-in trace for only the final individual conversations projected into the
 * inbox. Values are deliberately reduced to booleans and a short hash.
 */
export function traceAvatarTargetSelection(input: AvatarTargetTraceInput, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? process.env.AVATAR_DEBUG === 'true';
  if (!enabled || input.isGroup) return false;

  const payload = {
    entity: sanitizedEntity({ entityId: input.entityId, remoteJid: input.remoteJid }),
    jidType: jidType({ remoteJid: input.remoteJid, isGroup: input.isGroup }),
    remoteJidAltPresent: Boolean(input.remoteJidAltPresent),
    senderPnPresent: Boolean(input.senderPnPresent),
    participantPnPresent: Boolean(input.participantPnPresent),
    providerPhonePresent: Boolean(input.providerPhonePresent),
    snapshotProfilePicPresent: Boolean(input.snapshotProfilePicPresent),
    snapshotProfilePicturePresent: Boolean(input.snapshotProfilePicturePresent),
    whatsappIdentityPresent: Boolean(input.whatsappIdentityPresent),
    whatsappIdentityAvatarPresent: Boolean(input.whatsappIdentityAvatarPresent),
    whatsappStoredNamePresent: Boolean(input.whatsappStoredNamePresent),
    whatsappStoredAvatarPresent: Boolean(input.whatsappStoredAvatarPresent),
    contactRecordPresent: Boolean(input.contactRecordPresent),
    contactAvatarPresent: Boolean(input.contactAvatarPresent),
    googleLinkPresent: Boolean(input.googleLinkPresent),
    selectedSource: input.selectedSource,
    selectedAvatarPresent: hasAvatar(input.selectedAvatar),
  };
  const dedupeKey = `${payload.entity}|${JSON.stringify(payload)}`;
  if (emittedSelections.has(dedupeKey)) return false;
  if (emittedSelections.size >= MAX_DEDUPED_SELECTIONS) emittedSelections.clear();
  emittedSelections.add(dedupeKey);
  console.info('[AVATAR_TARGET_TRACE]', JSON.stringify(payload));
  return true;
}

/**
 * Opt-in trace for actual profile-picture provider calls. The result is a
 * closed set so provider responses and transport failures remain sanitized.
 */
export function traceAvatarProfileFetch(input: {
  entityId?: unknown;
  remoteJid?: unknown;
  participantJid?: unknown;
  isGroup?: boolean;
  identityBasis: 'PN' | 'explicitAlias' | 'GROUP' | 'OTHER';
  result: AvatarProfileFetchResult;
  avatarReturned: boolean;
}, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? process.env.AVATAR_DEBUG === 'true';
  if (!enabled) return false;
  const payload = {
    entity: sanitizedEntity(input),
    jidType: jidType({ remoteJid: input.remoteJid, participantJid: input.participantJid, isGroup: input.isGroup }),
    requestAttempted: true,
    identityBasis: input.identityBasis,
    result: input.result,
    avatarReturned: Boolean(input.avatarReturned),
  };
  const dedupeKey = `${payload.entity}|${payload.identityBasis}|${payload.result}|${payload.avatarReturned}`;
  if (emittedSelections.has(dedupeKey)) return false;
  if (emittedSelections.size >= MAX_DEDUPED_SELECTIONS) emittedSelections.clear();
  emittedSelections.add(dedupeKey);
  console.info('[AVATAR_PROFILE_FETCH]', JSON.stringify(payload));
  return true;
}

export function resetAvatarDebugDedupe() {
  emittedSelections.clear();
}
