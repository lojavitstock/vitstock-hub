import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import { mergeContactsInTransaction } from './contactMerge.js';
import { buildDuplicateGroups } from './contactDuplicates.js';
import { requireAdmin, requireUser } from './auth.js';
import {
  canonicalPhone,
  normalizeContactEmail,
  normalizeContactPhone,
  orderedContactPair,
  parseContactCsv,
  splitContactValues,
} from './contactDomain.js';
import { phoneLookupKeys, upsertContactPhone } from './contactPhones.js';
import { contactArchiveWhereClause } from './contactList.js';

const contactInput = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(40),
  phones: z.union([z.string().max(2000), z.array(z.string().max(40))]).optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  emails: z.union([z.string().max(2000), z.array(z.string().email())]).optional(),
  company: z.string().trim().max(160).optional().or(z.literal('')),
  nickname: z.string().trim().max(160).optional().or(z.literal('')),
  birthday: z.string().trim().max(40).optional().or(z.literal('')),
  jobTitle: z.string().trim().max(160).optional().or(z.literal('')),
  website: z.string().trim().max(500).optional().or(z.literal('')),
  cpf: z.string().trim().max(30).optional().or(z.literal('')),
  address: z.string().trim().max(500).optional().or(z.literal('')),
  notes: z.string().max(5000).optional().or(z.literal('')),
  source: z.enum(['manual', 'whatsapp', 'google', 'system', 'csv/import']).optional(),
});

const patchContact = contactInput.partial().extend({
  version: z.number().int().positive().optional(),
});

const tagInput = z.object({ name: z.string().trim().min(1).max(80), color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default('#EABB19') });

function queryString(request: any, key: string) {
  const value = request.query?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function pagination(request: any) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(queryString(request, 'page') || '1', 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(queryString(request, 'limit') || '30', 10) || 30));
  return { page, limit, offset: (page - 1) * limit };
}

function contactValues(input: z.infer<typeof contactInput>) {
  const phones = Array.from(new Set([input.phone, ...splitContactValues(input.phones)]
    .map((value) => canonicalPhone(value, { defaultCountry: 'BR' }))
    .filter((value): value is string => Boolean(value))));
  const emails = Array.from(new Set([input.email ? normalizeContactEmail(input.email) : '', ...splitContactValues(input.emails).map(normalizeContactEmail)].filter(Boolean)));
  return { phones, emails };
}

async function writeAudit(companyId: string, contactId: string | null, userId: string, action: string, beforeData: unknown, afterData: unknown) {
  await db.query(
    `INSERT INTO contact_audit_logs (company_id, contact_id, actor_user_id, action, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [companyId, contactId, userId, action, JSON.stringify(beforeData || {}), JSON.stringify(afterData || {})],
  );
}

async function loadTags(companyId: string, contactIds: string[]) {
  if (!contactIds.length) return new Map<string, any[]>();
  const result = await db.query(
    `SELECT l.contact_id, t.id, t.name, t.color
     FROM contact_tag_links l JOIN contact_tags t ON t.id = l.tag_id
     WHERE l.company_id = $1 AND l.contact_id = ANY($2::uuid[])
     ORDER BY lower(t.name)`, [companyId, contactIds],
  );
  const tags = new Map<string, any[]>();
  for (const row of result.rows) tags.set(row.contact_id, [...(tags.get(row.contact_id) || []), { id: row.id, name: row.name, color: row.color }]);
  return tags;
}

async function loadPhonesAndEmails(companyId: string, contactIds: string[]) {
  const phones = await db.query(`SELECT contact_id, id, phone, label, is_primary, source FROM contact_phones WHERE company_id = $1 AND contact_id = ANY($2::uuid[]) ORDER BY is_primary DESC, id`, [companyId, contactIds]);
  const emails = await db.query(`SELECT contact_id, id, email, label, is_primary, source FROM contact_emails WHERE company_id = $1 AND contact_id = ANY($2::uuid[]) ORDER BY is_primary DESC, id`, [companyId, contactIds]);
  const result = new Map<string, { phones: any[]; emails: any[] }>();
  for (const id of contactIds) result.set(id, { phones: [], emails: [] });
  for (const row of phones.rows) result.get(row.contact_id)?.phones.push(row);
  for (const row of emails.rows) result.get(row.contact_id)?.emails.push(row);
  return result;
}

function enrichRows(rows: any[], tags: Map<string, any[]>, channels: Map<string, { phones: any[]; emails: any[] }>) {
  return rows.map((row) => ({
    ...row,
    phones: channels.get(row.id)?.phones || [{ id: null, phone: row.phone, is_primary: true, source: row.source }],
    emails: channels.get(row.id)?.emails || (row.email ? [{ id: null, email: row.email, is_primary: true, source: row.source }] : []),
    tags: tags.get(row.id) || [],
    google_saved: Boolean(row.google_resource_name),
    archived: Boolean(row.archived_at),
  }));
}

async function insertContactChannels(companyId: string, contactId: string, values: { phones: string[]; emails: string[] }, source: string) {
  for (const [index, phone] of values.phones.entries()) {
    await upsertContactPhone(db, { companyId, contactId, phone, isPrimary: index === 0, source });
  }
  for (const [index, email] of values.emails.entries()) {
    await db.query(
      `INSERT INTO contact_emails (company_id, contact_id, email, normalized_email, is_primary, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`, [companyId, contactId, email, normalizeContactEmail(email), index === 0, source === 'google' ? 'google' : source],
    );
  }
}

async function ensureContact(companyId: string, input: z.infer<typeof contactInput>, source = 'manual', updateExisting = false) {
  const values = contactValues(input);
  const phone = values.phones[0];
  if (!phone) throw new Error('Telefone inválido');
  const phoneDigits = phoneLookupKeys(phone);
  const duplicate = await db.query<{ id: string }>(
    `SELECT c.id FROM contacts c
     WHERE c.company_id = $1
       AND (regexp_replace(c.phone, '\\D', '', 'g') = ANY($2::text[])
            OR EXISTS (SELECT 1 FROM contact_phones p WHERE p.company_id = c.company_id AND p.contact_id = c.id AND p.normalized_phone = ANY($2::text[])))
     ORDER BY c.id LIMIT 1`, [companyId, phoneDigits],
  );
  if (duplicate.rows[0]) {
    if (updateExisting) {
      await db.query(
        `UPDATE contacts SET name = $1, email = COALESCE($2, email), company = COALESCE($3, company),
         nickname = COALESCE($4, nickname), birthday = COALESCE($5, birthday), job_title = COALESCE($6, job_title),
         website = COALESCE($7, website), cpf = COALESCE($8, cpf), address = COALESCE($9, address),
         notes = COALESCE($10, notes), updated_at = now(), version = version + 1
         WHERE id = $11 AND company_id = $12`,
        [input.name, values.emails[0] || null, input.company || null, input.nickname || null, input.birthday || null, input.jobTitle || null, input.website || null, input.cpf || null, input.address || null, input.notes || null, duplicate.rows[0].id, companyId],
      );
      await insertContactChannels(companyId, duplicate.rows[0].id, values, source);
    }
    return { id: duplicate.rows[0].id, created: false };
  }
  const created = await db.query<{ id: string }>(
    `INSERT INTO contacts (company_id, name, phone, email, company, nickname, birthday, job_title, website, cpf, address, notes, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [companyId, input.name, phone, values.emails[0] || null, input.company || null, input.nickname || null, input.birthday || null, input.jobTitle || null, input.website || null, input.cpf || null, input.address || null, input.notes || null, source],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error('Contato não pôde ser criado');
  await insertContactChannels(companyId, id, values, source);
  return { id, created: true };
}

export async function registerContactRoutes(app: FastifyInstance) {
  app.get('/api/contacts', { preHandler: requireUser }, async (request) => {
    const { page, limit, offset } = pagination(request);
    const search = queryString(request, 'q') || queryString(request, 'search');
    const tag = queryString(request, 'tag');
    const includeArchived = ['1', 'true', 'yes'].includes(queryString(request, 'archived'));
    const duplicatesOnly = ['1', 'true', 'yes'].includes(queryString(request, 'duplicates'));
    const sort = queryString(request, 'sort') === 'name' ? 'name' : 'last_interaction';
    const values: unknown[] = [request.user!.companyId];
    const conditions = ['c.company_id = $1', 'NOT EXISTS (SELECT 1 FROM conversations cg WHERE cg.contact_id = c.id AND cg.is_group = true)'];
    const archiveClause = contactArchiveWhereClause(includeArchived);
    if (archiveClause) conditions.push(archiveClause);
    if (duplicatesOnly) conditions.push(`EXISTS (
      SELECT 1 FROM contact_phones dup
      WHERE dup.contact_id = c.id AND dup.company_id = c.company_id
        AND EXISTS (
          SELECT 1 FROM contact_phones other
          JOIN contacts other_contact ON other_contact.id = other.contact_id AND other_contact.company_id = other.company_id
          WHERE other.company_id = dup.company_id AND other.contact_id <> dup.contact_id
            AND (CASE WHEN length(regexp_replace(other.phone, '\\D', '', 'g')) IN (10, 11)
                      THEN '55' || regexp_replace(other.phone, '\\D', '', 'g')
                      ELSE regexp_replace(other.phone, '\\D', '', 'g') END)
              = (CASE WHEN length(regexp_replace(dup.phone, '\\D', '', 'g')) IN (10, 11)
                      THEN '55' || regexp_replace(dup.phone, '\\D', '', 'g')
                      ELSE regexp_replace(dup.phone, '\\D', '', 'g') END)
            AND NOT (
              (((c.source IN ('hub', 'whatsapp')) AND c.google_resource_name IS NULL
                 AND (EXISTS (SELECT 1 FROM contact_channel_identities cwi WHERE cwi.company_id = c.company_id AND cwi.contact_id = c.id AND cwi.channel = 'whatsapp')
                      OR EXISTS (SELECT 1 FROM contact_phones cwp WHERE cwp.company_id = c.company_id AND cwp.contact_id = c.id AND cwp.source = 'whatsapp')))
               AND (other_contact.source = 'google' OR other_contact.google_resource_name IS NOT NULL))
              OR
              (((other_contact.source IN ('hub', 'whatsapp')) AND other_contact.google_resource_name IS NULL
                 AND (EXISTS (SELECT 1 FROM contact_channel_identities owi WHERE owi.company_id = other_contact.company_id AND owi.contact_id = other_contact.id AND owi.channel = 'whatsapp')
                      OR EXISTS (SELECT 1 FROM contact_phones owp WHERE owp.company_id = other_contact.company_id AND owp.contact_id = other_contact.id AND owp.source = 'whatsapp')))
               AND (c.source = 'google' OR c.google_resource_name IS NOT NULL))
            )
        )
    )`);
    if (tag) {
      values.push(tag);
      conditions.push(`EXISTS (SELECT 1 FROM contact_tag_links tl JOIN contact_tags tg ON tg.id = tl.tag_id WHERE tl.contact_id = c.id AND lower(tg.name) = lower($${values.length}))`);
    }
    if (search) {
      values.push(`%${search}%`);
      const q = `$${values.length}`;
      const searchPhoneDigits = phoneLookupKeys(search);
      const phoneCondition = searchPhoneDigits.length
        ? (() => {
          values.push(searchPhoneDigits);
          const phoneParam = `$${values.length}`;
          return `OR regexp_replace(c.phone, '\\D', '', 'g') = ANY(${phoneParam}::text[])
                  OR EXISTS (SELECT 1 FROM contact_phones cp WHERE cp.company_id = c.company_id AND cp.contact_id = c.id AND cp.normalized_phone = ANY(${phoneParam}::text[]))`;
        })()
        : '';
      conditions.push(`(
        c.name ILIKE ${q} OR c.phone ILIKE ${q} OR COALESCE(c.email, '') ILIKE ${q}
        OR COALESCE(c.company, '') ILIKE ${q}
        OR EXISTS (SELECT 1 FROM contact_phones p WHERE p.contact_id = c.id AND p.phone ILIKE ${q})
        OR EXISTS (SELECT 1 FROM contact_emails e WHERE e.contact_id = c.id AND e.email ILIKE ${q})
        OR EXISTS (SELECT 1 FROM contact_tag_links tl JOIN contact_tags tg ON tg.id = tl.tag_id WHERE tl.contact_id = c.id AND tg.name ILIKE ${q})
        ${phoneCondition}
      )`);
    }
    const count = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM contacts c WHERE ${conditions.join(' AND ')}`, values);
    values.push(limit, offset);
    const order = sort === 'name' ? 'lower(c.name), c.id' : 'last_interaction DESC NULLS LAST, c.id';
    const rows = await db.query(
      `SELECT c.id, c.name, c.phone, c.email, c.avatar_url, c.notes, c.cpf, c.address, c.secondary_phone,
              c.nickname, c.birthday, c.company, c.job_title, c.website, c.google_resource_name,
              c.google_etag, c.google_data, c.google_synced_at, c.source, c.created_at,
              c.archived_at, c.archived_by, c.version,
              MAX(CASE WHEN cv.is_group = false THEN cv.last_message_at END) AS last_interaction,
              count(DISTINCT CASE WHEN cv.is_group = false THEN cv.id END)::int AS conversation_count
       FROM contacts c LEFT JOIN conversations cv ON cv.contact_id = c.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY c.id ORDER BY ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const ids = rows.rows.map((row) => row.id);
    return { contacts: enrichRows(rows.rows, await loadTags(request.user!.companyId, ids), await loadPhonesAndEmails(request.user!.companyId, ids)), page, limit, total: Number(count.rows[0]?.count || 0), hasMore: offset + rows.rows.length < Number(count.rows[0]?.count || 0) };
  });

  app.get('/api/contacts/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = String((request.params as any).id || '');
    const result = await db.query(
      `SELECT c.*, MAX(CASE WHEN cv.is_group = false THEN cv.last_message_at END) AS last_interaction,
              count(DISTINCT CASE WHEN cv.is_group = false THEN cv.id END)::int AS conversation_count
       FROM contacts c LEFT JOIN conversations cv ON cv.contact_id = c.id
       WHERE c.company_id = $1 AND c.id = $2 GROUP BY c.id`, [request.user!.companyId, id],
    );
    const contact = result.rows[0];
    if (!contact) return reply.code(404).send({ error: 'Contato não encontrado' });
    const channels = await loadPhonesAndEmails(request.user!.companyId, [id]);
    const tags = await loadTags(request.user!.companyId, [id]);
    const conversations = await db.query(
      `SELECT cv.id, cv.evolution_remote_jid, cv.status, cv.last_message, cv.last_message_at, cv.is_group, cv.group_name
       FROM conversations cv WHERE cv.company_id = $1 AND cv.contact_id = $2 AND cv.is_group = false ORDER BY cv.last_message_at DESC NULLS LAST, cv.id`, [request.user!.companyId, id],
    );
    const merge = await db.query(
      `SELECT id, source_contact_id, target_contact_id, status, created_at
       FROM contact_merge_operations
       WHERE company_id = $1 AND status = 'merged'
         AND (source_contact_id = $2 OR target_contact_id = $2)
       ORDER BY created_at DESC LIMIT 1`, [request.user!.companyId, id],
    );
    return { contact: enrichRows([contact], tags, channels)[0], conversations: conversations.rows, merge: merge.rows[0] || null };
  });

  app.post('/api/contacts', { preHandler: requireUser }, async (request, reply) => {
    const parsed = contactInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Informe nome e telefone válidos' });
    try {
      const created = await ensureContact(request.user!.companyId, parsed.data, parsed.data.source || 'manual');
      if (!created.created) return reply.code(409).send({ error: 'Já existe um contato com este telefone', id: created.id });
      await writeAudit(request.user!.companyId, created.id, request.user!.id, 'contact.created', {}, parsed.data);
      return reply.code(201).send({ id: created.id, created: true });
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || 'Contato inválido' });
    }
  });

  app.patch('/api/contacts/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = String((request.params as any).id || '');
    const parsed = patchContact.safeParse(request.body);
    if (!parsed.success || !Object.keys(parsed.data).length) return reply.code(400).send({ error: 'Nenhuma alteração válida' });
    const current = await db.query('SELECT * FROM contacts WHERE company_id = $1 AND id = $2 FOR UPDATE', [request.user!.companyId, id]);
    const existing = current.rows[0];
    if (!existing) return reply.code(404).send({ error: 'Contato não encontrado' });
    if (parsed.data.version !== undefined && parsed.data.version !== existing.version) return reply.code(409).send({ error: 'Contato foi alterado. Atualize e tente novamente.' });
    const fields: string[] = [];
    const values: unknown[] = [];
    const add = (name: string, value: unknown) => { fields.push(`${name} = $${values.length + 1}`); values.push(value); };
    if (parsed.data.name !== undefined) add('name', parsed.data.name);
    if (parsed.data.company !== undefined) add('company', parsed.data.company || null);
    if (parsed.data.nickname !== undefined) add('nickname', parsed.data.nickname || null);
    if (parsed.data.birthday !== undefined) add('birthday', parsed.data.birthday || null);
    if (parsed.data.jobTitle !== undefined) add('job_title', parsed.data.jobTitle || null);
    if (parsed.data.website !== undefined) add('website', parsed.data.website || null);
    if (parsed.data.cpf !== undefined) add('cpf', parsed.data.cpf || null);
    if (parsed.data.address !== undefined) add('address', parsed.data.address || null);
    if (parsed.data.notes !== undefined) add('notes', parsed.data.notes || null);
    if (parsed.data.phone !== undefined) {
      const phone = canonicalPhone(parsed.data.phone, { defaultCountry: 'BR' });
      if (!phone) return reply.code(400).send({ error: 'Telefone principal inválido' });
      const phoneDigits = phoneLookupKeys(phone);
      const duplicate = await db.query(
        `SELECT c.id FROM contacts c
         WHERE c.company_id = $1 AND c.id <> $3
           AND (regexp_replace(c.phone, '\\D', '', 'g') = ANY($2::text[])
                OR EXISTS (SELECT 1 FROM contact_phones p WHERE p.company_id = c.company_id AND p.contact_id = c.id AND p.normalized_phone = ANY($2::text[])))
         LIMIT 1`, [request.user!.companyId, phoneDigits, id],
      );
      if (duplicate.rows[0]) return reply.code(409).send({ error: 'Este telefone já pertence a outro contato' });
      add('phone', phone);
    }
    if (parsed.data.email !== undefined) add('email', parsed.data.email ? normalizeContactEmail(parsed.data.email) : null);
    fields.push('version = version + 1', 'updated_at = now()');
    values.push(id, request.user!.companyId);
    const updated = await db.query(`UPDATE contacts SET ${fields.join(', ')} WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`, values);
    const after = updated.rows[0];
    const overrideFields = Object.fromEntries(['name', 'email', 'company', 'nickname', 'birthday', 'jobTitle', 'website', 'cpf', 'address', 'notes', 'phone'].filter((field) => Object.prototype.hasOwnProperty.call(parsed.data, field)).map((field) => [field, 'manual']));
    if (Object.keys(overrideFields).length) await db.query('UPDATE contacts SET manual_override = manual_override || $3::jsonb WHERE company_id = $1 AND id = $2', [request.user!.companyId, id, JSON.stringify(overrideFields)]);
    if (parsed.data.phone !== undefined || parsed.data.phones !== undefined || parsed.data.email !== undefined || parsed.data.emails !== undefined) {
      const channels = contactValues({ ...existing, ...parsed.data, phone: parsed.data.phone || existing.phone } as any);
      // Keep WhatsApp-origin phone rows as provenance/identity evidence. The
      // manual form replaces only non-channel phone rows; the shared upsert
      // then reuses any semantically equivalent row instead of duplicating it.
      await db.query("DELETE FROM contact_phones WHERE contact_id = $1 AND source <> 'whatsapp'", [id]);
      await db.query('DELETE FROM contact_emails WHERE contact_id = $1', [id]);
      await insertContactChannels(request.user!.companyId, id, channels, 'manual');
    }
    await writeAudit(request.user!.companyId, id, request.user!.id, 'contact.updated', existing, after);
    return { contact: after };
  });

  app.post('/api/contacts/:id/archive', { preHandler: requireAdmin }, async (request, reply) => {
    const id = String((request.params as any).id || '');
    const result = await db.query('UPDATE contacts SET archived_at = now(), archived_by = $3, version = version + 1, updated_at = now() WHERE company_id = $1 AND id = $2 AND archived_at IS NULL RETURNING *', [request.user!.companyId, id, request.user!.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Contato não encontrado ou já arquivado' });
    await writeAudit(request.user!.companyId, id, request.user!.id, 'contact.archived', {}, result.rows[0]);
    return { archived: true };
  });

  app.post('/api/contacts/:id/restore', { preHandler: requireAdmin }, async (request, reply) => {
    const id = String((request.params as any).id || '');
    const result = await db.query('UPDATE contacts SET archived_at = NULL, archived_by = NULL, version = version + 1, updated_at = now() WHERE company_id = $1 AND id = $2 AND archived_at IS NOT NULL RETURNING *', [request.user!.companyId, id]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Contato não encontrado ou já ativo' });
    await writeAudit(request.user!.companyId, id, request.user!.id, 'contact.restored', {}, result.rows[0]);
    return { restored: true };
  });

  app.get('/api/contact-tags', { preHandler: requireUser }, async (request) => {
    const result = await db.query('SELECT id, name, color, created_at, updated_at FROM contact_tags WHERE company_id = $1 ORDER BY lower(name)', [request.user!.companyId]);
    return { tags: result.rows };
  });

  app.post('/api/contact-tags', { preHandler: requireUser }, async (request, reply) => {
    const parsed = tagInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Nome de tag inválido' });
    try {
      const result = await db.query('INSERT INTO contact_tags (company_id, name, color) VALUES ($1, $2, $3) ON CONFLICT (company_id, lower(name)) DO UPDATE SET color = EXCLUDED.color RETURNING id, name, color', [request.user!.companyId, parsed.data.name, parsed.data.color]);
      return reply.code(201).send({ tag: result.rows[0] });
    } catch { return reply.code(409).send({ error: 'Não foi possível criar a tag' }); }
  });

  app.post('/api/contacts/:id/tags', { preHandler: requireUser }, async (request, reply) => {
    const id = String((request.params as any).id || '');
    const parsed = z.object({ tagId: z.string().uuid().optional(), name: z.string().trim().min(1).max(80).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).refine((value) => value.tagId || value.name).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Tag inválida' });
    const contact = await db.query('SELECT id FROM contacts WHERE company_id = $1 AND id = $2', [request.user!.companyId, id]);
    if (!contact.rows[0]) return reply.code(404).send({ error: 'Contato não encontrado' });
    let tagId = parsed.data.tagId;
    if (!tagId) {
      const tag = await db.query('INSERT INTO contact_tags (company_id, name, color) VALUES ($1, $2, $3) ON CONFLICT (company_id, lower(name)) DO UPDATE SET color = contact_tags.color RETURNING id', [request.user!.companyId, parsed.data.name, parsed.data.color || '#EABB19']);
      tagId = tag.rows[0]?.id;
    }
    const ownedTag = await db.query('SELECT id FROM contact_tags WHERE company_id = $1 AND id = $2', [request.user!.companyId, tagId]);
    if (!ownedTag.rows[0]) return reply.code(404).send({ error: 'Tag não encontrada nesta empresa' });
    await db.query('INSERT INTO contact_tag_links (company_id, contact_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [request.user!.companyId, id, tagId]);
    return { added: true, tagId };
  });

  app.delete('/api/contacts/:id/tags/:tagId', { preHandler: requireUser }, async (request) => {
    const id = String((request.params as any).id || '');
    const tagId = String((request.params as any).tagId || '');
    await db.query('DELETE FROM contact_tag_links WHERE company_id = $1 AND contact_id = $2 AND tag_id = $3', [request.user!.companyId, id, tagId]);
    return { removed: true };
  });

  app.get('/api/contacts/duplicates', { preHandler: requireUser }, async (request) => {
    const companyId = request.user!.companyId;
    const rows = await db.query(
      `SELECT c.*, MAX(CASE WHEN cv.is_group = false THEN cv.last_message_at END) AS last_interaction,
              MIN(CASE WHEN cv.is_group = false THEN cv.created_at END) AS first_interaction,
              count(DISTINCT CASE WHEN cv.is_group = false THEN cv.id END)::int AS conversation_count,
              EXISTS (SELECT 1 FROM contact_channel_identities ci WHERE ci.company_id = c.company_id AND ci.contact_id = c.id AND ci.channel = 'whatsapp') AS whatsapp_linked
       FROM contacts c LEFT JOIN conversations cv ON cv.contact_id = c.id
       WHERE c.company_id = $1
         AND c.merged_into_contact_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM conversations cg WHERE cg.contact_id = c.id AND cg.is_group = true)
       GROUP BY c.id`, [companyId],
    );
    const ids = rows.rows.map((row) => row.id);
    const channels = await loadPhonesAndEmails(companyId, ids);
    const tags = await loadTags(companyId, ids);
    const phoneRows = await db.query<{ contact_id: string; phone: string }>(
      `SELECT contact_id, phone FROM contact_phones WHERE company_id = $1 AND contact_id = ANY($2::uuid[])`, [companyId, ids],
    );
    const emailRows = await db.query<{ contact_id: string; email: string; normalized_email: string }>(
      `SELECT contact_id, email, normalized_email FROM contact_emails WHERE company_id = $1 AND contact_id = ANY($2::uuid[])`, [companyId, ids],
    );
    const decisions = await db.query<{ contact_a_id: string; contact_b_id: string; decision: 'different' | 'merged' }>(
      `SELECT contact_a_id, contact_b_id, decision
       FROM contact_duplicate_decisions
       WHERE company_id = $1 AND contact_a_id = ANY($2::uuid[]) AND contact_b_id = ANY($2::uuid[])`, [companyId, ids],
    );
    const contacts = enrichRows(rows.rows, tags, channels).map((contact) => ({ ...contact, first_interaction: contact.first_interaction || null }));
    const sources = [
      ...phoneRows.rows.map((row) => ({ contactId: row.contact_id, kind: 'phone' as const, key: canonicalPhone(row.phone, { defaultCountry: 'BR' }) || normalizeContactPhone(row.phone), value: row.phone })),
      ...rows.rows.map((row) => ({ contactId: row.id, kind: 'phone' as const, key: canonicalPhone(row.phone, { defaultCountry: 'BR' }) || normalizeContactPhone(row.phone), value: row.phone })),
      ...emailRows.rows.map((row) => ({ contactId: row.contact_id, kind: 'email' as const, key: row.normalized_email || normalizeContactEmail(row.email), value: row.email })),
    ].filter((source) => Boolean(source.key));
    const groups = buildDuplicateGroups(contacts, sources, decisions.rows.map((row) => ({ contactAId: row.contact_a_id, contactBId: row.contact_b_id, decision: row.decision })));
    const reason = queryString(request, 'reason');
    const filtered = reason && ['phone', 'email', 'multiple'].includes(reason) ? groups.filter((group) => group.kind === reason) : groups;
    return { duplicates: filtered, summary: { cases: filtered.length, contacts: new Set(filtered.flatMap((group) => group.contacts.map((contact) => contact.id))).size } };
  });

  app.post('/api/contacts/duplicate-decisions', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({ contactAId: z.string().uuid(), contactBId: z.string().uuid(), decision: z.enum(['different', 'merged']) }).safeParse(request.body);
    if (!parsed.success || parsed.data.contactAId === parsed.data.contactBId) return reply.code(400).send({ error: 'Decisão inválida' });
    const [a, b] = orderedContactPair(parsed.data.contactAId, parsed.data.contactBId);
    await db.query('INSERT INTO contact_duplicate_decisions (company_id, contact_a_id, contact_b_id, decision, decided_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (company_id, contact_a_id, contact_b_id) DO UPDATE SET decision = EXCLUDED.decision, decided_by = EXCLUDED.decided_by, decided_at = now()', [request.user!.companyId, a, b, parsed.data.decision, request.user!.id]);
    return { saved: true };
  });

  app.post('/api/contacts/merge', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({ sourceContactId: z.string().uuid(), targetContactId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success || parsed.data.sourceContactId === parsed.data.targetContactId) return reply.code(400).send({ error: 'Contatos inválidos' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const merge = await mergeContactsInTransaction(client, {
        companyId: request.user!.companyId,
        sourceContactId: parsed.data.sourceContactId,
        targetContactId: parsed.data.targetContactId,
        performedBy: request.user!.id,
      });
      if (!merge) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Contatos não encontrados ou já mesclados' }); }
      await client.query('COMMIT');
      await writeAudit(request.user!.companyId, merge.target.id as string, request.user!.id, 'contact.merged', { sourceId: merge.source.id }, { targetId: merge.target.id, mergeId: merge.mergeId });
      return { merged: true, mergeId: merge.mergeId };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  app.post('/api/contacts/unmerge', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({ mergeId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Merge inválido' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const merge = await client.query('SELECT * FROM contact_merge_operations WHERE company_id = $1 AND id = $2 AND status = \'merged\' FOR UPDATE', [request.user!.companyId, parsed.data.mergeId]);
      const operation = merge.rows[0];
      if (!operation) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Merge não encontrado' }); }
      const snapshot = operation.field_snapshot || {};
      const target = await client.query('SELECT version FROM contacts WHERE company_id = $1 AND id = $2 FOR UPDATE', [request.user!.companyId, operation.target_contact_id]);
      if (target.rows[0]?.version !== snapshot.targetVersion + 1) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Unmerge bloqueado: o contato consolidado foi alterado após o merge.' }); }
      await client.query('UPDATE conversations cv SET contact_id = m.original_contact_id FROM contact_merge_conversations m WHERE m.merge_id = $1 AND m.conversation_id = cv.id', [operation.id]);
      await client.query('UPDATE contacts SET merged_into_contact_id = NULL, archived_at = NULL, archived_by = NULL, version = version + 1, updated_at = now() WHERE id = $1 AND company_id = $2', [operation.source_contact_id, request.user!.companyId]);
      await client.query('UPDATE contact_merge_operations SET status = \'unmerged\', unmerged_at = now(), unmerged_by = $1 WHERE id = $2', [request.user!.id, operation.id]);
      await client.query('COMMIT');
      await writeAudit(request.user!.companyId, operation.source_contact_id, request.user!.id, 'contact.unmerged', { mergeId: operation.id }, {});
      return { unmerged: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  app.post('/api/contacts/import', { preHandler: requireAdmin, bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const parsed = z.object({ csv: z.string().min(1).max(5_000_000), preview: z.boolean().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'CSV inválido' });
    const rows = parseContactCsv(parsed.data.csv);
    const preview = parsed.data.preview !== false;
    const job = await db.query('INSERT INTO contact_import_jobs (company_id, created_by, status, summary) VALUES ($1, $2, $3, $4::jsonb) RETURNING id', [request.user!.companyId, request.user!.id, preview ? 'review' : 'running', JSON.stringify({ total: rows.length })]);
    const jobId = job.rows[0]!.id;
    let created = 0; let updated = 0; let invalid = 0;
    for (const [index, row] of rows.entries()) {
      const name = row.name || row.nome || '';
      const phone = canonicalPhone(row.phone || row.telefone || row.celular || '', { defaultCountry: 'BR' }) || '';
      if (!name || !phone) { invalid += 1; await db.query('INSERT INTO contact_import_rows (job_id, row_number, raw_data, status, error) VALUES ($1, $2, $3::jsonb, \'invalid\', $4)', [jobId, index + 2, JSON.stringify(row), 'Nome ou telefone inválido']); continue; }
      if (preview) { await db.query('INSERT INTO contact_import_rows (job_id, row_number, raw_data, status) VALUES ($1, $2, $3::jsonb, \'pending\')', [jobId, index + 2, JSON.stringify(row)]); continue; }
      const result = await ensureContact(request.user!.companyId, { name, phone, email: row.email || row['e-mail'] || '', company: row.company || row.empresa || '', notes: row.notes || row.notas || '', source: 'csv/import' } as any, 'csv/import', true);
      const status = result.created ? 'created' : 'updated';
      if (result.created) created += 1; else updated += 1;
      await db.query('INSERT INTO contact_import_rows (job_id, row_number, raw_data, status, contact_id) VALUES ($1, $2, $3::jsonb, $4, $5)', [jobId, index + 2, JSON.stringify(row), status, result.id]);
    }
    const status = preview ? 'review' : invalid ? 'partial' : 'completed';
    await db.query('UPDATE contact_import_jobs SET status = $2, summary = $3::jsonb, updated_at = now() WHERE id = $1', [jobId, status, JSON.stringify({ total: rows.length, created, updated, invalid })]);
    return reply.code(201).send({ jobId, status, summary: { total: rows.length, created, updated, invalid } });
  });

  app.post('/api/contacts/import/:jobId/execute', { preHandler: requireAdmin }, async (request, reply) => {
    const jobId = String((request.params as any).jobId || '');
    const job = await db.query<{ id: string; status: string; summary: { total?: number; created?: number; updated?: number; invalid?: number } }>(
      `SELECT id, status, summary FROM contact_import_jobs
       WHERE id = $1 AND company_id = $2 AND status IN ('review', 'running', 'failed')`, [jobId, request.user!.companyId],
    );
    if (!job.rows[0]) {
      const completed = await db.query<{ status: string; summary: any }>('SELECT status, summary FROM contact_import_jobs WHERE id = $1 AND company_id = $2', [jobId, request.user!.companyId]);
      if (completed.rows[0]?.status === 'completed' || completed.rows[0]?.status === 'partial') return { jobId, status: completed.rows[0].status, summary: completed.rows[0].summary, replayed: true };
      return reply.code(404).send({ error: 'Importação não encontrada ou já processada' });
    }
    const rows = await db.query<{ id: string; row_number: number; raw_data: Record<string, string> }>('SELECT id, row_number, raw_data FROM contact_import_rows WHERE job_id = $1 AND status = \'pending\' ORDER BY row_number', [jobId]);
    let created = 0; let updated = 0; let invalid = 0;
    await db.query('UPDATE contact_import_jobs SET status = \'running\', updated_at = now() WHERE id = $1', [jobId]);
    try {
      for (const row of rows.rows) {
        const name = row.raw_data.name || row.raw_data.nome || '';
        const phone = canonicalPhone(row.raw_data.phone || row.raw_data.telefone || row.raw_data.celular || '', { defaultCountry: 'BR' }) || '';
        if (!name || !phone) { invalid += 1; await db.query('UPDATE contact_import_rows SET status = \'invalid\', error = $2 WHERE id = $1', [row.id, 'Nome ou telefone inválido']); continue; }
        const result = await ensureContact(request.user!.companyId, { name, phone, email: row.raw_data.email || row.raw_data['e-mail'] || '', company: row.raw_data.company || row.raw_data.empresa || '', notes: row.raw_data.notes || row.raw_data.notas || '', source: 'csv/import' } as any, 'csv/import', true);
        const status = result.created ? 'created' : 'updated'; if (result.created) created += 1; else updated += 1;
        await db.query('UPDATE contact_import_rows SET status = $2, contact_id = $3, error = NULL WHERE id = $1', [row.id, status, result.id]);
      }
    } catch (error) {
      await db.query('UPDATE contact_import_jobs SET status = \'failed\', updated_at = now() WHERE id = $1', [jobId]);
      throw error;
    }
    const status = invalid ? 'partial' : 'completed';
    await db.query('UPDATE contact_import_jobs SET status = $2, summary = $3::jsonb, updated_at = now() WHERE id = $1', [jobId, status, JSON.stringify({ total: rows.rows.length, created, updated, invalid })]);
    await writeAudit(request.user!.companyId, null, request.user!.id, 'contact.csv_import', {}, { jobId, created, updated, invalid });
    return { jobId, status, summary: { total: rows.rows.length, created, updated, invalid } };
  });

  app.get('/api/contacts/export', { preHandler: requireAdmin }, async (request, reply) => {
    const rows = await db.query(`SELECT c.id, c.name, c.phone, c.email, c.company, c.notes, c.archived_at, string_agg(DISTINCT p.phone, ';') AS phones, string_agg(DISTINCT e.email, ';') AS emails FROM contacts c LEFT JOIN contact_phones p ON p.contact_id = c.id LEFT JOIN contact_emails e ON e.contact_id = c.id WHERE c.company_id = $1 GROUP BY c.id ORDER BY lower(c.name)`, [request.user!.companyId]);
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = ['id,name,phone,email,company,notes,archived,phones,emails', ...rows.rows.map((row) => [row.id, row.name, row.phone, row.email, row.company, row.notes, Boolean(row.archived_at), row.phones, row.emails].map(escape).join(','))].join('\n');
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="vitstock-contatos.csv"').send(csv);
  });

  app.get('/api/contacts/:id/audit', { preHandler: requireAdmin }, async (request, reply) => {
    const id = String((request.params as any).id || '');
    const result = await db.query('SELECT id, action, before_data, after_data, actor_user_id, created_at FROM contact_audit_logs WHERE company_id = $1 AND contact_id = $2 ORDER BY created_at DESC', [request.user!.companyId, id]);
    if (!result.rows.length) {
      const exists = await db.query('SELECT id FROM contacts WHERE company_id = $1 AND id = $2', [request.user!.companyId, id]);
      if (!exists.rows[0]) return reply.code(404).send({ error: 'Contato não encontrado' });
    }
    return { audit: result.rows };
  });
}
