import { formatHubOutboundText } from './outboundMessage.js';
import { MAX_MEDIA_BASE64_CHARS } from './mediaLimits.js';

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

export type ForwardableDocument = {
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  caption?: string;
};

const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  log: 'text/plain',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
};

const DOCUMENT_EXTENSION_BY_MIME = Object.entries(DOCUMENT_MIME_BY_EXTENSION).reduce<Record<string, string>>(
  (extensions, [extension, mimeType]) => {
    if (!extensions[mimeType]) extensions[mimeType] = extension;
    return extensions;
  },
  {},
);

const documentFileName = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 180 || /[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed;
};

export const trustedDocumentMimeType = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(trimmed) && trimmed.length <= 100
    ? trimmed
    : undefined;
};

const documentExtension = (value: unknown) => {
  const fileName = documentFileName(value);
  const match = fileName?.match(/\.([a-z0-9]{1,10})$/i);
  return match?.[1]?.toLowerCase();
};

export const documentMimeTypeForForward = (...values: unknown[]) => {
  for (const value of values) {
    const mimeType = trustedDocumentMimeType(value);
    if (mimeType) return mimeType;
  }
  for (const value of values) {
    const mimeType = DOCUMENT_MIME_BY_EXTENSION[documentExtension(value) || ''];
    if (mimeType) return mimeType;
  }
  return 'application/octet-stream';
};

export const documentFileNameForForward = (value: unknown, mimeType: unknown) => {
  const existing = documentFileName(value);
  if (existing) return existing;
  const extension = DOCUMENT_EXTENSION_BY_MIME[String(trustedDocumentMimeType(mimeType) || '').toLowerCase()];
  return extension ? `document.${extension}` : 'document';
};

export const isForwardableMediaSizeAllowed = (media: unknown) => (
  typeof media === 'string'
  && media.trim().length > 0
  && media.trim().length <= MAX_MEDIA_BASE64_CHARS
);

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
  const content = typeof source.content === 'string' ? source.content : '';
  return content.trim() ? content : undefined;
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

const documentPlaceholder = /^\[\s*(?:documento|document)\s*\]$/iu;

/** Only a persisted, ordinary document can enter document forwarding. */
export function forwardableDocumentFromSource(source: ForwardSourceMessage | undefined): ForwardableDocument | undefined {
  if (!source
    || (source.sender !== 'contact' && source.sender !== 'attendant')
    || source.is_internal_note
    || source.media_type !== 'document'
    || hasPersistedLocation(source)
    || source.status === 'pending'
    || source.status === 'failed'
    || source.metadata?.deletedForEveryone === true
    || source.metadata?.deletedForEveryone === 'true') return undefined;

  const persisted = source.metadata?.document;
  const document = persisted && typeof persisted === 'object' && !Array.isArray(persisted) ? persisted : {};
  const content = typeof source.content === 'string' ? source.content.trim() : '';
  const fileSize = typeof document.fileSize === 'number'
    && Number.isFinite(document.fileSize)
    && document.fileSize >= 0
    ? Math.floor(document.fileSize)
    : undefined;
  return {
    ...(documentFileName(document.fileName) ? { fileName: documentFileName(document.fileName) } : {}),
    ...(trustedDocumentMimeType(document.mimeType) ? { mimeType: trustedDocumentMimeType(document.mimeType) } : {}),
    ...(fileSize !== undefined ? { fileSize } : {}),
    ...(content && !documentPlaceholder.test(content) ? { caption: content } : {}),
  };
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

export function evolutionForwardTextPayload(input: {
  recipient: string;
  text: string;
}) {
  return {
    number: input.recipient,
    text: input.text,
    delay: 1200,
    linkPreview: true,
  };
}
