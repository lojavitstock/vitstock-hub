import type { ProductMessageSnapshot } from '../types';

export const MAX_PRODUCT_PRICE_CENTS = 2_147_483_647;

export function normalizeBrlPriceDigits(value: string): string {
  return value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

export function parseBrlPriceCents(value: string): number | null {
  const digits = normalizeBrlPriceDigits(value);
  if (!digits) return null;
  const cents = Number(digits);
  if (!Number.isSafeInteger(cents) || cents > MAX_PRODUCT_PRICE_CENTS) return null;
  return cents;
}

export function formatBrlPrice(priceCents: number): string {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) return 'Valor inválido';
  const wholeReais = Math.floor(priceCents / 100).toLocaleString('pt-BR');
  const cents = String(priceCents % 100).padStart(2, '0');
  return `R$\u00a0${wholeReais},${cents}`;
}

export function formatBrlPriceInput(value: string): string {
  const digits = normalizeBrlPriceDigits(value);
  if (!digits) return '';
  const cents = Number(digits);
  if (!Number.isSafeInteger(cents)) return '';
  return formatBrlPrice(cents);
}

export function isProductMessageSnapshot(value: unknown): value is ProductMessageSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.productId === 'string' && snapshot.productId.length > 0
    && typeof snapshot.name === 'string' && snapshot.name.trim().length > 0
    && Number.isSafeInteger(snapshot.priceCents) && Number(snapshot.priceCents) >= 0
    && snapshot.currency === 'BRL'
    && typeof snapshot.imageObjectKey === 'string' && snapshot.imageObjectKey.length > 0;
}

export function productStorageImageUrl(imageObjectKey: string, apiBaseUrl = 'http://localhost:3001'): string {
  const url = new URL('/api/products/storage', apiBaseUrl);
  url.searchParams.set('key', imageObjectKey);
  return url.toString();
}
