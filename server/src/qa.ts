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

/** Deterministic group fixture used by local QA to exercise PN, LID and retroactive identity. */
export function qaGroupParticipantRecords() {
  const remoteJid = '120363000000@g.us';
  const record = (id: string, participant: string, timestamp: number, content: string, extra: Record<string, unknown> = {}) => ({
    key: { id, remoteJid, participant, fromMe: false },
    pushName: undefined,
    messageTimestamp: timestamp,
    message: { conversation: content },
    ...extra,
  });
  return [
    record('qa-group-c-old', '333333333@lid', 1_000, 'Mensagem antiga do C'),
    record('qa-group-a', '5521999000001@s.whatsapp.net', 2_000, 'Mensagem do A', { pushName: 'Participante A' }),
    record('qa-group-b', '222222222@lid', 3_000, 'Mensagem do B', { pushName: 'Participante B', senderPn: '5521999000002@s.whatsapp.net' }),
    record('qa-group-c-new', '333333333@lid', 4_000, 'Mensagem recente do C', { pushName: 'Participante C' }),
    record('qa-group-d', '444444444@lid', 5_000, 'Mensagem do D'),
  ];
}

/** Final display-priority fixtures: Google, provider, phone, then opaque LID. */
export function qaGroupParticipantIdentityRecords() {
  return [
    { googleName: 'Google A', providerName: 'WhatsApp A', participantPhone: '5521999000101', participantJid: '111111111@lid' },
    { providerName: 'WhatsApp B', participantPhone: '5521999000102', participantJid: '5521999000102@s.whatsapp.net' },
    { participantPhone: '5521999000103', participantJid: '5521999000103@s.whatsapp.net' },
    { participantJid: '444444444@lid' },
    { providerName: 'Participante', participantPhone: '5521999000105', participantJid: '555555555@lid' },
    { googleName: 'Google F', providerName: 'Participante', participantPhone: '5521999000106', participantJid: '666666666@lid' },
  ];
}

/** Webhook-shaped fixtures for the message-new identity path. */
export function qaNewGroupParticipantWebhookRecords() {
  const remoteJid = '120363000000@g.us';
  return [
    {
      key: { id: 'qa-new-lid-push-name', remoteJid, participant: '123456992@lid', fromMe: false },
      pushName: 'Vitstock',
      messageTimestamp: 1_000,
      message: { conversation: 'Teste 1' },
    },
    {
      key: { id: 'qa-new-lid-sender-pn', remoteJid, participant: '123456993@lid', fromMe: false },
      senderPn: '5521999000093@s.whatsapp.net',
      messageTimestamp: 1_001,
      message: { conversation: 'Teste 2' },
    },
    {
      key: { id: 'qa-new-lid-unknown', remoteJid, participant: '123456994@lid', fromMe: false },
      messageTimestamp: 1_002,
      message: { conversation: 'Teste 3' },
    },
    {
      key: { id: 'qa-new-lid-known', remoteJid, participant: '123456995@lid', fromMe: false },
      metadata: { participantJid: '123456995@lid', participantName: 'Participante conhecido QA' },
      messageTimestamp: 1_003,
      message: { conversation: 'Teste 4' },
    },
    {
      key: { id: 'qa-new-pn', remoteJid, participant: '5521999000096@s.whatsapp.net', fromMe: false },
      messageTimestamp: 1_004,
      message: { conversation: 'Teste 5' },
    },
  ];
}

/** Deterministic individual fixtures covering real names, PN and opaque LID fallbacks. */
export function qaIndividualIdentityRecords() {
  return [
    {
      id: 'qa-individual-a@s.whatsapp.net',
      remoteJid: 'qa-individual-a@s.whatsapp.net',
      pushName: 'Cliente Real QA',
    },
    {
      id: 'qa-individual-b@s.whatsapp.net',
      remoteJid: 'qa-individual-b@s.whatsapp.net',
      remoteJidAlt: '5521999000014@s.whatsapp.net',
    },
    {
      id: 'qa-individual-c@s.whatsapp.net',
      remoteJid: 'qa-individual-c@s.whatsapp.net',
      name: 'Contato',
      remoteJidAlt: '5521999000015@s.whatsapp.net',
    },
    {
      id: 'qa-individual-d@s.whatsapp.net',
      remoteJid: 'qa-individual-d@s.whatsapp.net',
      pushName: 'Contato',
      verifiedName: 'Empresa QA',
      businessName: 'Empresa Comercial QA',
    },
    {
      id: '888888888@lid',
      remoteJid: '888888888@lid',
      pushName: 'Contato',
    },
  ];
}

export function qaGroupMetadataRecords() {
  return [
    { id: '120363000000@g.us', subject: 'Equipe QA', profilePicUrl: 'http://localhost:3001/api/qa/avatar/valid.svg' },
    { id: '120363000001@g.us', subject: 'Equipe QA sem foto' },
    { id: '120363000002@g.us', subject: 'Equipe QA sem lookup' },
  ];
}

function qaEvolutionResponse(path: string, init?: RequestInit) {
  const method = (init?.method || 'GET').toUpperCase();
  let requestBody: any = {};
  try { requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : {}; } catch { requestBody = {}; }
  const participantNumber = String(requestBody?.number || '');
  const body = path.includes('/message/sendText/') || path.includes('/message/sendMedia/')
    ? { key: { id: `qa-evolution-${randomUUID()}` } }
      : path.includes('/message/sendReaction/') ? { status: 'ok' }
        : path.includes('/connectionState/') ? { instance: { state: 'open' } }
            : path.includes('/group/fetchAllGroups/') ? qaGroupMetadataRecords()
            : path.includes('/group/participants/') ? [
              { id: '123456994@lid', pushName: 'Lookup C QA' },
              { id: '123456995@lid', pushName: 'Participante conhecido QA' },
            ]
            : path.includes('/findChats/') || path.includes('/findContacts/') ? []
            : path.includes('/chat/findMessages/') ? { messages: { records: requestBody?.remoteJid === '120363000000@g.us' ? qaGroupParticipantRecords() : [] } }
              : path.includes('/chat/markMessageAsRead/') ? { status: 'read' }
                : path.includes('/instance/connect/') ? { code: 'QA_MOCK_CONNECTED' }
            : path.includes('/instance/logout/') ? { status: 'loggedOut' }
              : path.includes('/chat/getBase64FromMediaMessage') ? { base64: '' }
                : path.includes('/fetchProfilePictureUrl/') ? (participantNumber.includes('444444444@lid') || participantNumber.includes('333333333@lid') || participantNumber.includes('120363000002@g.us')
                  ? { profilePictureUrl: null }
                  : { profilePictureUrl: `http://localhost:3001/api/qa/avatar/${participantNumber.includes('5521999000001') ? 'a' : participantNumber.includes('222222222') ? 'b' : participantNumber.includes('120363000001@g.us') ? 'b' : 'valid'}.svg` })
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
    if (variant === 'valid.svg' || variant === 'a.svg' || variant === 'b.svg') {
      const fill = variant === 'a.svg' ? '#4ade80' : variant === 'b.svg' ? '#60a5fa' : '#eebb2c';
      reply.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${fill}"/><circle cx="48" cy="38" r="16" fill="#172027"/><path d="M20 78c4-18 16-27 28-27s24 9 28 27" fill="#172027"/></svg>`);
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
