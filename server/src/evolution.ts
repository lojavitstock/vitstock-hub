import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { config } from './config.js';
import { requireUser } from './auth.js';
import { db } from './db.js';
import { publishRealtimeEvent, registerRealtimeClient } from './realtime.js';

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
const sendTextSchema = z.object({
  number: z.string().regex(/^\d{8,20}$/),
  text: z.string().min(1).max(4096),
  remoteJid: z.string().min(3).max(128).optional(),
});
const sendMediaSchema = z.object({
  number: z.string().regex(/^\d{8,20}$/),
  remoteJid: z.string().min(3).max(128).optional(),
  mediatype: z.enum(['image', 'video', 'document']),
  mimetype: z.string().min(3).max(100),
  media: z.string().min(1).max(14_000_000),
  fileName: z.string().max(180).optional(),
  caption: z.string().max(4096).optional(),
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
    message_sent_at: Date | string | null;
  }>(
    `SELECT c.evolution_remote_jid,
            c.unread_count,
            c.last_message,
            c.last_message_at,
            ct.name AS contact_name,
            ct.avatar_url,
            latest.evolution_message_id AS message_id,
            latest.sender AS message_sender,
            latest.sent_at AS message_sent_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN LATERAL (
       SELECT m.evolution_message_id, m.sender, m.sent_at
       FROM messages m
       WHERE m.conversation_id = c.id
         AND m.is_internal_note = false
       ORDER BY m.sent_at DESC
       LIMIT 1
     ) latest ON true
     WHERE c.company_id = $1
     ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC`,
    [companyId],
  );

  return result.rows.map((row) => {
    const dateValue = row.message_sent_at || row.last_message_at;
    const timestamp = dateValue ? Math.floor(new Date(dateValue).getTime() / 1000) : 0;
    const remoteJid = row.evolution_remote_jid;
    return {
      id: remoteJid,
      remoteJid,
      unreadCount: Number(row.unread_count) || 0,
      updatedAt: dateValue ? new Date(dateValue).toISOString() : undefined,
      pushName: row.contact_name,
      profilePicUrl: row.avatar_url || undefined,
      lastMessage: {
        key: {
          id: row.message_id || `local-${remoteJid}-${timestamp}`,
          remoteJid,
          fromMe: row.message_sender === 'attendant',
        },
        message: { conversation: row.last_message || '[Conversa iniciada]' },
        messageTimestamp: timestamp,
        pushName: row.contact_name,
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
  const digits = input.phone?.replace(/\D/g, '') || '';
  if (digits.length >= 8 && digits.length <= 20) jids.push(`${digits}@s.whatsapp.net`);
  return [...new Set(jids)];
}

function canonicalPhoneJid(number: string) {
  return `${number.replace(/\D/g, '')}@s.whatsapp.net`;
}

function providerContactName(value: any) {
  const candidate = value?.pushName || value?.notify || value?.verifiedName || value?.name;
  if (typeof candidate !== 'string') return '';
  const name = candidate.trim();
  if (!name || name === 'Você' || name === 'WhatsApp Business' || /^\+?[\d\s().-]+$/.test(name)) return '';
  return name;
}

function providerContactPhone(value: any) {
  const rawJid = value?.lastMessage?.key?.remoteJidAlt
    || value?.key?.remoteJidAlt
    || value?.remoteJidAlt
    || value?.remoteJid
    || value?.id
    || value?.key?.remoteJid
    || '';
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

function unwrapProviderMessage(message: any) {
  let current = message || {};
  for (let index = 0; index < 6; index += 1) {
    const nested = current?.ephemeralMessage?.message
      || current?.viewOnceMessage?.message
      || current?.viewOnceMessageV2?.message
      || current?.documentWithCaptionMessage?.message
      || current?.associatedChildMessage?.message
      || current?.editedMessage?.message;
    if (!nested) break;
    current = nested;
  }
  return current;
}

function firstProviderText(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function providerMessageType(record: any, message: any) {
  const explicit = String(record?.messageType || '').trim();
  if (explicit) return explicit;
  const knownTypes = [
    'conversation', 'extendedTextMessage', 'imageMessage', 'audioMessage', 'videoMessage',
    'documentMessage', 'stickerMessage', 'contactMessage', 'locationMessage', 'reactionMessage',
    'protocolMessage', 'associatedChildMessage', 'interactiveMessage', 'templateMessage',
    'buttonsMessage', 'listMessage', 'pollCreationMessage', 'pollUpdateMessage', 'callLogMessage',
    'call', 'placeholderMessage', 'secretEncryptedMessage', 'statusMentionMessage',
  ];
  return knownTypes.find((type) => message?.[type]) || '';
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
  const context = record?.contextInfo
    || message?.contextInfo
    || message?.extendedTextMessage?.contextInfo
    || message?.imageMessage?.contextInfo
    || message?.videoMessage?.contextInfo
    || message?.documentMessage?.contextInfo
    || {};
  const externalAd = record?.contextInfo?.externalAdReply
    || message?.extendedTextMessage?.contextInfo?.externalAdReply
    || message?.contextInfo?.externalAdReply;
  const contact = message?.contactMessage;
  const location = message?.locationMessage;
  const reaction = message?.reactionMessage;
  const protocol = message?.protocolMessage;
  const call = message?.callLogMessage || message?.call || message?.offerMessage;
  const metadata: Record<string, any> = { providerType: type };

  const trafficSource = context?.conversionSource
    || context?.conversion_source
    || (context?.ctwaSignals || context?.conversionData || context?.conversion_data ? 'FB_Ads' : undefined);
  if (typeof trafficSource === 'string' && trafficSource.trim()) metadata.trafficSource = trafficSource.trim();
  const trafficTitle = externalAd?.title || externalAd?.sourceApp || externalAd?.mediaType;
  const trafficUrl = externalAd?.sourceUrl || externalAd?.sourceURL;
  if (typeof trafficTitle === 'string' && trafficTitle.trim()) metadata.trafficTitle = trafficTitle.trim();
  if (typeof trafficUrl === 'string' && trafficUrl.trim()) metadata.trafficUrl = trafficUrl.trim();

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
  } else if (type === 'secretEncryptedMessage') {
    metadata.systemLabel = 'Mensagem protegida';
  } else if (type === 'statusMentionMessage') {
    metadata.systemLabel = 'Menção de status';
  }

  const interactive = message?.interactiveMessage
    || message?.templateMessage?.interactiveMessageTemplate
    || message?.templateMessage?.interactiveMessage;
  const interactiveTitle = interactive?.header?.title || interactive?.header?.text || message?.templateMessage?.hydratedTemplate?.hydratedTitleText;
  const interactiveFooter = interactive?.footer?.text || message?.templateMessage?.hydratedTemplate?.hydratedFooterText;
  const interactiveButtons = providerInteractiveButtons(message);
  if (typeof interactiveTitle === 'string' && interactiveTitle.trim()) metadata.interactiveTitle = interactiveTitle.trim();
  if (typeof interactiveFooter === 'string' && interactiveFooter.trim()) metadata.interactiveFooter = interactiveFooter.trim();
  if (interactiveButtons.length) metadata.interactiveButtons = interactiveButtons;

  if (!fromMe && typeof metadata.trafficSource !== 'string') delete metadata.trafficSource;
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

function providerRemoteJid(record: any) {
  return String(record?.key?.remoteJid || record?.remoteJid || '').trim();
}

function providerPhone(record: any) {
  const remoteJid = providerRemoteJid(record);
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
  const mediaDuration = media?.type === 'audio' || media?.type === 'video'
    ? Number(media?.type === 'audio' ? message?.audioMessage?.seconds : message?.videoMessage?.seconds)
    : undefined;
  return {
    id: providerMessageId(record),
    remoteJid: providerRemoteJid(record),
    phone: providerPhone(record) || fallbackPhone.replace(/\D/g, ''),
    sender: fromMe ? 'attendant' as const : 'contact' as const,
    senderName: fromMe
      ? (record?.senderName || record?.pushName || 'Atendente')
      : (providerContactName(record) || record?.pushName || 'Contato'),
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

function localMessageToProviderRecord(row: any) {
  const remoteJid = row.evolution_remote_jid;
  const id = row.evolution_message_id || row.id;
  const timestamp = Math.floor(new Date(row.sent_at).getTime() / 1000);
  const key = { id, remoteJid, fromMe: row.sender === 'attendant' };
  const metadata = row.metadata || {};
  const mediaMessage = row.media_type === 'image'
    ? { imageMessage: { url: row.media_url || undefined, caption: row.content } }
    : row.media_type === 'audio'
      ? { audioMessage: { url: row.media_url || undefined } }
      : row.media_type === 'video'
        ? { videoMessage: { url: row.media_url || undefined, caption: row.content } }
        : row.media_type === 'document'
          ? { documentMessage: { url: row.media_url || undefined, caption: row.content } }
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
    interactiveTitle: row.interactive_title || metadata.interactiveTitle,
    interactiveFooter: row.interactive_footer || metadata.interactiveFooter,
    interactiveButtons: row.interactive_buttons || metadata.interactiveButtons,
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
  },
) {
  // A Evolution pode alternar entre o JID do telefone e um @lid para o mesmo
  // contato. Primeiro reutilizamos uma conversa do contato e só criamos uma
  // nova quando não existe nenhuma identidade local para aquele telefone.
  const existing = await client.query<{ id: string }>(
    `SELECT id
     FROM conversations
     WHERE company_id = $1
       AND (evolution_remote_jid = $3 OR contact_id = $2)
     ORDER BY CASE WHEN evolution_remote_jid = $3 THEN 0 ELSE 1 END,
              updated_at DESC
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
           updated_at = now()
       WHERE id = $1`,
      [existingId, input.contactId, input.lastMessageAt, input.lastMessage, input.reopenResolved],
    );
    return existingId;
  }

  const created = input.assignedUserId
    ? await client.query<{ id: string }>(
      `INSERT INTO conversations
        (company_id, contact_id, evolution_remote_jid, assigned_user_id, status, last_message, last_message_at)
       VALUES ($1, $2, $3, $4, 'open', $5, $6)
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
      [input.companyId, input.contactId, input.remoteJid, input.assignedUserId, input.lastMessage, input.lastMessageAt],
    )
    : await client.query<{ id: string }>(
      `INSERT INTO conversations
        (company_id, contact_id, evolution_remote_jid, status, last_message, last_message_at)
       VALUES ($1, $2, $3, 'open', $4, $5)
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
      [input.companyId, input.contactId, input.remoteJid, input.lastMessage, input.lastMessageAt, input.reopenResolved],
    );
  const conversationId = created.rows[0]?.id;
  if (!conversationId) throw new Error('Conversa não pôde ser preparada');
  return conversationId;
}

async function persistProviderMessage(companyId: string, record: any, options: { incrementUnread: boolean; reopen: boolean; fallbackPhone?: string }) {
  const local = providerRecordToLocalMessage(record, options.fallbackPhone);
  if (!local.id || !local.remoteJid || local.remoteJid.endsWith('@g.us') || !local.phone) return false;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const contact = await client.query<{ id: string }>(
      `INSERT INTO contacts (company_id, name, phone, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, phone) DO UPDATE SET
         name = CASE
           WHEN contacts.source = 'google' THEN contacts.name
           WHEN EXCLUDED.name !~ '^\\+?[0-9\\s().-]+$'
             AND (contacts.name ~ '^\\+?[0-9\\s().-]+$' OR contacts.name IN ('Contato', 'WhatsApp Business', 'Você'))
             THEN EXCLUDED.name
           ELSE contacts.name
         END,
         avatar_url = COALESCE(EXCLUDED.avatar_url, contacts.avatar_url),
         updated_at = now()
       RETURNING id`,
      [companyId, local.sender === 'contact' ? local.senderName : `+${local.phone}`, `+${local.phone}`, null],
    );
    const contactId = contact.rows[0]?.id;
    if (!contactId) throw new Error('Contato não pôde ser preparado para a mensagem recebida');

    const conversationId = await findOrCreateConversation(client, {
      companyId,
      contactId,
      remoteJid: local.remoteJid,
      lastMessage: local.content,
      lastMessageAt: local.sentAt,
      reopenResolved: options.reopen && local.sender === 'contact',
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

    // O envio local é registrado antes da resposta da Evolution. Se o webhook
    // chegar primeiro, vinculamos o ID do provedor à mensagem pendente em vez
    // de criar uma segunda linha para o mesmo envio.
    let linkedPendingMessage = false;
    if (local.sender === 'attendant') {
      const pending = await client.query<{ id: string }>(
        `SELECT id
         FROM messages
         WHERE company_id = $1
           AND conversation_id = $2
           AND sender = 'attendant'
           AND evolution_message_id IS NULL
           AND is_internal_note = false
           AND sent_at BETWEEN $3::timestamptz - interval '5 minutes'
                           AND $3::timestamptz + interval '5 minutes'
           AND (content = $4 OR media_type = $5)
         ORDER BY abs(extract(epoch FROM (sent_at - $3::timestamptz))) ASC
         LIMIT 1
         FOR UPDATE`,
         [companyId, conversationId, local.sentAt, local.content, local.mediaType || null],
      );
      const pendingId = pending.rows[0]?.id;
      if (pendingId) {
        const linked = await client.query(
          `UPDATE messages
           SET evolution_message_id = $1,
               metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
               content = CASE
                  WHEN content ILIKE '[mensagem%suportada]'
                    OR content ILIKE '[mensagem%identificada]'
                  THEN $3
                  ELSE content
               END,
               media_url = COALESCE(media_url, $4),
               media_type = COALESCE(media_type, $5),
               status = $6,
               sent_at = $7
           WHERE id = $8
             AND evolution_message_id IS NULL`,
           [
             local.id,
             JSON.stringify(local.metadata || {}),
             local.content,
             local.mediaUrl || null,
             local.mediaType || null,
             local.status,
             local.sentAt,
             pendingId,
           ],
        );
        linkedPendingMessage = Boolean(linked.rowCount);
      }
    }

    let insertedNewMessage = false;
    if (!linkedPendingMessage) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO messages
         (company_id, conversation_id, evolution_message_id, sender, sender_name, content, media_url, media_type, metadata, status, sent_at, is_internal_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)
         ON CONFLICT (company_id, evolution_message_id) DO NOTHING
         RETURNING id`,
        messageParams,
      );
      insertedNewMessage = Boolean(inserted.rowCount);

      // Reprocessamentos do webhook podem trazer metadados ou mídia que não
      // existiam na primeira entrega. Atualizamos o registro sem tratá-lo como
      // uma nova mensagem para fins de contagem de não lidas.
      if (!insertedNewMessage) {
        await client.query(
          `UPDATE messages
            SET metadata = COALESCE(messages.metadata, '{}'::jsonb) || $1::jsonb,
                sender_name = CASE
                  WHEN messages.sender = 'contact'
                    AND ($2 IS NOT NULL AND $2 <> '')
                  THEN $2
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
              AND evolution_message_id = $9`,
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
      }
    }

    if (insertedNewMessage && options.incrementUnread && local.sender === 'contact') {
      await client.query('UPDATE conversations SET unread_count = unread_count + 1, updated_at = now() WHERE id = $1', [conversationId]);
    }
    await client.query('COMMIT');
    localInboxCache.delete(companyId);
    return insertedNewMessage || linkedPendingMessage;
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
}) {
  const contact = await db.query<{ id: string }>(
    `INSERT INTO contacts (company_id, name, phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id, phone) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [input.companyId, `+${input.number}`, `+${input.number}`],
  );
  const contactId = contact.rows[0]?.id;
  if (!contactId) throw new Error('Contato não pôde ser preparado para o envio');

  const conversationId = await findOrCreateConversation(db, {
    companyId: input.companyId,
    contactId,
    remoteJid: input.remoteJid,
    lastMessage: input.content,
    lastMessageAt: new Date(),
    reopenResolved: true,
    assignedUserId: input.userId,
  });
  if (!conversationId) throw new Error('Conversa não pôde ser preparada para o envio');

  const message = await db.query<{ id: string }>(
    `INSERT INTO messages
      (company_id, conversation_id, sender, sender_name, content, media_type, status, is_internal_note)
     VALUES ($1, $2, 'attendant', $3, $4, $5, 'pending', false)
     RETURNING id`,
    [input.companyId, conversationId, input.userName, input.content, input.mediaType || null],
  );
  const messageId = message.rows[0]?.id;
  if (!messageId) throw new Error('Mensagem não pôde ser registrada');
  localInboxCache.delete(input.companyId);
  return { conversationId, messageId };
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
    const providerMessage = await db.query<{ id: string }>(
      `SELECT id
       FROM messages
       WHERE evolution_message_id = $1
       LIMIT 1`,
      [evolutionMessageId],
    );
    if (!providerMessage.rows[0]) throw error;
    await db.query(
      `UPDATE messages
       SET status = CASE
         WHEN status IN ('read', 'delivered') AND $2 = 'sent' THEN status
         WHEN status = 'failed' AND $2 <> 'failed' THEN status
         ELSE $2
       END
       WHERE id = $1`,
      [providerMessage.rows[0].id, status],
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
    reply.hijack();
    const origin = request.headers.origin;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin === config.FRONTEND_URL ? origin : config.FRONTEND_URL,
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
      const missingLocalChats = localChats.filter((chat: any) => {
        const remoteJid = String(chat?.remoteJid || chat?.id || '');
        const phone = providerContactPhone(chat);
        return !knownRemoteJids.has(remoteJid) && !knownPhones.has(phone);
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
    let statuses: { rows: Array<{ evolution_remote_jid: string; status: 'open' | 'pending' | 'resolved'; updated_at: string }> };
    let readStates: { rows: Array<{ evolution_remote_jid: string; last_read_message_timestamp: string }> };
    try {
      [storedContacts, assignments, statuses, readStates] = await Promise.all([db.query<{
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
      ORDER BY m.sent_at DESC
      LIMIT $${pageSizeParam}`, pageQueryParams);

    // Depois que o webhook persiste a conversa, a leitura deixa de depender da Evolution.
    // A consulta externa serve apenas para uma reconciliação inicial do histórico antigo.
    if (!parsed.data.reconcile && (localMessages.rows.length > 0 || parsed.data.afterTimestamp)) {
      return {
        messages: {
          records: localMessages.rows.map(localMessageToProviderRecord),
          hasMore: parsed.data.afterTimestamp ? false : localMessages.rows.length >= pageSize,
        },
      };
    }

    const responses = await Promise.all([...jids].map((remoteJid) => evolutionRequest(
      `/chat/findMessages/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      {
        method: 'POST',
        body: JSON.stringify({ where: { key: { remoteJid } }, limit: 500 }),
      },
    )));
    const successfulResponses = responses.filter((response) => response.ok);
    if (successfulResponses.length === 0) {
      return {
        messages: {
          records: localMessages.rows.map(localMessageToProviderRecord),
          hasMore: parsed.data.afterTimestamp ? false : localMessages.rows.length >= pageSize,
        },
      };
    }

    const recordsById = new Map<string, any>();
    for (const response of successfulResponses) {
      const body: any = await response.json().catch(() => ({}));
      const records = body?.messages?.records || body?.records || (Array.isArray(body) ? body : []);
      if (!Array.isArray(records)) continue;
      records.forEach((record: any, index: number) => {
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
          ? false
          : localMessages.rows.length >= pageSize || mergedRecords.size > pageSize,
      },
    };
  });

  app.post('/api/evolution/messages/send', { preHandler: requireUser }, async (request, reply) => {
    const parsed = sendTextSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mensagem inválida' });
    const { number, text, remoteJid } = parsed.data;
    const canonicalRemoteJid = remoteJid || canonicalPhoneJid(number);
    const assigned = await db.query<{ assigned_user_id: string; user_name: string }>(
      `SELECT a.assigned_user_id, u.name AS user_name
       FROM conversation_assignments a
       JOIN users u ON u.id = a.assigned_user_id
       WHERE a.company_id = $1
         AND a.evolution_remote_jid = ANY($2::text[])
       ORDER BY a.updated_at DESC
       LIMIT 1`,
      [request.user!.companyId, assignmentJids({ remoteJid: canonicalRemoteJid, phone: number })],
    );
    if (assigned.rows[0] && assigned.rows[0].assigned_user_id !== request.user!.id && request.user!.role !== 'admin') {
      return reply.code(409).send({ error: `Atendimento capturado por ${assigned.rows[0].user_name}` });
    }
    const localMessage = await ensureOutboundMessage({
      companyId: request.user!.companyId,
      userId: request.user!.id,
      userName: request.user!.name,
      number,
      remoteJid: canonicalRemoteJid,
      content: text,
    });
    let response: Response;
    let body: any;
    try {
      response = await evolutionRequest(
      `/message/sendText/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
      {
        method: 'POST',
        body: JSON.stringify({ number, text, delay: 1200, linkPreview: true }),
      },
      );
      body = await response.json().catch(() => ({ error: 'Evolution API response invalid' }));
    } catch (error) {
      await updateOutboundMessage(localMessage.messageId, 'failed');
      request.log.warn({ err: error }, 'Falha de comunicação com a Evolution API');
      return reply.code(502).send({ error: 'Evolution API unavailable', messageId: localMessage.messageId });
    }
    if (!response.ok) {
      await updateOutboundMessage(localMessage.messageId, 'failed');
      return reply.code(502).send({ error: 'Evolution API unavailable', messageId: localMessage.messageId });
    }
    const evolutionMessageId = body?.key?.id || body?.message?.key?.id || body?.data?.key?.id;
    await updateOutboundMessage(localMessage.messageId, 'sent', typeof evolutionMessageId === 'string' ? evolutionMessageId : undefined);
    publishRealtimeEvent(request.user!.companyId, 'message.upsert', {
      remoteJid: canonicalRemoteJid,
      phone: number,
      messageId: typeof evolutionMessageId === 'string' ? evolutionMessageId : localMessage.messageId,
      timestampMs: Date.now(),
      fromMe: true,
    });

    let dailyResponder: { id: string; name: string; date: string } | undefined;
    try {
      dailyResponder = await recordDailyResponder(request.user!.companyId, number, request.user!);
    } catch (error) {
      request.log.warn({ err: error }, 'NÃ£o foi possÃ­vel registrar o primeiro atendente do dia');
    }
    return {
      evolution: body,
      dailyResponder,
      remoteJid: canonicalRemoteJid,
      message: { id: localMessage.messageId, evolutionMessageId, status: 'sent', senderName: request.user!.name },
    };
  });

  app.post('/api/evolution/messages/send-media', { preHandler: requireUser }, async (request, reply) => {
    const parsed = sendMediaSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Anexo inválido' });
    const { number, text, remoteJid } = {
      number: parsed.data.number,
      text: parsed.data.caption?.trim() || `[${parsed.data.mediatype}]`,
      remoteJid: parsed.data.remoteJid,
    };
    const canonicalRemoteJid = remoteJid || canonicalPhoneJid(number);
    const assigned = await db.query<{ assigned_user_id: string; user_name: string }>(
      `SELECT a.assigned_user_id, u.name AS user_name
       FROM conversation_assignments a
       JOIN users u ON u.id = a.assigned_user_id
       WHERE a.company_id = $1
         AND a.evolution_remote_jid = ANY($2::text[])
       ORDER BY a.updated_at DESC
       LIMIT 1`,
      [request.user!.companyId, assignmentJids({ remoteJid: canonicalRemoteJid, phone: number })],
    );
    if (assigned.rows[0] && assigned.rows[0].assigned_user_id !== request.user!.id && request.user!.role !== 'admin') {
      return reply.code(409).send({ error: `Atendimento capturado por ${assigned.rows[0].user_name}` });
    }

    const localMessage = await ensureOutboundMessage({
      companyId: request.user!.companyId,
      userId: request.user!.id,
      userName: request.user!.name,
      number,
      remoteJid: canonicalRemoteJid,
      content: text,
      mediaType: parsed.data.mediatype,
    });
    let response: Response;
    let body: any;
    try {
      const caption = parsed.data.caption?.trim()
        ? `*${request.user!.name}*\n${parsed.data.caption.trim()}`
        : undefined;
      response = await evolutionRequest(
        `/message/sendMedia/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            number,
            mediatype: parsed.data.mediatype,
            mimetype: parsed.data.mimetype,
            media: parsed.data.media,
            fileName: parsed.data.fileName,
            caption,
          }),
        },
      );
      body = await response.json().catch(() => ({ error: 'Evolution API response invalid' }));
    } catch (error) {
      await updateOutboundMessage(localMessage.messageId, 'failed');
      request.log.warn({ err: error }, 'Falha de comunicação com a Evolution API ao enviar anexo');
      return reply.code(502).send({ error: 'Evolution API indisponível', messageId: localMessage.messageId });
    }
    if (!response.ok) {
      await updateOutboundMessage(localMessage.messageId, 'failed');
      return reply.code(502).send({ error: 'Evolution API indisponível', messageId: localMessage.messageId });
    }
    const evolutionMessageId = body?.key?.id || body?.message?.key?.id || body?.data?.key?.id;
    await updateOutboundMessage(localMessage.messageId, 'sent', typeof evolutionMessageId === 'string' ? evolutionMessageId : undefined);
    publishRealtimeEvent(request.user!.companyId, 'message.upsert', {
      remoteJid: canonicalRemoteJid,
      phone: number,
      messageId: typeof evolutionMessageId === 'string' ? evolutionMessageId : localMessage.messageId,
      timestampMs: Date.now(),
      fromMe: true,
    });
    let dailyResponder: { id: string; name: string; date: string } | undefined;
    try {
      dailyResponder = await recordDailyResponder(request.user!.companyId, number, request.user!);
    } catch (error) {
      request.log.warn({ err: error }, 'Não foi possível registrar o primeiro atendente do dia');
    }
    return {
      evolution: body,
      dailyResponder,
      remoteJid: canonicalRemoteJid,
      message: { id: localMessage.messageId, evolutionMessageId, status: 'sent', senderName: request.user!.name },
    };
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
      const records = Array.isArray(data)
        ? data
        : Array.isArray(data?.messages)
          ? data.messages
          : Array.isArray(data?.records)
            ? data.records
            : [data];

      if (companyId) {
        for (const record of records) {
          try {
            if (await persistProviderMessage(companyId, record, { incrementUnread: true, reopen: true })) {
              persistedMessages += 1;
            }
            const remoteJid = providerRemoteJid(record);
            if (remoteJid) {
              publishRealtimeEvent(companyId, 'message.upsert', {
                remoteJid,
                phone: providerPhone(record),
                messageId: providerMessageId(record),
                timestampMs: providerMessageDate(record).getTime(),
                fromMe: record?.key?.fromMe === true,
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
