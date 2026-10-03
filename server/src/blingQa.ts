import { isQaMode } from './config.js';
import { API_BASE, TOKEN_URL, BlingError } from './blingContract.js';
import type { BlingTransport } from './blingClient.js';

export const qaBlingTransport: BlingTransport = async (url, init) => {
  if (!isQaMode) throw new BlingError(503, 'Mock Bling bloqueado fora de QA');
  const target = new URL(url);
  if (target.origin !== new URL(API_BASE).origin) throw new BlingError(400, 'Destino Bling inválido');
  const product = { id: 101, nome: 'Produto Bling QA', codigo: '', preco: 12.5, tipo: 'P', situacao: 'I', formato: 'S' };
  let body: unknown;
  if (url === TOKEN_URL && init.method === 'POST') {
    const params = new URLSearchParams(String(init.body));
    if (params.get('grant_type') === 'authorization_code' && params.get('code') !== 'qa-local-code') return new Response('{}', { status: 400 });
    body = { access_token: 'qa.header.signature', refresh_token: 'qa-local-refresh', expires_in: 21600, token_type: 'Bearer' };
  } else if (init.method !== 'GET') throw new BlingError(400);
  else if (target.pathname === '/Api/v3/produtos') body = { data: [product] };
  else if (target.pathname === '/Api/v3/produtos/101') body = { data: product };
  else if (target.pathname === '/Api/v3/depositos') body = { data: [{ id: 7, descricao: 'QA', situacao: 1, padrao: true, desconsiderarSaldo: true }] };
  else if (target.pathname.startsWith('/Api/v3/estoques/saldos')) body = { data: [{ produto: { id: 101 }, saldoFisicoTotal: 8, saldoVirtualTotal: 5,
    depositos: [{ id: 7, saldoFisico: 8, saldoVirtual: 5 }] }] };
  else return new Response('{}', { status: 404 });
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
};
