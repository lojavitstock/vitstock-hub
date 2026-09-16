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

export type ForwardableLocation = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

export function hasPersistedLocation(source: ForwardSourceMessage | undefined) {
  return Boolean(source?.metadata
    && Object.prototype.hasOwnProperty.call(source.metadata, 'location'));
}

/** Only a persisted fixed location with valid coordinates can be forwarded. */
export function forwardableLocationFromSource(source: ForwardSourceMessage | undefined): ForwardableLocation | undefined {
  if (!source
    || (source.sender !== 'contact' && source.sender !== 'attendant')
    || source.is_internal_note
    || source.media_url
    || source.media_type
    || source.status === 'pending'
    || source.status === 'failed'
    || source.metadata?.deletedForEveryone === true
    || source.metadata?.deletedForEveryone === 'true'
    || !hasPersistedLocation(source)) return undefined;

  const location = source.metadata?.location;
  if (!location || typeof location !== 'object' || Array.isArray(location)) return undefined;
  const latitude = location.latitude;
  const longitude = location.longitude;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return undefined;

  const optionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
  return {
    latitude,
    longitude,
    ...(optionalText(location.name) ? { name: optionalText(location.name) } : {}),
    ...(optionalText(location.address) ? { address: optionalText(location.address) } : {}),
  };
}

/** Only ordinary, non-deleted text messages can enter the text-forward MVP. */
export function forwardableTextFromSource(source: ForwardSourceMessage | undefined) {
  if (!source
    || source.sender === 'system'
    || source.is_internal_note
    || source.media_url
    || source.media_type
    || hasPersistedLocation(source)
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
    || hasPersistedLocation(source)
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
