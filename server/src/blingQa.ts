import { isQaMode } from './config.js';
import { API_BASE, TOKEN_URL, BlingError } from './blingContract.js';
import type { BlingTransport } from './blingClient.js';

export type QaBlingScenario = 'default' | 'updated' | 'price-updated' | 'invalid-stock' | 'empty-stock' | 'missing-price' | 'detail-mismatch'
  | 'missing-sku' | 'blank-sku' | 'physical-only' | 'virtual-zero' | 'virtual-negative' | 'sku-collision';
let scenario: QaBlingScenario = 'default';

export function setQaBlingScenario(value: QaBlingScenario) {
  scenario = value;
}

const productDetail = (id: string) => {
  if (id === '201') return { id: 201, nome: 'Produto Inativo QA', codigo: 'SKU-201', preco: 99, tipo: 'P', situacao: 'I', formato: 'S' };
  if (id === '202') return { id: 202, nome: 'Produto Encerrado QA', codigo: '', preco: 99, tipo: 'P', situacao: 'E', formato: 'S' };
  if (id !== '101') {
    const generated = Number(id) >= 900_000_000_000;
    return {
    id: Number(id), nome: id === '303' ? 'Produto para Importar QA' : `Produto Catálogo QA ${id}`,
    codigo: scenario === 'missing-sku' ? undefined : scenario === 'blank-sku' ? '   '
      : scenario === 'sku-collision' && id !== '101' ? ' sku-101 ' : `SKU-${id}`,
    preco: scenario === 'price-updated' && generated ? 60 : generated ? 28 : 180, tipo: 'P', situacao: 'A', formato: 'S', unidade: 'UN',
    };
  }
  const updated = scenario === 'updated';
  const priceUpdated = scenario === 'price-updated';
  return {
    id: scenario === 'detail-mismatch' ? 102 : 101,
    nome: updated ? 'Produto Bling Atualizado QA' : priceUpdated ? 'Produto Bling Preço Atualizado QA' : 'Produto Bling QA',
    codigo: updated ? 'SKU-101-NOVO' : 'SKU-101',
    tipo: 'P', situacao: updated ? 'I' : 'A', formato: 'S', unidade: 'UN', gtin: '7890000000001',
    ...(updated ? { idProdutoPai: 90 } : {}),
    ...(scenario === 'missing-price' ? {} : { preco: priceUpdated ? 60 : updated ? 40 : 28 }),
  };
};

export const qaBlingTransport: BlingTransport = async (url, init) => {
  if (!isQaMode) throw new BlingError(503, 'Mock Bling bloqueado fora de QA');
  const target = new URL(url);
  if (target.origin !== new URL(API_BASE).origin) throw new BlingError(400, 'Destino Bling inválido');
  let body: unknown;
  if (url === TOKEN_URL && init.method === 'POST') {
    const params = new URLSearchParams(String(init.body));
    if (params.get('grant_type') === 'authorization_code' && params.get('code') !== 'qa-local-code') return new Response('{}', { status: 400 });
    body = { access_token: 'qa.header.signature', refresh_token: 'qa-local-refresh', expires_in: 21600, token_type: 'Bearer' };
  } else if (init.method !== 'GET') throw new BlingError(400);
  else if (target.pathname === '/Api/v3/produtos') {
    const products = [productDetail('101'), productDetail('201'), productDetail('202'), ...Array.from({ length: 21 }, (_, index) => productDetail(String(303 + index)))];
    const criterion = Number(target.searchParams.get('criterio') || 5);
    const byCriterion = criterion === 2 ? products.filter(item => item.situacao === 'A')
      : criterion === 3 ? products.filter(item => item.situacao === 'I')
        : criterion === 4 ? products.filter(item => item.situacao === 'E') : products;
    const name = target.searchParams.get('nome')?.toLocaleLowerCase();
    const filtered = name ? byCriterion.filter((item) => item.nome.toLocaleLowerCase().includes(name)) : byCriterion;
    const page = Number(target.searchParams.get('pagina') || 1);
    const limit = Number(target.searchParams.get('limite') || 50);
    body = { data: filtered.slice((page - 1) * limit, page * limit) };
  }
  else if (/^\/Api\/v3\/produtos\/[0-9]+$/.test(target.pathname)) body = { data: productDetail(target.pathname.split('/').at(-1) || '') };
  else if (target.pathname === '/Api/v3/depositos') body = { data: [{ id: 7, descricao: 'QA', situacao: 1, padrao: true, desconsiderarSaldo: true }] };
  else if (target.pathname.startsWith('/Api/v3/estoques/saldos')) {
    const productId = target.searchParams.get('idsProdutos[]') || '101';
    if (scenario === 'invalid-stock' && productId === '101') body = { data: [{ produto: { id: productId }, depositos: [{ id: 7, saldoFisico: 'inválido' }] }] };
    else if (scenario === 'empty-stock') body = { data: [] };
    else if (scenario === 'physical-only') body = { data: [{ produto: { id: productId }, saldoFisicoTotal: 7 }] };
    else if (scenario === 'virtual-zero') body = { data: [{ produto: { id: productId }, saldoFisicoTotal: 8, saldoVirtualTotal: 0 }] };
    else if (scenario === 'virtual-negative') body = { data: [{ produto: { id: productId }, saldoFisicoTotal: 8, saldoVirtualTotal: -2 }] };
    else if (scenario === 'updated' && productId === '101') body = { data: [{ produto: { id: productId }, saldoFisicoTotal: 14.25, saldoVirtualTotal: 9,
      depositos: [{ id: 7, saldoFisico: 4.25, saldoVirtual: 9 }] }] };
    else body = { data: [{ produto: { id: productId }, saldoFisicoTotal: 8, saldoVirtualTotal: 5,
      depositos: [{ id: 7, saldoFisico: 8, saldoVirtual: 5 }] }] };
  }
  else return new Response('{}', { status: 404 });
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
};
