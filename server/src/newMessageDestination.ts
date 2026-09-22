export function normalizeManualNewMessagePhone(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{8,20}$/.test(digits)) return undefined;
  return {
    digits,
    remoteJid: `${digits}@s.whatsapp.net`,
    phone: `+${digits}`,
  };
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
