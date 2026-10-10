import { API_BASE, TOKEN_URL, BlingError, tokenModel, parseContract, type Tokens } from './blingContract.js';
import type { BlingSession, BlingStore } from './blingStore.js';

export type BlingCredentials = { clientId: string; clientSecret: string; redirectUri: string };
export type BlingTransport = (url: string, init: RequestInit) => Promise<Response>;
export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}
export class BlingApiClient {
  constructor(private store: BlingStore, private credentials: BlingCredentials,
    private transport: BlingTransport, private sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
    private now = Date.now, private timeoutMs = 8000) {}

  private async request(url: string, init: RequestInit) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, this.timeoutMs);
      });
      const operation = async () => {
        const response = await this.transport(url, { ...init, signal: controller.signal, redirect: 'error' });
        if (!response.ok) { await response.body?.cancel(); return new Response(null, { status: response.status, headers: response.headers }); }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('body limit'); }
          chunks.push(next.value);
        }
        return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
      };
      return await Promise.race([operation(), deadline]);
    } catch { throw new BlingError(504, 'Bling indisponível ou tempo de resposta excedido'); }
    finally { clearTimeout(timer!); }
  }
  private async json(response: Response) {
    try { return await response.json(); }
    catch { throw new BlingError(502, 'Resposta do Bling inválida'); }
  }
  private async reservedRequest(session: BlingSession, kind: 'api' | 'oauth', url: string, init: RequestInit) {
    try { return await this.request(url, init); }
    finally {
      // A reservation can be acknowledged late by PostgreSQL. Anchor the next
      // slot AFTER transport too, while retaining the global row lock, so that
      // delayed dispatch never compresses the API/OAuth windows.
      await session.cooldown('api', 340);
      if (kind === 'oauth') await session.cooldown('oauth', 3100);
    }
  }
  private async token(session: BlingSession, grant: 'authorization_code' | 'refresh_token', value: string): Promise<Tokens> {
    await session.budget('oauth');
    const response = await this.reservedRequest(session, 'oauth', TOKEN_URL, { method: 'POST', headers: {
      Authorization: `Basic ${Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded', 'enable-jwt': '1', Accept: 'application/json',
    }, body: new URLSearchParams({ grant_type: grant, [grant === 'authorization_code' ? 'code' : 'refresh_token']: value }).toString() });
    // No POST retry: ambiguous token rotation must not replay a refresh/code.
    if (!response.ok) {
      if (response.status === 429) {
        const delay = retryAfterMs(response.headers.get('Retry-After'), this.now()) ?? 60000;
        await session.cooldown('oauth', delay);
      }
      throw new BlingError(response.status === 429 ? 429 : 502, 'Autorização Bling falhou; tente reconectar');
    }
    const tokens = parseContract(tokenModel, await this.json(response));
    // JWT syntax only; Bling validates authenticity. Never trust JWT claims as tenant identity.
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tokens.access_token)) throw new BlingError(502, 'Bling não retornou o token JWT esperado');
    await session.save(tokens, grant === 'authorization_code');
    return tokens;
  }
  async connect(company: string, code: string, stateHash: string) {
    return this.store.locked(company, async session => {
      if (!await session.validState(stateHash)) throw new BlingError(400, 'Autorização Bling inválida ou expirada');
      await this.token(session, 'authorization_code', code);
    });
  }
  // Closed set: neither URLs nor arbitrary paths can be supplied by the browser.
  async read(company: string, resource: 'products' | 'product' | 'warehouses' | 'stock' | 'contacts' | 'contact' | 'salesOrders', query: URLSearchParams, id?: string, warehouseId?: string) {
    if (id && !/^[1-9]\d{0,19}$/.test(id) || warehouseId && !/^[1-9]\d{0,19}$/.test(warehouseId)) throw new BlingError(400, 'Identificador inválido');
    const paths = { products: '/produtos', product: `/produtos/${id}`, warehouses: '/depositos', stock: `/estoques/saldos${warehouseId ? `/${warehouseId}` : ''}`,
      contacts: '/contatos', contact: `/contatos/${id}`, salesOrders: '/pedidos/vendas' };
    if (!Object.hasOwn(paths, resource) || (['product', 'contact'].includes(resource) && !id)) throw new BlingError(400, 'Recurso Bling inválido');
    return this.store.locked(company, async session => {
      const connection = await session.get();
      if (!connection) throw new BlingError(409, 'Bling não conectado');
      let access = connection.access;
      let refreshed = false;
      const refresh = async () => {
        const current = await session.get();
        if (!current) throw new BlingError(409, 'Bling não conectado');
        const tokens = await this.token(session, 'refresh_token', current.refresh);
        access = tokens.access_token; refreshed = true;
      };
      if (connection.expires <= this.now() + 60000) await refresh();
      let retries = 0;
      while (true) {
        // Budget/lock failures are not provider network failures and are not retried.
        await session.budget('api');
        let response: Response;
        try {
          response = await this.reservedRequest(session, 'api', `${API_BASE}${paths[resource]}?${query}`, {
            method: 'GET', headers: { Authorization: `Bearer ${access}`, 'enable-jwt': '1', Accept: 'application/json' },
          });
        } catch (error) {
          if (retries++ >= 2) throw error;
          await this.sleep(300 * 2 ** retries + Math.floor(Math.random() * 100));
          continue;
        }
        if (response.status === 401 && !refreshed) { await refresh(); continue; }
        if (response.status === 401) throw new BlingError(409, 'Reconecte sua conta Bling');
        if (response.status === 429 || response.status >= 500) {
          const wait = retryAfterMs(response.headers.get('Retry-After'), this.now());
          if (response.status === 429) await session.cooldown('api', wait ?? 1000);
          if (retries++ >= 2) throw new BlingError(response.status === 429 ? 429 : 502, 'Bling temporariamente indisponível; tente novamente');
          // Never shorten Retry-After. Long waits return control to the caller.
          if (wait !== null && wait > 5000) throw new BlingError(429, 'Bling temporariamente limitado; tente novamente mais tarde');
          await this.sleep(wait ?? (300 * 2 ** retries + Math.floor(Math.random() * 100)));
          continue;
        }
        if (!response.ok) throw new BlingError(response.status === 404 ? 404 : response.status === 403 ? 403 : 502, 'Consulta Bling recusada');
        return this.json(response);
      }
    });
  }
}
