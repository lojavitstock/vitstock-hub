export const PRODUCT_IMAGE_MAX_BYTES = 1_000_000;
export const PRODUCT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProductImageMimeType = typeof PRODUCT_IMAGE_MIME_TYPES[number];

export class ProductImageValidationError extends Error {}

const isSupportedMimeType = (value: string): value is ProductImageMimeType => (
  PRODUCT_IMAGE_MIME_TYPES.includes(value as ProductImageMimeType)
);

const actualMimeType = (bytes: Buffer): ProductImageMimeType | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
};

export function decodeProductImage(base64: string, declaredMimeType: string) {
  if (!isSupportedMimeType(declaredMimeType)) throw new ProductImageValidationError('Formato de imagem não suportado. Use JPEG, PNG ou WebP.');
  if (!base64 || base64.length === 0) throw new ProductImageValidationError('Selecione uma imagem válida.');
  if (base64.length > Math.ceil(PRODUCT_IMAGE_MAX_BYTES / 3) * 4) throw new ProductImageValidationError('A imagem deve ter no máximo 1 MB.');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new ProductImageValidationError('Imagem base64 inválida.');
  }

  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw new ProductImageValidationError('Selecione uma imagem válida.');
  if (bytes.length > PRODUCT_IMAGE_MAX_BYTES) throw new ProductImageValidationError('A imagem deve ter no máximo 1 MB.');
  if (bytes.toString('base64') !== base64) throw new ProductImageValidationError('Imagem base64 inválida.');

  const detectedMimeType = actualMimeType(bytes);
  if (!detectedMimeType) throw new ProductImageValidationError('O arquivo não contém uma imagem JPEG, PNG ou WebP válida.');
  if (detectedMimeType !== declaredMimeType) throw new ProductImageValidationError('O formato declarado não corresponde ao conteúdo da imagem.');

  return { bytes, mimeType: detectedMimeType, sizeBytes: bytes.length };
}
