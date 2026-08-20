import type { Message } from '../types';

export type DocumentKind = 'pdf' | 'word' | 'spreadsheet' | 'text' | 'archive' | 'file';

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'application/zip': 'zip',
};

const extensionFrom = (fileName?: string) => {
  const candidate = fileName?.trim().split(/[\\/]/).pop();
  const extension = candidate?.match(/\.([a-z0-9]{1,10})$/i)?.[1];
  return extension?.toLowerCase();
};

const documentKindFor = (extension?: string): DocumentKind => {
  if (extension === 'pdf') return 'pdf';
  if (extension === 'doc' || extension === 'docx' || extension === 'odt' || extension === 'rtf') return 'word';
  if (extension === 'xls' || extension === 'xlsx' || extension === 'csv' || extension === 'ods') return 'spreadsheet';
  if (extension === 'txt' || extension === 'md' || extension === 'log') return 'text';
  if (extension === 'zip' || extension === 'rar' || extension === '7z' || extension === 'tar' || extension === 'gz') return 'archive';
  return 'file';
};

export const formatDocumentSize = (value?: number) => {
  if (!Number.isFinite(value) || !value || value < 0) return undefined;
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / (1024 ** index);
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
};

export const getDocumentPresentation = (message: Message) => {
  const document = message.metadata?.document;
  const contentName = message.content && /\.[a-z0-9]{1,10}$/i.test(message.content.trim())
    ? message.content.trim()
    : undefined;
  const fileName = document?.fileName?.trim() || contentName || 'Documento';
  const extension = extensionFrom(fileName) || MIME_EXTENSIONS[document?.mimeType?.toLowerCase() || ''];
  const fileSize = Number.isFinite(document?.fileSize) && (document?.fileSize || 0) >= 0
    ? document?.fileSize
    : undefined;

  return {
    fileName,
    extension: extension?.toUpperCase() || 'ARQUIVO',
    kind: documentKindFor(extension),
    mimeType: document?.mimeType,
    fileSize,
    formattedSize: formatDocumentSize(fileSize),
  };
};
