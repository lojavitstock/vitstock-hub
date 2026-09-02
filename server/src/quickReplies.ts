import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import { requireUser } from './auth.js';

const shortcutSchema = z.string().trim().regex(/^\/[a-z0-9][a-z0-9_-]*$/i, 'Atalho inválido').transform((value) => value.toLocaleLowerCase());
const quickReplyInputSchema = z.object({
  shortcut: shortcutSchema,
  title: z.string().trim().min(1).max(120),
  body: z.string().min(1).max(10_000),
  scope: z.enum(['COMPANY', 'USER']).default('COMPANY'),
  position: z.number().int().min(0).max(100_000).default(0),
});
const quickReplyPatchSchema = quickReplyInputSchema.partial();

type QuickReplyRow = {
  id: string;
  company_id: string;
  user_id: string | null;
  scope: 'COMPANY' | 'USER';
  shortcut: string;
  title: string;
  body: string;
  position: number;
  usage_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const normalizeQuickReplyShortcut = (value: string) => value.trim().toLocaleLowerCase();

const toPublicQuickReply = (row: QuickReplyRow) => ({
  id: row.id,
  companyId: row.company_id,
  ...(row.user_id ? { userId: row.user_id } : {}),
  scope: row.scope,
  shortcut: row.shortcut,
  title: row.title,
  body: row.body,
  position: Number(row.position || 0),
  usageCount: Number(row.usage_count || 0),
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const quickReplyId = (request: { params: unknown }) => String((request.params as { id?: string }).id || '');

const loadQuickReply = async (companyId: string, userId: string, id: string) => {
  const result = await db.query<QuickReplyRow>(
    `SELECT id, company_id, user_id, scope, shortcut, title, body, position, usage_count, is_active, created_at, updated_at
     FROM quick_replies
     WHERE company_id = $1 AND id = $2 AND is_active = true
       AND (scope = 'COMPANY' OR user_id = $3)
     LIMIT 1`,
    [companyId, id, userId],
  );
  return result.rows[0] || null;
};

export async function registerQuickReplyRoutes(app: FastifyInstance) {
  app.get('/api/quick-replies', { preHandler: requireUser }, async (request) => {
    const result = await db.query<QuickReplyRow>(
      `SELECT id, company_id, user_id, scope, shortcut, title, body, position, usage_count, is_active, created_at, updated_at
       FROM quick_replies
       WHERE company_id = $1 AND is_active = true AND (scope = 'COMPANY' OR user_id = $2)
       ORDER BY usage_count DESC, position ASC, lower(title), id`,
      [request.user!.companyId, request.user!.id],
    );
    return { quickReplies: result.rows.map(toPublicQuickReply) };
  });

  app.post('/api/quick-replies', { preHandler: requireUser }, async (request, reply) => {
    const parsed = quickReplyInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Informe um atalho, título e mensagem válidos.' });
    const currentUser = request.user!;
    if (parsed.data.scope === 'COMPANY' && currentUser.role !== 'admin') {
      return reply.code(403).send({ error: 'Apenas administradores podem criar mensagens da empresa.' });
    }
    const userId = parsed.data.scope === 'USER' ? currentUser.id : null;
    try {
      const result = await db.query<QuickReplyRow>(
        `INSERT INTO quick_replies (company_id, user_id, scope, shortcut, title, body, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, company_id, user_id, scope, shortcut, title, body, position, usage_count, is_active, created_at, updated_at`,
        [currentUser.companyId, userId, parsed.data.scope, parsed.data.shortcut, parsed.data.title, parsed.data.body, parsed.data.position],
      );
      return reply.code(201).send({ quickReply: toPublicQuickReply(result.rows[0]!) });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Já existe um atalho com esse nome nesta empresa.' });
      throw error;
    }
  });

  app.patch('/api/quick-replies/:id', { preHandler: requireUser }, async (request, reply) => {
    const parsed = quickReplyPatchSchema.safeParse(request.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) return reply.code(400).send({ error: 'Informe uma alteração válida.' });
    const currentUser = request.user!;
    const existing = await loadQuickReply(currentUser.companyId, currentUser.id, quickReplyId(request));
    if (!existing) return reply.code(404).send({ error: 'Mensagem rápida não encontrada.' });
    if ((existing.scope === 'COMPANY' || parsed.data.scope === 'COMPANY') && currentUser.role !== 'admin') {
      return reply.code(403).send({ error: 'Apenas administradores podem editar mensagens da empresa.' });
    }
    const scope = parsed.data.scope || existing.scope;
    const userId = scope === 'USER' ? (existing.scope === 'USER' ? existing.user_id : currentUser.id) : null;
    try {
      const result = await db.query<QuickReplyRow>(
        `UPDATE quick_replies
         SET user_id = $3, scope = $4, shortcut = $5, title = $6, body = $7, position = $8, updated_at = now()
         WHERE company_id = $1 AND id = $2 AND is_active = true
         RETURNING id, company_id, user_id, scope, shortcut, title, body, position, usage_count, is_active, created_at, updated_at`,
        [currentUser.companyId, existing.id, userId, scope, parsed.data.shortcut || existing.shortcut, parsed.data.title || existing.title, parsed.data.body || existing.body, parsed.data.position ?? existing.position],
      );
      if (!result.rows[0]) return reply.code(404).send({ error: 'Mensagem rápida não encontrada.' });
      return { quickReply: toPublicQuickReply(result.rows[0]) };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Já existe um atalho com esse nome nesta empresa.' });
      throw error;
    }
  });

  app.delete('/api/quick-replies/:id', { preHandler: requireUser }, async (request, reply) => {
    const currentUser = request.user!;
    const existing = await loadQuickReply(currentUser.companyId, currentUser.id, quickReplyId(request));
    if (!existing) return reply.code(404).send({ error: 'Mensagem rápida não encontrada.' });
    if (existing.scope === 'COMPANY' && currentUser.role !== 'admin') return reply.code(403).send({ error: 'Apenas administradores podem excluir mensagens da empresa.' });
    await db.query('UPDATE quick_replies SET is_active = false, updated_at = now() WHERE company_id = $1 AND id = $2', [currentUser.companyId, existing.id]);
    return { removed: true, id: existing.id };
  });

  app.post('/api/quick-replies/:id/use', { preHandler: requireUser }, async (request, reply) => {
    const currentUser = request.user!;
    const result = await db.query<QuickReplyRow>(
      `UPDATE quick_replies
       SET usage_count = usage_count + 1, updated_at = now()
       WHERE company_id = $1 AND id = $2 AND is_active = true
         AND (scope = 'COMPANY' OR user_id = $3)
       RETURNING id, company_id, user_id, scope, shortcut, title, body, position, usage_count, is_active, created_at, updated_at`,
      [currentUser.companyId, quickReplyId(request), currentUser.id],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Mensagem rápida não encontrada.' });
    return { quickReply: toPublicQuickReply(result.rows[0]) };
  });
}
