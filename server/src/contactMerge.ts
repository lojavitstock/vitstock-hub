import type { PoolClient } from 'pg';
import { upsertContactPhone } from './contactPhones.js';

type MergeableContact = { merged_into_contact_id?: string | null };

export type ContactMergeInput = {
  companyId: string;
  sourceContactId: string;
  targetContactId: string;
  performedBy?: string | null;
  fieldSnapshot?: Record<string, unknown>;
};

export type ContactMergeResult = {
  mergeId: string;
  movedConversationIds: string[];
  source: Record<string, unknown>;
  target: Record<string, unknown>;
};

export function canMergeContacts(source: MergeableContact | undefined, target: MergeableContact | undefined): boolean {
  return Boolean(source && target && !source.merged_into_contact_id && !target.merged_into_contact_id);
}

/**
 * Executes the existing safe contact merge inside the caller's transaction.
 * The caller owns BEGIN/COMMIT/ROLLBACK so Google reconciliation can make
 * the data enrichment and consolidation atomic for one contact pair.
 */
export async function mergeContactsInTransaction(client: PoolClient, input: ContactMergeInput): Promise<ContactMergeResult | null> {
  const contacts = await client.query(
    'SELECT * FROM contacts WHERE company_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE',
    [input.companyId, [input.sourceContactId, input.targetContactId]],
  );
  const source = contacts.rows.find((row: { id: string }) => row.id === input.sourceContactId);
  const target = contacts.rows.find((row: { id: string }) => row.id === input.targetContactId);
  if (!canMergeContacts(source, target)) return null;

  const merge = await client.query<{ id: string }>(
    `INSERT INTO contact_merge_operations
      (company_id, source_contact_id, target_contact_id, performed_by, field_snapshot)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [input.companyId, source.id, target.id, input.performedBy || null, JSON.stringify(input.fieldSnapshot || { source, targetVersion: target.version })],
  );
  const mergeId = merge.rows[0]!.id;
  const moved = await client.query<{ id: string }>(
    'UPDATE conversations SET contact_id = $1, updated_at = now() WHERE company_id = $2 AND contact_id = $3 RETURNING id',
    [target.id, input.companyId, source.id],
  );
  for (const conversation of moved.rows) {
    await client.query(
      'INSERT INTO contact_merge_conversations (merge_id, conversation_id, original_contact_id) VALUES ($1, $2, $3)',
      [mergeId, conversation.id, source.id],
    );
  }
  const sourcePhones = await client.query<{ phone: string; label: string | null; source: string }>(
    'SELECT phone, label, source FROM contact_phones WHERE company_id = $1 AND contact_id = $2 ORDER BY is_primary DESC, id',
    [input.companyId, source.id],
  );
  for (const phone of sourcePhones.rows) {
    await upsertContactPhone(client, {
      companyId: input.companyId,
      contactId: target.id,
      phone: phone.phone,
      label: phone.label,
      isPrimary: false,
      source: phone.source,
    });
  }
  await client.query(
    `INSERT INTO contact_emails (company_id, contact_id, email, normalized_email, label, is_primary, source)
     SELECT company_id, $1, email, normalized_email, label, false, source
     FROM contact_emails WHERE contact_id = $2
     ON CONFLICT DO NOTHING`,
    [target.id, source.id],
  );
  await client.query(
    `INSERT INTO contact_tag_links (company_id, contact_id, tag_id)
     SELECT company_id, $1, tag_id FROM contact_tag_links WHERE contact_id = $2
     ON CONFLICT DO NOTHING`,
    [target.id, source.id],
  );
  await client.query(
    `INSERT INTO contact_channel_identities
      (company_id, contact_id, channel, identity, identity_type, aliases, metadata)
     SELECT company_id, $1, channel, identity, identity_type, aliases, metadata
     FROM contact_channel_identities WHERE contact_id = $2
     ON CONFLICT (company_id, channel, identity) DO NOTHING`,
    [target.id, source.id],
  );
  await client.query(
    'UPDATE contacts SET merged_into_contact_id = $1, archived_at = now(), version = version + 1, updated_at = now() WHERE id = $2 AND company_id = $3',
    [target.id, source.id, input.companyId],
  );
  await client.query('UPDATE contacts SET version = version + 1, updated_at = now() WHERE id = $1', [target.id]);
  return {
    mergeId,
    movedConversationIds: moved.rows.map((row) => row.id),
    source,
    target,
  };
}
