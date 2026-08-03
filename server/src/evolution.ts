import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { requireUser } from './auth.js';

const jidSchema = z.object({ remoteJid: z.string().min(3).max(128) });
const sendTextSchema = z.object({
  number: z.string().regex(/^\d{8,20}$/),
  text: z.string().min(1).max(4096),
});
const mediaSchema = z.object({ messageKey: z.record(z.string(), z.unknown()) });

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
    return {
      chats: await chatsResponse.json(),
      contacts: await contactsResponse.json(),
    };
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

  app.post('/webhooks/evolution', async (request, reply) => {
    const providedSecret = request.headers['x-webhook-secret'];
    const value = Array.isArray(providedSecret) ? providedSecret[0] : providedSecret;
    if (!matchesWebhookSecret(value)) return reply.code(401).send({ error: 'Webhook não autorizado' });

    request.log.info({ event: (request.body as { event?: string } | null)?.event }, 'Evento Evolution recebido');
    return reply.code(202).send({ accepted: true });
  });
}
