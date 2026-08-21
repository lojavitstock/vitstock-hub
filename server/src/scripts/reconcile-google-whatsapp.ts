import { closeDatabase, db } from '../db.js';
import type { PoolClient } from 'pg';
import { canonicalPhone } from '../contactDomain.js';
import { mergeContactsInTransaction } from '../contactMerge.js';
import { googlePhoneKey } from '../googleContactReconciliation.js';

type ContactRow = {
  id: string;
  company_id: string;
  name: string;
  phone: string;
  source: string | null;
  google_resource_name: string | null;
  manual_override: Record<string, unknown> | null;
  google_data: Record<string, unknown> | null;
  conversation_count: number;
  has_whatsapp_identity: boolean;
  has_whatsapp_phone: boolean;
  phone_keys: string[];
};

type Group = { companyId: string; key: string; contacts: ContactRow[] };

function hasManualOverride(contact: ContactRow) {
  return Boolean(contact.manual_override && Object.keys(contact.manual_override).length);
}

function isGoogle(contact: ContactRow) {
  return Boolean(contact.google_resource_name);
}

function isProvisionalWhatsapp(contact: ContactRow) {
  return contact.source === 'hub'
    && !contact.google_resource_name
    && !hasManualOverride(contact)
    && (contact.has_whatsapp_identity || contact.has_whatsapp_phone);
}

async function loadGroups(): Promise<Group[]> {
  const result = await db.query<ContactRow>(
    `SELECT c.id, c.company_id, c.name, c.phone, c.source, c.google_resource_name,
        c.manual_override, c.google_data,
        COUNT(DISTINCT cv.id)::int AS conversation_count,
        COALESCE(bool_or(ci.channel = 'whatsapp'), false) AS has_whatsapp_identity,
        COALESCE(bool_or(cp.source = 'whatsapp'), false) AS has_whatsapp_phone,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT cp.normalized_phone), NULL) AS phone_keys
     FROM contacts c
     LEFT JOIN contact_phones cp ON cp.company_id = c.company_id AND cp.contact_id = c.id
     LEFT JOIN contact_channel_identities ci ON ci.company_id = c.company_id AND ci.contact_id = c.id
     LEFT JOIN conversations cv ON cv.company_id = c.company_id AND cv.contact_id = c.id
     WHERE c.archived_at IS NULL AND c.merged_into_contact_id IS NULL
     GROUP BY c.id`,
  );
  const groups = new Map<string, Group>();
  for (const contact of result.rows) {
    const keys = new Set([contact.phone, ...(contact.phone_keys || [])]
      .map((value) => googlePhoneKey(value || ''))
      .filter(Boolean));
    for (const key of keys) {
      const groupKey = `${contact.company_id}:${key}`;
      const group = groups.get(groupKey) || { companyId: contact.company_id, key, contacts: [] };
      if (!group.contacts.some((item) => item.id === contact.id)) group.contacts.push(contact);
      groups.set(groupKey, group);
    }
  }
  return [...groups.values()];
}

function classifyGroup(group: Group) {
  const google = group.contacts.filter(isGoogle);
  const provisional = group.contacts.filter(isProvisionalWhatsapp);
  const isSafe = google.length === 1 && provisional.length === 1 && group.contacts.length === 2;
  if (isSafe) return 'safe' as const;
  if (google.length > 0 && provisional.length > 0) return 'ambiguous' as const;
  return 'skipped' as const;
}

type StoredGooglePerson = {
  resourceName?: string;
  etag?: string;
  names?: Array<{ displayName?: string; givenName?: string; middleName?: string; familyName?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  addresses?: Array<{ formattedValue?: string; streetAddress?: string; city?: string; region?: string; postalCode?: string; country?: string }>;
  organizations?: Array<{ name?: string; title?: string; current?: boolean }>;
  birthdays?: Array<{ date?: { year?: number; month?: number; day?: number } }>;
  biographies?: Array<{ value?: string }>;
  nicknames?: Array<{ value?: string }>;
  urls?: Array<{ value?: string }>;
  userDefined?: Array<{ key?: string; value?: string }>;
  photos?: Array<{ url?: string; default?: boolean }>;
};

function storedGoogleFields(value: Record<string, unknown> | null, fallbackResourceName: string | null) {
  const person = (value || {}) as StoredGooglePerson;
  const name = person.names?.[0]?.displayName?.trim()
    || [person.names?.[0]?.givenName, person.names?.[0]?.middleName, person.names?.[0]?.familyName].filter(Boolean).join(' ').trim();
  const phones = Array.from(new Set((person.phoneNumbers || []).map((item) => canonicalPhone(item.value || '', { defaultCountry: 'BR' }) || '').filter(Boolean)));
  const emails = Array.from(new Set((person.emailAddresses || []).map((item) => item.value?.trim() || '').filter(Boolean)));
  const address = person.addresses?.[0];
  const formattedAddress = address?.formattedValue?.trim()
    || [address?.streetAddress, address?.city, address?.region, address?.postalCode, address?.country].filter(Boolean).join(', ').trim();
  const organization = person.organizations?.find((item) => item.current !== false) || person.organizations?.[0];
  const birthday = person.birthdays?.[0]?.date;
  const birthdayValue = birthday?.month && birthday.day
    ? `${birthday.year ? `${birthday.year}-` : ''}${String(birthday.month).padStart(2, '0')}-${String(birthday.day).padStart(2, '0')}`
    : null;
  const cpf = person.userDefined?.find((item) => ['cpf', 'documento', 'document'].includes((item.key || '').trim().toLowerCase()))?.value?.trim() || null;
  return {
    person,
    name,
    phones,
    emails,
    email: emails[0] || null,
    address: formattedAddress || null,
    birthday: birthdayValue,
    cpf,
    company: organization?.name?.trim() || null,
    jobTitle: organization?.title?.trim() || null,
    notes: person.biographies?.map((item) => item.value?.trim() || '').filter(Boolean).join('\n\n') || null,
    nickname: person.nicknames?.find((item) => item.value?.trim())?.value?.trim() || null,
    website: person.urls?.find((item) => item.value?.trim())?.value?.trim() || null,
    avatarUrl: person.photos?.find((photo) => !photo.default)?.url || null,
    resourceName: person.resourceName || fallbackResourceName,
    etag: person.etag || null,
  };
}

async function applySafeGroup(client: PoolClient, group: Group) {
  const google = group.contacts.find(isGoogle);
  const provisional = group.contacts.find(isProvisionalWhatsapp);
  if (!google || !provisional || !google.google_data) return null;
  await client.query('BEGIN');
  try {
    const locked = await client.query(
      `SELECT id, company_id, name, phone, source, google_resource_name, manual_override
       FROM contacts WHERE company_id = $1 AND id = ANY($2::uuid[])
       AND archived_at IS NULL AND merged_into_contact_id IS NULL FOR UPDATE`,
      [group.companyId, [google.id, provisional.id]],
    );
    const source = locked.rows.find((row: { id: string }) => row.id === google.id);
    const target = locked.rows.find((row: { id: string }) => row.id === provisional.id);
    if (!source || !target || source.google_resource_name !== google.google_resource_name
      || target.source !== 'hub' || target.google_resource_name
      || Object.keys(target.manual_override || {}).length) {
      await client.query('ROLLBACK');
      return null;
    }
    const fields = storedGoogleFields(google.google_data, google.google_resource_name);
    if (!fields.name || !fields.resourceName) {
      await client.query('ROLLBACK');
      return null;
    }
    const targetPhone = target.phone;
    const secondaryPhone = fields.phones.find((phone) => phone !== targetPhone) || null;
    await client.query(
      `UPDATE contacts SET name = $2, email = $3, avatar_url = COALESCE($4, avatar_url),
         cpf = $5, address = $6, secondary_phone = COALESCE($7, secondary_phone),
         google_resource_name = $8, source = 'hub', nickname = $9, birthday = $10,
         company = $11, job_title = $12, website = $13, notes = $14,
         google_etag = $15, google_data = $16, google_synced_at = now(),
         updated_at = now(), version = version + 1
       WHERE company_id = $1 AND id = $17`,
      [group.companyId, fields.name, fields.email, fields.avatarUrl, fields.cpf, fields.address, secondaryPhone, fields.resourceName, fields.nickname, fields.birthday, fields.company, fields.jobTitle, fields.website, fields.notes, fields.etag, fields.person, target.id],
    );
    for (const [index, phone] of fields.phones.entries()) {
      await client.query(
        `INSERT INTO contact_phones (company_id, contact_id, phone, normalized_phone, is_primary, source)
         VALUES ($1, $2, $3, $4, $5, 'google')
         ON CONFLICT (contact_id, normalized_phone) DO UPDATE SET
           phone = EXCLUDED.phone,
           is_primary = EXCLUDED.is_primary,
           source = CASE WHEN contact_phones.source = 'whatsapp' THEN contact_phones.source ELSE 'google' END,
           updated_at = now()`,
        [group.companyId, target.id, phone, phone.replace(/\D/g, ''), index === 0 && phone === targetPhone],
      );
    }
    for (const [index, email] of fields.emails.entries()) {
      await client.query(
        `INSERT INTO contact_emails (company_id, contact_id, email, normalized_email, is_primary, source)
         VALUES ($1, $2, $3, $4, $5, 'google')
         ON CONFLICT (contact_id, normalized_email) DO UPDATE SET email = EXCLUDED.email, is_primary = EXCLUDED.is_primary, source = 'google', updated_at = now()`,
        [group.companyId, target.id, email, email.toLowerCase(), index === 0],
      );
    }
    const merge = await mergeContactsInTransaction(client, {
      companyId: group.companyId,
      sourceContactId: source.id,
      targetContactId: target.id,
      performedBy: null,
      fieldSnapshot: { reason: 'google_whatsapp_legacy_reconciliation', sourceId: source.id, targetId: target.id, resourceName: fields.resourceName },
    });
    if (!merge) throw new Error('Legacy Google/WhatsApp merge became unsafe before commit');
    await client.query(
      `INSERT INTO contact_audit_logs (company_id, contact_id, actor_user_id, action, before_data, after_data)
       VALUES ($1, $2, NULL, 'contact.google_whatsapp_reconciled', $3::jsonb, $4::jsonb)`,
      [group.companyId, target.id, JSON.stringify({ name: target.name, source: 'hub', conversations: provisional.conversation_count }), JSON.stringify({ name: fields.name, googleResourceName: fields.resourceName, mergedGoogleContactId: source.id })],
    );
    await client.query('COMMIT');
    return { contactId: target.id, conversations: merge.movedConversationIds.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function dryRun() {
  const groups = await loadGroups();
  const summary = { safe: 0, ambiguous: 0, skipped: 0, safeConversations: 0, safeGoogleContacts: 0, safeWhatsappContacts: 0 };
  for (const group of groups) {
    const classification = classifyGroup(group);
    summary[classification] += 1;
    if (classification === 'safe') {
      summary.safeConversations += group.contacts.find(isProvisionalWhatsapp)?.conversation_count || 0;
      summary.safeGoogleContacts += 1;
      summary.safeWhatsappContacts += 1;
    }
  }
  console.log(JSON.stringify({ mode: 'dry-run', groups: summary }));
  return summary;
}

async function applySafeGroups() {
  const groups = await loadGroups();
  const safe = groups.filter((group) => classifyGroup(group) === 'safe');
  const client = await db.connect();
  const results: Array<{ companyIdMasked: string; reconciled: number; conversations: number; skipped: number }> = [];
  try {
    for (const companyId of [...new Set(safe.map((group) => group.companyId))]) {
      const companyGroups = safe.filter((group) => group.companyId === companyId);
      let reconciled = 0;
      let conversations = 0;
      let skipped = 0;
      for (const group of companyGroups) {
        const result = await applySafeGroup(client, group);
        if (!result) skipped += 1;
        else { reconciled += 1; conversations += result.conversations; }
      }
      results.push({ companyIdMasked: `${companyId.slice(0, 8)}…`, reconciled, conversations, skipped });
    }
  } finally {
    client.release();
  }
  console.log(JSON.stringify({ mode: 'apply-safe', safeGroups: safe.length, results }));
}

const args = new Set(process.argv.slice(2));
try {
  const summary = await dryRun();
  if (args.has('--apply')) {
    if (!args.has('--confirm-safe')) throw new Error('Aplicação bloqueada: use --apply --confirm-safe após revisar o dry-run.');
    if (!summary.safe) throw new Error('Aplicação bloqueada: nenhum grupo SAFE encontrado.');
    await applySafeGroups();
  }
} finally {
  await closeDatabase();
}
