import { config, isQaMode } from './config.js';
import { db } from './db.js';
import { phoneLookupKeys } from './contactPhones.js';
import { providerPhoneDigits, providerPhoneJid } from './whatsappIdentity.js';
import { qaEvolutionResponse } from './qa.js';
import { traceAvatarProfileFetch } from './avatarDiagnostics.js';

export type AvatarResolutionSource = 'whatsapp' | 'google' | 'none';
export type AvatarResolutionReason =
  | 'stored_whatsapp'
  | 'fetched_whatsapp'
  | 'google_fallback'
  | 'no_safe_identity'
  | 'provider_empty'
  | 'provider_error';

export type AvatarResolution = {
  avatar: string | null;
  source: AvatarResolutionSource;
  reason: AvatarResolutionReason;
};

type ConversationIdentity = {
  conversationId: string;
  remoteJid: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  contactAvatar: string | null;
  googleLinked: boolean;
  identities: string[];
};

type CacheEntry = {
  result: AvatarResolution;
  expiresAt: number;
};

const SUCCESS_TTL_MS = 24 * 60 * 60_000;
const EMPTY_TTL_MS = 6 * 60 * 60_000;
const ERROR_TTL_MS = 15 * 60_000;
const UNAVAILABLE_TTL_MS = 60 * 60_000;
const MAX_CONCURRENT_PROVIDER_REQUESTS = 4;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<AvatarResolution>>();
let activeProviderRequests = 0;
const providerQueue: Array<() => void> = [];

const usableAvatar = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  ? value.trim()
  : null;

const normalizedJid = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';

const providerPictureFromBody = (body: any) => usableAvatar(
  body?.profilePictureUrl
  || body?.profilePicUrl
  || body?.pictureUrl
  || body?.data?.profilePictureUrl
  || body?.data?.profilePicUrl
  || body?.data?.pictureUrl,
);

const providerErrorResult = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return name === 'AbortError' || name === 'TimeoutError' || /timeout|timed out|aborted/i.test(message)
    ? 'timeout' as const
    : 'error' as const;
};

const cacheTtlFor = (kind: 'success' | 'empty' | 'error' | 'unavailable') => {
  if (kind === 'success') return SUCCESS_TTL_MS;
  if (kind === 'empty') return EMPTY_TTL_MS;
  if (kind === 'unavailable') return UNAVAILABLE_TTL_MS;
  return ERROR_TTL_MS;
};

const acquireProviderSlot = async () => {
  if (activeProviderRequests < MAX_CONCURRENT_PROVIDER_REQUESTS) {
    activeProviderRequests += 1;
    return;
  }
  await new Promise<void>((resolve) => providerQueue.push(resolve));
  activeProviderRequests += 1;
};

const releaseProviderSlot = () => {
  activeProviderRequests = Math.max(0, activeProviderRequests - 1);
  providerQueue.shift()?.();
};

const providerRequest = (path: string, init?: RequestInit) => {
  if (isQaMode) return qaEvolutionResponse(path, init);
  return fetch(`${config.EVOLUTION_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.EVOLUTION_API_KEY,
      ...init?.headers,
    },
    signal: init?.signal || AbortSignal.timeout(10_000),
  });
};

async function loadConversationIdentity(companyId: string, conversationId: string): Promise<ConversationIdentity | null> {
  const conversation = await db.query<{
    conversation_id: string;
    remote_jid: string;
    contact_id: string;
    contact_name: string;
    contact_phone: string | null;
    contact_avatar: string | null;
    source: string | null;
    google_resource_name: string | null;
  }>(
    `SELECT c.id AS conversation_id,
            c.evolution_remote_jid AS remote_jid,
            ct.id AS contact_id,
            ct.name AS contact_name,
            ct.phone AS contact_phone,
            ct.avatar_url AS contact_avatar,
            ct.source,
            ct.google_resource_name
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.company_id = $1
       AND (c.evolution_remote_jid = $2 OR c.id::text = $2)
     ORDER BY c.updated_at DESC
     LIMIT 1`,
    [companyId, conversationId],
  );
  const row = conversation.rows[0];
  if (!row) return null;

  const identities = await db.query<{ identity: string; aliases: string[] | null }>(
    `SELECT identity, aliases
     FROM contact_channel_identities
     WHERE company_id = $1 AND contact_id = $2 AND channel = 'whatsapp'`,
    [companyId, row.contact_id],
  ).catch(() => ({ rows: [] as Array<{ identity: string; aliases: string[] | null }> }));

  return {
    conversationId: row.conversation_id,
    remoteJid: row.remote_jid,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactAvatar: row.contact_avatar,
    googleLinked: row.source === 'google' || Boolean(row.google_resource_name),
    identities: identities.rows.flatMap((item) => [item.identity, ...(item.aliases || [])].filter(Boolean)),
  };
}

export function explicitAvatarProviderPhone(input: { remoteJid?: unknown; identities?: readonly unknown[] }) {
  const remote = normalizedJid(input.remoteJid);
  if (remote && !remote.endsWith('@lid') && !remote.endsWith('@g.us')) {
    const digits = providerPhoneDigits({ remoteJid: remote });
    if (digits) return digits;
  }
  for (const candidate of input.identities || []) {
    const normalized = normalizedJid(candidate);
    if (!normalized || normalized.endsWith('@lid') || normalized.endsWith('@g.us')) continue;
    const digits = providerPhoneDigits({ remoteJid: normalized });
    if (digits) return digits;
  }
  return '';
}

const explicitProviderPhone = (identity: ConversationIdentity) => explicitAvatarProviderPhone(identity);

async function storedWhatsappAvatar(companyId: string, phone: string) {
  const keys = phoneLookupKeys(phone);
  if (!keys.length) return null;
  const result = await db.query<{ avatar_url: string | null }>(
    `SELECT avatar_url
     FROM whatsapp_contact_names
     WHERE company_id = $1
       AND regexp_replace(phone, '\\D', '', 'g') = ANY($2::text[])
     ORDER BY updated_at DESC
     LIMIT 1`,
    [companyId, keys],
  ).catch(() => ({ rows: [] as Array<{ avatar_url: string | null }> }));
  return usableAvatar(result.rows[0]?.avatar_url);
}

async function persistWhatsappAvatar(companyId: string, identity: ConversationIdentity, phone: string, avatar: string) {
  await db.query(
    `INSERT INTO whatsapp_contact_names (company_id, phone, name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, phone) DO UPDATE SET
       name = COALESCE(NULLIF(EXCLUDED.name, ''), whatsapp_contact_names.name),
       avatar_url = COALESCE(EXCLUDED.avatar_url, whatsapp_contact_names.avatar_url),
       updated_at = now()`,
    [companyId, phone, identity.contactName || phone, avatar],
  );
}

function googleFallback(identity: ConversationIdentity): AvatarResolution {
  return identity.googleLinked && identity.contactAvatar
    ? { avatar: identity.contactAvatar, source: 'google', reason: 'google_fallback' }
    : { avatar: null, source: 'none', reason: 'no_safe_identity' };
}

async function resolveUncached(companyId: string, identity: ConversationIdentity, cacheKey: string): Promise<AvatarResolution> {
  const stored = await storedWhatsappAvatar(companyId, explicitProviderPhone(identity));
  if (stored) {
    const result = { avatar: stored, source: 'whatsapp' as const, reason: 'stored_whatsapp' as const };
    cache.set(cacheKey, { result, expiresAt: Date.now() + cacheTtlFor('success') });
    return result;
  }

  const phone = explicitProviderPhone(identity);
  if (!phone) {
    const result = googleFallback(identity);
    cache.set(cacheKey, { result, expiresAt: Date.now() + cacheTtlFor(result.avatar ? 'success' : 'empty') });
    return result;
  }

  const providerJid = providerPhoneJid({ remoteJid: phone });
  await acquireProviderSlot();
  try {
    try {
      const response = await providerRequest(
        `/chat/fetchProfilePictureUrl/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
        { method: 'POST', body: JSON.stringify({ number: providerJid }) },
      );
      if (!response.ok) {
        traceAvatarProfileFetch({
          entityId: identity.remoteJid,
          remoteJid: identity.remoteJid,
          identityBasis: 'PN',
          result: response.status >= 500 ? 'provider_5xx' : 'provider_4xx',
          avatarReturned: false,
        });
        const result = googleFallback(identity);
        cache.set(cacheKey, { result, expiresAt: Date.now() + cacheTtlFor(response.status >= 500 ? 'error' : 'unavailable') });
        return result;
      }
      const body = await response.json().catch(() => ({}));
      const avatar = providerPictureFromBody(body);
      traceAvatarProfileFetch({
        entityId: identity.remoteJid,
        remoteJid: identity.remoteJid,
        identityBasis: 'PN',
        result: avatar ? 'success' : 'empty',
        avatarReturned: Boolean(avatar),
      });
      if (avatar) {
        try { await persistWhatsappAvatar(companyId, identity, phone, avatar); } catch { /* persistence is best effort */ }
        const result = { avatar, source: 'whatsapp' as const, reason: 'fetched_whatsapp' as const };
        cache.set(cacheKey, { result, expiresAt: Date.now() + cacheTtlFor('success') });
        return result;
      }
      const result = googleFallback(identity);
      cache.set(cacheKey, { result, expiresAt: Date.now() + cacheTtlFor('empty') });
      return result.avatar ? { ...result, reason: 'provider_empty' } : result;
    } catch (error) {
      traceAvatarProfileFetch({
        entityId: identity.remoteJid,
        remoteJid: identity.remoteJid,
        identityBasis: 'PN',
        result: providerErrorResult(error),
        avatarReturned: false,
      });
      const result = googleFallback(identity);
      cache.set(cacheKey, { result, expiresAt: Date.now() + cacheTtlFor('error') });
      return result.avatar ? { ...result, reason: 'provider_error' } : result;
    }
  } finally {
    releaseProviderSlot();
  }
}

export async function resolveConversationAvatar(companyId: string, conversationId: string): Promise<AvatarResolution | null> {
  const identity = await loadConversationIdentity(companyId, conversationId);
  if (!identity) return null;
  const cacheIdentity = explicitProviderPhone(identity) || normalizedJid(identity.remoteJid) || identity.conversationId;
  const cacheKey = `${companyId}:${cacheIdentity}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;
  const request = resolveUncached(companyId, identity, cacheKey);
  inFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(cacheKey);
  }
}

export function resetAvatarResolutionCache() {
  cache.clear();
  inFlight.clear();
  providerQueue.splice(0);
  activeProviderRequests = 0;
}

export const avatarResolutionTtls = {
  success: SUCCESS_TTL_MS,
  empty: EMPTY_TTL_MS,
  error: ERROR_TTL_MS,
  unavailable: UNAVAILABLE_TTL_MS,
};
