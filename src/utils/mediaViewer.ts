import type { Message } from '../types';
import { getDocumentPresentation } from './documentMedia';

export type MediaViewerItem = {
  type: 'image' | 'video' | 'pdf';
  src: string;
  fileName: string;
  mimeType?: string;
};

export const isMediaViewerCloseKey = (key: string) => key === 'Escape';

export const mediaViewerItemFrom = (message: Message, source?: string | null): MediaViewerItem | undefined => {
  if (!source) return undefined;
  if (message.mediaType === 'image') {
    return { type: 'image', src: source, fileName: 'imagem-whatsapp.jpg' };
  }
  if (message.mediaType === 'video') {
    return { type: 'video', src: source, fileName: 'video-whatsapp.mp4' };
  }
  if (message.mediaType !== 'document') return undefined;

  const document = getDocumentPresentation(message);
  if (document.kind !== 'pdf') return undefined;
  return {
    type: 'pdf',
    src: source,
    fileName: document.fileName,
    mimeType: document.mimeType,
  };
};
