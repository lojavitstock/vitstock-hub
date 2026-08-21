import { closeDatabase, db } from '../db.js';
import { googlePhoneKey } from '../googleContactReconciliation.js';
import { syncGoogleContactsForCompany } from '../google-contacts.js';

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
  const companyIds = [...new Set(safe.map((group) => group.companyId))];
  const results: Array<{ companyIdMasked: string; imported: number; reconciled: number; conflicts: number }> = [];
  for (const companyId of companyIds) {
    const result = await syncGoogleContactsForCompany(companyId);
    results.push({
      companyIdMasked: `${companyId.slice(0, 8)}…`,
      imported: result.imported,
      reconciled: result.reconciled,
      conflicts: result.conflicts,
    });
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
