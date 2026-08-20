import { Message } from '../types';
import { callMessageInfo } from '../utils/callMessage';

type ProviderRecord = {
  key?: any;
  id?: string;
  message?: any;
  messageType?: string;
  contextInfo?: any;
  messageContextScope?: 'webhook';
  metadata?: Message['metadata'];
  metadataScope?: 'persisted_message';
  messageTimestamp?: number | string;
  pushName?: string;
  participant?: string;
  participantPn?: string;
  senderPn?: string;
  participantName?: string;
  senderName?: string;
  status?: unknown;
  update?: { status?: unknown };
};

/** WhatsApp group chats use the full `number@g.us` JID as remoteJid. */
export const isWhatsAppGroupJid = (value?: string | null) => (
  typeof value === 'string' && value.trim().toLowerCase().endsWith('@g.us')
);

const unwrapMessage = (message: any) => {
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
};

const firstText = (...values: unknown[]) => values.find(
  (value): value is string => typeof value === 'string' && value.trim().length > 0,
)?.trim();

const interactiveMessage = (message: any) => {
  const msg = unwrapMessage(message);
  return msg.interactiveMessage
    || msg.templateMessage?.interactiveMessageTemplate
    || msg.templateMessage?.interactiveMessage;
};

const interactiveResponseText = (message: any) => {
  const response = unwrapMessage(message).interactiveResponseMessage?.nativeFlowResponseMessage;
  if (!response?.paramsJson) return undefined;
  try {
    const params = JSON.parse(response.paramsJson);
    return firstText(params.display_text, params.title, params.id);
  } catch {
    return undefined;
  }
};

const messageText = (message: any, record: any = {}): string | undefined => {
  const msg = unwrapMessage(message);
  const interactive = interactiveMessage(msg);
  const template = msg.templateMessage?.hydratedTemplate;
  const fourRowTemplate = msg.templateMessage?.hydratedFourRowTemplate;
  const text = firstText(
    msg.conversation,
    msg.extendedTextMessage?.text,
    msg.imageMessage?.caption,
    msg.videoMessage?.caption,
    msg.audioMessage?.caption,
    msg.documentMessage?.caption,
    msg.documentMessage?.fileName,
    msg.documentMessage?.title,
    interactive?.body?.text,
    interactive?.header?.text,
    interactive?.header?.title,
    msg.buttonsMessage?.contentText,
    msg.buttonsMessage?.footerText,
    msg.listMessage?.description,
    msg.listMessage?.title,
    msg.listMessage?.footerText,
    template?.hydratedContentText,
    template?.hydratedTitleText,
    template?.hydratedFooterText,
    fourRowTemplate?.content,
    fourRowTemplate?.title,
    fourRowTemplate?.footer,
    msg.templateButtonReplyMessage?.selectedDisplayText,
    msg.buttonsResponseMessage?.selectedDisplayText,
    msg.listResponseMessage?.title,
    msg.listResponseMessage?.singleSelectReply?.selectedRowId,
    interactiveResponseText(msg),
  );
  if (text) return text;

  if (msg.reactionMessage?.text) return `Reagiu com: ${msg.reactionMessage.text}`;
  if (msg.contactMessage) {
    const vcard = String(msg.contactMessage.vcard || '');
    const phone = vcard.match(/waid=(\d+)/i)?.[1] || vcard.match(/(?:TEL[^:]*:)([^\n\r]+)/i)?.[1]?.trim();
    return `[Contato compartilhado]\n${msg.contactMessage.displayName || 'Contato'}${phone ? `\n+${phone.replace(/\D/g, '')}` : ''}`;
  }
  if (msg.locationMessage) return '[Localização compartilhada]';
  const callInfo = callMessageInfo(record, msg, String(record?.messageType || ''), record?.key?.fromMe === true);
  if (callInfo.isCall) return `[${callInfo.label || 'Ligação de voz'}]`;
  if (msg.protocolMessage) return Number(msg.protocolMessage.type) === 0 ? '[Mensagem apagada]' : '[Evento do WhatsApp]';
  if (msg.placeholderMessage) return '[Mensagem indisponível]';
  if (msg.secretEncryptedMessage) return '[Mensagem protegida]';
  if (msg.pollCreationMessage) return '[Enquete]';
  if (msg.pollUpdateMessage) return '[Resposta de enquete]';
  if (interactive || msg.buttonsMessage || msg.listMessage) return '[Mensagem interativa]';
  if (msg.stickerMessage) return '[Figurinha]';
  if (msg.audioMessage) return '[Mensagem de áudio]';
  if (msg.imageMessage) return '[Imagem]';
  if (msg.videoMessage) return '[Vídeo]';
  if (msg.documentMessage) return '[Documento]';
  return '[Mensagem não identificada]';
};

export const evolutionMessagePreview = (record: any): string | undefined => (
  isEvolutionReactionEvent(record)
    ? undefined
    : messageText(record?.message || record, record)
);

/**
 * A reaction is an update to the message referenced by reactionMessage.key,
 * not a standalone timeline message. The backend persists that update on the
 * original message; this guard also protects the client from legacy/raw rows.
 */
export const isEvolutionReactionEvent = (record: ProviderRecord | any): boolean => Boolean(
  unwrapMessage(record?.message || record)?.reactionMessage,
);

const quotedMessageFromContext = (context: any): NonNullable<NonNullable<Message['metadata']>['quotedMessage']> | undefined => {
  const messageId = firstText(context?.stanzaId, context?.stanzaID, context?.quotedMessage?.key?.id);
  if (!messageId) return undefined;

  const quoted = unwrapMessage(context?.quotedMessage || {});
  const mediaType = quoted.imageMessage ? 'image'
    : quoted.videoMessage ? 'video'
      : quoted.audioMessage ? 'audio'
        : quoted.documentMessage ? 'document'
          : quoted.stickerMessage ? 'sticker'
            : undefined;
  const participant = firstText(context?.participant, context?.participantPn, context?.quotedParticipant);

  return {
    messageId,
    content: messageText(quoted),
    mediaType,
    key: {
      id: messageId,
      ...(participant ? { participant } : {}),
    },
  };
};

const documentMetadataFromMessage = (message: any): NonNullable<Message['metadata']>['document'] | undefined => {
  const document = message?.documentMessage;
  if (!document) return undefined;
  const fileName = firstText(document.fileName, document.file_name, document.title);
  const mimeType = firstText(document.mimetype, document.mimeType);
  const rawSize = Number(document.fileLength ?? document.fileSize ?? document.file_length);
  const fileSize = Number.isFinite(rawSize) && rawSize >= 0 ? Math.floor(rawSize) : undefined;
  if (!fileName && !mimeType && fileSize === undefined) return undefined;
  return {
    ...(fileName ? { fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(fileSize !== undefined ? { fileSize } : {}),
  };
};

const messageMetadata = (record: ProviderRecord, message: any): Message['metadata'] => {
  const msg = unwrapMessage(message);
  // The record-level context can describe the chat snapshot. An ad card is
  // valid only when its evidence is attached to this message payload.
  const embeddedContext = msg.contextInfo
    || msg.extendedTextMessage?.contextInfo
    || msg.imageMessage?.contextInfo
    || msg.videoMessage?.contextInfo
    || msg.documentMessage?.contextInfo
    || {};
  const webhookContext = record.messageContextScope === 'webhook'
    ? record.contextInfo
    : undefined;
  const context = Object.keys(embeddedContext).length > 0
    ? embeddedContext
    : (webhookContext || {});
  const metadata: NonNullable<Message['metadata']> = { ...(record.metadata || {}) };
  // Metadata returned from the local PostgreSQL representation was already
  // derived by the backend per message. Raw Evolution records must derive ad
  // fields only from their own message payload below.
  if (record.metadataScope !== 'persisted_message') {
    delete metadata.trafficSource;
    delete metadata.trafficTitle;
    delete metadata.trafficUrl;
    delete metadata.quotedMessage;
  }
  if (!metadata.quotedMessage) {
    const quotedMessage = quotedMessageFromContext(context);
    if (quotedMessage) metadata.quotedMessage = quotedMessage;
  }
  if (!metadata.document) {
    const document = documentMetadataFromMessage(msg);
    if (document) metadata.document = document;
  }
  const fromMe = record.key?.fromMe === true;
  const participantJid = firstText(
    record.key?.participant,
    record.key?.participantPn,
    record.participant,
    record.participantPn,
    record.senderPn,
    record.key?.senderPn,
  );
  if (participantJid) metadata.participantJid = participantJid;
  const participantName = firstText(record.pushName, record.participantName, record.senderName);
  if (!fromMe && participantName) metadata.participantName = participantName;
  const callInfo = callMessageInfo(record, msg, String(record.messageType || metadata.providerType || ''), fromMe);
  const externalAd = context?.externalAdReply;
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
    if (!metadata.trafficSource && typeof trafficSource === 'string' && trafficSource.trim()) metadata.trafficSource = trafficSource.trim();
    if (!metadata.trafficTitle && typeof externalAd?.title === 'string' && externalAd.title.trim()) metadata.trafficTitle = externalAd.title.trim();
    if (!metadata.trafficUrl && typeof (externalAd?.sourceUrl || externalAd?.sourceURL) === 'string') metadata.trafficUrl = externalAd.sourceUrl || externalAd.sourceURL;
  } else if (fromMe) {
    delete metadata.trafficSource;
    delete metadata.trafficTitle;
    delete metadata.trafficUrl;
  }

  if (!metadata.contactCard && msg.contactMessage) {
    const vcard = String(msg.contactMessage.vcard || '');
    const phone = vcard.match(/waid=(\d+)/i)?.[1] || vcard.match(/(?:TEL[^:]*:)([^\n\r]+)/i)?.[1]?.trim();
    metadata.contactCard = { displayName: msg.contactMessage.displayName || 'Contato compartilhado', phone: phone ? `+${phone.replace(/\D/g, '')}` : undefined };
  }
  if (!metadata.location && msg.locationMessage && Number.isFinite(Number(msg.locationMessage.degreesLatitude)) && Number.isFinite(Number(msg.locationMessage.degreesLongitude))) {
    const latitude = Number(msg.locationMessage.degreesLatitude);
    const longitude = Number(msg.locationMessage.degreesLongitude);
    metadata.location = { latitude, longitude, name: msg.locationMessage.name, address: msg.locationMessage.address, url: msg.locationMessage.url || `https://www.google.com/maps?q=${latitude},${longitude}` };
  }
  if (!metadata.reaction && msg.reactionMessage?.text) metadata.reaction = msg.reactionMessage.text;
  if (callInfo.isCall) metadata.systemLabel = callInfo.label;
  if (!metadata.systemLabel && msg.protocolMessage) metadata.systemLabel = Number(msg.protocolMessage.type) === 0 ? 'Mensagem apagada' : 'Evento do WhatsApp';
  if (!metadata.systemLabel && msg.placeholderMessage) metadata.systemLabel = 'Mensagem indisponível';
  return metadata;
};

const messageButtons = (message: any): NonNullable<Message['interactiveButtons']> => {
  const msg = unwrapMessage(message);
  const interactive = interactiveMessage(msg);
  const buttons: NonNullable<Message['interactiveButtons']> = [];
  const addNativeButton = (button: any) => {
    try {
      const params = JSON.parse(button?.buttonParamsJson || '{}');
      if (button?.name === 'cta_url' && /^https?:\/\//i.test(params.url || '')) buttons.push({ type: 'url', label: params.display_text || 'Abrir link', url: params.url });
      if (button?.name === 'cta_call') buttons.push({ type: 'call', label: params.display_text || 'Ligar', value: params.phone_number || params.number || '' });
      if (button?.name === 'cta_copy') buttons.push({ type: 'copy', label: params.display_text || 'Copiar', value: params.copy_code || params.code || '' });
      if (button?.name === 'quick_reply') buttons.push({ type: 'quickReply', label: params.display_text || 'Responder', value: params.id || params.display_text || '' });
    } catch {
      // O conteúdo textual continua disponível quando o JSON comercial está incompleto.
    }
  };
  if (Array.isArray(interactive?.nativeFlowMessage?.buttons)) interactive.nativeFlowMessage.buttons.forEach(addNativeButton);
  const hydrated = msg.templateMessage?.hydratedTemplate?.hydratedButtons;
  if (Array.isArray(hydrated)) hydrated.forEach((button: any) => {
    if (button?.urlButton?.url) buttons.push({ type: 'url', label: button.urlButton.displayText || 'Abrir link', url: button.urlButton.url });
    if (button?.callButton?.phoneNumber) buttons.push({ type: 'call', label: button.callButton.displayText || 'Ligar', value: button.callButton.phoneNumber });
    if (button?.quickReplyButton) buttons.push({ type: 'quickReply', label: button.quickReplyButton.displayText || 'Responder', value: button.quickReplyButton.id || button.quickReplyButton.displayText || '' });
  });
  if (Array.isArray(msg.buttonsMessage?.buttons)) msg.buttonsMessage.buttons.forEach((button: any) => {
    const label = button?.buttonText?.displayText || button?.displayText;
    if (label) buttons.push({ type: 'quickReply', label, value: button.buttonId || label });
  });
  return buttons;
};

const mediaForMessage = (message: any) => {
  const msg = unwrapMessage(message);
  const candidates: Array<{ type: Message['mediaType']; value: any }> = [
    { type: 'image', value: msg.imageMessage },
    { type: 'audio', value: msg.audioMessage },
    { type: 'video', value: msg.videoMessage },
    { type: 'document', value: msg.documentMessage },
    { type: 'sticker', value: msg.stickerMessage },
  ];
  const found = candidates.find((candidate) => candidate.value);
  if (!found) return { type: undefined, url: undefined, value: undefined };
  const url = typeof found.value?.url === 'string' && found.value.url.startsWith('http') ? found.value.url : undefined;
  return { type: found.type, url, value: found.value };
};

const normalizeStatus = (value: unknown): Message['status'] => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (['ERROR', 'FAILED', 'FAILURE', 'REJECTED', '0'].includes(raw)) return 'failed';
  if (['READ', 'PLAYED', '4', '5'].includes(raw)) return 'read';
  if (['DELIVERY_ACK', 'DELIVERED', '2', '3'].includes(raw)) return 'delivered';
  return 'sent';
};

const parseSignature = (content: string) => {
  const match = content.match(/^\*(?:👤\s*)?([^*\r\n]+)\*\s*(?:\r?\n|$)/);
  if (!match) return { senderName: undefined, content };
  return { senderName: match[1].trim(), content: content.slice(match[0].length).trimStart() };
};

export const normalizeEvolutionMessage = (
  record: ProviderRecord,
  index: number,
  conversationId: string,
  attendantLabel: string,
): Message => {
  const fromMe = record.key?.fromMe === true;
  const rawMessage = record.message || {};
  const msg = unwrapMessage(rawMessage);
  const media = mediaForMessage(rawMessage);
  const metadata = messageMetadata(record, rawMessage) || {};
  const interactive = interactiveMessage(msg);
  const content = messageText(rawMessage, record);
  const signed = fromMe ? parseSignature(content || '[Mensagem não identificada]') : { senderName: undefined, content: content || '[Mensagem não identificada]' };
  const sentByHub = fromMe
    && metadata.sentByHub === true
    && typeof metadata.sentByUserName === 'string'
    && metadata.sentByUserName.trim().length > 0;
  if (fromMe && !sentByHub) metadata.sentOutsideHub = true;
  if (sentByHub) delete metadata.sentOutsideHub;
  const timestampMs = record.messageTimestamp ? Number(record.messageTimestamp) * 1000 : undefined;
  const timestamp = timestampMs ? new Date(timestampMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Agora';
  const durationValue = media.type === 'audio' ? msg.audioMessage?.seconds : media.type === 'video' ? msg.videoMessage?.seconds : undefined;

  return {
    id: record.key?.id || record.id || `real-msg-${index}`,
    conversationId,
    sender: fromMe ? 'attendant' : 'contact',
    senderName: fromMe
      ? (sentByHub ? metadata.sentByUserName!.trim() : undefined)
      : (metadata.participantName || record.pushName || 'Contato'),
    content: fromMe && sentByHub ? signed.content : (content || '[Mensagem não identificada]'),
    mediaUrl: media.url,
    mediaType: media.type,
    mediaDuration: durationValue ? Number(durationValue) : undefined,
    interactiveTitle: interactive?.header?.title || interactive?.header?.text || msg.templateMessage?.hydratedTemplate?.hydratedTitleText || msg.templateMessage?.hydratedFourRowTemplate?.title || undefined,
    interactiveFooter: interactive?.footer?.text || msg.templateMessage?.hydratedTemplate?.hydratedFooterText || msg.templateMessage?.hydratedFourRowTemplate?.footer || undefined,
    interactiveButtons: messageButtons(msg),
    metadata,
    rawKey: record.key,
    timestampMs,
    timestamp,
    status: fromMe ? normalizeStatus(record.status || record.update?.status || record.key?.status) : 'read',
    isInternalNote: false,
  };
};
