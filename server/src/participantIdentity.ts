/**
 * Identity helpers for WhatsApp group participants. A participant JID is the
 * stable key; a LID is opaque and is never converted to a phone implicitly.
 */
export type ParticipantIdentity = {
  participantJid: string;
  /** Stable identity key shared by explicit JID/phone aliases. */
  canonicalId?: string;
  /** Explicit provider/database aliases; never inferred from an opaque LID. */
  aliases?: string[];
  participantPhone?: string;
  displayName?: string;
  pictureUrl?: string;
  /** Internal provenance flag used to let a Google match outrank provider text. */
  googleContact?: boolean;
};

const firstText = (...values: unknown[]) => values.find(
  (value): value is string => typeof value === 'string' && value.trim().length > 0,
)?.trim();

export function normalizeParticipantJid(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isUsableParticipantName(value: unknown) {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  return Boolean(name)
    && name !== 'Você'
    && name !== 'WhatsApp Business'
    && name !== 'Contato'
    && name !== 'Participante'
    && !/^Participante …\S+$/.test(name)
    && !/^\+?[\d\s().-]+$/.test(name);
}

export function participantNameFromRecord(record: any) {
  const candidates = [
    record?.participantName,
    record?.senderName,
    record?.pushName,
    record?.contactName,
    record?.name,
    record?.metadata?.participantName,
    record?.notify,
    record?.verifiedName,
    record?.businessName,
  ];
  return candidates
    .map((candidate) => firstText(candidate))
    .find((candidate) => isUsableParticipantName(candidate));
}

export function participantJidFromRecord(record: any) {
  return normalizeParticipantJid(
    record?.key?.participant
      || record?.participantJid
      || record?.participant
      || record?.participantPn
      || record?.senderPn
      || record?.metadata?.participantJid
      || record?.key?.participantPn
      || record?.key?.senderPn,
  );
}

const explicitParticipantJidValues = (record: any) => [
  record?.key?.participant,
  record?.participantJid,
  record?.participant,
  record?.participantPn,
  record?.senderPn,
  record?.metadata?.participantJid,
  record?.key?.participantPn,
  record?.key?.senderPn,
].filter((value): value is string => typeof value === 'string');

const normalizedPhone = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const raw = value.trim().toLowerCase();
  if (!raw || raw.endsWith('@lid') || raw.endsWith('@g.us')) return '';
  const digits = (raw.split('@')[0] || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 20 ? digits : '';
};

/**
 * Returns only aliases explicitly supplied by Evolution or persistence. A
 * phone alias is accepted from a PN/alternate-phone field, never from the
 * numeric portion of an opaque @lid JID.
 */
export function participantAliasKeysFromRecord(record: any) {
  const aliases = new Set<string>();
  const persistedAliases = [
    ...(Array.isArray(record?.participantAliases) ? record.participantAliases : []),
    ...(Array.isArray(record?.metadata?.participantAliases) ? record.metadata.participantAliases : []),
  ];
  persistedAliases
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .forEach((value) => aliases.add(value.trim().toLowerCase()));
  for (const value of explicitParticipantJidValues(record)) {
    const jid = normalizeParticipantJid(value);
    if (jid) aliases.add(`jid:${jid}`);
  }
  const phoneValues = [
    record?.participantPhone,
    record?.metadata?.participantPhone,
    record?.phoneNumber,
    record?.phone,
    record?.number,
    record?.pn,
    record?.remoteJidAlt,
    record?.key?.phoneNumber,
    record?.key?.phone,
    record?.key?.remoteJidAlt,
    record?.key?.participantPn,
    record?.key?.senderPn,
    record?.participantPn,
    record?.senderPn,
  ];
  for (const value of phoneValues) {
    const phone = normalizedPhone(value);
    if (phone) {
      aliases.add(`phone:${phone}`);
      aliases.add(`jid:${phone}@s.whatsapp.net`);
      aliases.add(`jid:${phone}@c.us`);
    }
  }
  return [...aliases];
}

export function participantCanonicalIdFromRecord(record: any) {
  const explicit = firstText(record?.participantCanonicalId, record?.metadata?.participantCanonicalId);
  if (explicit) return explicit;
  const phone = participantPhoneFromRecord(record);
  if (phone) return `phone:${phone}`;
  const jid = participantJidFromRecord(record);
  return jid ? `jid:${jid}` : undefined;
}

/** Only values explicitly supplied as alternate/sender PN are phone identities. */
export function participantPhoneFromRecord(record: any) {
  const values = [
    record?.senderPn,
    record?.participantPn,
    record?.phoneNumber,
    record?.phone,
    record?.number,
    record?.pn,
    record?.metadata?.participantPhone,
    record?.remoteJidAlt,
    record?.key?.senderPn,
    record?.key?.participantPn,
    record?.key?.phoneNumber,
    record?.key?.phone,
    record?.key?.remoteJidAlt,
  ];
  for (const value of values) {
    if (typeof value !== 'string' || value.trim().toLowerCase().endsWith('@lid') || value.trim().toLowerCase().endsWith('@g.us')) continue;
    const digits = (value.trim().split('@')[0] || '').replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 20) return digits;
  }
  return undefined;
}

/**
 * Produces a useful, non-ambiguous label when WhatsApp did not provide a
 * display name. LIDs remain opaque; they are never converted into phones.
 */
export function participantFallbackNameFromRecord(record: any) {
  const phone = participantPhoneFromRecord(record);
  if (phone) return `+${phone}`;
  const jid = participantJidFromRecord(record);
  if (jid) {
    const value = jid.split('@')[0] || jid;
    if (value.length > 8) return `Participante …${value.slice(-4)}`;
    return `Participante ${value}`;
  }
  return 'Participante';
}

export function participantDisplayNameFromSources(input: {
  googleName?: unknown;
  providerName?: unknown;
  participantPhone?: unknown;
  participantJid?: unknown;
}) {
  const googleName = isUsableParticipantName(input.googleName) ? String(input.googleName).trim() : '';
  if (googleName) return googleName;
  const providerName = isUsableParticipantName(input.providerName) ? String(input.providerName).trim() : '';
  if (providerName) return providerName;
  const participantPhone = input.participantPhone;
  const phone = typeof participantPhone === 'string'
    ? (participantPhone.trim().split('@')[0] || '').replace(/\D/g, '')
    : '';
  if (phone.length >= 8 && phone.length <= 20) return `+${phone}`;
  return participantFallbackNameFromRecord({
    key: { participant: typeof input.participantJid === 'string' ? input.participantJid : undefined },
  });
}

export function mergeParticipantIdentity(record: any, identity: ParticipantIdentity) {
  const metadata = { ...(record?.metadata || {}) };
  metadata.participantJid = identity.participantJid;
  if (identity.canonicalId) metadata.participantCanonicalId = identity.canonicalId;
  if (identity.aliases?.length) metadata.participantAliases = identity.aliases;
  if (identity.participantPhone) metadata.participantPhone = identity.participantPhone;
  if (identity.displayName) metadata.participantName = identity.displayName;
  if (identity.pictureUrl) metadata.participantAvatar = identity.pictureUrl;
  return {
    ...record,
    metadata,
    ...(identity.canonicalId ? { participantCanonicalId: identity.canonicalId } : {}),
    ...(identity.aliases?.length ? { participantAliases: identity.aliases } : {}),
    ...(identity.displayName ? { participantName: identity.displayName } : {}),
    ...(identity.participantPhone ? { participantPhone: identity.participantPhone } : {}),
    ...(identity.pictureUrl ? { participantAvatar: identity.pictureUrl } : {}),
  };
}

export function buildParticipantIdentityMap(records: any[]) {
  const identities = new Map<string, ParticipantIdentity>();
  for (const record of records) {
    const participantJid = participantJidFromRecord(record);
    if (!participantJid) continue;
    const aliases = participantAliasKeysFromRecord(record);
    const canonicalId = participantCanonicalIdFromRecord(record);
    const current = identities.get(participantJid)
      || [...identities.values()].find((identity) => (
        (canonicalId && identity.canonicalId === canonicalId)
        || aliases.some((alias) => identity.aliases?.includes(alias))
      ))
      || { participantJid };
    const displayName = participantNameFromRecord(record);
    const participantPhone = participantPhoneFromRecord(record);
    const pictureUrl = typeof (record?.participantAvatar || record?.metadata?.participantAvatar) === 'string'
      ? (record.participantAvatar || record.metadata.participantAvatar).trim()
      : '';
    const identity: ParticipantIdentity = {
      ...current,
      participantJid,
      ...(canonicalId ? { canonicalId } : {}),
      ...(aliases.length ? { aliases: [...new Set([...(current.aliases || []), ...aliases])] } : {}),
      ...(current.displayName || !displayName ? {} : { displayName }),
      ...(current.participantPhone || !participantPhone ? {} : { participantPhone }),
      ...(current.pictureUrl || !pictureUrl ? {} : { pictureUrl }),
    };
    for (const [key, value] of identities) {
      if (value === current) identities.set(key, identity);
    }
    // Keep the public map keyed by the provider JID for backwards
    // compatibility. Alias matching is performed by the enrichment helper.
    identities.set(participantJid, identity);
  }
  return identities;
}

export function enrichRecordsWithParticipantIdentities(records: any[], identities: Map<string, ParticipantIdentity>) {
  return records.map((record) => {
    const participantJid = participantJidFromRecord(record);
    const aliases = participantAliasKeysFromRecord(record);
    const canonicalId = participantCanonicalIdFromRecord(record);
    const identity = (participantJid ? identities.get(participantJid) : undefined)
      || [...identities.values()].find((candidate) => (
        (canonicalId && candidate.canonicalId === canonicalId)
        || aliases.some((alias) => candidate.aliases?.includes(alias))
      ));
    return identity ? mergeParticipantIdentity(record, identity) : record;
  });
}
