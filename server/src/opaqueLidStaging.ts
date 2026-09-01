/**
 * Helpers shared by the Evolution replay path and its tests.  An opaque LID
 * is never converted to a phone number; it can only inherit a PN when that
 * association is explicitly present in the same provider batch.
 */

export const OPAQUE_LID_STAGING_TTL_MS = 15 * 60_000;
export const OPAQUE_LID_STAGING_CLEANUP_INTERVAL_MS = 60_000;

type ProviderRecord = Record<string, any>;

function remoteJidOf(record: ProviderRecord) {
  return String(record?.key?.remoteJid || record?.remoteJid || '').trim();
}

function isLid(value: string) {
  return value.toLowerCase().endsWith('@lid');
}

function isProviderPhoneIdentity(value: string) {
  const lower = value.toLowerCase();
  return lower.endsWith('@s.whatsapp.net') || lower.endsWith('@c.us');
}

/**
 * Build a deterministic LID -> PN map from one provider batch.  Ambiguous
 * batches are deliberately left unresolved rather than choosing an identity
 * by position, timestamp or display data.
 */
export function buildReplayAliasMap(
  records: readonly ProviderRecord[],
  identityCandidatesOf: (record: ProviderRecord) => readonly string[],
) {
  const candidatesByLid = new Map<string, Set<string>>();
  for (const record of records) {
    const candidates = identityCandidatesOf(record).map((value) => String(value || '').trim()).filter(Boolean);
    const lids = candidates.filter(isLid);
    if (!lids.length) continue;
    const pns = new Set<string>();
    for (const candidate of identityCandidatesOf(record)) {
      const value = String(candidate || '').trim();
      if (value && isProviderPhoneIdentity(value)) pns.add(value);
    }
    if (!pns.size) continue;
    for (const lid of lids) {
      const existing = candidatesByLid.get(lid) || new Set<string>();
      for (const pn of pns) existing.add(pn);
      candidatesByLid.set(lid, existing);
    }
  }

  const resolved = new Map<string, string>();
  for (const [lid, pns] of candidatesByLid) {
    if (pns.size === 1) resolved.set(lid, [...pns][0]!);
  }
  return resolved;
}

/**
 * Add a discovered PN as an explicit remoteJidAlt before persistence.  This
 * is a shallow record copy, so the provider payload and message content are
 * not rewritten and no identity is inferred from ordering.
 */
export function preEnrichProviderReplayRecords(
  records: readonly ProviderRecord[],
  identityCandidatesOf: (record: ProviderRecord) => readonly string[],
) {
  const aliases = buildReplayAliasMap(records, identityCandidatesOf);
  if (!aliases.size) return [...records];
  return records.map((record) => {
    const remoteJid = remoteJidOf(record);
    const alias = aliases.get(remoteJid);
    if (!alias) return record;
    const hasExplicitPhone = identityCandidatesOf(record).some((candidate) => isProviderPhoneIdentity(String(candidate || '').trim()));
    if (hasExplicitPhone) return record;
    return {
      ...record,
      remoteJidAlt: record.remoteJidAlt || alias,
      key: {
        ...(record.key || {}),
        remoteJidAlt: record.key?.remoteJidAlt || alias,
      },
    };
  });
}

export function shouldStageOpaqueLidMessage(input: {
  remoteJid: string;
  isGroup: boolean;
  hasCanonicalConversation: boolean;
  phone?: string;
}) {
  return !input.isGroup
    && isLid(input.remoteJid)
    && !input.hasCanonicalConversation
    && !String(input.phone || '').trim();
}

const omittedStagingKeys = new Set([
  'base64',
  'jpegthumbnail',
  'thumbnail',
  'apikey',
  'authorization',
  'cookie',
  'secret',
  'token',
]);

function sanitizeValue(value: any): any {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (omittedStagingKeys.has(key.toLowerCase())) continue;
    result[key] = sanitizeValue(child);
  }
  return result;
}

/** Keep the provider key/message metadata while excluding binary/secrets. */
export function sanitizeProviderRecordForStaging(record: ProviderRecord) {
  return sanitizeValue(record) as ProviderRecord;
}

export type OpaqueLidStagingEnvelope = {
  record: ProviderRecord;
  options: {
    incrementUnread: boolean;
    reopen: boolean;
    fallbackPhone?: string;
  };
};

export function createOpaqueLidStagingEnvelope(
  record: ProviderRecord,
  options: OpaqueLidStagingEnvelope['options'],
): OpaqueLidStagingEnvelope {
  return {
    record: sanitizeProviderRecordForStaging(record),
    options: {
      incrementUnread: options.incrementUnread,
      reopen: options.reopen,
      ...(options.fallbackPhone ? { fallbackPhone: options.fallbackPhone } : {}),
    },
  };
}
