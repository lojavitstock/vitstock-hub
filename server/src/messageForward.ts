import { formatHubOutboundText } from './outboundMessage.js';

export type ForwardSourceMessage = {
  id: string;
  conversation_id: string;
  evolution_message_id?: string | null;
  evolution_remote_jid?: string | null;
  sender: 'contact' | 'attendant' | 'system';
  content: string | null;
  media_url: string | null;
  media_type: string | null;
  metadata: Record<string, any> | null;
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | null;
  is_internal_note: boolean;
};

/** Only ordinary, non-deleted text messages can enter the text-forward MVP. */
export function forwardableTextFromSource(source: ForwardSourceMessage | undefined) {
  if (!source
    || source.sender === 'system'
    || source.is_internal_note
    || source.media_url
    || source.media_type
    || source.metadata?.deletedForEveryone === true
    || source.metadata?.deletedForEveryone === 'true') return undefined;
  const content = typeof source.content === 'string' ? source.content.trim() : '';
  return content || undefined;
}

const imagePlaceholder = /^(?:🖼️\s*)?\[(?:imagem|image)\]$/iu;

/** Only a persisted, ordinary image message can enter image forwarding. */
export function forwardableImageFromSource(source: ForwardSourceMessage | undefined) {
  if (!source
    || (source.sender !== 'contact' && source.sender !== 'attendant')
    || source.is_internal_note
    || source.media_type !== 'image'
    || source.status === 'pending'
    || source.status === 'failed'
    || source.metadata?.deletedForEveryone === true
    || source.metadata?.deletedForEveryone === 'true') return undefined;
  const content = typeof source.content === 'string' ? source.content.trim() : '';
  return { caption: content && !imagePlaceholder.test(content) ? content : undefined };
}

export function evolutionTextPayload(input: {
  recipient: string;
  text: string;
  userName: string;
  quoted?: unknown;
}) {
  return {
    number: input.recipient,
    text: formatHubOutboundText(input.userName, input.text),
    delay: 1200,
    linkPreview: true,
    ...(input.quoted ? { quoted: input.quoted } : {}),
  };
}
