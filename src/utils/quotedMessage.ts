import { Message } from '../types';

export type QuotedMessage = NonNullable<NonNullable<Message['metadata']>['quotedMessage']>;

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

export const messageAuthorLabel = (message: Message) => {
  if (message.sender === 'contact') return message.senderName || 'Contato';
  if (message.metadata?.sentOutsideHub) return 'Enviado fora do Vitstock Hub';
  return message.senderName || 'Atendente';
};

export const toQuotedMessage = (message: Message): QuotedMessage => {
  const key = message.rawKey && typeof message.rawKey === 'object'
    ? message.rawKey
    : undefined;
  const id = typeof key?.id === 'string' && key.id.trim() ? key.id : message.id;

  return {
    messageId: id,
    authorName: messageAuthorLabel(message),
    sender: message.sender,
    content: message.content,
    mediaType: message.mediaType,
    key: {
      id,
      remoteJid: typeof key?.remoteJid === 'string' ? key.remoteJid : message.conversationId,
      fromMe: typeof key?.fromMe === 'boolean' ? key.fromMe : message.sender === 'attendant',
      ...(typeof key?.participant === 'string' ? { participant: key.participant } : {}),
    },
  };
};
