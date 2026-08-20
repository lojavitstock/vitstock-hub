import type { Message } from '../types';

export const canDownloadMessageMedia = (message: Message) => Boolean(
  message.mediaType && (message.rawKey || message.mediaUrl),
);

export const messageCopyText = (message: Message) => message.content;

export const messageMenuActionsFor = (message: Message) => [
  'reply',
  'react',
  'copy',
  ...(canDownloadMessageMedia(message) ? ['download'] : []),
] as const;
