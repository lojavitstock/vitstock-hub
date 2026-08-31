import type { PoolClient } from 'pg';
import { db } from './db.js';
import { canonicalPhone, normalizeContactPhone } from './contactDomain.js';
import { phoneLookupKeys, upsertContactPhone } from './contactPhones.js';
import { isWhatsAppGroup, isWhatsAppLid, providerPhoneJid } from './whatsappIdentity.js';

export type ConversationResolution = {
  id: string;
  contactId: string;
  remoteJid: string;
  created: boolean;
};

type ConversationResolutionInput = {
  companyId: string;
  remoteJid: string;
  phone?: string;
};

type ConversationResolutionOptions = {
  createIfMissing?: boolean;
};

export function conversationIdentityCandidates(input: ConversationResolutionInput) {
  const remoteJid = String(input.remoteJid || '').trim();
  const phone = String(input.phone || '').trim();
  const phoneJid = !isWhatsAppGroup(remoteJid) && phone && !isWhatsAppLid(phone)
    ? providerPhoneJid({ remoteJid: phone })
    : '';
  return Array.from(new Set([remoteJid, phoneJid].filter(Boolean)));
}

function phoneForStorage(value: string) {
  return canonicalPhone(value, { defaultCountry: 'BR' }) || `+${normalizeContactPhone(value)}`;
}

function phoneCandidate(input: ConversationResolutionInput, candidates: string[]) {
  if (isWhatsAppGroup(input.remoteJid)) return '';
  const explicitPhone = String(input.phone || '').trim();
  if (explicitPhone && !isWhatsAppLid(explicitPhone)) return explicitPhone;
  const providerJid = candidates.find((value) => value.toLowerCase().endsWith('@s.whatsapp.net'));
  return providerJid ? providerJid.split('@')[0] : '';
}

async function resolveWithClient(
  client: PoolClient,
  input: ConversationResolutionInput,
  options: ConversationResolutionOptions,
): Promise<ConversationResolution | undefined> {
  const remoteJid = String(input.remoteJid || '').trim();
  if (!remoteJid) return undefined;
  const candidates = conversationIdentityCandidates(input);
  const phone = phoneCandidate(input, candidates);
  const phoneKeys = phone ? phoneLookupKeys(phone) : [];

  // Serialize materialization of the same explicit provider identity. This
  // keeps two operators from creating duplicate rows for a provider-only chat.
  const lockKey = `conversation-materialize:${input.companyId}:${[...candidates].sort().join('|')}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [lockKey]);

  const existing = await client.query<{ id: string; contact_id: string; evolution_remote_jid: string }>(
    `SELECT c.id, c.contact_id, c.evolution_remote_jid
     FROM conversations c
     WHERE c.company_id = $1::uuid
       AND (
         c.evolution_remote_jid = ANY($2::text[])
         OR EXISTS (
           SELECT 1
           FROM contact_channel_identities ci
           WHERE ci.company_id = c.company_id
             AND ci.contact_id = c.contact_id
             AND ci.channel = 'whatsapp'
             AND (ci.identity = ANY($2::text[]) OR ci.aliases && $2::text[])
         )
       )
     ORDER BY CASE WHEN c.evolution_remote_jid = $3::text THEN 0 ELSE 1 END,
              c.updated_at DESC, c.id
     LIMIT 1`,
    [input.companyId, candidates, remoteJid],
  );
  if (existing.rows[0]) {
    return {
      id: existing.rows[0].id,
      contactId: existing.rows[0].contact_id,
      remoteJid: existing.rows[0].evolution_remote_jid,
      created: false,
    };
  }
  if (options.createIfMissing === false) return undefined;

  const contactResult = await client.query<{ id: string; phone: string }>(
    `SELECT c.id, c.phone
     FROM contacts c
     WHERE c.company_id = $1::uuid
       AND (
         EXISTS (
           SELECT 1
           FROM contact_channel_identities ci
           WHERE ci.company_id = c.company_id
             AND ci.contact_id = c.id
             AND ci.channel = 'whatsapp'
             AND (ci.identity = ANY($2::text[]) OR ci.aliases && $2::text[])
         )
         OR (
           cardinality($3::text[]) > 0
           AND (
             regexp_replace(c.phone, '\\D', '', 'g') = ANY($3::text[])
             OR EXISTS (
               SELECT 1
               FROM contact_phones p
               WHERE p.company_id = c.company_id
                 AND p.contact_id = c.id
                 AND regexp_replace(p.normalized_phone, '\\D', '', 'g') = ANY($3::text[])
             )
           )
         )
       )
     ORDER BY c.updated_at DESC, c.id
     LIMIT 1
     FOR UPDATE`,
    [input.companyId, candidates, phoneKeys],
  );

  let contactId = contactResult.rows[0]?.id;
  const isGroup = isWhatsAppGroup(remoteJid);
  if (!contactId) {
    if (!isGroup && !phone) return undefined;
    const contactPhone = isGroup ? remoteJid : phoneForStorage(phone || '');
    const contactName = isGroup ? `Grupo ${remoteJid.split('@')[0]}` : contactPhone;
    const createdContact = await client.query<{ id: string }>(
      `INSERT INTO contacts (company_id, name, phone)
       VALUES ($1::uuid, $2::text, $3::text)
       ON CONFLICT (company_id, phone) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [input.companyId, contactName, contactPhone],
    );
    contactId = createdContact.rows[0]?.id;
  }
  if (!contactId) return undefined;

  if (!isGroup && phone) {
    await upsertContactPhone(client, {
      companyId: input.companyId,
      contactId,
      phone: phoneForStorage(phone),
      isPrimary: true,
      source: 'whatsapp',
    });
  }

  for (const identity of candidates) {
    await client.query(
      `INSERT INTO contact_channel_identities (company_id, contact_id, channel, identity, identity_type)
       VALUES ($1::uuid, $2::uuid, 'whatsapp', $3::text, $4::text)
       ON CONFLICT (company_id, channel, identity) DO NOTHING`,
      [input.companyId, contactId, identity, isWhatsAppLid(identity) ? 'lid' : isGroup ? 'group' : 'remote_jid'],
    );
  }

  const contactConversation = await client.query<{ id: string; evolution_remote_jid: string }>(
    `SELECT id, evolution_remote_jid
     FROM conversations
     WHERE company_id = $1::uuid AND contact_id = $2::uuid
     ORDER BY CASE WHEN evolution_remote_jid = ANY($3::text[]) THEN 0 ELSE 1 END,
              updated_at DESC, id
     LIMIT 1`,
    [input.companyId, contactId, candidates],
  );
  if (!isGroup && contactConversation.rows[0]) {
    return {
      id: contactConversation.rows[0].id,
      contactId,
      remoteJid: contactConversation.rows[0].evolution_remote_jid,
      created: false,
    };
  }

  const conversation = await client.query<{ id: string }>(
    `INSERT INTO conversations
       (company_id, contact_id, evolution_remote_jid, is_group, group_name)
     VALUES ($1::uuid, $2::uuid, $3::text, $4::boolean, NULLIF($5::text, ''))
     ON CONFLICT (company_id, evolution_remote_jid) DO UPDATE SET
       contact_id = EXCLUDED.contact_id,
       is_group = EXCLUDED.is_group,
       group_name = COALESCE(EXCLUDED.group_name, conversations.group_name),
       updated_at = now()
     RETURNING id`,
    [input.companyId, contactId, remoteJid, isGroup, isGroup ? `Grupo ${remoteJid.split('@')[0]}` : ''],
  );
  const id = conversation.rows[0]?.id;
  if (!id) return undefined;
  return { id, contactId, remoteJid, created: true };
}

/**
 * Resolves a provider chat to a tenant-scoped conversation. When necessary,
 * the provider-only chat is materialized lazily in one transaction; opaque
 * LIDs without an explicit contact/phone identity fail closed.
 */
export async function resolveConversationForOperation(
  input: ConversationResolutionInput,
  options: ConversationResolutionOptions = {},
) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await resolveWithClient(client, input, options);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
