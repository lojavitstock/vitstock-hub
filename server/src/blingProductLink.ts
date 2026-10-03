import { z } from 'zod';
import { BlingError, productDetailModel } from './blingContract.js';

type BlingProductDetail = z.infer<typeof productDetailModel>;

export type BlingProductLinkSnapshot = {
  blingProductId: string;
  blingName: string;
  blingCode: string | null;
  blingPriceCents: number | null;
  blingSituacao: 'A' | 'I';
  blingFormato: 'S' | 'V' | 'E';
};

export function blingPriceToCents(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) throw new BlingError(502, 'Preço do produto Bling fora do contrato esperado');
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents > 2_147_483_647) {
    throw new BlingError(502, 'Preço do produto Bling fora do limite suportado');
  }
  return cents;
}

export function toBlingProductLinkSnapshot(product: BlingProductDetail): BlingProductLinkSnapshot {
  return {
    blingProductId: product.id,
    blingName: product.nome,
    blingCode: product.codigo ?? null,
    blingPriceCents: blingPriceToCents(product.preco),
    blingSituacao: product.situacao,
    blingFormato: product.formato,
  };
}
