import { Conversation } from '../types';
import { phoneVariants } from './phone';

export type ContactChatTarget = {
  phone?: string;
  remoteJid?: string;
};

const normalizeRemoteJid = (value?: string) => value?.trim().toLowerCase() || '';

const conversationRemoteJids = (conversation: Conversation) => [
  conversation.id,
  conversation.lastMessageKey?.remoteJid,
].map(normalizeRemoteJid).filter(Boolean);

/**
 * Resolves a contact shortcut without collapsing independent WhatsApp
 * channels. A provider JID is always preferred; phone matching is only used
 * for a single unambiguous private conversation.
 */
export const findConversationForContactChat = (
  conversations: Conversation[],
  target: ContactChatTarget,
) => {
  const remoteJid = normalizeRemoteJid(target.remoteJid);
  if (remoteJid) {
    const exact = conversations.find((conversation) => (
      conversationRemoteJids(conversation).includes(remoteJid)
    ));
    if (exact) return exact;
  }

  const phoneVariantsForTarget = new Set(phoneVariants(target.phone || ''));
  if (phoneVariantsForTarget.size === 0) return undefined;
  const matches = conversations.filter((conversation) => (
    !conversation.isGroup
    && phoneVariants(conversation.contact.phone).some((phone) => phoneVariantsForTarget.has(phone))
  ));
  return matches.length === 1 ? matches[0] : undefined;
};

export const normalizeContactChatPhone = (value: string) => value.replace(/\D/g, '');
