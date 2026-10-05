import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireUser } from './auth.js';
import { config, isQaMode } from './config.js';
import { integrationCipher } from './blingEncryption.js';
import { BlingApiClient, type BlingCredentials } from './blingClient.js';
import { PgBlingStore, stateHash, type BlingStore } from './blingStore.js';
import { AUTHORIZATION_URL, BlingError, idSchema, pagination, parseContract, productDetailModel, productListModel, stockModel, warehouseModel } from './blingContract.js';
import { qaBlingTransport } from './blingQa.js';

export type BlingDependencies = { store: BlingStore; client: BlingApiClient; credentials: BlingCredentials; qa?: boolean };
export function runtimeBling(): BlingDependencies | undefined {
  if (!config.BLING_CLIENT_ID || !config.BLING_CLIENT_SECRET || !config.BLING_REDIRECT_URI || !config.INTEGRATION_ENCRYPTION_KEY) return undefined;
  try {
    const credentials = { clientId: config.BLING_CLIENT_ID, clientSecret: config.BLING_CLIENT_SECRET, redirectUri: config.BLING_REDIRECT_URI };
    const redirect = new URL(credentials.redirectUri);
    if (redirect.pathname !== '/api/integrations/bling/callback' || redirect.search || redirect.hash || redirect.username || redirect.password
      || (isQaMode ? !['localhost', '127.0.0.1'].includes(redirect.hostname) || redirect.port !== '3001' || !credentials.clientId.startsWith('qa-local-') || !credentials.clientSecret.startsWith('qa-local-') : redirect.protocol !== 'https:')) return undefined;
    const store = new PgBlingStore(integrationCipher(config.INTEGRATION_ENCRYPTION_KEY));
    const client = new BlingApiClient(store, credentials, isQaMode ? qaBlingTransport : (url, init) => {
      if (config.NODE_ENV === 'test') throw new BlingError(503, 'Chamadas reais Bling bloqueadas em testes');
      return fetch(url, init);
    });
    return { credentials, store, client, qa: isQaMode };
  } catch { return undefined; }
}
export async function registerBlingRoutes(app: FastifyInstance, dependencies = runtimeBling()) {
  app.addHook('onClose', async () => { await dependencies?.store.close?.(); });
  const base = '/api/integrations/bling';
  const redirect = (result: 'connected' | 'error') => `${config.FRONTEND_URL}/configuracoes?tab=integracoes&bling=${result}`;
  const safe = async (reply: FastifyReply, action: () => Promise<unknown>) => {
    reply.header('Cache-Control', 'no-store');
    try { return await action(); }
    catch (error) { return reply.code(error instanceof BlingError ? error.statusCode : 503).send({ error: error instanceof BlingError ? error.message : 'Integração Bling temporariamente indisponível' }); }
  };
  const ready = () => { if (!dependencies) throw new BlingError(503, 'Integração Bling não configurada'); return dependencies; };
  app.get(`${base}/status`, { preHandler: requireUser }, async (request, reply) => safe(reply, async () => ({ configured: !!dependencies,
    ...(dependencies ? await dependencies.store.status(request.user!.companyId) : { connected: false, connectedAt: null }) })));
  app.post(`${base}/connect`, { preHandler: requireAdmin }, async (request, reply) => safe(reply, async () => {
    const { store, credentials, qa } = ready();
    const state = await store.createState(request.user!.companyId, request.user!.id);
    const params = new URLSearchParams({ response_type: 'code', client_id: credentials.clientId, state, redirect_uri: credentials.redirectUri });
    // QA mock bypasses only provider UI, retaining the real state/callback/storage flow.
    return { url: qa ? `${credentials.redirectUri}?${new URLSearchParams({ state, code: 'qa-local-code' })}` : `${AUTHORIZATION_URL}?${params}` };
  }));
  app.get(`${base}/callback`, { preHandler: requireAdmin }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    try {
      const parsed = z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().min(1).max(4096) }).strict().safeParse(request.query);
      if (!parsed.success) return reply.redirect(redirect('error'));
      const { store, client } = ready();
      if (!await store.consumeState(parsed.data.state, request.user!.companyId, request.user!.id)) return reply.redirect(redirect('error'));
      await client.connect(request.user!.companyId, parsed.data.code, stateHash(parsed.data.state));
      return reply.redirect(redirect('connected'));
    } catch { return reply.redirect(redirect('error')); }
  });
  app.post(`${base}/disconnect`, { preHandler: requireAdmin }, async (request, reply) => safe(reply, async () => {
    await ready().store.locked(request.user!.companyId, session => session.remove());
    // Local unlink only. Revoke the application separately in Bling if needed.
    return { disconnected: true };
  }));
  const productQuery = pagination.extend({ nome: z.string().trim().min(1).max(120).optional(),
    tipo: z.enum(['T','P','S','E','PS','C','V']).default('T') }).strict();
  const warehouseQuery = pagination.extend({ descricao: z.string().trim().min(1).max(120).optional(), situacao: z.coerce.number().int().min(0).max(1).optional() }).strict();
  for (const resource of ['products', 'warehouses'] as const) {
    app.get(`${base}/${resource}`, { preHandler: requireAdmin }, async (request, reply) => safe(reply, async () => {
      const parsed = (resource === 'products' ? productQuery : warehouseQuery).safeParse(request.query);
      if (!parsed.success) throw new BlingError(400, 'Paginação ou filtros inválidos');
      const { page, limit, ...filters } = parsed.data;
      const query = new URLSearchParams({ pagina: String(page), limite: String(limit) });
      if (resource === 'products') query.set('criterio', '2');
      for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.set(key, String(value));
      const value = await ready().client.read(request.user!.companyId, resource, query);
      const data = resource === 'products'
        ? parseContract(z.object({ data: z.array(productListModel) }), value).data
        : parseContract(z.object({ data: z.array(warehouseModel) }), value).data;
      if (resource === 'products' && data.some(product => product.situacao !== 'A')) {
        throw new BlingError(502, 'Resposta do catálogo Bling contém produto não ativo');
      }
      return { data, page, limit };
    }));
  }
  app.get(`${base}/products/:id`, { preHandler: requireAdmin }, async (request, reply) => safe(reply, async () => {
    const parsed = z.object({ id: idSchema }).safeParse(request.params);
    if (!parsed.success || Object.keys(request.query as object).length) throw new BlingError(400, 'Identificador ou parâmetros inválidos');
    return parseContract(z.object({ data: productDetailModel }), await ready().client.read(request.user!.companyId, 'product', new URLSearchParams(), parsed.data.id));
  }));
  app.get(`${base}/products/:id/stock`, { preHandler: requireAdmin }, async (request, reply) => safe(reply, async () => {
    const params = z.object({ id: idSchema }).safeParse(request.params);
    const query = z.object({ warehouseId: idSchema.optional() }).strict().safeParse(request.query);
    if (!params.success || !query.success) throw new BlingError(400, 'Identificador ou depósito inválido');
    return parseContract(z.object({ data: z.array(stockModel) }), await ready().client.read(request.user!.companyId, 'stock',
      new URLSearchParams({ 'idsProdutos[]': params.data.id }), params.data.id, query.data.warehouseId));
  }));
}
