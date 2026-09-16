import { formatHubOutboundText } from './outboundMessage.js';

export type ForwardSourceMessage = {
  id: string;
  conversation_id: string;
  sender: 'contact' | 'attendant' | 'system';
  content: string | null;
  media_url: string | null;
  media_type: string | null;
  metadata: Record<string, any> | null;
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
