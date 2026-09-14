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

export type ProviderMessageKeyJidKind = 'PN' | 'LID' | 'GROUP' | 'UNKNOWN';

export type ProviderMessageKeyDiagnostics = {
  idPresent: boolean;
  remoteJidPresent: boolean;
  remoteJidKind: ProviderMessageKeyJidKind;
  remoteJidAltPresent: boolean;
  participantPresent: boolean;
  participantAltPresent: boolean;
  addressingModePresent: boolean;
  senderPnPresent: boolean;
  participantPnPresent: boolean;
  fromMePresent: boolean;
};

export type ProviderMessageKeyValidation =
  | { valid: true; key: ProviderMessageKey; diagnostics: ProviderMessageKeyDiagnostics }
  | { valid: false; reason: 'not_object' | 'invalid_field' | 'missing_id' | 'missing_remote_jid'; diagnostics: ProviderMessageKeyDiagnostics };

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

const keyStringFields = [
  'remoteJid',
  'remoteJidAlt',
  'participant',
  'participantAlt',
  'addressingMode',
  'senderPn',
  'participantPn',
] as const;

const jidKind = (value: string): ProviderMessageKeyJidKind => {
  const normalized = value.toLowerCase();
  if (normalized.endsWith('@g.us')) return 'GROUP';
  if (normalized.endsWith('@lid')) return 'LID';
  if (normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@c.us')) return 'PN';
  return 'UNKNOWN';
};

export const providerMessageKeyDiagnostics = (input: unknown): ProviderMessageKeyDiagnostics => {
  const key = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const remoteJid = optionalString(key.remoteJid);
  return {
    idPresent: Boolean(optionalString(key.id)),
    remoteJidPresent: Boolean(remoteJid),
    remoteJidKind: remoteJid ? jidKind(remoteJid) : 'UNKNOWN',
    remoteJidAltPresent: Boolean(optionalString(key.remoteJidAlt)),
    participantPresent: Boolean(optionalString(key.participant)),
    participantAltPresent: Boolean(optionalString(key.participantAlt)),
    addressingModePresent: Boolean(optionalString(key.addressingMode)),
    senderPnPresent: Boolean(optionalString(key.senderPn)),
    participantPnPresent: Boolean(optionalString(key.participantPn)),
    fromMePresent: typeof key.fromMe === 'boolean',
  };
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

/**
 * Validate and reduce a client-supplied provider key before sending it back
 * to Evolution. A group participant is intentionally optional: the provider
 * can accept valid group keys without one, while LID/PN aliases are retained
 * whenever the original pipeline supplied them.
 */
export const validateProviderMessageKey = (input: unknown): ProviderMessageKeyValidation => {
  const diagnostics = providerMessageKeyDiagnostics(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, reason: 'not_object', diagnostics };
  }

  const source = input as Record<string, unknown>;
  if (source.id !== undefined && typeof source.id !== 'string') {
    return { valid: false, reason: 'invalid_field', diagnostics };
  }
  if (source.fromMe !== undefined && typeof source.fromMe !== 'boolean') {
    return { valid: false, reason: 'invalid_field', diagnostics };
  }
  if (keyStringFields.some((field) => source[field] !== undefined && typeof source[field] !== 'string')) {
    return { valid: false, reason: 'invalid_field', diagnostics };
  }

  const key = providerMessageKeyFromRecord({ key: source });
  if (!key?.id) return { valid: false, reason: 'missing_id', diagnostics };
  if (!key.remoteJid) return { valid: false, reason: 'missing_remote_jid', diagnostics };
  return { valid: true, key, diagnostics };
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
