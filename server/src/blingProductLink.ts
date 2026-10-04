import { z } from 'zod';
import { BlingError, parseContract, productDetailModel, stockModel } from './blingContract.js';

type BlingProductDetail = z.infer<typeof productDetailModel>;

export type BlingProductSyncSnapshot = {
  blingProductId: string;
  parentProductId: string | null;
  name: string;
  code: string | null;
  gtin: string | null;
  unit: string | null;
  status: 'A' | 'I' | 'E';
  format: 'S' | 'V' | 'E';
  priceCents: number;
  physicalTotal: number | null;
  virtualTotal: number | null;
  balances: Array<{
    warehouseId: string;
    physicalBalance: number | null;
    virtualBalance: number | null;
  }>;
};

const localPriceLimit = 2_147_483_647;

export function blingPriceToCents(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    throw new BlingError(502, 'Preço do produto Bling fora do contrato esperado');
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents > localPriceLimit) {
    throw new BlingError(502, 'Preço do produto Bling fora do limite suportado');
  }
  return cents;
}

const finiteOrNull = (value: number | undefined, field: string) => {
  if (value === undefined) return null;
  if (!Number.isFinite(value)) throw new BlingError(502, `Saldo Bling inválido: ${field}`);
  return value;
};

export function toBlingProductSyncSnapshot(
  product: BlingProductDetail,
  stockValue: unknown,
  expectedProductId: string,
): BlingProductSyncSnapshot {
  if (product.id !== expectedProductId) throw new BlingError(502, 'Identidade do produto Bling não confere');
  const name = product.nome.trim();
  if (!name || name.length > 120) throw new BlingError(502, 'Nome do produto Bling fora do contrato esperado');

  const explicitParent = product.idProdutoPai;
  const variationParent = product.variacao?.produtoPai.id;
  if (explicitParent && variationParent && explicitParent !== variationParent) {
    throw new BlingError(502, 'Relação de variação Bling inconsistente');
  }

  const stock = parseContract(z.object({ data: z.array(stockModel) }), stockValue).data;
  if (stock.length > 1 || (stock.length === 1 && stock[0]!.produto.id !== expectedProductId)) {
    throw new BlingError(502, 'Identidade do estoque Bling não confere');
  }
  const totals = stock[0];
  const balances = (totals?.depositos || []).map((balance) => ({
    warehouseId: balance.id,
    physicalBalance: finiteOrNull(balance.saldoFisico, 'físico'),
    virtualBalance: finiteOrNull(balance.saldoVirtual, 'virtual'),
  }));
  if (new Set(balances.map((balance) => balance.warehouseId)).size !== balances.length) {
    throw new BlingError(502, 'Depósitos duplicados na resposta de estoque Bling');
  }

  return {
    blingProductId: product.id,
    parentProductId: explicitParent ?? variationParent ?? null,
    name,
    code: product.codigo ?? null,
    gtin: product.gtin ?? null,
    unit: product.unidade ?? null,
    status: product.situacao,
    format: product.formato,
    priceCents: blingPriceToCents(product.preco),
    physicalTotal: finiteOrNull(totals?.saldoFisicoTotal, 'físico total'),
    virtualTotal: finiteOrNull(totals?.saldoVirtualTotal, 'virtual total'),
    balances,
  };
}
