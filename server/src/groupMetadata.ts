export type GroupMetadata = {
  groupJid: string;
  subject?: string;
  picture?: string;
  metadataUpdatedAt: number;
};

function normalizedGroupJid(value: string) {
  return value.trim().toLowerCase();
}

function firstText(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function groupName(value: any) {
  const candidate = firstText(
    value?.groupName,
    value?.subject,
    value?.groupMetadata?.subject,
    value?.chatName,
    value?.name,
    value?.notify,
  );
  if (!candidate || candidate === 'Você' || candidate === 'WhatsApp Business' || /^\+?[\d\s().-]+$/.test(candidate)) return undefined;
  return candidate;
}

export function normalizeGroupMetadata(value: any, metadataUpdatedAt = Date.now()): GroupMetadata | undefined {
  const groupJid = normalizedGroupJid(String(value?.groupJid || value?.remoteJid || value?.id || value?.jid || ''));
  if (!groupJid.toLowerCase().endsWith('@g.us')) return undefined;
  const subject = groupName(value);
  const picture = firstText(
    value?.profilePicUrl,
    value?.pictureUrl,
    value?.profilePictureUrl,
    value?.profilePicture,
    value?.picture,
    value?.imgUrl,
  );
  return { groupJid, ...(subject ? { subject } : {}), ...(picture ? { picture } : {}), metadataUpdatedAt };
}

export function parseGroupMetadata(body: any, metadataUpdatedAt = Date.now()) {
  const values = Array.isArray(body)
    ? body
    : Array.isArray(body?.groups)
      ? body.groups
      : Array.isArray(body?.data)
        ? body.data
        : [];
  const byJid = new Map<string, GroupMetadata>();
  values.forEach((value: any) => {
    const normalized = normalizeGroupMetadata(value, metadataUpdatedAt);
    if (normalized) byJid.set(normalized.groupJid, normalized);
  });
  return [...byJid.values()];
}
