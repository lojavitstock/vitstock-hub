import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isQaMode } from './config.js';
import { db } from './db.js';
import { requireAdmin } from './auth.js';
import { publishRealtimeEvent } from './realtime.js';

export type QaGoogleScenario = 'success' | 'conflict' | 'rate-limit' | 'timeout' | 'sync-token-expired' | 'partial' | 'external-delete';

let googleScenario: QaGoogleScenario = 'success';

export function currentQaGoogleScenario() {
  return googleScenario;
}

export function setQaGoogleScenario(value: QaGoogleScenario) {
  googleScenario = value;
}

export function qaGoogleFailure() {
  if (googleScenario === 'success' || googleScenario === 'sync-token-expired' || googleScenario === 'partial' || googleScenario === 'external-delete') return null;
  const error = new Error(`Google mock: ${googleScenario}`) as Error & { status?: number };
  error.status = googleScenario === 'conflict' ? 412 : googleScenario === 'rate-limit' ? 429 : 504;
  return error;
}

export function qaGooglePeople() {
  const people = [
    {
      resourceName: 'people/qa-ana',
      etag: 'qa-etag-ana-1',
      names: [{ displayName: 'Ana QA Atualizada' }],
      phoneNumbers: [{ value: '+55 21 99000-0001', type: 'mobile' }, { value: '+55 21 99000-0099', type: 'home' }],
      emailAddresses: [{ value: 'ana.qa@example.test', type: 'home' }],
      organizations: [{ name: 'Empresa QA', title: 'Compradora', current: true }],
      addresses: [{ formattedValue: 'Rua QA, 100 - Rio de Janeiro' }],
      birthdays: [{ date: { year: 1990, month: 5, day: 10 } }],
      biographies: [{ value: 'Contato Google fictício para QA', contentType: 'TEXT_PLAIN' }],
      urls: [{ value: 'https://example.test/qa-ana', type: 'home' }],
      userDefined: [{ key: 'cpf', value: '000.000.000-01' }],
    },
    {
      resourceName: 'people/qa-new',
      etag: 'qa-etag-new-1',
      names: [{ displayName: 'Novo Contato Google QA' }],
      phoneNumbers: [{ value: '+55 21 99000-0100', type: 'mobile' }],
      emailAddresses: [{ value: 'novo.qa@example.test', type: 'home' }],
    },
  ];
  return googleScenario === 'external-delete' ? people.slice(1) : people;
}

function qaEvolutionResponse(path: string, init?: RequestInit) {
  const method = (init?.method || 'GET').toUpperCase();
  const body = path.includes('/message/sendText/') || path.includes('/message/sendMedia/')
    ? { key: { id: `qa-evolution-${randomUUID()}` } }
      : path.includes('/message/sendReaction/') ? { status: 'ok' }
        : path.includes('/connectionState/') ? { instance: { state: 'open' } }
          : path.includes('/findChats/') || path.includes('/findContacts/') ? []
            : path.includes('/chat/findMessages/') ? { messages: { records: [] } }
              : path.includes('/chat/markMessageAsRead/') ? { status: 'read' }
                : path.includes('/instance/connect/') ? { code: 'QA_MOCK_CONNECTED' }
            : path.includes('/instance/logout/') ? { status: 'loggedOut' }
              : path.includes('/chat/getBase64FromMediaMessage') ? { base64: '' }
                : path.includes('/profile/') ? { name: 'Vitstock QA', picture: null }
                  : null;
  if (body === null) throw new Error(`QA_MODE bloqueou chamada Evolution não simulada: ${method} ${path}`);
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

const qaInboundSchema = z.object({
  remoteJid: z.string().min(3).max(128),
  phone: z.string().min(8).max(32).optional(),
  name: z.string().min(2).max(160).default('Contato QA'),
  content: z.string().min(1).max(4096),
  isGroup: z.boolean().optional().default(false),
  timestampMs: z.number().int().positive().optional(),
});

export async function registerQaRoutes(app: FastifyInstance) {
  if (!isQaMode) return;

  app.get<{ Params: { variant: string } }>('/api/qa/avatar/:variant', async (request, reply) => {
    const variant = request.params.variant;
    if (variant === 'valid.svg') {
      reply.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#eebb2c"/><circle cx="48" cy="38" r="16" fill="#172027"/><path d="M20 78c4-18 16-27 28-27s24 9 28 27" fill="#172027"/></svg>');
      return;
    }
    if (variant === 'broken.svg') {
      return reply.code(404).send({ error: 'Avatar QA indisponível' });
    }
    return reply.code(404).send({ error: 'Avatar QA não encontrado' });
  });

  app.get('/api/qa/ready', async () => ({
    qaMode: true,
    database: 'local-only',
    evolution: 'mock-only',
    google: 'mock-only',
  }));

  app.get('/api/qa/status', { preHandler: requireAdmin }, async () => ({
    qaMode: true,
    database: 'local-only',
    evolution: 'mock-only',
    google: 'mock-only',
    googleScenario,
  }));

  app.get('/api/qa/google/scenario', { preHandler: requireAdmin }, async () => ({ scenario: googleScenario }));
  app.post('/api/qa/google/scenario', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z.object({ scenario: z.enum(['success', 'conflict', 'rate-limit', 'timeout', 'sync-token-expired', 'partial', 'external-delete']) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Cenário Google QA inválido' });
    setQaGoogleScenario(parsed.data.scenario);
    return { scenario: googleScenario };
  });

  app.post('/api/qa/evolution/inbound', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = qaInboundSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mensagem QA inválida' });
    const input = parsed.data;
    const timestampMs = input.timestampMs ?? Date.now();
    const phone = input.phone?.replace(/\D/g, '') || input.remoteJid.split('@')[0];
    const contact = await db.query<{ id: string }>(
      `INSERT INTO contacts (company_id, name, phone, source)
       VALUES ($1, $2, $3, 'system')
       ON CONFLICT (company_id, phone) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id`, [request.user!.companyId, input.name, phone],
    );
    const contactId = contact.rows[0]!.id;
    const conversation = await db.query<{ id: string }>(
      `INSERT INTO conversations (company_id, contact_id, evolution_remote_jid, is_group, group_name, last_message, last_message_at, unread_count)
       VALUES ($1, $2, $3, $4, $5, $6, now(), 1)
       ON CONFLICT (company_id, evolution_remote_jid) DO UPDATE SET last_message = EXCLUDED.last_message, last_message_at = EXCLUDED.last_message_at, unread_count = conversations.unread_count + 1, updated_at = now()
       RETURNING id`, [request.user!.companyId, contactId, input.remoteJid, input.isGroup, input.isGroup ? input.name : null, input.content],
    );
    const conversationId = conversation.rows[0]!.id;
    const evolutionMessageId = `qa-inbound-${randomUUID()}`;
    await db.query(
      `INSERT INTO messages (company_id, conversation_id, evolution_message_id, sender, sender_name, content, status, sent_at)
       VALUES ($1, $2, $3, 'contact', $4, $5, 'delivered', to_timestamp($6::numeric / 1000))`,
      [request.user!.companyId, conversationId, evolutionMessageId, input.name, input.content, timestampMs],
    );
    publishRealtimeEvent(request.user!.companyId, 'message.upsert', {
      remoteJid: input.remoteJid, phone, messageId: evolutionMessageId, timestampMs, fromMe: false,
      message: { id: evolutionMessageId, conversationId: input.remoteJid, sender: 'contact', senderName: input.name, content: input.content, status: 'delivered', isInternalNote: false, timestampMs },
    });
    return { injected: true, remoteJid: input.remoteJid, evolutionMessageId };
  });
}

export { qaEvolutionResponse };
