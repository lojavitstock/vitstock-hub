import { canonicalPhone, normalizeContactPhone, phoneIdentityKeys } from './contactDomain.js';

export type ContactPhoneExecutor = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
};

/**
 * Returns exact digit representations that can identify the same phone in
 * both canonical rows and legacy rows stored without the country code.
 */
export function phoneLookupKeys(value: unknown) {
  const keys = phoneIdentityKeys(value, { defaultCountry: 'BR' })
    .map(normalizeContactPhone)
    .filter(Boolean);
  const canonicalDigits = normalizeContactPhone(canonicalPhone(value, { defaultCountry: 'BR' }) || '');
  if (canonicalDigits.startsWith('55') && (canonicalDigits.length === 12 || canonicalDigits.length === 13)) {
    keys.push(canonicalDigits.slice(2));
  }
  return Array.from(new Set(keys));
}

export async function upsertContactPhone(
  executor: ContactPhoneExecutor,
  input: {
    companyId: string;
    contactId: string;
    phone: string;
    label?: string | null;
    isPrimary?: boolean;
    source: string;
  },
) {
  const phone = canonicalPhone(input.phone, { defaultCountry: 'BR' }) || input.phone.trim();
  const normalizedPhone = normalizeContactPhone(phone);
  const lookupKeys = phoneLookupKeys(input.phone);
  if (!normalizedPhone || !lookupKeys.length) return { id: null, created: false };

  const existing = await executor.query(
    `SELECT id, normalized_phone, source
     FROM contact_phones
     WHERE company_id = $1 AND contact_id = $2
       AND (regexp_replace(phone, '\\D', '', 'g') = ANY($3::text[])
            OR regexp_replace(normalized_phone, '\\D', '', 'g') = ANY($3::text[]))
     ORDER BY (regexp_replace(normalized_phone, '\\D', '', 'g') = $4) DESC, is_primary DESC, id
     LIMIT 20`,
    [input.companyId, input.contactId, lookupKeys, normalizedPhone],
  );
  const exact = existing.rows.find((row) => normalizeContactPhone(row.normalized_phone) === normalizedPhone);
  const row = exact || existing.rows[0];
  if (row?.id) {
    const normalizedAlreadyUsed = existing.rows.some((candidate) => candidate.id !== row.id && normalizeContactPhone(candidate.normalized_phone) === normalizedPhone);
    await executor.query(
      `UPDATE contact_phones SET
         phone = $3,
         normalized_phone = CASE WHEN $4::boolean THEN normalized_phone ELSE $5 END,
         label = COALESCE($6, label),
         is_primary = CASE WHEN $7::boolean THEN true ELSE is_primary END,
         source = CASE WHEN contact_phones.source = 'whatsapp' THEN contact_phones.source ELSE $8 END,
         updated_at = now()
       WHERE company_id = $1 AND contact_id = $2 AND id = $9`,
      [input.companyId, input.contactId, phone, normalizedAlreadyUsed, normalizedPhone, input.label || null, Boolean(input.isPrimary), input.source, row.id],
    );
    if (input.isPrimary) {
      await executor.query('UPDATE contact_phones SET is_primary = false, updated_at = now() WHERE company_id = $1 AND contact_id = $2 AND id <> $3', [input.companyId, input.contactId, row.id]);
    }
    return { id: row.id, created: false };
  }

  const inserted = await executor.query(
    `INSERT INTO contact_phones (company_id, contact_id, phone, normalized_phone, label, is_primary, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (contact_id, normalized_phone) DO UPDATE SET
       phone = EXCLUDED.phone,
       label = COALESCE(EXCLUDED.label, contact_phones.label),
       is_primary = CASE WHEN EXCLUDED.is_primary THEN true ELSE contact_phones.is_primary END,
       source = CASE WHEN contact_phones.source = 'whatsapp' THEN contact_phones.source ELSE EXCLUDED.source END,
       updated_at = now()
     RETURNING id`,
    [input.companyId, input.contactId, phone, normalizedPhone, input.label || null, Boolean(input.isPrimary), input.source],
  );
  if (input.isPrimary && inserted.rows[0]?.id) {
    await executor.query('UPDATE contact_phones SET is_primary = false, updated_at = now() WHERE company_id = $1 AND contact_id = $2 AND id <> $3', [input.companyId, input.contactId, inserted.rows[0].id]);
  }
  return { id: inserted.rows[0]?.id || null, created: Boolean(inserted.rows[0]?.id) };
}
