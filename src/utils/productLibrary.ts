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

export function parseMessagePriceCents(value: string): number | null {
  const input = value.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!input || !/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(input)) return null;
  const [wholeText, fractionText = ''] = input.replace(/\./g, '').split(',');
  const cents = Number(wholeText) * 100 + Number(fractionText.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_PRODUCT_PRICE_CENTS) return null;
  return cents;
}

export function formatMessagePriceInput(priceCents: number): string {
  if (!Number.isSafeInteger(priceCents) || priceCents < 1) return '';
  return formatBrlPrice(priceCents).replace(/^R\$\s*/i, '').replace(/\s/g, '');
}

export function effectiveBlingStock(virtual: string | number | null | undefined, physical: string | number | null | undefined): number | null {
  const selected = virtual ?? physical;
  if (selected === null || selected === undefined || selected === '') return null;
  const value = typeof selected === 'number' ? selected : Number(selected);
  return Number.isFinite(value) ? value : null;
}

export function normalizeBlingSku(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase('en-US') ?? '';
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

export function isRedundantProductCaption(content: string, snapshot: unknown): boolean {
  if (!isProductMessageSnapshot(snapshot)) return false;
  const caption = `${snapshot.name}\n${formatBrlPrice(snapshot.priceCents).replace(/\u00a0/g, ' ')}`;
  return content === caption;
}
