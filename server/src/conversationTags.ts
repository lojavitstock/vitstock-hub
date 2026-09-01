import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import { requireUser } from './auth.js';
import { publishRealtimeEvent } from './realtime.js';
import { resolveConversationForOperation } from './conversationResolver.js';

const TAG_COLORS = ['#EABB19', '#3B82F6', '#10B981', '#F97316', '#A78BFA', '#EC4899', '#14B8A6', '#64748B', '#EF4444', '#84CC16'] as const;
const colorSchema = z.enum(TAG_COLORS);
const createTagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: colorSchema.default('#EABB19'),
});
const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: colorSchema.optional(),
}).refine((value) => value.name !== undefined || value.color !== undefined);
const tagLinkSchema = z.object({ tagId: z.string().uuid() });

export const normalizeTagName = (value: string) => value.trim().toLocaleLowerCase();

type ConversationTagRow = {
  id: string;
  name: string;
  color: string;
  system_key: string | null;
  usage_count: number;
};

const toPublicTag = (tag: ConversationTagRow) => ({
  id: tag.id,
  name: tag.name,
  color: tag.color,
  ...(tag.system_key ? { systemKey: tag.system_key } : {}),
  usageCount: Number(tag.usage_count || 0),
});

async function loadTagByIdWithUsage(companyId: string, tagId: string) {
  const result = await db.query<ConversationTagRow>(
    `SELECT t.id, t.name, t.color, t.system_key,
            COUNT(l.conversation_id)::int AS usage_count
     FROM conversation_tags t
     LEFT JOIN conversation_tag_links l
       ON l.tag_id = t.id AND l.company_id = t.company_id
     WHERE t.company_id = $1 AND t.id = $2
     GROUP BY t.id, t.name, t.color, t.system_key
     LIMIT 1`,
    [companyId, tagId],
  );
  return result.rows[0] || null;
}

async function ensureTrafficTag(companyId: string) {
  const existing = await db.query<{ id: string }>(
    `SELECT id, name, color, system_key
     FROM conversation_tags
     WHERE company_id = $1 AND system_key = 'traffic'
     LIMIT 1`,
    [companyId],
  );
  if (!existing.rows[0]) {
    await db.query(
      `INSERT INTO conversation_tags (company_id, name, color, system_key)
       VALUES ($1, 'Tráfego', '#F97316', 'traffic')
       ON CONFLICT DO NOTHING`,
      [companyId],
    );
  }
  const result = await db.query<ConversationTagRow>(
    `SELECT t.id, t.name, t.color, t.system_key,
            COUNT(l.conversation_id)::int AS usage_count
     FROM conversation_tags t
     LEFT JOIN conversation_tag_links l
       ON l.tag_id = t.id AND l.company_id = t.company_id
     WHERE t.company_id = $1
     GROUP BY t.id, t.name, t.color, t.system_key
     ORDER BY t.system_key DESC NULLS LAST, lower(t.name)`,
    [companyId],
  );
  return result.rows;
}

export async function loadConversationTags(companyId: string) {
  try {
    const result = await db.query<{
      evolution_remote_jid: string;
      identity: string | null;
      aliases: string[] | null;
      id: string;
      name: string;
      color: string;
      system_key: string | null;
    }>(
      `SELECT c.evolution_remote_jid, ci.identity, ci.aliases, t.id, t.name, t.color, t.system_key
       FROM conversation_tag_links l
       JOIN conversations c ON c.id = l.conversation_id AND c.company_id = l.company_id
       LEFT JOIN contact_channel_identities ci
         ON ci.company_id = c.company_id AND ci.contact_id = c.contact_id AND ci.channel = 'whatsapp'
       JOIN conversation_tags t ON t.id = l.tag_id AND t.company_id = l.company_id
       WHERE l.company_id = $1
       ORDER BY c.evolution_remote_jid, t.system_key DESC NULLS LAST, lower(t.name)`,
      [companyId],
    );
    const tags = new Map<string, Array<{ id: string; name: string; color: string; systemKey?: string }>>();
    for (const row of result.rows) {
      const keys = [row.evolution_remote_jid, row.identity, ...(row.aliases || [])].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      keys.forEach((key) => {
        const list = tags.get(key) || [];
        if (!list.some((tag) => tag.id === row.id)) {
          list.push({ id: row.id, name: row.name, color: row.color, ...(row.system_key ? { systemKey: row.system_key } : {}) });
        }
        tags.set(key, list);
      });
    }
    return tags;
  } catch {
    // The API remains usable during a rolling deploy before migration 018.
    return new Map<string, Array<{ id: string; name: string; color: string; systemKey?: string }>>();
  }
}

export async function registerConversationTagRoutes(app: FastifyInstance) {
  app.get('/api/conversation-tags', { preHandler: requireUser }, async (request) => {
    const tags = await ensureTrafficTag(request.user!.companyId);
    return {
      tags: tags.map(toPublicTag),
      colors: TAG_COLORS,
    };
  });

  app.post('/api/conversation-tags', { preHandler: requireUser }, async (request, reply) => {
    const parsed = createTagSchema.safeParse(request.body);
    if (!parsed.success || ['traffic', 'tráfego'].includes(normalizeTagName(parsed.data?.name || ''))) {
      return reply.code(400).send({ error: 'Nome ou cor de tag inválido' });
    }
    try {
      const result = await db.query<{ id: string; name: string; color: string; system_key: string | null }>(
        `INSERT INTO conversation_tags (company_id, name, color)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, lower(trim(name))) DO UPDATE SET color = conversation_tags.color
         RETURNING id, name, color, system_key`,
        [request.user!.companyId, parsed.data.name, parsed.data.color],
      );
      const inserted = result.rows[0];
      if (!inserted) return reply.code(500).send({ error: 'Não foi possível criar a tag' });
      const tag = await loadTagByIdWithUsage(request.user!.companyId, inserted.id);
      return reply.code(201).send({ tag: tag ? toPublicTag(tag) : undefined });
    } catch {
      return reply.code(409).send({ error: 'Não foi possível criar a tag' });
    }
  });

  app.patch('/api/conversation-tags/:tagId', { preHandler: requireUser }, async (request, reply) => {
    const tagId = String((request.params as { tagId?: string }).tagId || '');
    const parsed = updateTagSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Nome ou cor de tag inválido' });
    const companyId = request.user!.companyId;
    const existing = await loadTagByIdWithUsage(companyId, tagId);
    if (!existing) return reply.code(404).send({ error: 'Tag não encontrada nesta empresa' });
    if (existing.system_key === 'traffic' && parsed.data.name !== undefined && normalizeTagName(parsed.data.name) !== normalizeTagName(existing.name)) {
      return reply.code(400).send({ error: 'A tag Tráfego não pode ser renomeada' });
    }
    if (!existing.system_key && parsed.data.name !== undefined && ['traffic', 'tráfego'].includes(normalizeTagName(parsed.data.name))) {
      return reply.code(400).send({ error: 'Nome ou cor de tag inválido' });
    }
    try {
      const updated = await db.query<{ id: string; name: string; color: string; system_key: string | null }>(
        `UPDATE conversation_tags
         SET name = $3, color = $4, updated_at = now()
         WHERE company_id = $1 AND id = $2
         RETURNING id, name, color, system_key`,
        [companyId, tagId, parsed.data.name ?? existing.name, parsed.data.color ?? existing.color],
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) return reply.code(404).send({ error: 'Tag não encontrada nesta empresa' });
      const tag = await loadTagByIdWithUsage(companyId, updatedRow.id);
      return { tag: tag ? toPublicTag(tag) : undefined };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Já existe uma tag com esse nome' });
      throw error;
    }
  });

  app.delete('/api/conversation-tags/:tagId', { preHandler: requireUser }, async (request, reply) => {
    const tagId = String((request.params as { tagId?: string }).tagId || '');
    const companyId = request.user!.companyId;
    const existing = await loadTagByIdWithUsage(companyId, tagId);
    if (!existing) return reply.code(404).send({ error: 'Tag não encontrada nesta empresa' });
    if (existing.system_key === 'traffic') return reply.code(409).send({ error: 'A tag Tráfego não pode ser excluída' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM conversation_tag_links WHERE company_id = $1 AND tag_id = $2`,
        [companyId, tagId],
      );
      await client.query(
        `DELETE FROM conversation_tags WHERE company_id = $1 AND id = $2`,
        [companyId, tagId],
      );
      await client.query('COMMIT');
      return { removed: true, tagId, usageCount: Number(existing.usage_count || 0) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/evolution/chats/:remoteJid/tags', { preHandler: requireUser }, async (request, reply) => {
    const parsed = tagLinkSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Tag inválida' });
    const remoteJid = decodeURIComponent(String((request.params as { remoteJid?: string }).remoteJid || ''));
    const companyId = request.user!.companyId;
    const conversation = await resolveConversationForOperation({ companyId, remoteJid });
    if (!conversation) return reply.code(404).send({ error: 'Conversa não encontrada' });
    const tag = await db.query<{ id: string; name: string; color: string; system_key: string | null }>(
      `SELECT id, name, color, system_key FROM conversation_tags WHERE company_id = $1 AND id = $2 LIMIT 1`,
      [companyId, parsed.data.tagId],
    );
    if (!tag.rows[0]) return reply.code(404).send({ error: 'Tag não encontrada nesta empresa' });
    await db.query(
      `INSERT INTO conversation_tag_links (company_id, conversation_id, tag_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [companyId, conversation.id, parsed.data.tagId],
    );
    const conversationTags = await loadConversationTags(companyId);
    const tags = conversationTags.get(remoteJid) || conversationTags.get(conversation.remoteJid) || [];
    publishRealtimeEvent(companyId, 'conversation.updated', { remoteJid, conversationTags: tags });
    return { added: true, tagId: parsed.data.tagId, tags };
  });

  app.delete('/api/evolution/chats/:remoteJid/tags/:tagId', { preHandler: requireUser }, async (request) => {
    const remoteJid = decodeURIComponent(String((request.params as { remoteJid?: string }).remoteJid || ''));
    const tagId = String((request.params as { tagId?: string }).tagId || '');
    const companyId = request.user!.companyId;
    const conversation = await resolveConversationForOperation({ companyId, remoteJid }, { createIfMissing: false });
    if (!conversation) return { removed: true, tagId, tags: [] };
    await db.query(
      `DELETE FROM conversation_tag_links
       WHERE company_id = $1 AND conversation_id = $2 AND tag_id = $3`,
      [companyId, conversation.id, tagId],
    );
    const conversationTags = await loadConversationTags(companyId);
    const tags = conversationTags.get(remoteJid) || conversationTags.get(conversation.remoteJid) || [];
    publishRealtimeEvent(companyId, 'conversation.updated', { remoteJid, conversationTags: tags });
    return { removed: true, tagId, tags };
  });
}
