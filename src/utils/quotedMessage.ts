import { Message, type QuotedProviderKeySource, type QuotedSourceAge, type QuotedSourceMediaType } from '../types';

export type QuotedMessage = NonNullable<NonNullable<Message['metadata']>['quotedMessage']>;

const nonBlankString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim().length > 0 ? value : undefined
);

export const quotedMediaLabel = (mediaType?: Message['mediaType']) => {
  switch (mediaType) {
    case 'image': return 'Foto';
    case 'video': return 'Vídeo';
    case 'audio': return 'Áudio';
    case 'document': return 'Documento';
    case 'sticker': return 'Figurinha';
    default: return undefined;
  }
};

export const quotedMessageExcerpt = (quoted: QuotedMessage) => (
  quoted.content?.trim() || quotedMediaLabel(quoted.mediaType) || 'Mensagem'
);

export const quotedProviderKeySource = (message: Message): QuotedProviderKeySource => {
  if (message.rawKey && typeof message.rawKey === 'object') return 'raw';
  if (message.metadata?.providerKey && typeof message.metadata.providerKey === 'object') return 'metadata';
  if (typeof message.id === 'string' && message.id.trim()) return 'legacy';
  return 'none';
};

export const quotedSourceAge = (timestampMs?: number, nowMs = Date.now()): QuotedSourceAge => {
  if (!Number.isFinite(timestampMs) || !timestampMs || !Number.isFinite(nowMs)) return 'UNKNOWN';
  const ageMs = Math.max(0, nowMs - Number(timestampMs));
  if (ageMs <= 7 * 24 * 60 * 60 * 1000) return 'RECENT';
  if (ageMs <= 90 * 24 * 60 * 60 * 1000) return 'OLDER';
  return 'LEGACY';
};

export const quotedSourceMediaType = (message: Message): QuotedSourceMediaType => {
  if (message.metadata?.location) return 'location';
  if (message.mediaType) return message.mediaType;
  if (message.content.trim()) return 'text';
  return 'other';
};

export const messageAuthorLabel = (message: Message) => {
  if (message.sender === 'contact') return message.senderName || 'Contato';
  if (message.metadata?.sentOutsideHub) return 'Enviado fora do Vitstock Hub';
  return message.senderName || 'Atendente';
};

export const toQuotedMessage = (message: Message): QuotedMessage => {
  const key = message.rawKey && typeof message.rawKey === 'object'
    ? message.rawKey
    : message.metadata?.providerKey;
  const id = typeof key?.id === 'string' && key.id.trim() ? key.id : message.id;
  const remoteJid = nonBlankString(key?.remoteJid) || nonBlankString(message.conversationId);
  const remoteJidAlt = nonBlankString(key?.remoteJidAlt);
  const participant = nonBlankString(key?.participant);
  const participantAlt = nonBlankString(key?.participantAlt);
  const addressingMode = nonBlankString(key?.addressingMode);
  const senderPn = nonBlankString(key?.senderPn);
  const participantPn = nonBlankString(key?.participantPn);

  return {
    messageId: id,
    providerKeySource: quotedProviderKeySource(message),
    sourceAge: quotedSourceAge(message.timestampMs),
    sourceMediaType: quotedSourceMediaType(message),
    authorName: messageAuthorLabel(message),
    sender: message.sender,
    content: message.content,
    mediaType: message.mediaType,
    key: {
      id,
      ...(remoteJid ? { remoteJid } : {}),
      ...(remoteJidAlt ? { remoteJidAlt } : {}),
      fromMe: typeof key?.fromMe === 'boolean' ? key.fromMe : message.sender === 'attendant',
      ...(participant ? { participant } : {}),
      ...(participantAlt ? { participantAlt } : {}),
      ...(addressingMode ? { addressingMode } : {}),
      ...(senderPn ? { senderPn } : {}),
      ...(participantPn ? { participantPn } : {}),
    },
  };
};
