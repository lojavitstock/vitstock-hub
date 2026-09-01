export function buildExistingConversationQuery(input: {
  companyId: string;
  remoteJid: string;
  identityCandidates?: string[];
}) {
  const identityCandidates = [...new Set((input.identityCandidates || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
  return {
    text: `SELECT id
     FROM conversations
       WHERE company_id = $1::uuid
       AND (
         evolution_remote_jid = $2::text
         OR (cardinality($3::text[]) > 0 AND evolution_remote_jid = ANY($3::text[]))
         OR (
           cardinality($3::text[]) > 0
           AND EXISTS (
             SELECT 1
             FROM contact_channel_identities ci
             WHERE ci.company_id = conversations.company_id
               AND ci.contact_id = conversations.contact_id
               AND ci.channel = 'whatsapp'
               AND (ci.identity = ANY($3::text[]) OR ci.aliases && $3::text[])
           )
         )
       )
     ORDER BY CASE
       -- A direct PN supplied alongside a LID is the canonical individual
       -- conversation. This prevents a replay-created LID row from winning
       -- merely because it was updated more recently.
       WHEN cardinality($3::text[]) > 0
         AND (evolution_remote_jid LIKE '%@s.whatsapp.net' OR evolution_remote_jid LIKE '%@c.us')
         AND evolution_remote_jid = ANY($3::text[]) THEN 0
       WHEN cardinality($3::text[]) > 0
         AND EXISTS (
           SELECT 1
           FROM contact_channel_identities ci
           WHERE ci.company_id = conversations.company_id
             AND ci.contact_id = conversations.contact_id
             AND ci.channel = 'whatsapp'
             AND (ci.identity = ANY($3::text[]) OR ci.aliases && $3::text[])
         ) THEN 1
       WHEN evolution_remote_jid = $2::text THEN 2
       WHEN cardinality($3::text[]) > 0 AND evolution_remote_jid = ANY($3::text[]) THEN 3
       ELSE 4
     END,
     created_at ASC, updated_at ASC, id
     LIMIT 1
     FOR UPDATE`,
    values: [input.companyId, input.remoteJid, identityCandidates] as const,
  };
}
