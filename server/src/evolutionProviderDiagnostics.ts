export type EvolutionRecipientDiagnostics = {
  recipientType: 'LID' | 'PN' | 'GROUP';
  numberKind: 'digits' | 'lid' | 'group';
  remoteJidKind: 'pn' | 'lid' | 'group';
};

const isGroupJid = (value: string) => value.toLowerCase().endsWith('@g.us');
const isLidJid = (value: string) => value.toLowerCase().endsWith('@lid');

const jidKind = (value: string): 'pn' | 'lid' | 'group' => {
  if (isGroupJid(value)) return 'group';
  if (isLidJid(value)) return 'lid';
  return 'pn';
};

export function evolutionRecipientDiagnostics(input: {
  number: string;
  remoteJid?: string | null;
}): EvolutionRecipientDiagnostics {
  const number = String(input.number || '').trim();
  const remoteJid = String(input.remoteJid || '').trim();
  const numberKind = isGroupJid(number) ? 'group' : isLidJid(number) ? 'lid' : 'digits';
  const remoteJidKind = jidKind(remoteJid || number);
  const recipientType = remoteJidKind === 'group' || numberKind === 'group'
    ? 'GROUP'
    : remoteJidKind === 'lid' || numberKind === 'lid'
      ? 'LID'
      : 'PN';
  return { recipientType, numberKind, remoteJidKind };
}

const SAFE_PROVIDER_KEYS = new Set(['status', 'error', 'code', 'message', 'details', 'reason', 'type']);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const redactText = (value: string, sensitiveValues: string[] = []) => sensitiveValues
  .filter((item) => item.length > 0)
  .reduce((current, item) => current.replace(new RegExp(escapeRegExp(item), 'gi'), '[redacted-content]'), value)
  .replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=_-]+/gi, '[redacted-base64]')
  .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted-token]')
  .replace(/\b(?:authorization|apikey|api[-_ ]?key|token|secret|password)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, '[redacted-secret]')
  .replace(/\b\d{8,20}@(s\.whatsapp\.net|lid|g\.us)\b/gi, '[redacted-jid]')
  .replace(/\b\d{8,20}\b/g, '[redacted-number]')
  .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[redacted-token]')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 300);

const sanitizeValue = (value: unknown, depth = 0, sensitiveValues: string[] = []): unknown => {
  if (depth > 2) return '[redacted]';
  if (typeof value === 'string') return redactText(value, sensitiveValues);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => sanitizeValue(item, depth + 1, sensitiveValues));
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  Object.entries(source).forEach(([key, item]) => {
    if (!SAFE_PROVIDER_KEYS.has(key.toLowerCase())) return;
    const sanitized = sanitizeValue(item, depth + 1, sensitiveValues);
    if (sanitized !== undefined) output[key] = sanitized;
  });
  return output;
};

/**
 * Keeps only provider error fields useful for diagnosis. Arbitrary provider
 * fields are discarded because they may contain media, credentials or JIDs.
 */
export function sanitizeEvolutionProviderError(rawBody: string, sensitiveValues: string[] = []): unknown {
  const raw = rawBody.trim();
  if (!raw) return undefined;
  try {
    return sanitizeValue(JSON.parse(raw), 0, sensitiveValues);
  } catch {
    return redactText(raw, sensitiveValues);
  }
}
