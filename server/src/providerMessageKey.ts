/**
 * The provider key is the durable identity Evolution/Baileys uses to resolve
 * a quoted message. Keep it separate from the canonical conversation identity:
 * a message can be stored on a PN conversation while its original provider
 * key still uses a LID (or carries explicit aliases).
 */
export type ProviderMessageKey = {
  id: string;
  remoteJid?: string;
  remoteJidAlt?: string;
  fromMe?: boolean;
  participant?: string;
  participantAlt?: string;
  addressingMode?: string;
  senderPn?: string;
  participantPn?: string;
};

const stringFields = [
  'remoteJid',
  'remoteJidAlt',
  'participant',
  'participantAlt',
  'addressingMode',
  'senderPn',
  'participantPn',
] as const;

const optionalString = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const readKeyFields = (key: any, fallback: any = {}): Omit<ProviderMessageKey, 'id'> => {
  const result: Omit<ProviderMessageKey, 'id'> = {};
  for (const field of stringFields) {
    const value = optionalString(key?.[field] ?? fallback?.[field]);
    if (value) (result as Record<string, string>)[field] = value;
  }
  const fromMe = key?.fromMe ?? fallback?.fromMe;
  if (typeof fromMe === 'boolean') result.fromMe = fromMe;
  return result;
};

/** Build a sanitized, explicit key from an Evolution record before storage. */
export const providerMessageKeyFromRecord = (record: any, fallbackId = ''): ProviderMessageKey | undefined => {
  const id = optionalString(record?.key?.id ?? record?.id ?? fallbackId);
  if (!id) return undefined;
  return { id, ...readKeyFields(record?.key, record) };
};

/** Restore the original provider key from a persisted message row. */
export const providerMessageKeyFromStoredMessage = (row: any, fallbackId = ''): ProviderMessageKey => {
  const stored = row?.metadata?.providerKey;
  const id = optionalString(stored?.id ?? fallbackId) || fallbackId;
  const key = readKeyFields(stored, {
    remoteJid: row?.evolution_remote_jid,
    fromMe: row?.sender === 'attendant',
    participant: row?.metadata?.participantJid,
  });
  return { id, ...key };
};
