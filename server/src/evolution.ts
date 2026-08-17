import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { config, isAllowedFrontendOrigin } from './config.js';
import { requireUser } from './auth.js';
import { db } from './db.js';
import { buildHasOlderMessagesQuery } from './hasOlderMessagesQuery.js';
import { publishRealtimeEvent, registerRealtimeClient } from './realtime.js';
import { acquireConversationLease, type ConversationLease } from './conversationLease.js';
import { evolutionMessageIdFromResponse, evolutionReactionPayload, formatHubOutboundText, removeHubAgentPrefix } from './outboundMessage.js';
import { createOutboundRequestCoordinator, outboundDispatchAction, outboundIdempotencyLockKey } from './outboundIdempotency.js';
import { isNonRenderableProviderMessage, providerMessageType, unwrapProviderMessage } from './providerMessagePolicy.js';
import {
  applyProviderReaction,
  areStoredReactionsEqual,
  HUB_REACTOR_KEY,
  isProviderReactionEvent,
  normalizeStoredReactions,
  providerReactionUpdate,
} from './messageReactions.js';

const jidSchema = z.object({
  remoteJid: z.string().min(3).max(128),
  phone: z.string().max(32).optional(),
  // A reconciliação é feita somente na primeira abertura da conversa. As
  // atualizações seguintes usam o PostgreSQL e não ficam consultando a
  // Evolution a cada ciclo de atualização da tela.
  reconcile: z.boolean().optional(),
  beforeTimestamp: z.coerce.number().int().positive().optional(),
  afterTimestamp: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(20).max(200).optional(),
});
/** Evolution groups are addressed by the full `number@g.us` JID. For sends,
 * that exact JID is passed in the provider `number` field; participants stay
 * in message key.participant and never become the conversation identity. */
const isWhatsAppGroupJid = (value: string | undefined | null) => (
  typeof value === 'string' && value.trim().toLowerCase().endsWith('@g.us')
);
const evolutionRecipientSchema = z.string().min(3).max(128).refine((value) => (
  /^\d{8,20}$/.test(value) || isWhatsAppGroupJid(value)
), 'destinatário Evolution inválido');
const sendTextSchema = z.object({
  number: evolutionRecipientSchema,
  text: z.string().min(1).max(4096),
  remoteJid: z.string().min(3).max(128).optional(),
  clientMessageId: z.string().trim().min(1).max(128).optional(),
  quotedMessage: z.object({
    messageId: z.string().trim().min(1).max(256),
    authorName: z.string().trim().min(1).max(200).optional(),
    sender: z.enum(['contact', 'attendant', 'system']).optional(),
    content: z.string().max(4096).optional(),
    mediaType: z.enum(['image', 'audio', 'video', 'document', 'sticker']).optional(),
    key: z.object({
      id: z.string().trim().min(1).max(256),
      remoteJid: z.string().trim().min(3).max(128).optional(),
      fromMe: z.boolean().optional(),
      participant: z.string().trim().min(3).max(128).optional(),
    }).optional(),
  }).optional(),
});
const sendMediaSchema = z.object({
  number: evolutionRecipientSchema,
  remoteJid: z.string().min(3).max(128).optional(),
  mediatype: z.enum(['image', 'video', 'document']),
  mimetype: z.string().min(3).max(100),
  media: z.string().min(1).max(14_000_000),
  fileName: z.string().max(180).optional(),
  caption: z.string().max(4096).optional(),
  clientMessageId: z.string().trim().min(1).max(128).optional(),
  quotedMessage: sendTextSchema.shape.quotedMessage,
});
const sendReactionSchema = z.object({
  number: evolutionRecipientSchema,
  remoteJid: z.string().min(3).max(128),
  messageId: z.string().trim().min(1).max(256),
  emoji: z.union([z.enum(['👍', '❤️', '😂', '😮', '😢', '🙏']), z.null()]),
});
const mediaSchema = z.object({ messageKey: z.record(z.string(), z.unknown()) });
const phoneSchema = z.object({ number: z.string().regex(/^\d{8,20}$/) });
const noteSchema = z.object({
  remoteJid: z.string().min(3).max(128),
  phone: z.string().max(32).optional(),
  content: z.string().trim().min(1).max(4096),
});
const noteLookupSchema = noteSchema.pick({ remoteJid: true, phone: true });
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

type EvolutionChatsSnapshot = { chats: any[]; contacts: any[]; expiresAt: number; staleUntil: number };
const evolutionChatsCache = new Map<string, EvolutionChatsSnapshot>();
const evolutionChatsInFlight = new Map<string, Promise<{ chats: any[]; contacts: any[] }>>();
const localInboxCache = new Map<string, { chats: any[]; expiresAt: number }>();
const outboundTraceEnabled = process.env.OUTBOUND_TRACE === 'true';
const outboundEvolutionRequests = createOutboundRequestCoordinator<{ ok: boolean; body: any }>();

function traceOutbound(request: any, stage: string, input: {
  clientMessageId?: string;
  remoteJid?: string;
  evolutionMessageId?: string;
  deduplicated?: boolean;
  ok?: boolean;
  elapsedMs?: number;
  idempotencyLockMs?: number;
  persistenceMs?: number;
  evolutionRequestMs?: number;
}) {
  if (!outboundTraceEnabled) return;
  // This opt-in trace intentionally omits text, media, headers and secrets.
  console.info('[OUTBOUND_TRACE]', JSON.stringify({
    stage,
    requestId: request.id,
    userId: request.user?.id,
    remoteJid: input.remoteJid,
    clientMessageId: input.clientMessageId,
    evolutionMessageId: input.evolutionMessageId,
    deduplicated: input.deduplicated,
    ok: input.ok,
    elapsedMs: input.elapsedMs,
    idempotencyLockMs: input.idempotencyLockMs,
    persistenceMs: input.persistenceMs,
    evolutionRequestMs: input.evolutionRequestMs,
    timestampMs: Date.now(),
  }));
}

async function refreshEvolutionChatsSnapshot(companyId: string) {
  const current = evolutionChatsInFlight.get(companyId);
  if (current) return current;
  const instance = encodeURIComponent(config.EVOLUTION_INSTANCE_NAME);
  const request = (async () => {
    const [chatsResponse, contactsResponse] = await Promise.all([
      evolutionRequest(`/chat/findChats/${instance}`, { method: 'POST', body: '{}' }),
      evolutionRequest(`/chat/findContacts/${instance}`, { method: 'POST', body: '{}' }),
    ]);
    if (!chatsResponse.ok || !contactsResponse.ok) {
      throw new Error('Evolution API indisponÃ­vel para consultar as conversas');
    }
    const [chats, contacts] = await Promise.all([
      chatsResponse.json().catch(() => []),
      contactsResponse.json().catch(() => []),
    ]);
    const snapshot = {
      chats: Array.isArray(chats) ? chats : [],
      contacts: Array.isArray(contacts) ? contacts : [],
    };
    evolutionChatsCache.set(companyId, {
      ...snapshot,
      expiresAt: Date.now() + 3_000,
      staleUntil: Date.now() + 30_000,
    });
    return snapshot;
  })();
  evolutionChatsInFlight.set(companyId, request);
  try {
    return await request;
  } finally {
    evolutionChatsInFlight.delete(companyId);
  }
}

async function fetchEvolutionChatsSnapshot(companyId: string) {
  const now = Date.now();
  const cached = evolutionChatsCache.get(companyId);
  if (cached && cached.expiresAt > now) {
    return { chats: cached.chats, contacts: cached.contacts };
  }

  // Enquanto a Evolution responde, entregamos o último snapshot conhecido.
  // Isso mantém o inbox utilizável mesmo quando o provedor demora vários segundos.
  if (cached && cached.staleUntil > now) {
    void refreshEvolutionChatsSnapshot(companyId).catch(() => undefined);
    return { chats: cached.chats, contacts: cached.contacts };
  }

  return refreshEvolutionChatsSnapshot(companyId);
}

/**
 * A Evolution é a fonte primária do inbox, mas o PostgreSQL é a fonte de
 * verdade depois que uma mensagem chega pelo webhook. Quando o provedor fica
 * oscilando, usamos o último estado persistido para que a lista continue
 * navegável e nenhuma conversa desapareça da tela.
 */
async function loadLocalInboxChats(companyId: string) {
  const result = await db.query<{
    evolution_remote_jid: string;
    unread_count: number;
    last_message: string | null;
    last_message_at: Date | string | null;
    contact_name: string;
    avatar_url: string | null;
    message_id: string | null;
    message_sender: string | null;
    message_sender_name: string | null;
    message_sent_at: Date | string | null;
    is_group: boolean;
    group_name: string | null;
    group_avatar_url: string | null;
  }>(
    `SELECT c.evolution_remote_jid,
            c.unread_count,
            COALESCE(
              latest.content,
              CASE
                WHEN c.last_message LIKE 'Reagiu com:%' THEN NULL
                ELSE NULLIF(c.last_message, '[Mensagem protegida]')
              END
            ) AS last_message,
            COALESCE(latest.sent_at, c.last_message_at) AS last_message_at,
            ct.name AS contact_name,
            ct.avatar_url,
            latest.evolution_message_id AS message_id,
            latest.sender AS message_sender,
            latest.sender_name AS message_sender_name,
            latest.sent_at AS message_sent_at,
            c.is_group,
            c.group_name,
            c.group_avatar_url
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN LATERAL (
       SELECT m.evolution_message_id, m.sender, m.sender_name, m.content, m.sent_at
       FROM messages m
       WHERE m.conversation_id = c.id
         AND m.is_internal_note = false
         AND COALESCE(m.metadata->>'providerType', '') NOT IN ('secretEncryptedMessage', 'senderKeyDistributionMessage', 'reactionMessage')
       ORDER BY m.sent_at DESC
       LIMIT 1
     ) latest ON true
     WHERE c.company_id = $1
     ORDER BY COALESCE(latest.sent_at, c.last_message_at, c.updated_at) DESC`,
    [companyId],
  );

  return result.rows.map((row) => {
    const dateValue = row.message_sent_at || row.last_message_at;
    const timestamp = dateValue ? Math.floor(new Date(dateValue).getTime() / 1000) : 0;
    const remoteJid = row.evolution_remote_jid;
    const isGroup = Boolean(row.is_group) || isWhatsAppGroupJid(remoteJid);
    const rawPreview = row.last_message || '[Conversa iniciada]';
    const preview = isGroup && row.message_sender
      ? `${row.message_sender_name || (row.message_sender === 'attendant' ? 'Atendente' : 'Participante')}: ${rawPreview}`
      : rawPreview;
    return {
      id: remoteJid,
      remoteJid,
      isGroup,
      groupName: row.group_name || undefined,
      groupAvatarUrl: row.group_avatar_url || undefined,
      unreadCount: Number(row.unread_count) || 0,
      updatedAt: dateValue ? new Date(dateValue).toISOString() : undefined,
      pushName: row.contact_name,
      profilePicUrl: row.group_avatar_url || row.avatar_url || undefined,
      lastMessage: {
        key: {
          id: row.message_id || `local-${remoteJid}-${timestamp}`,
          remoteJid,
          fromMe: row.message_sender === 'attendant',
        },
        message: { conversation: preview },
        messageTimestamp: timestamp,
        pushName: row.contact_name,
        participantName: row.message_sender_name || undefined,
        previewIsPrefixed: isGroup,
      },
    };
  });
}

async function fetchLocalInboxChats(companyId: string) {
  const cached = localInboxCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.chats;
  const chats = await loadLocalInboxChats(companyId);
  localInboxCache.set(companyId, { chats, expiresAt: Date.now() + 5_000 });
  return chats;
}

async function forwardJson(response: Response, reply: FastifyReply) {
  const body = await response.json().catch(() => ({ error: 'Resposta inválida da Evolution API' }));
  if (!response.ok) return reply.code(502).send({ error: 'Evolution API indisponível' });
  return body;
}

async function forwardEvolutionRequest(path: string, reply: FastifyReply, init?: RequestInit) {
  try {
    return await forwardJson(await evolutionRequest(path, init), reply);
  } catch (error) {
    reply.request.log.warn({ err: error, path }, 'Evolution API não respondeu');
    return reply.code(502).send({ error: 'Evolution API indisponível no momento' });
  }
}

function assignmentJids(input: { remoteJid: string; phone?: string }) {
  const jids = [input.remoteJid];
  const phone = String(input.phone || '').trim();
  const digits = phone.replace(/\D/g, '') || '';
  if (!isWhatsAppGroupJid(phone) && digits.length >= 8 && digits.length <= 20) jids.push(`${digits}@s.whatsapp.net`);
  return [...new Set(jids)];
}

function canonicalPhoneJid(number: string) {
  return `${number.replace(/\D/g, '')}@s.whatsapp.net`;
}

async function prepareOutboundConversation(input: {
  companyId: string;
  number: string;
  remoteJid: string;
}) {
  const isGroup = isWhatsAppGroupJid(input.remoteJid);
  const contactPhone = isGroup ? input.remoteJid : `+${input.number.replace(/\D/g, '')}`;
  const contactName = isGroup ? `Grupo ${input.remoteJid.split('@')[0]}` : contactPhone;
  const contact = await db.query<{ id: string }>(
    `INSERT INTO contacts (company_id, name, phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id, phone) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [input.companyId, contactName, contactPhone],
  );
  const contactId = contact.rows[0]?.id;
  if (!contactId) throw new Error('Contato n\u00e3o p\u00f4de ser preparado para o envio');

  if (!isGroup) {
    await db.query(
      `INSERT INTO contact_phones (company_id, contact_id, phone, normalized_phone, is_primary, source)
       VALUES ($1, $2, $3, $4, true, 'whatsapp')
       ON CONFLICT (contact_id, normalized_phone) DO UPDATE SET updated_at = now()`,
      [input.companyId, contactId, contactPhone, contactPhone.replace(/\D/g, '')],
    );
  }

  await db.query(
    `INSERT INTO contact_channel_identities (company_id, contact_id, channel, identity, identity_type)
     VALUES ($1, $2, 'whatsapp', $3, $4)
     ON CONFLICT (company_id, channel, identity) DO UPDATE SET contact_id = EXCLUDED.contact_id, updated_at = now()`,
    [input.companyId, contactId, input.remoteJid, input.remoteJid.endsWith('@lid') ? 'lid' : 'remote_jid'],
  );

  const existing = await db.query<{ id: string }>(
    `SELECT id FROM conversations
     WHERE company_id = $1
       AND evolution_remote_jid = $2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [input.companyId, input.remoteJid],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const created = await db.query<{ id: string }>(
    `INSERT INTO conversations (company_id, contact_id, evolution_remote_jid, is_group, group_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, evolution_remote_jid) DO UPDATE
       SET contact_id = EXCLUDED.contact_id,
           updated_at = now()
     RETURNING id`,
    [input.companyId, contactId, input.remoteJid, isGroup, isGroup ? contactName : null],
  );
  const conversationId = created.rows[0]?.id;
  if (!conversationId) throw new Error('Conversa n\u00e3o p\u00f4de ser preparada para o envio');
  return conversationId;
}

async function findConversationForLease(input: { companyId: string; remoteJid: string; phone?: string }) {
  const result = await db.query<{ id: string }>(
    `SELECT c.id
     FROM conversations c
     JOIN contacts contact ON contact.id = c.contact_id
     WHERE c.company_id = $1::uuid
       AND c.evolution_remote_jid = $2::text
     ORDER BY c.updated_at DESC
     LIMIT 1`,
    [input.companyId, input.remoteJid],
  );
  return result.rows[0]?.id;
}

const leaseRealtimePayload = (input: { remoteJid: string; phone?: string; lease: ConversationLease }) => ({
  remoteJid: input.remoteJid,
  phone: input.phone || '',
  leaseOwnerUserId: input.lease.ownerUserId,
  leaseOwnerName: input.lease.ownerName,
  leaseExpiresAt: input.lease.expiresAt,
});

async function acquireOutboundLease(input: {
  companyId: string;
  user: { id: string };
  number: string;
  remoteJid: string;
}) {
  const conversationId = await prepareOutboundConversation({
    companyId: input.companyId,
    number: input.number,
    remoteJid: input.remoteJid,
  });
  const outcome = await acquireConversationLease(db, {
    companyId: input.companyId,
    conversationId,
    userId: input.user.id,
  });
  return { conversationId, ...outcome };
}

function providerContactName(value: any) {
  const candidate = value?.pushName || value?.notify || value?.verifiedName || value?.name;
  if (typeof candidate !== 'string') return '';
  const name = candidate.trim();
  if (!name || name === 'Você' || name === 'WhatsApp Business' || /^\+?[\d\s().-]+$/.test(name)) return '';
  return name;
}

function providerGroupName(value: any) {
  const candidate = value?.groupName
    || value?.subject
    || value?.groupMetadata?.subject
    || value?.chatName
    || value?.name
    || value?.notify;
  if (typeof candidate !== 'string') return '';
  const name = candidate.trim();
  if (!name || name === 'WhatsApp Business' || name === 'Você' || /^\+?[\d\s().-]+$/.test(name)) return '';
  return name;
}

function providerContactPhone(value: any) {
  const primaryJid = value?.remoteJid
    || value?.id
    || value?.lastMessage?.key?.remoteJid
    || value?.key?.remoteJid
    || '';
  if (isWhatsAppGroupJid(String(primaryJid))) return '';
  const rawJid = value?.lastMessage?.key?.remoteJidAlt
    || value?.key?.remoteJidAlt
    || value?.remoteJidAlt
    || value?.remoteJid
    || value?.id
    || value?.key?.remoteJid
    || '';
  if (isWhatsAppGroupJid(String(rawJid))) return '';
  const digits = String(rawJid).split('@')[0]?.replace(/\D/g, '') || '';
  return digits.length >= 8 && digits.length <= 20 ? digits : '';
}

function normalizeProviderMessageStatus(value: unknown): 'sent' | 'delivered' | 'read' | 'failed' | undefined {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return undefined;
  if (['ERROR', 'FAILED', 'FAILURE', 'REJECTED'].includes(raw) || raw === '0') return 'failed';
  if (['READ', 'PLAYED', '4', '5'].includes(raw)) return 'read';
  if (['DELIVERY_ACK', 'DELIVERED', '2', '3'].includes(raw)) return 'delivered';
  if (['SERVER_ACK', 'SENT', 'PENDING', '1'].includes(raw)) return 'sent';
  return undefined;
}

function firstProviderText(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

type QuotedMessage = NonNullable<z.infer<typeof sendTextSchema>['quotedMessage']>;

function quotedMessageFromContext(context: any): QuotedMessage | undefined {
  const messageId = firstProviderText(context?.stanzaId, context?.stanzaID, context?.quotedMessage?.key?.id);
  if (!messageId) return undefined;

  const quoted = unwrapProviderMessage(context?.quotedMessage || {});
  const mediaType = quoted?.imageMessage ? 'image'
    : quoted?.videoMessage ? 'video'
      : quoted?.audioMessage ? 'audio'
        : quoted?.documentMessage ? 'document'
          : quoted?.stickerMessage ? 'sticker'
            : undefined;
  const content = firstProviderText(
    quoted?.conversation,
    quoted?.extendedTextMessage?.text,
    quoted?.imageMessage?.caption,
    quoted?.videoMessage?.caption,
    quoted?.documentMessage?.caption,
  );
  const participant = firstProviderText(context?.participant, context?.participantPn, context?.quotedParticipant);

  return {
    messageId,
    ...(content ? { content } : {}),
    ...(mediaType ? { mediaType } : {}),
    key: {
      id: messageId,
      ...(participant ? { participant } : {}),
    },
  };
}

function normalizedQuotedMessage(quoted: QuotedMessage | undefined, fallbackRemoteJid: string): QuotedMessage | undefined {
  if (!quoted) return undefined;
  const messageId = quoted.key?.id || quoted.messageId;
  if (!messageId) return undefined;
  return {
    messageId,
    ...(quoted.authorName ? { authorName: quoted.authorName } : {}),
    ...(quoted.sender ? { sender: quoted.sender } : {}),
    ...(quoted.content ? { content: quoted.content } : {}),
    ...(quoted.mediaType ? { mediaType: quoted.mediaType } : {}),
    key: {
      id: messageId,
      remoteJid: quoted.key?.remoteJid || fallbackRemoteJid,
      ...(typeof quoted.key?.fromMe === 'boolean' ? { fromMe: quoted.key.fromMe } : {}),
      ...(quoted.key?.participant ? { participant: quoted.key.participant } : {}),
    },
  };
}

function evolutionQuotedPayload(quoted: QuotedMessage | undefined, fallbackRemoteJid: string) {
  const normalized = normalizedQuotedMessage(quoted, fallbackRemoteJid);
  if (!normalized) return undefined;
  return {
    key: {
      id: normalized.key!.id,
      remoteJid: normalized.key!.remoteJid,
      fromMe: normalized.key!.fromMe,
      ...(normalized.key!.participant ? { participant: normalized.key!.participant } : {}),
    },
  };
}

function providerCallInfo(record: any, message: any, type: string, fromMe: boolean) {
  const call = message?.callLogMessage
    || message?.call
    || message?.offerMessage
    || record?.callLogMessage
    || record?.call
    || record?.offerMessage
    || record?.data?.callLogMessage
    || record?.data?.call
    || record?.data?.offerMessage;
  const markers = [
    type,
    record?.messageType,
    record?.event,
    record?.type,
    call?.callType,
    call?.type,
    call?.callOutcome,
    call?.outcome,
    call?.callResult,
    call?.result,
    call?.status,
    call?.reason,
    record?.callOutcome,
    record?.callResult,
  ].filter((value) => value !== undefined && value !== null).map(String).join(' ').toLowerCase();
  const isCall = Boolean(call) || /call|phonecall|voicecall|voip|ligaç/.test(markers);
  if (!isCall) return { isCall: false, label: undefined };

  const numericOutcome = [
    call?.callOutcome,
    call?.outcome,
    call?.callResult,
    call?.result,
    record?.callOutcome,
  ].map((value) => Number(value)).find((value) => Number.isInteger(value));
  const isVideo = Boolean(call?.isVideo || call?.video || /video/.test(markers));
  const isExplicitlyMissed = /miss|unanswered|no[_ -]?answer|not[_ -]?answer|no[_ -]?response|reject|declin|timeout|failed|cancel|unavailable|busy/.test(markers)
    // Baileys CallOutcome: MISSED=1, FAILED=2, REJECTED=3,
    // ACCEPTED_ELSEWHERE=4, SILENCED_BY_DND=6, SILENCED_UNKNOWN_CALLER=7.
    || [1, 2, 3, 4, 6, 7].includes(numericOutcome ?? -1);
  const hasConnectedOutcome = /connected|accepted|answered|completed|success|established/.test(markers)
    || numericOutcome === 0
    || Number(call?.duration || call?.durationMs || call?.durationSecs || 0) > 0;
  const missed = isExplicitlyMissed || (!fromMe && !hasConnectedOutcome);
  const medium = isVideo ? 'vídeo' : 'voz';
  return {
    isCall: true,
    label: `Ligação de ${medium} ${missed ? 'perdida' : fromMe ? 'realizada' : 'recebida'}`,
  };
}

function providerContactPhoneFromVcard(vcard: unknown) {
  if (typeof vcard !== 'string') return '';
  const waid = vcard.match(/waid=(\d+)/i)?.[1];
  if (waid) return `+${waid}`;
  const phone = vcard.match(/(?:TEL[^:]*:)([^\n\r]+)/i)?.[1]?.trim();
  return phone || '';
}

function providerInteractiveButtons(message: any) {
  const interactive = message?.interactiveMessage
    || message?.templateMessage?.interactiveMessageTemplate
    || message?.templateMessage?.interactiveMessage;
  const buttons: Array<{ type: 'url' | 'quickReply' | 'call' | 'copy'; label: string; url?: string; value?: string }> = [];
  const addNativeButton = (button: any) => {
    try {
      const params = JSON.parse(button?.buttonParamsJson || '{}');
      if (button?.name === 'cta_url' && /^https?:\/\//i.test(params.url || '')) {
        buttons.push({ type: 'url', label: params.display_text || 'Abrir link', url: params.url });
      } else if (button?.name === 'cta_call') {
        buttons.push({ type: 'call', label: params.display_text || 'Ligar', value: params.phone_number || params.number || '' });
      } else if (button?.name === 'cta_copy') {
        buttons.push({ type: 'copy', label: params.display_text || 'Copiar', value: params.copy_code || params.code || '' });
      } else if (button?.name === 'quick_reply') {
        buttons.push({ type: 'quickReply', label: params.display_text || 'Responder', value: params.id || params.display_text || '' });
      }
    } catch {
      // Alguns modelos comerciais entregam o JSON do botão incompleto.
    }
  };
  if (Array.isArray(interactive?.nativeFlowMessage?.buttons)) interactive.nativeFlowMessage.buttons.forEach(addNativeButton);
  const hydrated = message?.templateMessage?.hydratedTemplate?.hydratedButtons;
  if (Array.isArray(hydrated)) {
    hydrated.forEach((button: any) => {
      if (button?.urlButton?.url) buttons.push({ type: 'url', label: button.urlButton.displayText || 'Abrir link', url: button.urlButton.url });
      if (button?.callButton?.phoneNumber) buttons.push({ type: 'call', label: button.callButton.displayText || 'Ligar', value: button.callButton.phoneNumber });
      if (button?.quickReplyButton) buttons.push({ type: 'quickReply', label: button.quickReplyButton.displayText || 'Responder', value: button.quickReplyButton.id || button.quickReplyButton.displayText || '' });
    });
  }
  return buttons;
}

function providerMessageMetadata(record: any, message: any, fromMe: boolean) {
  const type = providerMessageType(record, message);
  // `record.contextInfo` may be supplied by Evolution as context for the chat
  // snapshot. It is not proof that the individual message came from an ad.
  // Traffic metadata must be derived only from the message payload itself.
  const embeddedContext = message?.contextInfo
    || message?.extendedTextMessage?.contextInfo
    || message?.imageMessage?.contextInfo
    || message?.videoMessage?.contextInfo
    || message?.documentMessage?.contextInfo
    || {};
  // Evolution messages.upsert may carry the message's ContextInfo next to the
  // `message` object in data.contextInfo. This marker is set only while
  // handling that one webhook record, so a chat snapshot can never leak its
  // context into another message.
  const webhookContext = record?.messageContextScope === 'webhook'
    ? record?.contextInfo
    : undefined;
  const context = Object.keys(embeddedContext).length > 0
    ? embeddedContext
    : (webhookContext || {});
  const externalAd = context?.externalAdReply;
  const contact = message?.contactMessage;
  const location = message?.locationMessage;
  const reaction = message?.reactionMessage;
  const protocol = message?.protocolMessage;
  const call = message?.callLogMessage || message?.call || message?.offerMessage;
  const callInfo = providerCallInfo(record, message, type, fromMe);
  const metadata: Record<string, any> = { providerType: type };
  const participantJid = firstProviderText(
    record?.key?.participant,
    record?.key?.participantPn,
    record?.participant,
    record?.participantPn,
    record?.senderPn,
    record?.key?.senderPn,
  );
  if (participantJid) metadata.participantJid = participantJid;
  if (!fromMe) {
    const participantName = providerContactName(record) || firstProviderText(record?.pushName, record?.participantName);
    if (participantName) metadata.participantName = participantName;
  }
  const document = providerDocumentMetadata(message);
  if (document) metadata.document = document;
  const quotedMessage = quotedMessageFromContext(context);
  if (quotedMessage) metadata.quotedMessage = quotedMessage;

  // A referência de anúncio pertence somente à mensagem recebida que iniciou
  // a conversa. Mensagens enviadas pela loja podem carregar o mesmo
  // contextInfo do WhatsApp, mas não devem herdar a etiqueta do anúncio.
  const hasMessageBoundAdContext = Boolean(
    Object.keys(embeddedContext).length > 0
    && (externalAd
    || context?.ctwaSignals
    || context?.conversionData
    || context?.conversion_data),
  );
  if (!fromMe && hasMessageBoundAdContext) {
    const trafficSource = context?.conversionSource
      || context?.conversion_source
      || 'FB_Ads';
    if (typeof trafficSource === 'string' && trafficSource.trim()) metadata.trafficSource = trafficSource.trim();
    const trafficTitle = externalAd?.title || externalAd?.sourceApp || externalAd?.mediaType;
    const trafficUrl = externalAd?.sourceUrl || externalAd?.sourceURL;
    if (typeof trafficTitle === 'string' && trafficTitle.trim()) metadata.trafficTitle = trafficTitle.trim();
    if (typeof trafficUrl === 'string' && trafficUrl.trim()) metadata.trafficUrl = trafficUrl.trim();
  }

  if (contact) {
    metadata.contactCard = {
      displayName: contact.displayName || 'Contato compartilhado',
      phone: providerContactPhoneFromVcard(contact.vcard) || undefined,
    };
  }
  if (location && Number.isFinite(Number(location.degreesLatitude)) && Number.isFinite(Number(location.degreesLongitude))) {
    const latitude = Number(location.degreesLatitude);
    const longitude = Number(location.degreesLongitude);
    metadata.location = {
      latitude,
      longitude,
      name: location.name || undefined,
      address: location.address || undefined,
      url: location.url || `https://www.google.com/maps?q=${latitude},${longitude}`,
    };
  }
  if (typeof reaction?.text === 'string' && reaction.text.trim()) metadata.reaction = reaction.text.trim();
  if (context?.isForwarded || message?.contextInfo?.isForwarded) metadata.forwarded = true;

  if (call || /call/i.test(type)) {
    const isVideo = Boolean(call?.isVideo || call?.video || call?.callType === 'video');
    metadata.systemLabel = isVideo ? 'Ligação de vídeo' : 'Ligação de voz';
  } else if (type === 'protocolMessage') {
    const protocolType = Number(protocol?.type);
    metadata.systemLabel = protocolType === 0
      ? 'Mensagem apagada'
      : protocolType === 3
        ? 'Mensagens temporárias atualizadas'
        : 'Evento do WhatsApp';
  } else if (type === 'placeholderMessage') {
    metadata.systemLabel = 'Mensagem indisponível';
  } else if (type === 'statusMentionMessage') {
    metadata.systemLabel = 'Menção de status';
  }
  if (callInfo.isCall) metadata.systemLabel = callInfo.label;

  const interactive = message?.interactiveMessage
    || message?.templateMessage?.interactiveMessageTemplate
    || message?.templateMessage?.interactiveMessage;
  const interactiveTitle = interactive?.header?.title || interactive?.header?.text || message?.templateMessage?.hydratedTemplate?.hydratedTitleText;
  const interactiveFooter = interactive?.footer?.text || message?.templateMessage?.hydratedTemplate?.hydratedFooterText;
  const interactiveButtons = providerInteractiveButtons(message);
  if (typeof interactiveTitle === 'string' && interactiveTitle.trim()) metadata.interactiveTitle = interactiveTitle.trim();
  if (typeof interactiveFooter === 'string' && interactiveFooter.trim()) metadata.interactiveFooter = interactiveFooter.trim();
  if (interactiveButtons.length) metadata.interactiveButtons = interactiveButtons;

  if (fromMe) {
    delete metadata.trafficSource;
    delete metadata.trafficTitle;
    delete metadata.trafficUrl;
  }
  return metadata;
}

function providerMessageContent(record: any) {
  const message = unwrapProviderMessage(record?.message);
  const fromMe = record?.key?.fromMe === true;
  const metadata = providerMessageMetadata(record, message, fromMe);
  const interactive = message?.interactiveMessage
    || message?.templateMessage?.interactiveMessageTemplate
    || message?.templateMessage?.interactiveMessage;
  const text = firstProviderText(
    message?.conversation,
    message?.extendedTextMessage?.text,
    message?.imageMessage?.caption,
    message?.videoMessage?.caption,
    message?.documentMessage?.caption,
    interactive?.body?.text,
    interactive?.header?.text,
    interactive?.header?.title,
    message?.buttonsMessage?.contentText,
    message?.listMessage?.description,
    message?.listMessage?.title,
    message?.templateMessage?.hydratedTemplate?.hydratedContentText,
    message?.templateMessage?.hydratedTemplate?.hydratedTitleText,
    message?.templateMessage?.hydratedFourRowTemplate?.content,
  );
  if (text) return text;
  if (metadata.reaction) return `Reagiu com: ${metadata.reaction}`;
  if (metadata.contactCard) {
    const phone = metadata.contactCard.phone ? `\n${metadata.contactCard.phone}` : '';
    return `[Contato compartilhado]\n${metadata.contactCard.displayName}${phone}`;
  }
  if (metadata.location) return '[Localização compartilhada]';
  if (metadata.systemLabel) return `[${metadata.systemLabel}]`;
  if (message?.stickerMessage) return '[Figurinha]';
  if (message?.audioMessage) return '[Mensagem de Áudio]';
  if (message?.imageMessage) return '[Imagem]';
  if (message?.videoMessage) return '[Vídeo]';
  if (message?.documentMessage) return '[Documento]';
  if (message?.pollCreationMessage) return '[Enquete]';
  if (message?.pollUpdateMessage) return '[Resposta de enquete]';
  if (interactive || message?.buttonsMessage || message?.listMessage) return '[Mensagem interativa]';
  return '[Mensagem não identificada]';
}

function providerMessageMedia(record: any) {
  const message = unwrapProviderMessage(record?.message);
  const candidates: Array<{ type: 'image' | 'audio' | 'video' | 'document' | 'sticker'; value: any }> = [
    { type: 'image', value: message?.imageMessage },
    { type: 'audio', value: message?.audioMessage },
    { type: 'video', value: message?.videoMessage },
    { type: 'document', value: message?.documentMessage },
    { type: 'sticker', value: message?.stickerMessage },
  ];
  const found = candidates.find((candidate) => candidate.value);
  if (!found) return undefined;
  const url = typeof found.value?.url === 'string' && found.value.url.startsWith('http')
    ? found.value.url
    : undefined;
  return { type: found.type, url };
}

function providerDocumentMetadata(message: any) {
  const document = message?.documentMessage;
  if (!document) return undefined;
  const fileName = firstProviderText(document.fileName, document.file_name, document.title);
  const mimeType = firstProviderText(document.mimetype, document.mimeType);
  const rawSize = Number(document.fileLength ?? document.fileSize ?? document.file_length);
  const fileSize = Number.isFinite(rawSize) && rawSize >= 0 ? Math.floor(rawSize) : undefined;
  if (!fileName && !mimeType && fileSize === undefined) return undefined;
  return {
    ...(fileName ? { fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(fileSize !== undefined ? { fileSize } : {}),
  };
}

function providerRemoteJid(record: any) {
  return String(record?.key?.remoteJid || record?.remoteJid || '').trim();
}

function providerPhone(record: any) {
  const remoteJid = providerRemoteJid(record);
  if (isWhatsAppGroupJid(remoteJid)) return remoteJid;
  const phoneJid = record?.key?.senderPn
    || record?.key?.participantPn
    || record?.senderPn
    || record?.key?.remoteJidAlt
    || record?.remoteJidAlt
    || remoteJid;
  const digits = String(phoneJid).split('@')[0]?.replace(/\D/g, '') || '';
  return digits.length >= 8 && digits.length <= 20 ? digits : '';
}

function providerMessageId(record: any) {
  const value = record?.key?.id || record?.id;
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function providerMessageDate(record: any) {
  const seconds = Number(record?.messageTimestamp || record?.message?.messageTimestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

function providerRecordToLocalMessage(record: any, fallbackPhone = '') {
  const media = providerMessageMedia(record);
  const fromMe = record?.key?.fromMe === true;
  const message = unwrapProviderMessage(record?.message);
  const metadata = providerMessageMetadata(record, message, fromMe);
  const remoteJid = providerRemoteJid(record);
  const isGroup = isWhatsAppGroupJid(remoteJid);
  const groupName = isGroup
    ? (providerGroupName(record) || providerGroupName(record?.chat) || providerGroupName(record?.groupMetadata))
    : '';
  // Evolution's fromMe only proves that the connected WhatsApp account sent
  // the message. Until an exact Hub outbox record is matched, it is external.
  if (fromMe) metadata.sentOutsideHub = true;
  const mediaDuration = media?.type === 'audio' || media?.type === 'video'
    ? Number(media?.type === 'audio' ? message?.audioMessage?.seconds : message?.videoMessage?.seconds)
    : undefined;
  return {
    id: providerMessageId(record),
    remoteJid,
    phone: isGroup ? remoteJid : providerPhone(record) || fallbackPhone.replace(/\D/g, ''),
    isGroup,
    groupName: groupName || undefined,
    groupAvatarUrl: isGroup
      ? (record?.profilePicUrl || record?.profilePictureUrl || record?.profilePicture || undefined)
      : undefined,
    sender: fromMe ? 'attendant' as const : 'contact' as const,
    senderName: fromMe
      ? undefined
      : (metadata.participantName || providerContactName(record) || record?.pushName || 'Contato'),
    content: providerMessageContent(record),
    mediaUrl: media?.url,
    mediaType: media?.type,
    mediaDuration: typeof mediaDuration === 'number' && Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : undefined,
    interactiveTitle: metadata.interactiveTitle,
    interactiveFooter: metadata.interactiveFooter,
    interactiveButtons: metadata.interactiveButtons,
    metadata,
    rawKey: record?.key,
    sentAt: providerMessageDate(record),
    status: normalizeProviderMessageStatus(record?.status || record?.update?.status) || 'sent',
  };
}

function localMessageToRealtimeMessage(local: ReturnType<typeof providerRecordToLocalMessage>) {
  const timestampMs = local.sentAt.getTime();
  return {
    id: local.id,
    conversationId: local.remoteJid,
    sender: local.sender,
    senderName: local.senderName,
    content: local.content,
    mediaUrl: local.mediaUrl,
    mediaType: local.mediaType,
    mediaDuration: local.mediaDuration,
    interactiveTitle: local.interactiveTitle,
    interactiveFooter: local.interactiveFooter,
    interactiveButtons: local.interactiveButtons,
    metadata: local.metadata,
    rawKey: local.rawKey,
    timestampMs,
    timestamp: local.sentAt.toISOString(),
    status: local.status,
    isInternalNote: false,
  };
}

function localMessageToProviderRecord(row: any) {
  const remoteJid = row.evolution_remote_jid;
  const id = row.evolution_message_id || row.id;
  const timestamp = Math.floor(new Date(row.sent_at).getTime() / 1000);
  const metadata = { ...(row.metadata || {}) };
  const key = {
    id,
    remoteJid,
    fromMe: row.sender === 'attendant',
    ...(metadata.participantJid ? { participant: metadata.participantJid } : {}),
  };
  if (Array.isArray(metadata.reactions)) {
    metadata.reactions = normalizeStoredReactions(metadata.reactions);
  }
  if (row.sender === 'attendant') {
    delete metadata.trafficSource;
    delete metadata.trafficTitle;
    delete metadata.trafficUrl;
  }
  const mediaMessage = row.media_type === 'image'
    ? { imageMessage: { url: row.media_url || undefined, caption: row.content } }
    : row.media_type === 'audio'
      ? { audioMessage: { url: row.media_url || undefined } }
      : row.media_type === 'video'
        ? { videoMessage: { url: row.media_url || undefined, caption: row.content } }
        : row.media_type === 'document'
          ? {
              documentMessage: {
                url: row.media_url || undefined,
                caption: row.content,
                fileName: metadata.document?.fileName,
                mimetype: metadata.document?.mimeType,
                fileLength: metadata.document?.fileSize,
              },
            }
          : row.media_type === 'sticker'
            ? { stickerMessage: { url: row.media_url || undefined } }
            : { conversation: row.content };
  return {
    key,
    message: mediaMessage,
    pushName: row.sender_name || 'Contato',
    messageTimestamp: timestamp,
    status: row.status,
    metadata,
    metadataScope: 'persisted_message',
    interactiveTitle: row.interactive_title || metadata.interactiveTitle,
    interactiveFooter: row.interactive_footer || metadata.interactiveFooter,
    interactiveButtons: row.interactive_buttons || metadata.interactiveButtons,
  };
}

function storedMessageToRealtimeMessage(row: any) {
  const timestampMs = new Date(row.sent_at).getTime();
  const id = row.evolution_message_id || row.id;
  return {
    id,
    conversationId: row.evolution_remote_jid,
    sender: row.sender,
    senderName: row.sender_name || undefined,
    content: row.content,
    mediaUrl: row.media_url || undefined,
    mediaType: row.media_type || undefined,
    metadata: row.metadata || {},
    rawKey: {
      id,
      remoteJid: row.evolution_remote_jid,
      fromMe: row.sender === 'attendant',
      ...(row.metadata?.participantJid ? { participant: row.metadata.participantJid } : {}),
    },
    timestampMs,
    timestamp: new Date(timestampMs).toISOString(),
    status: row.status,
    isInternalNote: false,
  };
}

type ProviderPersistenceResult = {
  persisted: boolean;
  ignored?: boolean;
  reaction?: boolean;
  originalFound?: boolean;
  message?: any;
};

async function persistProviderReaction(companyId: string, record: any) {
  const update = providerReactionUpdate(record);
  if (!update) return undefined;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // reactionMessage.key.id is the only association used here. If the
    // original has not arrived yet, no visual message is invented.
    const original = await client.query<{
      id: string;
      evolution_message_id: string | null;
      sender: 'contact' | 'attendant' | 'system';
      sender_name: string | null;
      content: string;
      media_url: string | null;
      media_type: string | null;
      metadata: Record<string, any>;
      status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
      sent_at: string;
      evolution_remote_jid: string;
    }>(
      `SELECT m.id, m.evolution_message_id, m.sender, m.sender_name, m.content,
              m.media_url, m.media_type, m.metadata, m.status, m.sent_at,
              c.evolution_remote_jid
       FROM messages m
       INNER JOIN conversations c ON c.id = m.conversation_id
       WHERE m.company_id = $1
         AND (m.evolution_message_id = $2 OR m.id::text = $2)
       ORDER BY m.sent_at DESC
       LIMIT 1
       FOR UPDATE`,
      [companyId, update.targetMessageId],
    );
    const row = original.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return { persisted: false, reaction: true, originalFound: false, message: undefined };
    }

    const storedReactions = Array.isArray(row.metadata?.reactions)
      ? row.metadata.reactions
      : [];
    const reactions = normalizeStoredReactions(storedReactions);
    const nextReactions = applyProviderReaction(reactions, update);
    const metadataNeedsNormalization = Boolean(row.metadata?.reaction)
      || !areStoredReactionsEqual(storedReactions, reactions);
    if (nextReactions === reactions && !metadataNeedsNormalization) {
      await client.query('COMMIT');
      // An equivalent provider event must not cause a second realtime update
      // for the original message.
      return { persisted: false, reaction: true, originalFound: true, message: undefined };
    }

    const metadata = { ...(row.metadata || {}) };
    delete metadata.reaction;
    if (nextReactions.length) metadata.reactions = nextReactions;
    else delete metadata.reactions;
    const updated = await client.query<{ metadata: Record<string, any> }>(
      `UPDATE messages
       SET metadata = $1::jsonb
       WHERE id = $2
       RETURNING metadata`,
      [JSON.stringify(metadata), row.id],
    );
    row.metadata = updated.rows[0]?.metadata || metadata;
    await client.query('COMMIT');
    localInboxCache.delete(companyId);
    return { persisted: false, reaction: true, originalFound: true, message: storedMessageToRealtimeMessage(row) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Persists a Hub-initiated reaction on its target message. A reaction never
 * creates a message or mutates conversation activity; the webhook only
 * confirms this same metadata later.
 */
async function persistHubReaction(input: {
  message: {
    id: string;
    evolution_message_id: string;
    sender: 'contact' | 'attendant' | 'system';
    sender_name: string | null;
    content: string;
    media_url: string | null;
    media_type: string | null;
    metadata: Record<string, any>;
    status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
    sent_at: string;
    evolution_remote_jid: string;
  };
  emoji: string;
  user: { id: string; name: string };
}) {
  const current = normalizeStoredReactions(input.message.metadata?.reactions);
  const reactions = applyProviderReaction(current, {
    targetMessageId: input.message.evolution_message_id,
    reactorKey: HUB_REACTOR_KEY,
    emoji: input.emoji,
    fromMe: true,
    updatedAt: Date.now(),
    actorId: input.user.id,
    actorName: input.user.name,
  });
  if (reactions === current && !input.message.metadata?.reaction) {
    return storedMessageToRealtimeMessage(input.message);
  }

  const metadata = { ...(input.message.metadata || {}) };
  delete metadata.reaction;
  if (reactions.length) metadata.reactions = reactions;
  else delete metadata.reactions;
  const updated = await db.query<{ metadata: Record<string, any> }>(
    `UPDATE messages
     SET metadata = $1::jsonb
     WHERE id = $2::uuid
     RETURNING metadata`,
    [JSON.stringify(metadata), input.message.id],
  );
  input.message.metadata = updated.rows[0]?.metadata || metadata;
  return storedMessageToRealtimeMessage(input.message);
}

async function hydrateQuotedMessageMetadata(
  client: Pick<PoolClient, 'query'>,
  companyId: string,
  metadata: Record<string, any>,
  fallbackRemoteJid: string,
) {
  const quoted = normalizedQuotedMessage(metadata?.quotedMessage, fallbackRemoteJid);
  if (!quoted) return metadata;

  const original = await client.query<{
    evolution_message_id: string | null;
    sender: 'contact' | 'attendant' | 'system';
    sender_name: string | null;
    content: string;
    media_type: QuotedMessage['mediaType'] | null;
    evolution_remote_jid: string;
  }>(
    `SELECT m.evolution_message_id, m.sender, m.sender_name, m.content, m.media_type, c.evolution_remote_jid
     FROM messages m
     INNER JOIN conversations c ON c.id = m.conversation_id
     WHERE m.company_id = $1
       AND (m.evolution_message_id = $2 OR m.id::text = $2)
     ORDER BY m.sent_at DESC
     LIMIT 1`,
    [companyId, quoted.messageId],
  );
  const row = original.rows[0];
  if (!row) return { ...metadata, quotedMessage: quoted };

  return {
    ...metadata,
    quotedMessage: {
      ...quoted,
      messageId: row.evolution_message_id || quoted.messageId,
      authorName: row.sender_name || (row.sender === 'contact' ? 'Contato' : 'Enviado fora do Vitstock Hub'),
      sender: row.sender,
      content: row.content,
      mediaType: row.media_type || undefined,
      key: {
        ...quoted.key,
        id: row.evolution_message_id || quoted.messageId,
        remoteJid: row.evolution_remote_jid || quoted.key?.remoteJid,
        fromMe: row.sender === 'attendant',
      },
    },
  };
}

async function findOrCreateConversation(
  client: Pick<PoolClient, 'query'>,
  input: {
    companyId: string;
    contactId: string;
    remoteJid: string;
    lastMessage: string;
    lastMessageAt: Date;
    reopenResolved: boolean;
    assignedUserId?: string;
    isGroup?: boolean;
    groupName?: string;
    groupAvatarUrl?: string;
  },
) {
  // Uma Conversation representa uma identidade remota específica. Nunca
  // reutilize uma thread apenas porque o contact_id coincide.
  const existing = await client.query<{ id: string }>(
    `SELECT id
     FROM conversations
     WHERE company_id = $1
       AND evolution_remote_jid = $3
     ORDER BY updated_at DESC
     LIMIT 1
     FOR UPDATE`,
    [input.companyId, input.contactId, input.remoteJid],
  );
  const existingId = existing.rows[0]?.id;
  if (existingId) {
    await client.query(
      `UPDATE conversations
       SET contact_id = $2,
           last_message = CASE
             WHEN $3 >= COALESCE(last_message_at, to_timestamp(0)) THEN $4
             ELSE last_message
           END,
           last_message_at = CASE
             WHEN $3 >= COALESCE(last_message_at, to_timestamp(0)) THEN $3
             ELSE last_message_at
           END,
           status = CASE
             WHEN $5 AND status = 'resolved' THEN 'open'
             ELSE status
           END,
           is_group = COALESCE($6, conversations.is_group),
           group_name = COALESCE(NULLIF($7, ''), conversations.group_name),
           group_avatar_url = COALESCE(NULLIF($8, ''), conversations.group_avatar_url),
           updated_at = now()
       WHERE id = $1`,
      [existingId, input.contactId, input.lastMessageAt, input.lastMessage, input.reopenResolved, input.isGroup ?? false, input.groupName || '', input.groupAvatarUrl || ''],
    );
    return existingId;
  }

  const created = input.assignedUserId
    ? await client.query<{ id: string }>(
      `INSERT INTO conversations
        (company_id, contact_id, evolution_remote_jid, assigned_user_id, status, last_message, last_message_at, is_group, group_name, group_avatar_url)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''))
       ON CONFLICT (company_id, evolution_remote_jid) DO UPDATE SET
         last_message = CASE
           WHEN EXCLUDED.last_message_at >= COALESCE(conversations.last_message_at, to_timestamp(0)) THEN EXCLUDED.last_message
           ELSE conversations.last_message
         END,
         last_message_at = CASE
           WHEN EXCLUDED.last_message_at >= COALESCE(conversations.last_message_at, to_timestamp(0)) THEN EXCLUDED.last_message_at
           ELSE conversations.last_message
         END,
         updated_at = now()
       RETURNING id`,
      [input.companyId, input.contactId, input.remoteJid, input.assignedUserId, input.lastMessage, input.lastMessageAt, input.isGroup ?? false, input.groupName || '', input.groupAvatarUrl || ''],
    )
    : await client.query<{ id: string }>(
      `INSERT INTO conversations
        (company_id, contact_id, evolution_remote_jid, status, last_message, last_message_at, is_group, group_name, group_avatar_url)
       VALUES ($1, $2, $3, 'open', $4, $5, $7, NULLIF($8, ''), NULLIF($9, ''))
       ON CONFLICT (company_id, evolution_remote_jid) DO UPDATE SET
         contact_id = EXCLUDED.contact_id,
         last_message = CASE
           WHEN EXCLUDED.last_message_at >= COALESCE(conversations.last_message_at, to_timestamp(0)) THEN EXCLUDED.last_message
           ELSE conversations.last_message
         END,
         last_message_at = CASE
           WHEN EXCLUDED.last_message_at >= COALESCE(conversations.last_message_at, to_timestamp(0)) THEN EXCLUDED.last_message_at
           ELSE conversations.last_message_at
         END,
         status = CASE
           WHEN $6 AND conversations.status = 'resolved' THEN 'open'
           ELSE conversations.status
         END,
         updated_at = now()
       RETURNING id`,
      [input.companyId, input.contactId, input.remoteJid, input.lastMessage, input.lastMessageAt, input.reopenResolved, input.isGroup ?? false, input.groupName || '', input.groupAvatarUrl || ''],
    );
  const conversationId = created.rows[0]?.id;
  if (!conversationId) throw new Error('Conversa não pôde ser preparada');
  return conversationId;
}

async function persistProviderMessage(
  companyId: string,
  record: any,
  options: { incrementUnread: boolean; reopen: boolean; fallbackPhone?: string },
): Promise<ProviderPersistenceResult | undefined> {
  if (isNonRenderableProviderMessage(record)) {
    return { persisted: false, ignored: true, message: undefined };
  }
  if (isProviderReactionEvent(record)) {
    return persistProviderReaction(companyId, record);
  }
  const local = providerRecordToLocalMessage(record, options.fallbackPhone);
  if (!local.id || !local.remoteJid || !local.phone) return undefined;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    local.metadata = await hydrateQuotedMessageMetadata(client, companyId, local.metadata || {}, local.remoteJid);
    const isGroup = Boolean(local.isGroup) || isWhatsAppGroupJid(local.remoteJid);
    const groupName = isGroup ? local.groupName : undefined;
    const displayGroupName = groupName || `Grupo ${local.remoteJid.split('@')[0]}`;
    const contactPhone = isGroup ? local.remoteJid : `+${local.phone}`;
    const contactName = isGroup
      ? displayGroupName
      : local.sender === 'contact' ? local.senderName : `+${local.phone}`;
    const conversationPreview = isGroup
      ? `${local.senderName || (local.sender === 'attendant' ? 'Atendente' : 'Participante')}: ${local.content}`
      : local.content;
    const contact = await client.query<{ id: string }>(
      `INSERT INTO contacts (company_id, name, phone, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, phone) DO UPDATE SET
         name = CASE
           WHEN contacts.source = 'google' THEN contacts.name
           WHEN $5::boolean AND EXCLUDED.name <> '' THEN EXCLUDED.name
           WHEN EXCLUDED.name !~ '^\\+?[0-9\\s().-]+$'
             AND (contacts.name ~ '^\\+?[0-9\\s().-]+$' OR contacts.name IN ('Contato', 'WhatsApp Business', 'Você'))
             THEN EXCLUDED.name
           ELSE contacts.name
         END,
         avatar_url = COALESCE(EXCLUDED.avatar_url, contacts.avatar_url),
         updated_at = now()
       RETURNING id`,
      [companyId, contactName, contactPhone, local.groupAvatarUrl || null, isGroup && Boolean(groupName)],
    );
    const contactId = contact.rows[0]?.id;
    if (!contactId) throw new Error('Contato não pôde ser preparado para a mensagem recebida');

    if (!isGroup) {
      await client.query(
        `INSERT INTO contact_phones (company_id, contact_id, phone, normalized_phone, is_primary, source)
         VALUES ($1, $2, $3, $4, true, 'whatsapp')
         ON CONFLICT (contact_id, normalized_phone) DO UPDATE SET updated_at = now()`,
        [companyId, contactId, contactPhone, contactPhone.replace(/\D/g, '')],
      );
    }

    await client.query(
      `INSERT INTO contact_channel_identities (company_id, contact_id, channel, identity, identity_type)
       VALUES ($1, $2, 'whatsapp', $3, $4)
       ON CONFLICT (company_id, channel, identity) DO UPDATE SET contact_id = EXCLUDED.contact_id, updated_at = now()`,
      [companyId, contactId, local.remoteJid, local.remoteJid.endsWith('@lid') ? 'lid' : 'remote_jid'],
    );

    const conversationId = await findOrCreateConversation(client, {
      companyId,
      contactId,
      remoteJid: local.remoteJid,
      lastMessage: conversationPreview,
      lastMessageAt: local.sentAt,
      reopenResolved: options.reopen && local.sender === 'contact',
      isGroup,
      groupName,
      groupAvatarUrl: local.groupAvatarUrl,
    });
    if (!conversationId) throw new Error('Conversa não pôde ser preparada para a mensagem recebida');

    const messageParams = [
      companyId,
      conversationId,
      local.id,
      local.sender,
      local.senderName,
      local.content,
      local.mediaUrl || null,
      local.mediaType || null,
      JSON.stringify(local.metadata || {}),
      local.status,
      local.sentAt,
    ];

    // Do not infer Hub authorship by matching timestamp/content to a pending
    // row. The exact Evolution id returned by the send endpoint is the only
    // accepted correlation for internal authorship.
    const inserted = await client.query<{ id: string }>(
        `INSERT INTO messages
         (company_id, conversation_id, evolution_message_id, sender, sender_name, content, media_url, media_type, metadata, status, sent_at, is_internal_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)
         ON CONFLICT (company_id, evolution_message_id) DO NOTHING
         RETURNING id`,
        messageParams,
      );
    const insertedNewMessage = Boolean(inserted.rowCount);

    // Reprocessamentos podem trazer metadados ou mídia que não existiam na
    // primeira entrega. Preservamos autoria interna somente quando já existe
    // evidência persistida de um envio do Hub.
    if (!insertedNewMessage) {
      const refreshed = await client.query<{ sender_name: string | null; metadata: Record<string, any> }>(
          `UPDATE messages
            SET metadata = (
                  CASE
                    WHEN COALESCE(messages.metadata->>'sentByHub', 'false') = 'true' THEN
                      (COALESCE(messages.metadata, '{}'::jsonb)
                        - 'trafficSource' - 'trafficTitle' - 'trafficUrl' - 'sentOutsideHub')
                      || ($1::jsonb - 'sentOutsideHub')
                    ELSE
                      (COALESCE(messages.metadata, '{}'::jsonb)
                        - 'trafficSource' - 'trafficTitle' - 'trafficUrl'
                        - 'sentByHub' - 'sentByUserId' - 'sentByUserName')
                      || $1::jsonb
                  END
                ),
                sender_name = CASE
                  WHEN messages.sender = 'contact'
                    AND COALESCE($2::text, '') <> ''
                  THEN $2::text
                  ELSE messages.sender_name
                END,
                content = CASE
                  WHEN messages.content ILIKE '[mensagem%suportada]'
                    OR messages.content ILIKE '[mensagem%identificada]'
                  THEN $3
                  ELSE messages.content
                END,
                media_url = COALESCE(messages.media_url, $4),
                media_type = COALESCE(messages.media_type, $5),
                status = CASE
                  WHEN messages.status IN ('failed', 'read') THEN messages.status
                  WHEN $6 = 'failed' THEN 'failed'
                  WHEN $6 = 'read' THEN 'read'
                  WHEN $6 = 'delivered' THEN 'delivered'
                  WHEN messages.status = 'pending' THEN $6
                  ELSE messages.status
                END,
                sent_at = $7
            WHERE company_id = $8
              AND evolution_message_id = $9
            RETURNING sender_name, metadata`,
           [
             JSON.stringify(local.metadata || {}),
             local.senderName,
             local.content,
             local.mediaUrl || null,
             local.mediaType || null,
             local.status,
             local.sentAt,
             companyId,
             local.id,
           ],
        );
      const persistedRow = refreshed.rows[0];
      if (persistedRow) {
        local.senderName = persistedRow.sender_name || undefined;
        local.metadata = persistedRow.metadata || {};
        if (local.metadata?.sentByHub === true) {
          local.content = removeHubAgentPrefix(local.content, local.senderName);
        }
      }
    }

    if (insertedNewMessage && options.incrementUnread && local.sender === 'contact') {
      await client.query('UPDATE conversations SET unread_count = unread_count + 1, updated_at = now() WHERE id = $1', [conversationId]);
    }
    await client.query('COMMIT');
    localInboxCache.delete(companyId);
    return {
      persisted: insertedNewMessage,
      message: localMessageToRealtimeMessage(local),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function extractWebhookMessageStatus(body: any) {
  const data = body?.data || body?.payload || body;
  const messageId = data?.key?.id || data?.message?.key?.id || data?.id || data?.messageId;
  const rawStatus = data?.update?.status
    ?? data?.status
    ?? data?.message?.status
    ?? data?.key?.status;
  const status = normalizeProviderMessageStatus(rawStatus);
  return typeof messageId === 'string' && status ? { messageId, status } : undefined;
}

async function recordDailyResponder(companyId: string, number: string, user: { id: string; name: string }) {
  if (isWhatsAppGroupJid(number)) return undefined;
  const remoteJid = canonicalPhoneJid(number);
  const existing = await db.query<{
    user_id: string;
    user_name: string;
    response_date: string;
  }>(
    `SELECT first_user_id AS user_id, first_user_name AS user_name, response_date
     FROM conversation_daily_responders
     WHERE company_id = $1
       AND evolution_remote_jid = $2
       AND response_date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date
     LIMIT 1`,
    [companyId, remoteJid],
  );

  if (!existing.rows[0]) {
    await db.query(
      `INSERT INTO conversation_daily_responders
        (company_id, evolution_remote_jid, response_date, first_user_id, first_user_name)
       VALUES ($1, $2, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date, $3, $4)
       ON CONFLICT (company_id, evolution_remote_jid, response_date) DO NOTHING`,
      [companyId, remoteJid, user.id, user.name],
    );
  }

  const result = await db.query<{
    user_id: string;
    user_name: string;
    response_date: string;
  }>(
    `SELECT first_user_id AS user_id, first_user_name AS user_name, response_date
     FROM conversation_daily_responders
     WHERE company_id = $1
       AND evolution_remote_jid = $2
       AND response_date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date
     LIMIT 1`,
    [companyId, remoteJid],
  );
  const first = result.rows[0];
  return first ? { id: first.user_id, name: first.user_name, date: first.response_date } : undefined;
}

async function ensureOutboundMessage(input: {
  companyId: string;
  userId: string;
  userName: string;
  number: string;
  remoteJid: string;
  content: string;
  mediaType?: 'image' | 'video' | 'document';
  document?: { fileName?: string; mimeType?: string; fileSize?: number };
  clientMessageId?: string;
  quotedMessage?: QuotedMessage;
}) {
  const persistenceStartedAt = Date.now();
  let idempotencyLockMs: number | undefined;
  const quotedMessage = normalizedQuotedMessage(input.quotedMessage, input.remoteJid);
  const client = await db.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    if (input.clientMessageId) {
      // This lock covers the outbox lookup and insert across concurrent API
      // requests and workers. It is keyed only by explicit persisted IDs.
      const lockStartedAt = Date.now();
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        [outboundIdempotencyLockKey(input.companyId, input.clientMessageId)],
      );
      idempotencyLockMs = Date.now() - lockStartedAt;
    }
    const isGroup = isWhatsAppGroupJid(input.remoteJid);
    const contactPhone = isGroup ? input.remoteJid : `+${input.number.replace(/\D/g, '')}`;
    const contactName = isGroup ? `Grupo ${input.remoteJid.split('@')[0]}` : contactPhone;
    const conversationPreview = isGroup ? `${input.userName}: ${input.content}` : input.content;
    const contact = await client.query<{ id: string }>(
    `INSERT INTO contacts (company_id, name, phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id, phone) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [input.companyId, contactName, contactPhone],
  );
  const contactId = contact.rows[0]?.id;
  if (!contactId) throw new Error('Contato não pôde ser preparado para o envio');

    if (!isGroup) {
      await client.query(
        `INSERT INTO contact_phones (company_id, contact_id, phone, normalized_phone, is_primary, source)
         VALUES ($1, $2, $3, $4, true, 'whatsapp')
         ON CONFLICT (contact_id, normalized_phone) DO UPDATE SET updated_at = now()`,
        [input.companyId, contactId, contactPhone, contactPhone.replace(/\D/g, '')],
      );
    }

    await client.query(
      `INSERT INTO contact_channel_identities (company_id, contact_id, channel, identity, identity_type)
       VALUES ($1, $2, 'whatsapp', $3, $4)
       ON CONFLICT (company_id, channel, identity) DO UPDATE SET contact_id = EXCLUDED.contact_id, updated_at = now()`,
      [input.companyId, contactId, input.remoteJid, input.remoteJid.endsWith('@lid') ? 'lid' : 'remote_jid'],
    );

    const conversationId = await findOrCreateConversation(client, {
    companyId: input.companyId,
    contactId,
    remoteJid: input.remoteJid,
    lastMessage: conversationPreview,
    lastMessageAt: new Date(),
    reopenResolved: true,
    assignedUserId: input.userId,
    isGroup,
    groupName: undefined,
  });
  if (!conversationId) throw new Error('Conversa não pôde ser preparada para o envio');

  if (input.clientMessageId) {
    const existing = await client.query<{
      id: string;
      conversation_id: string;
      evolution_message_id: string | null;
      status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
    }>(
      `SELECT id, conversation_id, evolution_message_id, status
       FROM messages
       WHERE company_id = $1
         AND metadata->>'clientMessageId' = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.companyId, input.clientMessageId],
    );
    const previous = existing.rows[0];
    if (previous) {
      if (outboundDispatchAction(previous.status) === 'retry') {
        await client.query(
          `UPDATE messages
           SET status = 'pending', sent_at = now()
           WHERE id = $1`,
          [previous.id],
        );
        await client.query('COMMIT');
        transactionStarted = false;
        localInboxCache.delete(input.companyId);
        return {
          conversationId: previous.conversation_id,
          messageId: previous.id,
          evolutionMessageId: previous.evolution_message_id,
          status: 'pending' as const,
          deduplicated: false,
          persistenceMs: Date.now() - persistenceStartedAt,
          idempotencyLockMs,
        };
      }
      await client.query('COMMIT');
      transactionStarted = false;
      return {
        conversationId: previous.conversation_id,
        messageId: previous.id,
        evolutionMessageId: previous.evolution_message_id,
        status: previous.status,
        deduplicated: true,
        persistenceMs: Date.now() - persistenceStartedAt,
        idempotencyLockMs,
      };
    }
  }

    const message = await client.query<{ id: string }>(
    `INSERT INTO messages
      (company_id, conversation_id, sender, sender_name, content, media_type, metadata, status, is_internal_note)
     VALUES ($1, $2, 'attendant', $3, $4, $5, $6::jsonb, 'pending', false)
     RETURNING id`,
    [
      input.companyId,
      conversationId,
      input.userName,
      input.content,
      input.mediaType || null,
      JSON.stringify({
        ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
        sentByHub: true,
        sentByUserId: input.userId,
        sentByUserName: input.userName,
        ...(input.document ? { document: input.document } : {}),
        ...(quotedMessage
          ? { quotedMessage }
          : {}),
      }),
    ],
  );
  const messageId = message.rows[0]?.id;
  if (!messageId) throw new Error('Mensagem não pôde ser registrada');
    await client.query('COMMIT');
    transactionStarted = false;
    localInboxCache.delete(input.companyId);
    return {
    conversationId,
    messageId,
    evolutionMessageId: null,
    status: 'pending' as const,
    deduplicated: false,
    persistenceMs: Date.now() - persistenceStartedAt,
    idempotencyLockMs,
    };
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateOutboundMessage(messageId: string, status: 'sent' | 'failed', evolutionMessageId?: string) {
  try {
    await db.query(
      `UPDATE messages
       SET status = $2,
           evolution_message_id = COALESCE($3, evolution_message_id),
           sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
       WHERE id = $1`,
      [messageId, status, evolutionMessageId || null],
    );
  } catch (error: any) {
    // Se o webhook vinculou o ID alguns milissegundos antes, a restrição
    // única pode bloquear esta atualização. Nesse caso, consolidamos o estado
    // no registro do provedor e removemos somente a linha local pendente.
    if (error?.code !== '23505' || !evolutionMessageId) throw error;
    const pendingMessage = await db.query<{ sender_name: string | null; metadata: Record<string, any> }>(
      `SELECT sender_name, metadata
       FROM messages
       WHERE id = $1
       LIMIT 1`,
      [messageId],
    );
    const providerMessage = await db.query<{ id: string }>(
      `SELECT id
       FROM messages
       WHERE evolution_message_id = $1
       LIMIT 1`,
      [evolutionMessageId],
    );
    const pending = pendingMessage.rows[0];
    if (!providerMessage.rows[0] || !pending) throw error;
    await db.query(
      `UPDATE messages
       SET sender_name = $2,
           metadata = (COALESCE(metadata, '{}'::jsonb) - 'sentOutsideHub') || $3::jsonb,
           status = CASE
             WHEN status IN ('read', 'delivered') AND $4 = 'sent' THEN status
             WHEN status = 'failed' AND $4 <> 'failed' THEN status
             ELSE $4
           END
       WHERE id = $1`,
      [providerMessage.rows[0].id, pending.sender_name, JSON.stringify(pending.metadata || {}), status],
    );
    await db.query(
      `DELETE FROM messages
       WHERE id = $1 AND evolution_message_id IS NULL`,
      [messageId],
    );
  }
}

export async function registerEvolutionRoutes(app: FastifyInstance) {
  app.get('/api/evolution/events', { preHandler: requireUser }, async (request, reply) => {
    // EventSource não passa pelo ciclo normal de resposta do Fastify: o stream
    // fica aberto e recebe somente eventos da empresa do usuário autenticado.
    const origin = request.headers.origin;
    if (origin && !isAllowedFrontendOrigin(origin)) {
      return reply.code(403).send({ error: 'Origem nÃ£o autorizada' });
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin || config.FRONTEND_URL,
      'Access-Control-Allow-Credentials': 'true',
    });
    reply.raw.write(': connected\n\n');
    registerRealtimeClient(request.user!.companyId, reply.raw);
  });

  app.get('/api/evolution/status', { preHandler: requireUser }, async (_request, reply) => {
    return forwardEvolutionRequest(
      `/instance/connectionState/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      reply,
    );
  });

  app.get('/api/evolution/connect', { preHandler: requireUser }, async (_request, reply) => {
    return forwardEvolutionRequest(
      `/instance/connect/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      reply,
    );
  });

  app.post('/api/evolution/logout', { preHandler: requireUser }, async (_request, reply) => {
    return forwardEvolutionRequest(
      `/instance/logout/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      reply,
      { method: 'DELETE', body: '{}' },
    );
  });

  app.get('/api/evolution/chats', { preHandler: requireUser }, async (_request, reply) => {
    let snapshot: { chats: any[]; contacts: any[] };
    let usingLocalInboxFallback = false;
    try {
      snapshot = await fetchEvolutionChatsSnapshot(_request.user!.companyId);
    } catch (error) {
      _request.log.warn({ err: error }, 'Evolution nÃ£o respondeu a consulta de conversas');
      try {
        snapshot = { chats: await fetchLocalInboxChats(_request.user!.companyId), contacts: [] };
        usingLocalInboxFallback = true;
      } catch (localError) {
        _request.log.error({ err: localError }, 'NÃ£o foi possÃ­vel recuperar o inbox persistido');
        return reply.code(503).send({ error: 'NÃ£o foi possível carregar as conversas agora' });
      }
    }
    if (snapshot.chats.length === 0) {
      try {
        const localChats = await fetchLocalInboxChats(_request.user!.companyId);
        if (localChats.length > 0) {
          snapshot = { chats: localChats, contacts: snapshot.contacts };
          usingLocalInboxFallback = true;
        }
      } catch (error) {
        _request.log.warn({ err: error }, 'Inbox local indisponÃ­vel durante a resposta vazia da Evolution');
      }
    }
    let chatsData = snapshot.chats;
    const contactsData = snapshot.contacts;
    // O webhook pode chegar antes da próxima atualização da Evolution. Mesclamos
    // o estado local recente sem substituir o snapshot do provedor.
    try {
      const localChats = await fetchLocalInboxChats(_request.user!.companyId);
      const knownRemoteJids = new Set(chatsData.map((chat: any) => String(chat?.remoteJid || chat?.id || '')));
      const knownPhones = new Set(chatsData.map((chat: any) => providerContactPhone(chat)).filter(Boolean));
      const localByRemoteJid = new Map(localChats.map((chat: any) => [String(chat?.remoteJid || chat?.id || ''), chat]));
      const localByPhone = new Map(localChats
        .map((chat: any) => [providerContactPhone(chat), chat] as const)
        .filter(([phone]) => Boolean(phone)));
      chatsData = chatsData.map((chat: any) => {
        // A reaction is a metadata update, not a chat activity. Evolution may
        // still expose it as lastMessage in findChats, so always replace it
        // with the last persisted user-visible message before serializing the
        // inbox snapshot.
        if (!isNonRenderableProviderMessage(chat?.lastMessage) && !isProviderReactionEvent(chat?.lastMessage)) return chat;
        return localByRemoteJid.get(String(chat?.remoteJid || chat?.id || ''))
          || localByPhone.get(providerContactPhone(chat))
          || { ...chat, lastMessage: undefined };
      });
      const missingLocalChats = localChats.filter((chat: any) => {
        const remoteJid = String(chat?.remoteJid || chat?.id || '');
        const phone = providerContactPhone(chat);
        return !knownRemoteJids.has(remoteJid) && (!phone || !knownPhones.has(phone));
      });
      if (missingLocalChats.length > 0) chatsData = [...chatsData, ...missingLocalChats];
    } catch (error) {
      _request.log.warn({ err: error }, 'Não foi possível mesclar o inbox persistido');
    }
    const providerNames = new Map<string, { phone: string; name: string; avatar_url: string | null }>();
    const rememberProviderContact = (value: any) => {
      const phone = providerContactPhone(value);
      const name = providerContactName(value);
      if (!phone || !name) return;
      providerNames.set(phone, {
        phone,
        name,
        avatar_url: value?.profilePicUrl || value?.profilePictureUrl || null,
      });
    };
    (Array.isArray(contactsData) ? contactsData : []).forEach(rememberProviderContact);
    (Array.isArray(chatsData) ? chatsData : []).forEach((chat: any) => {
      rememberProviderContact(chat);
      rememberProviderContact(chat?.lastMessage);
    });
    if (!usingLocalInboxFallback && providerNames.size > 0) {
      try {
        await db.query(
          `INSERT INTO whatsapp_contact_names (company_id, phone, name, avatar_url)
           SELECT $1, item.phone, item.name, item.avatar_url
           FROM jsonb_to_recordset($2::jsonb) AS item(phone text, name text, avatar_url text)
           ON CONFLICT (company_id, phone) DO UPDATE SET
             name = EXCLUDED.name,
             avatar_url = COALESCE(EXCLUDED.avatar_url, whatsapp_contact_names.avatar_url),
             updated_at = now()`,
          [_request.user!.companyId, JSON.stringify(Array.from(providerNames.values()))],
        );
      } catch (error) {
        _request.log.warn({ err: error }, 'Tabela de nomes do WhatsApp ainda não está disponível');
      }
    }
    let storedContacts: { rows: Array<{ name: string; phone: string; source: string }> };
    let assignments: { rows: Array<{ evolution_remote_jid: string; user_id: string; user_name: string }> };
    let leases: { rows: Array<{ evolution_remote_jid: string; phone: string; owner_user_id: string; owner_name: string; expires_at: string }> };
    let statuses: { rows: Array<{ evolution_remote_jid: string; status: 'open' | 'pending' | 'resolved'; updated_at: string }> };
    let readStates: { rows: Array<{ evolution_remote_jid: string; last_read_message_timestamp: string }> };
    try {
      [storedContacts, assignments, leases, statuses, readStates] = await Promise.all([db.query<{
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
      phone: string;
      owner_user_id: string;
      owner_name: string;
      expires_at: string;
    }>(
      `SELECT c.evolution_remote_jid, contact.phone, lease.owner_user_id, user_account.name AS owner_name, lease.expires_at
       FROM conversation_leases lease
       JOIN conversations c ON c.id = lease.conversation_id
       JOIN contacts contact ON contact.id = c.contact_id
       JOIN users user_account ON user_account.id = lease.owner_user_id
       WHERE lease.company_id = $1
         AND lease.expires_at > now()`,
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
    } catch (error) {
      _request.log.error({ err: error }, 'Banco indisponível ao montar o inbox');
      return reply.code(503).send({ error: 'Banco de dados temporariamente indisponível' });
    }
    let whatsappNames: { rows: Array<{ phone: string; name: string; avatar_url: string | null }> } = { rows: [] };
    try {
      whatsappNames = await db.query(
        `SELECT phone, name, avatar_url
         FROM whatsapp_contact_names
         WHERE company_id = $1`,
        [_request.user!.companyId],
      );
    } catch (error) {
      _request.log.warn({ err: error }, 'Tabela de nomes do WhatsApp ainda não está disponível');
    }
    let dailyResponders: { rows: Array<{ evolution_remote_jid: string; user_id: string; user_name: string; response_date: string }> } = { rows: [] };
    try {
      dailyResponders = await db.query(
        `SELECT evolution_remote_jid, first_user_id AS user_id, first_user_name AS user_name, response_date
         FROM conversation_daily_responders
         WHERE company_id = $1
           AND response_date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`,
        [_request.user!.companyId],
      );
    } catch (error) {
      _request.log.warn({ err: error }, 'Tabela de primeiros atendentes ainda nÃ£o estÃ¡ disponÃ­vel');
    }
    return {
      chats: chatsData,
      contacts: contactsData,
      storedContacts: storedContacts.rows,
      whatsappNames: whatsappNames.rows,
      assignments: assignments.rows,
      leases: leases.rows,
      statuses: statuses.rows,
      readStates: readStates.rows,
      dailyResponders: dailyResponders.rows,
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
    publishRealtimeEvent(currentUser.companyId, 'conversation.updated', {
      remoteJid: parsed.data.remoteJid,
      phone: parsed.data.phone || '',
      assignedUserId: currentUser.id,
      assignedUserName: currentUser.name,
    });
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
    publishRealtimeEvent(currentUser.companyId, 'conversation.updated', {
      remoteJid: parsed.data.remoteJid,
      phone: parsed.data.phone || '',
      assignedUserId: null,
      assignedUserName: null,
    });
    return { released: true, remoteJid: parsed.data.remoteJid };
  });

  app.post('/api/evolution/chats/pull-lease', { preHandler: requireUser }, async (request, reply) => {
    const parsed = assignmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Conversa inv\u00e1lida' });
    const currentUser = request.user!;
    const conversationId = await findConversationForLease({
      companyId: currentUser.companyId,
      remoteJid: parsed.data.remoteJid,
      phone: parsed.data.phone,
    });
    if (!conversationId) return reply.code(404).send({ error: 'Conversa ainda n\u00e3o est\u00e1 dispon\u00edvel para atendimento' });

    const outcome = await acquireConversationLease(db, {
      companyId: currentUser.companyId,
      conversationId,
      userId: currentUser.id,
      force: true,
    });
    publishRealtimeEvent(currentUser.companyId, 'conversation.updated', leaseRealtimePayload({
      remoteJid: parsed.data.remoteJid,
      phone: parsed.data.phone,
      lease: outcome.lease,
    }));
    return { remoteJid: parsed.data.remoteJid, lease: outcome.lease };
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

    publishRealtimeEvent(request.user!.companyId, 'conversation.updated', {
      remoteJid: parsed.data.remoteJid,
      phone: parsed.data.phone || '',
      status: parsed.data.status,
    });
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

    publishRealtimeEvent(request.user!.companyId, 'conversation.updated', {
      remoteJid: parsed.data.remoteJid,
      messageTimestamp: parsed.data.messageTimestamp,
      readBy: request.user!.id,
    });

    return { remoteJid: parsed.data.remoteJid, messageTimestamp: parsed.data.messageTimestamp, providerMarked };
  });

  app.post('/api/evolution/notes', { preHandler: requireUser }, async (request, reply) => {
    const parsed = noteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Nota interna invÃ¡lida' });

    const remoteJid = parsed.data.phone?.replace(/\D/g, '')
      ? canonicalPhoneJid(parsed.data.phone)
      : parsed.data.remoteJid;
    const result = await db.query<{
      id: string;
      author_name: string;
      content: string;
      created_at: string;
    }>(
      `INSERT INTO conversation_notes
        (company_id, evolution_remote_jid, author_id, author_name, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, author_name, content, created_at`,
      [request.user!.companyId, remoteJid, request.user!.id, request.user!.name, parsed.data.content],
    );
    const note = result.rows[0];
    if (!note) return reply.code(500).send({ error: 'NÃ£o foi possÃ­vel salvar a nota interna' });
    return {
      note: {
        id: note.id,
        conversationId: parsed.data.remoteJid,
        sender: 'attendant',
        senderName: note.author_name,
        content: note.content,
        timestamp: new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestampMs: Date.parse(note.created_at),
        status: 'sent',
        isInternalNote: true,
      },
    };
  });

  app.post('/api/evolution/notes/list', { preHandler: requireUser }, async (request, reply) => {
    const parsed = noteLookupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Conversa invÃ¡lida' });
    const jids = assignmentJids({ remoteJid: parsed.data.remoteJid, phone: parsed.data.phone });
    const result = await db.query<{
      id: string;
      evolution_remote_jid: string;
      author_name: string;
      content: string;
      created_at: string;
    }>(
      `SELECT id, evolution_remote_jid, author_name, content, created_at
       FROM conversation_notes
       WHERE company_id = $1 AND evolution_remote_jid = ANY($2::text[])
       ORDER BY created_at ASC`,
      [request.user!.companyId, jids],
    );
    return {
      notes: result.rows.map((note) => ({
        id: note.id,
        conversationId: parsed.data.remoteJid,
        sender: 'attendant',
        senderName: note.author_name,
        content: note.content,
        timestamp: new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestampMs: Date.parse(note.created_at),
        status: 'sent',
        isInternalNote: true,
      })),
    };
  });

  app.post('/api/evolution/messages', { preHandler: requireUser }, async (request, reply) => {
    const parsed = jidSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Conversa inválida' });
    // Alguns contatos alternam entre o JID do telefone e o JID interno (@lid).
    // Buscamos os dois para preservar todo o historico da conversa.
    const jids = new Set([parsed.data.remoteJid]);
    const phoneDigits = parsed.data.phone?.replace(/\D/g, '') || '';
    if (phoneDigits.length >= 8 && phoneDigits.length <= 20) {
      jids.add(canonicalPhoneJid(phoneDigits));
    }

    // A contact may alternate between its phone JID and an internal @lid JID.
    // Merge all local conversations for the same phone before reading history.
    const contactIds = phoneDigits.length >= 8 && phoneDigits.length <= 20
      ? (await db.query<{ id: string }>(
          `SELECT id FROM contacts
           WHERE company_id = $1 AND regexp_replace(phone, '\\D', '', 'g') = $2`,
          [request.user!.companyId, phoneDigits],
        )).rows.map((row) => row.id)
      : [];
    if (contactIds.length > 0) {
      const contactJids = await db.query<{ evolution_remote_jid: string }>(
        `SELECT evolution_remote_jid FROM conversations
         WHERE company_id = $1 AND contact_id = ANY($2::uuid[])`,
        [request.user!.companyId, contactIds],
      );
      contactJids.rows.forEach((row) => jids.add(row.evolution_remote_jid));
    }

    const conversationFilter = contactIds.length > 0
      ? `(c.evolution_remote_jid = ANY($2::text[]) OR c.contact_id = ANY($3::uuid[]))`
      : `c.evolution_remote_jid = ANY($2::text[])`;
    const queryParams = contactIds.length > 0
      ? [request.user!.companyId, [...jids], contactIds]
      : [request.user!.companyId, [...jids]];
    const pageSize = parsed.data.limit || 100;
    const pageSizeParam = queryParams.length + 1;
    const beforeParam = queryParams.length + 2;
    const afterParam = queryParams.length + 3;
    const pageQueryParams = [
      ...queryParams,
      pageSize,
      parsed.data.beforeTimestamp || null,
      parsed.data.afterTimestamp || null,
    ];
    const beforeFilter = `($${beforeParam}::numeric IS NULL OR m.sent_at < to_timestamp($${beforeParam}::numeric / 1000))`;
    const afterFilter = `($${afterParam}::numeric IS NULL OR m.sent_at > to_timestamp($${afterParam}::numeric / 1000))`;

    const hasOlderMessages = async () => {
      const olderQuery = buildHasOlderMessagesQuery({
        companyId: request.user!.companyId,
        jids: [...jids],
        contactIds,
        afterTimestamp: parsed.data.afterTimestamp,
      });
      if (!olderQuery) return false;
      const older = await db.query(olderQuery.text, olderQuery.values);
      return older.rows.length > 0;
    };

    const localMessages = await db.query(`
      SELECT m.id, m.evolution_message_id, m.sender, m.sender_name, m.content, m.media_url,
             m.media_type, m.metadata, m.status, m.sent_at, c.evolution_remote_jid
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.company_id = $1
        AND ${conversationFilter}
        AND ${beforeFilter}
        AND ${afterFilter}
        AND m.is_internal_note = false
        AND COALESCE(m.metadata->>'providerType', '') NOT IN ('secretEncryptedMessage', 'senderKeyDistributionMessage', 'reactionMessage')
      ORDER BY m.sent_at DESC
      LIMIT $${pageSizeParam}`, pageQueryParams);

    // Depois que o webhook persiste a conversa, a leitura deixa de depender da Evolution.
    // A consulta externa serve apenas para uma reconciliação inicial do histórico antigo.
    if (!parsed.data.reconcile && (localMessages.rows.length > 0 || parsed.data.afterTimestamp)) {
      return {
        messages: {
          records: localMessages.rows.map(localMessageToProviderRecord),
          hasMore: parsed.data.afterTimestamp ? await hasOlderMessages() : localMessages.rows.length >= pageSize,
        },
      };
    }

    const responses = await Promise.all([...jids].map((remoteJid) => evolutionRequest(
      `/chat/findMessages/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      {
        method: 'POST',
        // A reconciliação inicial não precisa baixar todo o histórico. O
        // restante é carregado pelo botão de histórico, evitando uma espera
        // longa ao abrir uma conversa sem cache local.
        body: JSON.stringify({ where: { key: { remoteJid } }, limit: pageSize }),
      },
    )));
    const successfulResponses = responses.filter((response) => response.ok);
    if (successfulResponses.length === 0) {
      return {
        messages: {
          records: localMessages.rows.map(localMessageToProviderRecord),
          hasMore: parsed.data.afterTimestamp ? await hasOlderMessages() : localMessages.rows.length >= pageSize,
        },
      };
    }

    const recordsById = new Map<string, any>();
    const reactionRecords: any[] = [];
    for (const response of successfulResponses) {
      const body: any = await response.json().catch(() => ({}));
      const records = body?.messages?.records || body?.records || (Array.isArray(body) ? body : []);
      if (!Array.isArray(records)) continue;
      records.forEach((record: any, index: number) => {
        if (isNonRenderableProviderMessage(record)) return;
        if (isProviderReactionEvent(record)) {
          reactionRecords.push(record);
          return;
        }
        const id = record?.key?.id || record?.id || `${record?.messageTimestamp || 'unknown'}-${index}`;
        if (!recordsById.has(String(id))) recordsById.set(String(id), record);
      });
    }

    for (const record of recordsById.values()) {
      try {
        await persistProviderMessage(request.user!.companyId, record, {
          incrementUnread: false,
          reopen: false,
          fallbackPhone: parsed.data.phone,
        });
      } catch (error) {
        request.log.warn({ err: error, messageId: providerMessageId(record) }, 'Falha ao reconciliar mensagem da Evolution com o PostgreSQL');
      }
    }
    reactionRecords.sort((left, right) => {
      const leftUpdate = providerReactionUpdate(left);
      const rightUpdate = providerReactionUpdate(right);
      return (leftUpdate?.updatedAt || 0) - (rightUpdate?.updatedAt || 0);
    });
    for (const record of reactionRecords) {
      try {
        await persistProviderMessage(request.user!.companyId, record, {
          incrementUnread: false,
          reopen: false,
          fallbackPhone: parsed.data.phone,
        });
      } catch (error) {
        request.log.warn({ err: error, messageId: providerMessageId(record) }, 'Falha ao reconciliar reação da Evolution com o PostgreSQL');
      }
    }

    const reconciledMessages = await db.query(`
      SELECT m.id, m.evolution_message_id, m.sender, m.sender_name, m.content, m.media_url,
             m.media_type, m.metadata, m.status, m.sent_at, c.evolution_remote_jid
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.company_id = $1
        AND ${conversationFilter}
        AND ${beforeFilter}
        AND ${afterFilter}
        AND m.is_internal_note = false
        AND COALESCE(m.metadata->>'providerType', '') NOT IN ('secretEncryptedMessage', 'senderKeyDistributionMessage', 'reactionMessage')
      ORDER BY m.sent_at DESC
      LIMIT $${pageSizeParam}`, pageQueryParams);

    const localRecords = reconciledMessages.rows.map(localMessageToProviderRecord);
    const mergedRecords = new Map<string, any>();
    for (const record of recordsById.values()) {
      const id = String(record?.key?.id || record?.id || '');
      if (id) mergedRecords.set(id, record);
    }
    for (const record of localRecords) {
      const id = String(record?.key?.id || (record as any)?.id || '');
      if (id) mergedRecords.set(id, record);
    }
    const orderedRecords = Array.from(mergedRecords.values())
      .sort((left, right) => Number(right?.messageTimestamp || 0) - Number(left?.messageTimestamp || 0))
      .slice(0, pageSize);
    return {
      messages: {
        records: orderedRecords,
        hasMore: parsed.data.afterTimestamp
          ? await hasOlderMessages()
          : localMessages.rows.length >= pageSize || mergedRecords.size > pageSize,
      },
    };
  });

  app.post('/api/evolution/messages/send', { preHandler: requireUser }, async (request, reply) => {
    const outboundStartedAt = Date.now();
    const parsed = sendTextSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mensagem inválida' });
    const { number, text, remoteJid, quotedMessage } = parsed.data;
    const clientMessageId = parsed.data.clientMessageId || `hub-${randomUUID()}`;
    const canonicalRemoteJid = remoteJid || (isWhatsAppGroupJid(number) ? number : canonicalPhoneJid(number));
    const normalizedQuote = normalizedQuotedMessage(quotedMessage, canonicalRemoteJid);
    const evolutionQuote = evolutionQuotedPayload(normalizedQuote, canonicalRemoteJid);
    traceOutbound(request, 'received', { clientMessageId, remoteJid: canonicalRemoteJid, elapsedMs: Date.now() - outboundStartedAt });
    const leaseAcquisition = await acquireOutboundLease({
      companyId: request.user!.companyId,
      user: request.user!,
      number,
      remoteJid: canonicalRemoteJid,
    });
    if (!leaseAcquisition.acquired) {
      return reply.code(409).send({
        error: `Atendimento em andamento por ${leaseAcquisition.lease.ownerName}`,
        code: 'conversation_lease_active',
        lease: leaseAcquisition.lease,
      });
    }
    publishRealtimeEvent(request.user!.companyId, 'conversation.updated', leaseRealtimePayload({
      remoteJid: canonicalRemoteJid,
      phone: number,
      lease: leaseAcquisition.lease,
    }));
    const localMessage = await ensureOutboundMessage({
      companyId: request.user!.companyId,
      userId: request.user!.id,
      userName: request.user!.name,
      number,
      remoteJid: canonicalRemoteJid,
      content: text,
      clientMessageId,
      quotedMessage: normalizedQuote,
    });
    traceOutbound(request, 'outbox.prepared', {
      clientMessageId,
      remoteJid: canonicalRemoteJid,
      evolutionMessageId: localMessage.evolutionMessageId || undefined,
      deduplicated: localMessage.deduplicated,
      elapsedMs: Date.now() - outboundStartedAt,
      idempotencyLockMs: localMessage.idempotencyLockMs,
      persistenceMs: localMessage.persistenceMs,
    });
    if (localMessage.deduplicated) {
      return {
        remoteJid: canonicalRemoteJid,
        message: {
          id: localMessage.messageId,
          evolutionMessageId: localMessage.evolutionMessageId || undefined,
          status: localMessage.status,
          senderName: request.user!.name,
        },
        deduplicated: true,
      };
    }
    let dispatch: { ok: boolean; body: any };
    const evolutionRequestStartedAt = Date.now();
    try {
      dispatch = await outboundEvolutionRequests.run(
        `${request.user!.companyId}:${clientMessageId}`,
        async () => {
          traceOutbound(request, 'evolution.request', { clientMessageId, remoteJid: canonicalRemoteJid, elapsedMs: Date.now() - outboundStartedAt });
          const response = await evolutionRequest(
            `/message/sendText/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
            {
              method: 'POST',
              body: JSON.stringify({
                number: isWhatsAppGroupJid(canonicalRemoteJid) ? canonicalRemoteJid : number,
                text: formatHubOutboundText(request.user!.name, text),
                delay: 1200,
                linkPreview: true,
                ...(evolutionQuote ? { quoted: evolutionQuote } : {}),
              }),
            },
          );
          return {
            ok: response.ok,
            body: await response.json().catch(() => ({ error: 'Evolution API response invalid' })),
          };
        },
      );
    } catch (error) {
      await updateOutboundMessage(localMessage.messageId, 'failed');
      request.log.warn({ err: error }, 'Falha de comunicação com a Evolution API');
      return reply.code(502).send({ error: 'Evolution API unavailable', messageId: localMessage.messageId });
    }
    if (!dispatch.ok) {
      await updateOutboundMessage(localMessage.messageId, 'failed');
      return reply.code(502).send({ error: 'Evolution API unavailable', messageId: localMessage.messageId });
    }
    const evolutionMessageId = evolutionMessageIdFromResponse(dispatch.body);
    traceOutbound(request, 'evolution.response', {
      clientMessageId,
      remoteJid: canonicalRemoteJid,
      evolutionMessageId,
      ok: dispatch.ok,
      elapsedMs: Date.now() - outboundStartedAt,
      evolutionRequestMs: Date.now() - evolutionRequestStartedAt,
    });
    await updateOutboundMessage(localMessage.messageId, 'sent', typeof evolutionMessageId === 'string' ? evolutionMessageId : undefined);
    traceOutbound(request, 'persistence.confirmed', {
      clientMessageId,
      remoteJid: canonicalRemoteJid,
      evolutionMessageId,
      elapsedMs: Date.now() - outboundStartedAt,
    });
    const realtimeMessageId = typeof evolutionMessageId === 'string' ? evolutionMessageId : localMessage.messageId;
    const realtimeTimestampMs = Date.now();
    publishRealtimeEvent(request.user!.companyId, 'message.upsert', {
      remoteJid: canonicalRemoteJid,
      phone: number,
      messageId: realtimeMessageId,
      timestampMs: realtimeTimestampMs,
      fromMe: true,
      message: {
        id: realtimeMessageId,
        conversationId: canonicalRemoteJid,
        sender: 'attendant',
        senderName: request.user!.name,
        content: text,
        metadata: {
          sentByHub: true,
          sentByUserId: request.user!.id,
          sentByUserName: request.user!.name,
          ...(clientMessageId ? { clientMessageId } : {}),
          ...(normalizedQuote
            ? { quotedMessage: normalizedQuote }
            : {}),
        },
        rawKey: { id: realtimeMessageId, remoteJid: canonicalRemoteJid, fromMe: true },
        timestampMs: realtimeTimestampMs,
        timestamp: new Date(realtimeTimestampMs).toISOString(),
        status: 'sent',
        isInternalNote: false,
      },
    });
    traceOutbound(request, 'sse.published', {
      clientMessageId,
      remoteJid: canonicalRemoteJid,
      evolutionMessageId: realtimeMessageId,
      elapsedMs: Date.now() - outboundStartedAt,
    });

    let dailyResponder: { id: string; name: string; date: string } | undefined;
    try {
      dailyResponder = await recordDailyResponder(request.user!.companyId, number, request.user!);
    } catch (error) {
      request.log.warn({ err: error }, 'NÃ£o foi possÃ­vel registrar o primeiro atendente do dia');
    }
    return {
      evolution: dispatch.body,
      dailyResponder,
      lease: leaseAcquisition.lease,
      remoteJid: canonicalRemoteJid,
      message: { id: localMessage.messageId, evolutionMessageId, status: 'sent', senderName: request.user!.name },
    };
  });

  app.post('/api/evolution/messages/send-media', { preHandler: requireUser }, async (request, reply) => {
    const outboundStartedAt = Date.now();
    const parsed = sendMediaSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Anexo inválido' });
    const { number, text, remoteJid, quotedMessage } = {
      number: parsed.data.number,
      text: parsed.data.caption?.trim() || `[${parsed.data.mediatype}]`,
      remoteJid: parsed.data.remoteJid,
      quotedMessage: parsed.data.quotedMessage,
    };
    const clientMessageId = parsed.data.clientMessageId || `hub-${randomUUID()}`;
    const canonicalRemoteJid = remoteJid || (isWhatsAppGroupJid(number) ? number : canonicalPhoneJid(number));
    const normalizedQuote = normalizedQuotedMessage(quotedMessage, canonicalRemoteJid);
    const evolutionQuote = evolutionQuotedPayload(normalizedQuote, canonicalRemoteJid);
    traceOutbound(request, 'received', { clientMessageId, remoteJid: canonicalRemoteJid, elapsedMs: Date.now() - outboundStartedAt });
    const leaseAcquisition = await acquireOutboundLease({
      companyId: request.user!.companyId,
      user: request.user!,
      number,
      remoteJid: canonicalRemoteJid,
    });
    if (!leaseAcquisition.acquired) {
      return reply.code(409).send({
        error: `Atendimento em andamento por ${leaseAcquisition.lease.ownerName}`,
        code: 'conversation_lease_active',
        lease: leaseAcquisition.lease,
      });
    }
    publishRealtimeEvent(request.user!.companyId, 'conversation.updated', leaseRealtimePayload({
      remoteJid: canonicalRemoteJid,
      phone: number,
      lease: leaseAcquisition.lease,
    }));
    const localMessage = await ensureOutboundMessage({
      companyId: request.user!.companyId,
      userId: request.user!.id,
      userName: request.user!.name,
      number,
      remoteJid: canonicalRemoteJid,
      content: text,
      mediaType: parsed.data.mediatype,
      document: parsed.data.mediatype === 'document'
        ? { fileName: parsed.data.fileName, mimeType: parsed.data.mimetype }
        : undefined,
      clientMessageId,
      quotedMessage: normalizedQuote,
    });
    traceOutbound(request, 'outbox.prepared', {
      clientMessageId,
      remoteJid: canonicalRemoteJid,
      evolutionMessageId: localMessage.evolutionMessageId || undefined,
      deduplicated: localMessage.deduplicated,
      elapsedMs: Date.now() - outboundStartedAt,
      idempotencyLockMs: localMessage.idempotencyLockMs,
      persistenceMs: localMessage.persistenceMs,
    });
    if (localMessage.deduplicated) {
      return {
        remoteJid: canonicalRemoteJid,
        message: {
          id: localMessage.messageId,
          evolutionMessageId: localMessage.evolutionMessageId || undefined,
          status: localMessage.status,
          senderName: request.user!.name,
        },
        deduplicated: true,
      };
    }
    let dispatch: { ok: boolean; body: any };
    const evolutionRequestStartedAt = Date.now();
    try {
      const caption = parsed.data.caption?.trim()
        ? formatHubOutboundText(request.user!.name, parsed.data.caption.trim())
        : undefined;
      dispatch = await outboundEvolutionRequests.run(
        `${request.user!.companyId}:${clientMessageId}`,
        async () => {
          traceOutbound(request, 'evolution.request', { clientMessageId, remoteJid: canonicalRemoteJid, elapsedMs: Date.now() - outboundStartedAt });
          const response = await evolutionRequest(
            `/message/sendMedia/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
            {
              method: 'POST',
              body: JSON.stringify({
                number: isWhatsAppGroupJid(canonicalRemoteJid) ? canonicalRemoteJid : number,
                mediatype: parsed.data.mediatype,
                mimetype: parsed.data.mimetype,
                media: parsed.data.media,
                fileName: parsed.data.fileName,
                caption,
                ...(evolutionQuote ? { quoted: evolutionQuote } : {}),
              }),
            },
          );
          return {
            ok: response.ok,
            body: await response.json().catch(() => ({ error: 'Evolution API response invalid' })),
          };
        },
      );
    } catch (error) {
      await updateOutboundMessage(localMessage.messageId, 'failed');
      request.log.warn({ err: error }, 'Falha de comunicação com a Evolution API ao enviar anexo');
      return reply.code(502).send({ error: 'Evolution API indisponível', messageId: localMessage.messageId });
    }
    if (!dispatch.ok) {
      await updateOutboundMessage(localMessage.messageId, 'failed');
      return reply.code(502).send({ error: 'Evolution API indisponível', messageId: localMessage.messageId });
    }
    const evolutionMessageId = evolutionMessageIdFromResponse(dispatch.body);
    traceOutbound(request, 'evolution.response', {
      clientMessageId,
      remoteJid: canonicalRemoteJid,
      evolutionMessageId,
      ok: dispatch.ok,
      elapsedMs: Date.now() - outboundStartedAt,
      evolutionRequestMs: Date.now() - evolutionRequestStartedAt,
    });
    await updateOutboundMessage(localMessage.messageId, 'sent', typeof evolutionMessageId === 'string' ? evolutionMessageId : undefined);
    traceOutbound(request, 'persistence.confirmed', {
      clientMessageId,
      remoteJid: canonicalRemoteJid,
      evolutionMessageId,
      elapsedMs: Date.now() - outboundStartedAt,
    });
    const realtimeMessageId = typeof evolutionMessageId === 'string' ? evolutionMessageId : localMessage.messageId;
    const realtimeTimestampMs = Date.now();
    publishRealtimeEvent(request.user!.companyId, 'message.upsert', {
      remoteJid: canonicalRemoteJid,
      phone: number,
      messageId: realtimeMessageId,
      timestampMs: realtimeTimestampMs,
      fromMe: true,
      message: {
        id: realtimeMessageId,
        conversationId: canonicalRemoteJid,
        sender: 'attendant',
        senderName: request.user!.name,
        content: text,
        mediaType: parsed.data.mediatype,
        metadata: {
          sentByHub: true,
          sentByUserId: request.user!.id,
          sentByUserName: request.user!.name,
          ...(parsed.data.mediatype === 'document'
            ? { document: { fileName: parsed.data.fileName, mimeType: parsed.data.mimetype } }
            : {}),
          ...(clientMessageId ? { clientMessageId } : {}),
          ...(normalizedQuote
            ? { quotedMessage: normalizedQuote }
            : {}),
        },
        rawKey: { id: realtimeMessageId, remoteJid: canonicalRemoteJid, fromMe: true },
        timestampMs: realtimeTimestampMs,
        timestamp: new Date(realtimeTimestampMs).toISOString(),
        status: 'sent',
        isInternalNote: false,
      },
    });
    traceOutbound(request, 'sse.published', {
      clientMessageId,
      remoteJid: canonicalRemoteJid,
      evolutionMessageId: realtimeMessageId,
      elapsedMs: Date.now() - outboundStartedAt,
    });
    let dailyResponder: { id: string; name: string; date: string } | undefined;
    try {
      dailyResponder = await recordDailyResponder(request.user!.companyId, number, request.user!);
    } catch (error) {
      request.log.warn({ err: error }, 'Não foi possível registrar o primeiro atendente do dia');
    }
    return {
      evolution: dispatch.body,
      dailyResponder,
      lease: leaseAcquisition.lease,
      remoteJid: canonicalRemoteJid,
      message: { id: localMessage.messageId, evolutionMessageId, status: 'sent', senderName: request.user!.name },
    };
  });

  app.post('/api/evolution/messages/reaction', { preHandler: requireUser }, async (request, reply) => {
    const parsed = sendReactionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Reação inválida' });

    const { number, remoteJid, messageId, emoji } = parsed.data;
    const phone = number.replace(/\D/g, '');
    // The frontend supplies an id only to address a visible message. The
    // target itself is always resolved inside the authenticated company.
    const targetResult = await db.query<{
      id: string;
      evolution_message_id: string;
      sender: 'contact' | 'attendant' | 'system';
      sender_name: string | null;
      content: string;
      media_url: string | null;
      media_type: string | null;
      metadata: Record<string, any>;
      status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
      sent_at: string;
      evolution_remote_jid: string;
      contact_phone: string;
    }>(
      `SELECT m.id, m.evolution_message_id, m.sender, m.sender_name, m.content,
              m.media_url, m.media_type, m.metadata, m.status, m.sent_at,
              c.evolution_remote_jid,
              regexp_replace(contact.phone, '\\D', '', 'g') AS contact_phone
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN contacts contact ON contact.id = c.contact_id
       WHERE m.company_id = $1::uuid
         AND m.evolution_message_id = $2::text
         AND m.is_internal_note = false
         AND (
           c.evolution_remote_jid = ANY($3::text[])
           OR regexp_replace(contact.phone, '\\D', '', 'g') = $4::text
         )
       LIMIT 1`,
      [request.user!.companyId, messageId, assignmentJids({ remoteJid, phone: isWhatsAppGroupJid(number) ? number : phone }), phone],
    );
    const target = targetResult.rows[0]!;
    const leaseNumber = isWhatsAppGroupJid(target?.evolution_remote_jid)
      ? target.evolution_remote_jid
      : target?.contact_phone || phone;
    if (!target) return reply.code(404).send({ error: 'Mensagem não disponível para reação' });

    const leaseAcquisition = await acquireOutboundLease({
      companyId: request.user!.companyId,
      user: request.user!,
      number: leaseNumber,
      remoteJid: target.evolution_remote_jid,
    });
    if (!leaseAcquisition.acquired) {
      return reply.code(409).send({
        error: `Atendimento em andamento por ${leaseAcquisition.lease.ownerName}`,
        code: 'conversation_lease_active',
        lease: leaseAcquisition.lease,
      });
    }
    publishRealtimeEvent(request.user!.companyId, 'conversation.updated', leaseRealtimePayload({
      remoteJid: target.evolution_remote_jid,
      phone: leaseNumber,
      lease: leaseAcquisition.lease,
    }));

    let dispatch: { ok: boolean; body: any };
    try {
      const response = await evolutionRequest(
        `/message/sendReaction/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
        {
          method: 'POST',
          body: JSON.stringify(evolutionReactionPayload({
            id: target.evolution_message_id,
            remoteJid: target.evolution_remote_jid,
            fromMe: target.sender === 'attendant',
          }, emoji || '')),
        },
      );
      dispatch = {
        ok: response.ok,
        body: await response.json().catch(() => ({ error: 'Resposta inválida da Evolution API' })),
      };
    } catch (error) {
      request.log.warn({ err: error, messageId }, 'Falha ao enviar reação para a Evolution API');
      return reply.code(502).send({ error: 'Evolution API indisponível no momento' });
    }
    if (!dispatch.ok) return reply.code(502).send({ error: 'Não foi possível enviar a reação ao WhatsApp' });

    const message = await persistHubReaction({
      message: target,
      emoji: emoji || '',
      user: request.user!,
    });
    publishRealtimeEvent(request.user!.companyId, 'message.upsert', {
      remoteJid: target.evolution_remote_jid,
      phone: leaseNumber,
      messageId: target.evolution_message_id,
      timestampMs: message.timestampMs,
      fromMe: true,
      reaction: true,
      message,
    });

    return { message, lease: leaseAcquisition.lease, evolution: dispatch.body };
  });

  app.post('/api/evolution/media', { preHandler: requireUser }, async (request, reply) => {
    const parsed = mediaSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mensagem de mídia inválida' });
    return forwardEvolutionRequest(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      reply,
      { method: 'POST', body: JSON.stringify({ message: { key: parsed.data.messageKey }, convertToMp4: false }) },
    );
  });

  app.post('/api/evolution/business-profile', { preHandler: requireUser }, async (request, reply) => {
    const parsed = phoneSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Número inválido' });
    let response: Response;
    try {
      response = await evolutionRequest(
        `/chat/fetchBusinessProfile/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
        { method: 'POST', body: JSON.stringify(parsed.data) },
      );
    } catch (error) {
      request.log.warn({ err: error }, 'Perfil empresarial não respondeu');
      return reply.code(502).send({ error: 'Perfil empresarial indisponível no momento' });
    }
    if (!response.ok) return reply.code(404).send({ error: 'Perfil empresarial não disponível' });
    const body: any = await response.json().catch(() => ({}));
    const profile = body?.data || body?.businessProfile || body;
    const name = profile?.verifiedName || profile?.businessName || profile?.name || profile?.profileName;
    if (typeof name === 'string' && name.trim() && !/^\+?[\d\s().-]+$/.test(name.trim())) {
      try {
        await db.query(
          `INSERT INTO whatsapp_contact_names (company_id, phone, name, avatar_url)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (company_id, phone) DO UPDATE SET
             name = EXCLUDED.name,
             avatar_url = COALESCE(EXCLUDED.avatar_url, whatsapp_contact_names.avatar_url),
             updated_at = now()`,
          [request.user!.companyId, parsed.data.number, name.trim(), profile?.profilePicUrl || profile?.profilePictureUrl || null],
        );
      } catch (error) {
        request.log.warn({ err: error }, 'Não foi possível persistir o nome empresarial do WhatsApp');
      }
    }
    return body;
  });

  app.post('/webhooks/evolution', async (request, reply) => {
    const providedSecret = request.headers['x-webhook-secret'];
    const value = Array.isArray(providedSecret) ? providedSecret[0] : providedSecret;
    if (!matchesWebhookSecret(value)) return reply.code(401).send({ error: 'Webhook não autorizado' });

    const body = request.body as any;
    const event = String(body?.event || body?.type || 'unknown');
    const normalizedEvent = event.toLowerCase().replace(/_/g, '.');
    const isMessageEvent = normalizedEvent === 'messages.upsert' || normalizedEvent === 'messages.set';
    let persistedMessages = 0;
    const company = await db.query<{ id: string }>('SELECT id FROM companies ORDER BY created_at LIMIT 1');
    const companyId = company.rows[0]?.id;

    if (isMessageEvent) {
      const data = body?.data || body?.payload || body;
      const rawRecords = Array.isArray(data)
        ? data
        : Array.isArray(data?.messages)
          ? data.messages
          : Array.isArray(data?.records)
            ? data.records
            : [data];
      // `data.contextInfo` is scoped to this webhook message. Preserve that
      // fact explicitly for quote extraction without treating arbitrary
      // record-level contexts from history/snapshots as message metadata.
      const records = rawRecords.map((record: any) => ({
        ...record,
        messageContextScope: 'webhook' as const,
      }));

      if (companyId) {
        for (const record of records) {
          try {
            traceOutbound(request, `webhook.${normalizedEvent}`, {
              remoteJid: providerRemoteJid(record),
              evolutionMessageId: providerMessageId(record),
            });
            const persisted = await persistProviderMessage(companyId, record, { incrementUnread: true, reopen: true });
            if (persisted?.ignored) continue;
            if (persisted?.persisted) {
              persistedMessages += 1;
            }
            const remoteJid = providerRemoteJid(record);
            if (remoteJid && persisted?.message) {
              publishRealtimeEvent(companyId, 'message.upsert', {
                remoteJid,
                phone: providerPhone(record),
                messageId: persisted.message.id,
                timestampMs: persisted.message.timestampMs,
                fromMe: record?.key?.fromMe === true,
                ...(persisted.reaction ? { reaction: true } : {}),
                message: persisted.message,
              });
            }
          } catch (error) {
            request.log.warn({ err: error, event, messageId: providerMessageId(record) }, 'Falha ao persistir mensagem recebida no PostgreSQL');
          }
        }
      }
    }

    const statusUpdate = extractWebhookMessageStatus(body);
    if (statusUpdate) {
      traceOutbound(request, `webhook.${normalizedEvent}`, {
        remoteJid: providerRemoteJid(body?.data || body?.payload || body),
        evolutionMessageId: statusUpdate.messageId,
      });
      const eventKey = `${event}:${statusUpdate.messageId}:${statusUpdate.status}`;
      try {
        const inserted = await db.query(
          `INSERT INTO webhook_events (provider, event_key, event_type)
           VALUES ('evolution', $1, $2)
           ON CONFLICT (provider, event_key) DO NOTHING
           RETURNING id`,
          [eventKey, event],
        );
        if (inserted.rowCount) {
          await db.query(
            `UPDATE messages
             SET status = CASE
               WHEN status = 'failed' THEN status
               WHEN $1 = 'failed' THEN 'failed'
               WHEN $1 = 'read' THEN 'read'
               WHEN $1 = 'delivered' AND status NOT IN ('read') THEN 'delivered'
               ELSE status
             END
             WHERE evolution_message_id = $2`,
            [statusUpdate.status, statusUpdate.messageId],
          );
          await db.query('UPDATE webhook_events SET processed_at = now() WHERE id = $1', [inserted.rows[0]?.id]);
        }
      } catch (error) {
        request.log.warn({ err: error, event, messageId: statusUpdate.messageId }, 'Falha ao atualizar status da mensagem');
      }
      try {
        const statusData = body?.data || body?.payload || body;
        const remoteJid = providerRemoteJid(statusData) || String(statusData?.key?.remoteJid || '').trim();
        if (companyId) publishRealtimeEvent(companyId, 'message.status', {
          remoteJid,
          phone: providerPhone(statusData),
          messageId: statusUpdate.messageId,
          status: statusUpdate.status,
        });
      } catch (error) {
        request.log.warn({ err: error, event, messageId: statusUpdate.messageId }, 'Falha ao publicar status em tempo real');
      }
    }
    request.log.info({ event, messageId: statusUpdate?.messageId, status: statusUpdate?.status, persistedMessages }, 'Evento Evolution recebido');
    return reply.code(202).send({ accepted: true });
  });
}
