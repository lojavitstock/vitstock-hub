import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { requireUser } from './auth.js';
import { db } from './db.js';

const jidSchema = z.object({ remoteJid: z.string().min(3).max(128) });
const sendTextSchema = z.object({
  number: z.string().regex(/^\d{8,20}$/),
  text: z.string().min(1).max(4096),
});
const mediaSchema = z.object({ messageKey: z.record(z.string(), z.unknown()) });
const phoneSchema = z.object({ number: z.string().regex(/^\d{8,20}$/) });
const assignmentSchema = z.object({
  remoteJid: z.string().min(3).max(128),
  phone: z.string().max(32).optional(),
});
const conversationStatusSchema = z.object({
  remoteJid: z.string().min(3).max(128),
  status: z.enum(['open', 'pending', 'resolved']),
  phone: z.string().max(32).optional(),
});
const conversationReadSchema = z.object({
  remoteJid: z.string().min(3).max(128),
  messageTimestamp: z.coerce.number().int().nonnegative(),
  messageKey: z.object({
    id: z.string().min(1),
    remoteJid: z.string().min(3),
    fromMe: z.boolean().optional(),
  }).passthrough().optional(),
});

function matchesWebhookSecret(value: string | undefined) {
  if (!value) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(config.WEBHOOK_SECRET);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function evolutionRequest(path: string, init?: RequestInit) {
  return fetch(`${config.EVOLUTION_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.EVOLUTION_API_KEY,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
}

async function forwardJson(response: Response, reply: FastifyReply) {
  const body = await response.json().catch(() => ({ error: 'Resposta inválida da Evolution API' }));
  if (!response.ok) return reply.code(502).send({ error: 'Evolution API indisponível' });
  return body;
}

function assignmentJids(input: { remoteJid: string; phone?: string }) {
  const jids = [input.remoteJid];
  const digits = input.phone?.replace(/\D/g, '') || '';
  if (digits.length >= 8 && digits.length <= 20) jids.push(`${digits}@s.whatsapp.net`);
  return [...new Set(jids)];
}

export async function registerEvolutionRoutes(app: FastifyInstance) {
  app.get('/api/evolution/status', { preHandler: requireUser }, async (_request, reply) => {
    const response = await evolutionRequest(
      `/instance/connectionState/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
    );
    return forwardJson(response, reply);
  });

  app.get('/api/evolution/connect', { preHandler: requireUser }, async (_request, reply) => {
    const response = await evolutionRequest(
      `/instance/connect/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
    );
    return forwardJson(response, reply);
  });

  app.get('/api/evolution/chats', { preHandler: requireUser }, async (_request, reply) => {
    const instance = encodeURIComponent(config.EVOLUTION_INSTANCE_NAME);
    const [chatsResponse, contactsResponse] = await Promise.all([
      evolutionRequest(`/chat/findChats/${instance}`, { method: 'POST', body: '{}' }),
      evolutionRequest(`/chat/findContacts/${instance}`, { method: 'POST', body: '{}' }),
    ]);
    if (!chatsResponse.ok || !contactsResponse.ok) {
      return reply.code(502).send({ error: 'Não foi possível consultar as conversas' });
    }
    const [storedContacts, assignments, statuses, readStates] = await Promise.all([db.query<{
      name: string;
      phone: string;
      source: string;
    }>(
      `SELECT name, phone, source
       FROM contacts
       WHERE company_id = $1
       ORDER BY CASE source WHEN 'google' THEN 0 WHEN 'hub' THEN 1 ELSE 2 END`,
      [_request.user!.companyId],
    ), db.query<{
      evolution_remote_jid: string;
      user_id: string;
      user_name: string;
    }>(
      `SELECT a.evolution_remote_jid, u.id AS user_id, u.name AS user_name
       FROM conversation_assignments a
       JOIN users u ON u.id = a.assigned_user_id
       WHERE a.company_id = $1`,
      [_request.user!.companyId],
    ), db.query<{
      evolution_remote_jid: string;
      status: 'open' | 'pending' | 'resolved';
      updated_at: string;
    }>(
      `SELECT evolution_remote_jid, status, updated_at
       FROM conversation_statuses
       WHERE company_id = $1`,
      [_request.user!.companyId],
    ), db.query<{
      evolution_remote_jid: string;
      last_read_message_timestamp: string;
    }>(
      `SELECT evolution_remote_jid, last_read_message_timestamp
       FROM conversation_read_states
       WHERE company_id = $1`,
      [_request.user!.companyId],
    )]);
    return {
      chats: await chatsResponse.json(),
      contacts: await contactsResponse.json(),
      storedContacts: storedContacts.rows,
      assignments: assignments.rows,
      statuses: statuses.rows,
      readStates: readStates.rows,
    };
  });

  app.post('/api/evolution/chats/capture', { preHandler: requireUser }, async (request, reply) => {
    const parsed = assignmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Conversa inválida' });
    const currentUser = request.user!;
    const jids = assignmentJids(parsed.data);
    const existing = await db.query<{ assigned_user_id: string | null; user_name: string | null }>(
      `SELECT a.assigned_user_id, u.name AS user_name
       FROM conversation_assignments a
       LEFT JOIN users u ON u.id = a.assigned_user_id
       WHERE a.company_id = $1 AND a.evolution_remote_jid = ANY($2::text[])
       ORDER BY a.updated_at DESC
       LIMIT 1`,
      [currentUser.companyId, jids],
    );
    const currentAssignment = existing.rows[0];
    if (currentAssignment?.assigned_user_id && currentAssignment.assigned_user_id !== currentUser.id && currentUser.role !== 'admin') {
      return reply.code(409).send({ error: `Atendimento capturado por ${currentAssignment.user_name || 'outro atendente'}` });
    }
    for (const jid of jids) {
      await db.query(
        `INSERT INTO conversation_assignments (company_id, evolution_remote_jid, assigned_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, evolution_remote_jid) DO UPDATE SET
           assigned_user_id = EXCLUDED.assigned_user_id,
           updated_at = now()`,
        [currentUser.companyId, jid, currentUser.id],
      );
    }
    return { remoteJid: parsed.data.remoteJid, user: { id: currentUser.id, name: currentUser.name } };
  });

  app.post('/api/evolution/chats/release', { preHandler: requireUser }, async (request, reply) => {
    const parsed = assignmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Conversa inválida' });
    const currentUser = request.user!;
    const jids = assignmentJids(parsed.data);
    const existing = await db.query<{ assigned_user_id: string | null }>(
      'SELECT assigned_user_id FROM conversation_assignments WHERE company_id = $1 AND evolution_remote_jid = ANY($2::text[]) ORDER BY updated_at DESC LIMIT 1',
      [currentUser.companyId, jids],
    );
    if (existing.rows[0]?.assigned_user_id && existing.rows[0].assigned_user_id !== currentUser.id && currentUser.role !== 'admin') {
      return reply.code(403).send({ error: 'Somente o responsável pode liberar este atendimento' });
    }
    await db.query(
      'DELETE FROM conversation_assignments WHERE company_id = $1 AND evolution_remote_jid = ANY($2::text[])',
      [currentUser.companyId, jids],
    );
    return { released: true, remoteJid: parsed.data.remoteJid };
  });

  app.patch('/api/evolution/chats/status', { preHandler: requireUser }, async (request, reply) => {
    const parsed = conversationStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Status de conversa invÃ¡lido' });

    for (const jid of assignmentJids(parsed.data)) {
      await db.query(
        `INSERT INTO conversation_statuses (company_id, evolution_remote_jid, status, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, evolution_remote_jid) DO UPDATE SET
           status = EXCLUDED.status,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [request.user!.companyId, jid, parsed.data.status, request.user!.id],
      );
    }

    return { remoteJid: parsed.data.remoteJid, status: parsed.data.status };
  });

  app.post('/api/evolution/chats/read', { preHandler: requireUser }, async (request, reply) => {
    const parsed = conversationReadSchema.safeParse(request.body);
    let providerMarked = false;
    if (parsed.success && parsed.data.messageKey && !parsed.data.messageKey.fromMe) {
      try {
        const response = await evolutionRequest(
          `/chat/markMessageAsRead/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
          {
            method: 'POST',
            body: JSON.stringify({ readMessages: [parsed.data.messageKey] }),
          },
        );
        providerMarked = response.ok;
      } catch (error) {
        request.log.warn({ err: error }, 'Evolution nÃ£o confirmou a leitura; mantendo o estado local');
      }
    }
    if (!parsed.success) return reply.code(400).send({ error: 'Leitura de conversa invÃ¡lida' });

    await db.query(
      `INSERT INTO conversation_read_states
        (company_id, evolution_remote_jid, last_read_message_timestamp, last_read_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, evolution_remote_jid) DO UPDATE SET
         last_read_message_timestamp = GREATEST(
           conversation_read_states.last_read_message_timestamp,
           EXCLUDED.last_read_message_timestamp
         ),
         last_read_by = EXCLUDED.last_read_by,
         updated_at = now()`,
      [request.user!.companyId, parsed.data.remoteJid, parsed.data.messageTimestamp, request.user!.id],
    );

    return { remoteJid: parsed.data.remoteJid, messageTimestamp: parsed.data.messageTimestamp, providerMarked };
  });

  app.post('/api/evolution/messages', { preHandler: requireUser }, async (request, reply) => {
    const parsed = jidSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Conversa inválida' });
    const response = await evolutionRequest(
      `/chat/findMessages/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      {
        method: 'POST',
        body: JSON.stringify({ where: { key: { remoteJid: parsed.data.remoteJid } }, limit: 100 }),
      },
    );
    return forwardJson(response, reply);
  });

  app.post('/api/evolution/messages/send', { preHandler: requireUser }, async (request, reply) => {
    const parsed = sendTextSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mensagem inválida' });
    const response = await evolutionRequest(
      `/message/sendText/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      {
        method: 'POST',
        body: JSON.stringify({ ...parsed.data, delay: 1200, linkPreview: true }),
      },
    );
    return forwardJson(response, reply);
  });

  app.post('/api/evolution/media', { preHandler: requireUser }, async (request, reply) => {
    const parsed = mediaSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mensagem de mídia inválida' });
    const response = await evolutionRequest(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      { method: 'POST', body: JSON.stringify({ message: { key: parsed.data.messageKey }, convertToMp4: false }) },
    );
    return forwardJson(response, reply);
  });

  app.post('/api/evolution/business-profile', { preHandler: requireUser }, async (request, reply) => {
    const parsed = phoneSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Número inválido' });
    const response = await evolutionRequest(
      `/chat/fetchBusinessProfile/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      { method: 'POST', body: JSON.stringify(parsed.data) },
    );
    if (!response.ok) return reply.code(404).send({ error: 'Perfil empresarial não disponível' });
    return forwardJson(response, reply);
  });

  app.post('/webhooks/evolution', async (request, reply) => {
    const providedSecret = request.headers['x-webhook-secret'];
    const value = Array.isArray(providedSecret) ? providedSecret[0] : providedSecret;
    if (!matchesWebhookSecret(value)) return reply.code(401).send({ error: 'Webhook não autorizado' });

    request.log.info({ event: (request.body as { event?: string } | null)?.event }, 'Evento Evolution recebido');
    return reply.code(202).send({ accepted: true });
  });
}
