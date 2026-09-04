/**
 * Classifies provider entities using only the explicit JID contract.
 * Unknown entities fail closed until their provider contract is understood.
 */
export type ProviderJidKind =
  | 'PN'
  | 'LID'
  | 'GROUP'
  | 'NEWSLETTER'
  | 'STATUS_BROADCAST'
  | 'OTHER_BROADCAST'
  | 'UNKNOWN';

const KNOWN_PN_SUFFIXES = ['@s.whatsapp.net', '@c.us'];

export function classifyProviderJid(value: unknown): ProviderJidKind {
  const jid = typeof value === 'string' ? value.trim() : '';
  if (!jid) return 'UNKNOWN';
  const lower = jid.toLowerCase();
  if (lower.endsWith('@newsletter')) return 'NEWSLETTER';
  if (lower === 'status@broadcast') return 'STATUS_BROADCAST';
  if (lower.endsWith('@broadcast')) return 'OTHER_BROADCAST';
  if (lower.endsWith('@g.us')) return 'GROUP';
  if (lower.endsWith('@lid')) return 'LID';
  if (KNOWN_PN_SUFFIXES.some((suffix) => lower.endsWith(suffix)) || /^\d{8,20}$/.test(jid)) return 'PN';
  return 'UNKNOWN';
}

export function isConversationalProviderJid(value: unknown): boolean {
  const kind = classifyProviderJid(value);
  return kind === 'PN' || kind === 'LID' || kind === 'GROUP';
}

export function filterConversationalProviderChats<T extends Record<string, any>>(chats: T[]): T[] {
  return chats.filter((chat) => isConversationalProviderJid(chat?.remoteJid || chat?.id));
}
