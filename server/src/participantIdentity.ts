/**
 * Identity helpers for WhatsApp group participants. A participant JID is the
 * stable key; a LID is opaque and is never converted to a phone implicitly.
 */
export type ParticipantIdentity = {
  participantJid: string;
  participantPhone?: string;
  displayName?: string;
  pictureUrl?: string;
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
    && !/^\+?[\d\s().-]+$/.test(name);
}

export function participantNameFromRecord(record: any) {
  const candidates = [
    record?.participantName,
    record?.senderName,
    record?.pushName,
    record?.metadata?.participantName,
    record?.notify,
    record?.verifiedName,
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

/** Only values explicitly supplied as alternate/sender PN are phone identities. */
export function participantPhoneFromRecord(record: any) {
  const values = [
    record?.senderPn,
    record?.participantPn,
    record?.remoteJidAlt,
    record?.key?.senderPn,
    record?.key?.participantPn,
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

export function mergeParticipantIdentity(record: any, identity: ParticipantIdentity) {
  const metadata = { ...(record?.metadata || {}) };
  metadata.participantJid = identity.participantJid;
  if (identity.participantPhone) metadata.participantPhone = identity.participantPhone;
  if (identity.displayName) metadata.participantName = identity.displayName;
  if (identity.pictureUrl) metadata.participantAvatar = identity.pictureUrl;
  return {
    ...record,
    metadata,
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
    const current = identities.get(participantJid) || { participantJid };
    const displayName = participantNameFromRecord(record);
    const participantPhone = participantPhoneFromRecord(record);
    const pictureUrl = typeof (record?.participantAvatar || record?.metadata?.participantAvatar) === 'string'
      ? (record.participantAvatar || record.metadata.participantAvatar).trim()
      : '';
    identities.set(participantJid, {
      ...current,
      ...(current.displayName || !displayName ? {} : { displayName }),
      ...(current.participantPhone || !participantPhone ? {} : { participantPhone }),
      ...(current.pictureUrl || !pictureUrl ? {} : { pictureUrl }),
    });
  }
  return identities;
}

export function enrichRecordsWithParticipantIdentities(records: any[], identities: Map<string, ParticipantIdentity>) {
  return records.map((record) => {
    const participantJid = participantJidFromRecord(record);
    const identity = participantJid ? identities.get(participantJid) : undefined;
    return identity ? mergeParticipantIdentity(record, identity) : record;
  });
}
