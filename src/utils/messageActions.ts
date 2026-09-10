import type { Message } from '../types';

export type MessageActionEligibilityReason =
  | 'NOT_ATTENDANT'
  | 'NOT_SENT_BY_HUB'
  | 'MISSING_PROVIDER_KEY'
  | 'MISSING_PROVIDER_ID'
  | 'MISSING_REMOTE_JID'
  | 'FROM_ME_NOT_TRUE'
  | 'ALREADY_DELETED'
  | 'UNSUPPORTED_EDIT_TARGET';

export type MessageActionEligibility = {
  allowed: boolean;
  reasons: MessageActionEligibilityReason[];
};

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

const commonEligibility = (message: Message) => {
  const key = providerKeyFor(message);
  const reasons: MessageActionEligibilityReason[] = [];
  if (message.sender !== 'attendant') reasons.push('NOT_ATTENDANT');
  if (message.metadata?.sentByHub !== true) reasons.push('NOT_SENT_BY_HUB');
  if (message.metadata?.deletedForEveryone === true) reasons.push('ALREADY_DELETED');
  if (!key) reasons.push('MISSING_PROVIDER_KEY');
  else {
    if (typeof key.id !== 'string' || !key.id.trim()) reasons.push('MISSING_PROVIDER_ID');
    if (typeof key.remoteJid !== 'string' || !key.remoteJid.trim()) reasons.push('MISSING_REMOTE_JID');
    if (key.fromMe !== true) reasons.push('FROM_ME_NOT_TRUE');
  }
  return { key, reasons };
};

const isDirectPn = (remoteJid: string) => {
  const normalized = remoteJid.toLowerCase();
  return normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@c.us');
};

export const getEditMessageEligibility = (message: Message): MessageActionEligibility => {
  const { key, reasons } = commonEligibility(message);
  if (message.mediaType || !message.content.trim()) reasons.push('UNSUPPORTED_EDIT_TARGET');
  if (typeof key?.remoteJid === 'string' && key.remoteJid.trim() && !isDirectPn(key.remoteJid)) {
    reasons.push('UNSUPPORTED_EDIT_TARGET');
  }
  return { allowed: reasons.length === 0, reasons };
};

export const getDeleteMessageEligibility = (message: Message): MessageActionEligibility => {
  const { key, reasons } = commonEligibility(message);
  if (typeof key?.remoteJid === 'string' && key.remoteJid.toLowerCase().endsWith('@g.us')
    && (typeof key.participant !== 'string' || !key.participant.trim())) {
    reasons.push('UNSUPPORTED_EDIT_TARGET');
  }
  return { allowed: reasons.length === 0, reasons };
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

const remoteJidType = (remoteJid: unknown) => {
  if (typeof remoteJid !== 'string') return 'missing';
  const normalized = remoteJid.toLowerCase();
  if (normalized.endsWith('@lid')) return '@lid';
  if (normalized.endsWith('@g.us')) return '@g.us';
  if (normalized.endsWith('@s.whatsapp.net')) return '@s.whatsapp.net';
  return 'other';
};

export const messageActionDebugPayload = (message: Message) => {
  const providerKey = providerKeyFor(message);
  const editEligibility = getEditMessageEligibility(message);
  const deleteEligibility = getDeleteMessageEligibility(message);
  const topLevelProviderKey = (message as Message & { providerKey?: unknown }).providerKey;
  return {
    id: message.id,
    sender: message.sender,
    sentByHub: message.metadata?.sentByHub,
    deletedForEveryone: message.metadata?.deletedForEveryone,
    metadataProviderKeyPresent: Boolean(message.metadata?.providerKey),
    providerKey: {
      idPresent: typeof providerKey?.id === 'string',
      remoteJidType: remoteJidType(providerKey?.remoteJid),
      fromMe: providerKey?.fromMe,
    },
    rawKeyPresent: Boolean(message.rawKey),
    topLevelProviderKeyPresent: Boolean(topLevelProviderKey),
    canEdit: canEditMessage(message),
    canDelete: canDeleteMessageForEveryone(message),
    editFailureReasons: editEligibility.reasons,
    deleteFailureReasons: deleteEligibility.reasons,
  };
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
