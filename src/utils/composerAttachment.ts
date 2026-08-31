import { isMediaFileSizeAllowed, MAX_ATTACHMENTS_PER_MESSAGE, MAX_TOTAL_ATTACHMENT_BYTES } from './mediaLimits';

export type ComposerMediaType = 'image' | 'video' | 'document';
export { MAX_ATTACHMENTS_PER_MESSAGE, MAX_TOTAL_ATTACHMENT_BYTES } from './mediaLimits';

export type AttachmentDraft = {
  id: string;
  file: File;
  mediaType: ComposerMediaType;
  previewUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
  status?: 'pending' | 'failed';
  clientMessageId?: string;
  captionEligible?: boolean;
};

export const createAttachmentId = () => (
  `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

export const selectAttachmentFiles = <T extends Pick<File, 'name' | 'type' | 'size'>>(
  files: T[],
  currentCount: number,
  currentBytes: number,
) => {
  const availableSlots = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - currentCount);
  let totalBytes = currentBytes;
  const accepted: T[] = [];
  let rejected = 0;
  files.forEach((file) => {
    const valid = accepted.length < availableSlots
      && isMediaFileSizeAllowed(file.size)
      && Boolean(classifyAttachmentFile(file))
      && totalBytes + file.size <= MAX_TOTAL_ATTACHMENT_BYTES;
    if (!valid) {
      rejected += 1;
      return;
    }
    accepted.push(file);
    totalBytes += file.size;
  });
  return { accepted, rejected, totalBytes };
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
