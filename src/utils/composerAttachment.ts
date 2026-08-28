export type ComposerMediaType = 'image' | 'video' | 'document';

export type AttachmentDraft = {
  file: File;
  mediaType: ComposerMediaType;
  previewUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export const classifyAttachmentFile = (file: Pick<File, 'type' | 'name'>): ComposerMediaType | null => {
  const mimeType = file.type || '';
  const extension = file.name.toLowerCase().split('.').pop() || '';
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const isDocument = mimeType === 'application/pdf'
    || mimeType.startsWith('application/msword')
    || mimeType.startsWith('application/vnd.openxmlformats-officedocument')
    || ['pdf', 'doc', 'docx'].includes(extension);

  if (isImage) return 'image';
  if (isVideo) return 'video';
  if (isDocument) return 'document';
  return null;
};
