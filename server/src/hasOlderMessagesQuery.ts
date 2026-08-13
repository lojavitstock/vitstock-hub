export type HasOlderMessagesQueryInput = {
  companyId: string;
  jids: string[];
  contactIds: string[];
  afterTimestamp?: number | null;
};

export type HasOlderMessagesQuery = {
  text: string;
  values: Array<string | string[] | number>;
};

export function buildHasOlderMessagesQuery(
  input: HasOlderMessagesQueryInput,
): HasOlderMessagesQuery | null {
  if (!input.afterTimestamp) return null;

  const hasContactIds = input.contactIds.length > 0;
  const conversationFilter = hasContactIds
    ? `(c.evolution_remote_jid = ANY($2::text[]) OR c.contact_id = ANY($3::uuid[]))`
    : `c.evolution_remote_jid = ANY($2::text[])`;
  const afterParam = hasContactIds ? 4 : 3;
  const values = hasContactIds
    ? [input.companyId, input.jids, input.contactIds, input.afterTimestamp]
    : [input.companyId, input.jids, input.afterTimestamp];

  return {
    text: `
      SELECT 1
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.company_id = $1::uuid
        AND ${conversationFilter}
        AND m.sent_at <= to_timestamp($${afterParam}::double precision / 1000)
        AND m.is_internal_note = false
        AND COALESCE(m.metadata->>'providerType', '') <> 'reactionMessage'
      LIMIT 1`,
    values,
  };
}
