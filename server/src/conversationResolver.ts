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

export type ConversationResolutionInput = {
  companyId: string;
  remoteJid: string;
  phone?: string;
  /** Explicit provider aliases (PN/LID/remoteJidAlt), never heuristics. */
  identityCandidates?: string[];
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
  return Array.from(new Set([
    remoteJid,
    ...(input.identityCandidates || []).map((value) => String(value || '').trim()),
    phoneJid,
  ].filter(Boolean)));
}

function phoneForStorage(value: string) {
  return canonicalPhone(value, { defaultCountry: 'BR' }) || `+${normalizeContactPhone(value)}`;
}

function phoneCandidate(input: ConversationResolutionInput, candidates: string[]) {
  if (isWhatsAppGroup(input.remoteJid)) return '';
  const providerJid = candidates.find((value) => {
    const lower = value.toLowerCase();
    return lower.endsWith('@s.whatsapp.net') || lower.endsWith('@c.us');
  });
  if (providerJid) return providerJid.split('@')[0];
  const explicitPhone = String(input.phone || '').trim();
  return explicitPhone && !isWhatsAppLid(explicitPhone) ? explicitPhone : '';
}

export async function resolveConversationWithClient(
  client: PoolClient,
  input: ConversationResolutionInput,
  options: ConversationResolutionOptions,
): Promise<ConversationResolution | undefined> {
  const remoteJid = String(input.remoteJid || '').trim();
  if (!remoteJid) return undefined;
  const candidates = conversationIdentityCandidates(input);
  const explicitCandidates = Array.from(new Set([
    remoteJid,
    ...(input.identityCandidates || []).map((value) => String(value || '').trim()),
  ].filter(Boolean)));
  const phone = phoneCandidate(input, candidates);
  const phoneKeys = phone ? phoneLookupKeys(phone) : [];
  const phoneJid = phone ? providerPhoneJid({ remoteJid: phone }) : '';
  const fallbackCandidates = phoneJid && !explicitCandidates.includes(phoneJid) ? [phoneJid] : [];

  // Serialize materialization of the same explicit provider identity. This
  // keeps two operators from creating duplicate rows for a provider-only chat.
  // Lock each explicit identity independently (in stable order). A replay
  // carrying only a LID and another carrying LID+PN therefore serialize on the
  // shared LID instead of using two unrelated composite locks.
  for (const identity of [...explicitCandidates].sort()) {
    const lockKey = `conversation-materialize:${input.companyId}:${identity}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [lockKey]);
  }

  const existing = await client.query<{ id: string; contact_id: string; evolution_remote_jid: string }>(
    `SELECT c.id, c.contact_id, c.evolution_remote_jid
     FROM conversations c
     WHERE c.company_id = $1::uuid
       AND (
         c.evolution_remote_jid = ANY($2::text[])
         OR (
           cardinality($2::text[]) > 0
           AND EXISTS (
             SELECT 1
             FROM contact_channel_identities ci
             WHERE ci.company_id = c.company_id
               AND ci.contact_id = c.contact_id
               AND ci.channel = 'whatsapp'
               AND (ci.identity = ANY($2::text[]) OR ci.aliases && $2::text[])
           )
         )
         OR (
           cardinality($3::text[]) > 0
           AND (
             c.evolution_remote_jid = ANY($3::text[])
             OR EXISTS (
               SELECT 1
               FROM contact_channel_identities ci
               WHERE ci.company_id = c.company_id
                 AND ci.contact_id = c.contact_id
                 AND ci.channel = 'whatsapp'
                 AND (ci.identity = ANY($3::text[]) OR ci.aliases && $3::text[])
             )
           )
         )
       )
     ORDER BY CASE
       WHEN (c.evolution_remote_jid LIKE '%@s.whatsapp.net' OR c.evolution_remote_jid LIKE '%@c.us')
         AND c.evolution_remote_jid = ANY($2::text[]) THEN 0
       WHEN EXISTS (
         SELECT 1
         FROM contact_channel_identities ci
         WHERE ci.company_id = c.company_id
           AND ci.contact_id = c.contact_id
           AND ci.channel = 'whatsapp'
           AND (ci.identity = ANY($2::text[]) OR ci.aliases && $2::text[])
       ) THEN 1
       WHEN c.evolution_remote_jid = $4::text THEN 2
       WHEN c.evolution_remote_jid = ANY($2::text[]) THEN 3
       ELSE 4
     END,
     c.created_at ASC, c.updated_at ASC, c.id
     LIMIT 1`,
    [input.companyId, explicitCandidates, fallbackCandidates, remoteJid],
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
     ORDER BY CASE WHEN EXISTS (
                SELECT 1
                FROM contact_channel_identities ci
                WHERE ci.company_id = c.company_id
                  AND ci.contact_id = c.id
                  AND ci.channel = 'whatsapp'
                  AND ci.identity = ANY($2::text[])
                  AND (ci.identity LIKE '%@s.whatsapp.net' OR ci.identity LIKE '%@c.us')
              ) THEN 0
              WHEN EXISTS (
                SELECT 1
                FROM contact_channel_identities ci
                WHERE ci.company_id = c.company_id
                  AND ci.contact_id = c.id
                  AND ci.channel = 'whatsapp'
                  AND (ci.identity = ANY($2::text[]) OR ci.aliases && $2::text[])
              ) THEN 1 ELSE 2 END,
              c.updated_at DESC, c.id
     LIMIT 1
     FOR UPDATE`,
    [input.companyId, explicitCandidates, phoneKeys],
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
     ORDER BY CASE
                WHEN evolution_remote_jid LIKE '%@s.whatsapp.net'
                  AND evolution_remote_jid = ANY($3::text[]) THEN 0
                WHEN evolution_remote_jid = ANY($3::text[]) THEN 1
                ELSE 2
              END,
              created_at ASC, updated_at ASC, id
     LIMIT 1`,
    [input.companyId, contactId, explicitCandidates],
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
    const result = await resolveConversationWithClient(client, input, options);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
