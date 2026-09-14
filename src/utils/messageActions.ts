import type { Message } from '../types';

const providerKeyFor = (message: Message) => {
  // Mutations are allowed only when the backend has persisted the provider
  // identity. A rawKey alone may be optimistic or provider-only data that the
  // mutation route must reject rather than turning into a guessed payload.
  const key = message.metadata?.providerKey;
  return key && typeof key === 'object' ? key as {
    id?: unknown;
    remoteJid?: unknown;
    fromMe?: unknown;
    participant?: unknown;
  } : undefined;
};

const hasSafeOutboundKey = (message: Message) => {
  const key = providerKeyFor(message);
  return message.sender === 'attendant'
    && message.metadata?.sentByHub === true
    && message.metadata?.deletedForEveryone !== true
    && typeof key?.id === 'string'
    && Boolean(key.id.trim())
    && typeof key.remoteJid === 'string'
    && Boolean(key.remoteJid.trim())
    && key.fromMe === true;
};

const isDirectPn = (remoteJid: string) => {
  const normalized = remoteJid.toLowerCase();
  return normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@c.us');
};

export const canEditMessage = (message: Message) => {
  const key = providerKeyFor(message);
  return hasSafeOutboundKey(message)
    && !message.mediaType
    && Boolean(message.content.trim())
    && typeof key?.remoteJid === 'string'
    && isDirectPn(key.remoteJid);
};

export const canDeleteMessageForEveryone = (message: Message) => {
  const key = providerKeyFor(message);
  if (!hasSafeOutboundKey(message) || typeof key?.remoteJid !== 'string') return false;
  return !key.remoteJid.toLowerCase().endsWith('@g.us') || typeof key.participant === 'string' && Boolean(key.participant.trim());
};

export const canDownloadMessageMedia = (message: Message) => Boolean(
  message.mediaType && (message.rawKey || message.mediaUrl),
);

export const messageCopyText = (message: Message) => message.metadata?.deletedForEveryone === true
  ? 'Mensagem apagada'
  : message.content;

export const messageMenuActionsFor = (message: Message) => [
  'reply',
  'react',
  'copy',
  ...(canEditMessage(message) ? ['edit'] : []),
  ...(canDeleteMessageForEveryone(message) ? ['delete'] : []),
  ...(canDownloadMessageMedia(message) ? ['download'] : []),
] as const;
