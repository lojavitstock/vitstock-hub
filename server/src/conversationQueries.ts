export function buildExistingConversationQuery(input: { companyId: string; remoteJid: string }) {
  return {
    text: `SELECT id
     FROM conversations
       WHERE company_id = $1::uuid
       AND evolution_remote_jid = $2::text
     ORDER BY updated_at DESC
     LIMIT 1
     FOR UPDATE`,
    values: [input.companyId, input.remoteJid] as const,
  };
}
