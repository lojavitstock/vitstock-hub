import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import { requireUser } from './auth.js';
import { publishRealtimeEvent } from './realtime.js';

const TAG_COLORS = ['#EABB19', '#3B82F6', '#10B981', '#F97316', '#A78BFA', '#EC4899', '#14B8A6', '#64748B', '#EF4444', '#84CC16'] as const;
const colorSchema = z.enum(TAG_COLORS);
const createTagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: colorSchema.default('#EABB19'),
});
const tagLinkSchema = z.object({ tagId: z.string().uuid() });

const normalizeTagName = (value: string) => value.trim().toLocaleLowerCase();

async function ensureTrafficTag(companyId: string) {
  const existing = await db.query<{ id: string; name: string; color: string; system_key: string | null }>(
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
  const result = await db.query<{ id: string; name: string; color: string; system_key: string | null }>(
    `SELECT id, name, color, system_key
     FROM conversation_tags
     WHERE company_id = $1
     ORDER BY system_key DESC NULLS LAST, lower(name)`,
    [companyId],
  );
  return result.rows;
}

export async function loadConversationTags(companyId: string) {
  try {
    const result = await db.query<{
      evolution_remote_jid: string;
      id: string;
      name: string;
      color: string;
      system_key: string | null;
    }>(
      `SELECT c.evolution_remote_jid, t.id, t.name, t.color, t.system_key
       FROM conversation_tag_links l
       JOIN conversations c ON c.id = l.conversation_id AND c.company_id = l.company_id
       JOIN conversation_tags t ON t.id = l.tag_id AND t.company_id = l.company_id
       WHERE l.company_id = $1
       ORDER BY c.evolution_remote_jid, t.system_key DESC NULLS LAST, lower(t.name)`,
      [companyId],
    );
    const tags = new Map<string, Array<{ id: string; name: string; color: string; systemKey?: string }>>();
    for (const row of result.rows) {
      const key = row.evolution_remote_jid;
      const list = tags.get(key) || [];
      list.push({ id: row.id, name: row.name, color: row.color, ...(row.system_key ? { systemKey: row.system_key } : {}) });
      tags.set(key, list);
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
      tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color, ...(tag.system_key ? { systemKey: tag.system_key } : {}) })),
      colors: TAG_COLORS,
    };
  });

  app.post('/api/conversation-tags', { preHandler: requireUser }, async (request, reply) => {
    const parsed = createTagSchema.safeParse(request.body);
    if (!parsed.success || ['traffic', 'tráfego'].includes(normalizeTagName(parsed.data?.name || ''))) {
      return reply.code(400).send({ error: 'Nome ou cor de tag inválido' });
    }
    try {
      const result = await db.query<{ id: string; name: string; color: string }>(
        `INSERT INTO conversation_tags (company_id, name, color)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, lower(trim(name))) DO UPDATE SET color = conversation_tags.color
         RETURNING id, name, color`,
        [request.user!.companyId, parsed.data.name, parsed.data.color],
      );
      return reply.code(201).send({ tag: result.rows[0] });
    } catch {
      return reply.code(409).send({ error: 'Não foi possível criar a tag' });
    }
  });

  app.post('/api/evolution/chats/:remoteJid/tags', { preHandler: requireUser }, async (request, reply) => {
    const parsed = tagLinkSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Tag inválida' });
    const remoteJid = decodeURIComponent(String((request.params as { remoteJid?: string }).remoteJid || ''));
    const companyId = request.user!.companyId;
    const conversation = await db.query<{ id: string }>(
      `SELECT id FROM conversations WHERE company_id = $1 AND evolution_remote_jid = $2 LIMIT 1`,
      [companyId, remoteJid],
    );
    if (!conversation.rows[0]) return reply.code(404).send({ error: 'Conversa não encontrada' });
    const tag = await db.query<{ id: string; name: string; color: string; system_key: string | null }>(
      `SELECT id, name, color, system_key FROM conversation_tags WHERE company_id = $1 AND id = $2 LIMIT 1`,
      [companyId, parsed.data.tagId],
    );
    if (!tag.rows[0]) return reply.code(404).send({ error: 'Tag não encontrada nesta empresa' });
    await db.query(
      `INSERT INTO conversation_tag_links (company_id, conversation_id, tag_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [companyId, conversation.rows[0].id, parsed.data.tagId],
    );
    const conversationTags = await loadConversationTags(companyId);
    publishRealtimeEvent(companyId, 'conversation.updated', { remoteJid, conversationTags: conversationTags.get(remoteJid) || [] });
    return { added: true, tagId: parsed.data.tagId, tags: conversationTags.get(remoteJid) || [] };
  });

  app.delete('/api/evolution/chats/:remoteJid/tags/:tagId', { preHandler: requireUser }, async (request) => {
    const remoteJid = decodeURIComponent(String((request.params as { remoteJid?: string }).remoteJid || ''));
    const tagId = String((request.params as { tagId?: string }).tagId || '');
    const companyId = request.user!.companyId;
    await db.query(
      `DELETE FROM conversation_tag_links l USING conversations c
       WHERE l.company_id = $1 AND l.conversation_id = c.id AND c.company_id = $1
         AND c.evolution_remote_jid = $2 AND l.tag_id = $3`,
      [companyId, remoteJid, tagId],
    );
    const conversationTags = await loadConversationTags(companyId);
    publishRealtimeEvent(companyId, 'conversation.updated', { remoteJid, conversationTags: conversationTags.get(remoteJid) || [] });
    return { removed: true, tagId, tags: conversationTags.get(remoteJid) || [] };
  });
}
