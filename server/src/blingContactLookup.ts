import { formatPhoneForDisplay, normalizePhoneIdentity } from './contactDomain.js';

export type BlingLookupPhone = { digits: string; formatted: string };

/**
 * Accepts only Brazilian numbers with a complete DDD and 10/11 national digits.
 * Known WhatsApp phone JIDs are unwrapped; other JIDs and arbitrary text fail closed.
 */
export function normalizeBlingLookupPhone(value: unknown): BlingLookupPhone | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 80) return null;

  const jid = raw.match(/^(.+)@(s\.whatsapp\.net|c\.us)$/i);
  const phone = jid ? jid[1]!.trim() : raw;
  if (!/^[+\d\s().-]+$/.test(phone)) return null;

  const identity = normalizePhoneIdentity(phone, { defaultCountry: 'BR' });
  if (!identity.valid || identity.country !== 'BR' || !identity.national
    || (identity.national.length !== 10 && identity.national.length !== 11)) return null;

  return {
    digits: `55${identity.national}`,
    formatted: formatPhoneForDisplay(identity.canonical, { defaultCountry: 'BR' }),
  };
}

export function blingPhoneMatches(value: unknown, target: BlingLookupPhone): boolean {
  const candidate = normalizeBlingLookupPhone(value);
  return Boolean(candidate && candidate.digits === target.digits);
}
