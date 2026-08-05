import { Message } from '../types';

/**
 * Mescla páginas e atualizações em tempo real sem duplicar o ID do provedor.
 * A última versão recebida vence, preservando a ordem cronológica.
 */
export const mergeConversationMessages = (current: Message[], incoming: Message[]) => {
  const byId = new Map<string, Message>();
  current.forEach((message) => byId.set(message.id, message));
  incoming.forEach((message) => byId.set(message.id, message));
  return Array.from(byId.values()).sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
};

