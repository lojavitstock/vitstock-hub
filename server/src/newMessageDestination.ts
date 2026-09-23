import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export function normalizeManualNewMessagePhone(value: string) {
  const raw = String(value || '').trim();
  if (!raw || !/^(?:\+|00)?[\d\s().-]+$/.test(raw)) return undefined;

  const rawDigits = raw.replace(/\D/g, '');
  const digits = raw.startsWith('00') ? rawDigits.slice(2) : rawDigits;
  if (!digits || digits.length > 15) return undefined;

  let parsed;
  if (raw.startsWith('+') || raw.startsWith('00')) {
    parsed = parsePhoneNumberFromString(raw.startsWith('00') ? `+${raw.slice(2)}` : raw);
  } else if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    parsed = parsePhoneNumberFromString(`+${digits}`);
  } else if (digits.length === 10 || digits.length === 11) {
    // The existing contact write contract treats unprefixed 10/11 digit
    // numbers as Brazilian national input; no country is inferred otherwise.
    parsed = parsePhoneNumberFromString(digits, 'BR');
  }

  if (!parsed?.isValid()) return undefined;
  const canonicalDigits = parsed.number.replace(/\D/g, '');
  const phone = parsed.number;
  return {
    digits: canonicalDigits,
    remoteJid: `${canonicalDigits}@s.whatsapp.net`,
    phone,
  };
}

/**
 * A bare/contact number may be tried as an exact provider alias, but this
 * candidate is never used to create a new outbound identity.
 */
export function explicitPhoneAliasRemoteJid(value: string) {
  const raw = String(value || '').trim();
  if (!raw || !/^(?:\+|00)?[\d\s().-]+$/.test(raw)) return undefined;
  const digits = raw.replace(/\D/g, '');
  return /^\d{1,20}$/.test(digits) ? `${digits}@s.whatsapp.net` : undefined;
}

export function explicitPhoneAliasRemoteJids(value: string) {
  return Array.from(new Set([
    explicitPhoneAliasRemoteJid(value),
    normalizeManualNewMessagePhone(value)?.remoteJid,
  ].filter((remoteJid): remoteJid is string => Boolean(remoteJid))));
}

export type ExplicitConversationMatch = {
  id: string;
  contact_id: string;
  evolution_remote_jid: string;
};

export function buildExplicitConversationLookup(companyId: string, candidateRemoteJid: string) {
  return {
    text: `SELECT DISTINCT c.id, c.contact_id, c.evolution_remote_jid
     FROM conversations c
     WHERE c.company_id = $1::uuid
       AND c.is_group = false
       AND c.evolution_remote_jid NOT LIKE '%@g.us'
       AND (
         c.evolution_remote_jid = $2::text
         OR EXISTS (
           SELECT 1
           FROM contact_channel_identities explicit_identity
           WHERE explicit_identity.company_id = c.company_id
             AND explicit_identity.channel = 'whatsapp'
             AND (
               explicit_identity.identity = c.evolution_remote_jid
               OR explicit_identity.aliases @> ARRAY[c.evolution_remote_jid]::text[]
             )
             AND (
               explicit_identity.identity = $2::text
               OR explicit_identity.aliases @> ARRAY[$2::text]
             )
         )
       )
     ORDER BY c.id`,
    values: [companyId, candidateRemoteJid] as const,
  };
}

export function classifyExplicitConversationMatches<T extends { id: string }>(rows: T[]) {
  const unique = Array.from(new Map(rows.map((row) => [row.id, row])).values());
  if (unique.length === 0) return { kind: 'none' as const };
  if (unique.length > 1) return { kind: 'ambiguous' as const };
  return { kind: 'existing' as const, conversation: unique[0]! };
}
