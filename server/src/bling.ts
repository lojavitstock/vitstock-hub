import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireUser } from './auth.js';
import { config, isQaMode } from './config.js';
import { integrationCipher } from './blingEncryption.js';
import { BlingApiClient, type BlingCredentials } from './blingClient.js';
import { PgBlingStore, stateHash, type BlingStore } from './blingStore.js';
import { AUTHORIZATION_URL, BlingError, blingContactDetailModel, blingContactListModel, blingSalesOrderModel, idSchema, pagination, parseContract, productDetailModel, stockModel, warehouseModel, blingSituationModuleModel, blingSituationModel } from './blingContract.js';
import { qaBlingTransport } from './blingQa.js';
import { blingPhoneMatches, mapBlingContactPhoneFields, normalizeBlingLookupPhone } from './blingContactLookup.js';
import { BlingCatalogService, PgBlingCatalogRepository, type BlingCatalogRepository } from './blingCatalog.js';
import { BlingContactDirectoryService, PgBlingContactDirectoryRepository, type BlingContactDirectoryRepository } from './blingContactDirectory.js';

export type BlingDependencies = { store: BlingStore; client: BlingApiClient; credentials: BlingCredentials; qa?: boolean;
  catalogRepository?: BlingCatalogRepository; contactDirectoryRepository?: BlingContactDirectoryRepository };
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
  const catalog = dependencies ? new BlingCatalogService(
    dependencies.catalogRepository ?? new PgBlingCatalogRepository(), dependencies.client) : undefined;
  const contactDirectory = dependencies ? new BlingContactDirectoryService(
    dependencies.contactDirectoryRepository ?? new PgBlingContactDirectoryRepository(), dependencies.client) : undefined;
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
  app.get(`${base}/contact-directory/status`, { preHandler: requireAdmin }, async (request, reply) => safe(reply, async () => {
    const { store } = ready();
    if (!(await store.status(request.user!.companyId)).connected) return { ready: false, stale: false, syncing: false, syncedAt: null, contacts: 0 };
    return contactDirectory!.status(request.user!.companyId);
  }));
  app.post(`${base}/contact-directory/sync`, { preHandler: requireAdmin }, async (request, reply) => safe(reply, async () => {
    if (Object.keys(request.query as object).length || Object.keys((request.body ?? {}) as object).length) {
      throw new BlingError(400, 'Parâmetros inválidos');
    }
    ready();
    return contactDirectory!.refresh(request.user!.companyId);
  }));
  const productQuery = pagination.extend({
    q: z.string().trim().max(120).optional(),
    // Keep the previous query key as a compatibility alias; both use the local projection.
    nome: z.string().trim().max(120).optional(),
    tipo: z.enum(['T','P','S','E','PS','C','V']).default('T'),
    generationId: z.string().uuid().optional(),
  }).strict();
  const warehouseQuery = pagination.extend({ descricao: z.string().trim().min(1).max(120).optional(), situacao: z.coerce.number().int().min(0).max(1).optional() }).strict();
  app.get(`${base}/products`, { preHandler: requireAdmin }, async (request, reply) => safe(reply, async () => {
    const parsed = productQuery.safeParse(request.query);
    if (!parsed.success || (parsed.data.q !== undefined && parsed.data.nome !== undefined)) {
      throw new BlingError(400, 'Paginação ou filtros inválidos');
    }
    ready();
    const { page, limit, tipo, generationId } = parsed.data;
    return catalog!.search(request.user!.companyId, { query: parsed.data.q ?? parsed.data.nome ?? '', page, limit,
      type: tipo, ...(generationId ? { generationId } : {}) });
  }));

  app.post(`${base}/contact-lookup`, { preHandler: requireUser }, async (request, reply) => safe(reply, async () => {
    const input = z.object({ phone: z.string().trim().min(1).max(80), contactId: idSchema.optional() }).strict().safeParse(request.body);
    if (!input.success) throw new BlingError(400, 'Telefone ou contato inválido');
    const phone = normalizeBlingLookupPhone(input.data.phone);
    if (!phone) throw new BlingError(400, 'Informe um telefone brasileiro com DDD válido para consultar o Bling');
    const { client, store } = ready();
    const companyId = request.user!.companyId;
    if (!(await store.status(companyId)).connected) throw new BlingError(409, 'Conecte o Bling antes de consultar contatos');
    const read = async (resource: 'contacts' | 'contact' | 'salesOrders' | 'situationModules' | 'moduleSituations', query: URLSearchParams, id?: string) => {
      try { return await client.read(companyId, resource, query, id); }
      catch (error) {
        if (error instanceof BlingError && error.statusCode === 403) {
          throw new BlingError(403, 'O Bling não autorizou a consulta. Verifique as permissões da integração para contatos e pedidos.');
        }
        throw error;
      }
    };

    const { snapshot, matches: candidates, truncated: contactSearchTruncated } = await contactDirectory!.lookup(companyId, phone, input.data.contactId);
    const matches = new Map(candidates.map(contact => [contact.id, contact]));
    if (input.data.contactId) {
      if (!matches.has(input.data.contactId)) throw new BlingError(404, 'O cadastro selecionado não corresponde ao telefone desta conversa');
    } else if (!candidates.length) {
      if (contactSearchTruncated) throw new BlingError(502, 'A busca por telefone excedeu o limite de consulta; não foi possível confirmar se há cadastro correspondente');
      return { status: 'not_found' as const };
    } else if (candidates.length > 1 || contactSearchTruncated) {
      return {
        status: 'multiple' as const,
        truncated: contactSearchTruncated,
        matches: candidates.slice(0, 20).map(contact => ({
          id: contact.id,
          name: contact.name,
          document: contact.document,
          ...mapBlingContactPhoneFields(contact.phone, contact.mobile),
        })),
      };
    }

    const selected = input.data.contactId ? matches.get(input.data.contactId)! : candidates[0]!;
    const detailResponse = await read('contact', new URLSearchParams(), selected.id);
    const detail = parseContract(z.object({ data: blingContactDetailModel }), detailResponse).data;
    if (![detail.celular, detail.telefone].some(value => blingPhoneMatches(value, phone))) {
      throw new BlingError(409, 'O telefone do cadastro mudou durante a consulta; verifique novamente');
    }

    const generalAddress = detail.endereco?.geral;
    const billingAddress = detail.endereco?.cobranca;
    const hasAddress = (value: typeof generalAddress) => Boolean(value && (
      value.endereco || value.cep || value.bairro || value.municipio || value.uf || value.numero || value.complemento
    ));
    const address = hasAddress(generalAddress) ? generalAddress : hasAddress(billingAddress) ? billingAddress : null;
    const contact = {
      id: detail.id,
      name: detail.nome,
      fantasy: detail.fantasia ?? null,
      document: detail.numeroDocumento ?? null,
      zipCode: address?.cep ?? null,
      address: address ? [address.endereco, address.numero, address.complemento, address.bairro, address.municipio, address.uf]
        .map(value => value?.trim()).filter(Boolean).join(', ') || null : null,
      ...mapBlingContactPhoneFields(detail.telefone, detail.celular),
      email: detail.email ?? null,
    };

    const orders: Array<z.infer<typeof blingSalesOrderModel>> = [];
    let ordersTruncated = false;
    let ordersError: string | null = null;
    const orderPageSize = 100;
    try {
      for (let page = 1; page <= 5; page += 1) {
        const query = new URLSearchParams({ pagina: String(page), limite: String(orderPageSize), idContato: detail.id });
        const result = parseContract(z.object({ data: z.array(blingSalesOrderModel) }), await read('salesOrders', query));
        orders.push(...result.data);
        if (result.data.length < orderPageSize) break;
        if (page === 5) ordersTruncated = true;
      }
    } catch (error) {
      const status = error instanceof BlingError ? error.statusCode : 0;
      const kind = status === 403 ? 'permission' : status === 409 ? 'authorization'
        : status === 429 ? 'rate_limit'
          : error instanceof BlingError && error.message === 'Resposta do Bling fora do contrato esperado'
            ? 'contract' : 'provider';
      app.log.warn({ integration: 'bling', operation: 'salesOrders', kind },
        'Consulta de pedidos Bling indisponível'); // No customer data, credentials or provider payloads.
      ordersError = kind === 'permission'
        ? 'O Bling não autorizou a consulta de pedidos. Verifique as permissões da integração.'
        : kind === 'authorization' ? 'Reconecte a conta Bling para consultar os pedidos.'
          : kind === 'rate_limit' ? 'O Bling atingiu o limite temporário de consultas. Tente novamente mais tarde.'
            : kind === 'contract' ? 'O Bling retornou pedidos em um formato não reconhecido. Tente novamente mais tarde.'
              : 'Não foi possível carregar os pedidos agora.';
    }
    const latestOrders = Array.from(new Map(orders.map(order => [order.id || `${order.numero ?? ''}:${order.data ?? ''}`, order])).values())
      .sort((left, right) => (right.data ?? '').localeCompare(left.data ?? ''))
      .slice(0, 5)
      .map(order => ({ id: order.id ?? null, number: order.numero == null ? null : String(order.numero), date: order.data ?? null, total: order.total ?? null,
        // Numeric valor is a provider code, not a human-readable status label.
        status: order.situacao?.nome?.trim() || (typeof order.situacao?.valor === 'string' &&
          !/^\\d+$/.test(order.situacao.valor.trim()) ? order.situacao.valor.trim() || null : null),
        statusId: order.situacao?.id ?? null }));
    // Situation names are optional enrichment. Missing scope, bad payloads, or API outages
    // must never hide already-loaded sales orders or invent labels for custom situations.
    if (!ordersError && latestOrders.some(order => !order.status && order.statusId)) {
      try {
        const modules = parseContract(z.object({ data: z.array(blingSituationModuleModel).max(100) }),
          await read('situationModules', new URLSearchParams())).data;
        const salesModules = modules.filter(mod => /pedidos?\\s+de\\s+vendas?/i.test(mod.nome));
        if (salesModules.length === 1) {
          const situations = parseContract(z.object({ data: z.array(blingSituationModel).max(1000) }),
            await read('moduleSituations', new URLSearchParams(), salesModules[0]!.id)).data;
          const names = new Map(situations.map(item => [item.id, item.nome.trim()]).filter(([, name]) => Boolean(name)));
          for (const order of latestOrders) if (!order.status && order.statusId) {
            order.status = names.get(order.statusId) || null;
          }
        }
      } catch (error) {
        const kind = error instanceof BlingError ? error.statusCode : 'provider';
        app.log.warn({ integration: 'bling', operation: 'situationNames', kind },
          'Nomes das situações Bling indisponíveis; pedidos preservados');
      }
    }
    return { status: 'found' as const, contact, orders: latestOrders, ordersTruncated, ordersError, directorySyncedAt: snapshot.syncedAt };
  }));
  app.post(`${base}/contact-existence`, { preHandler: requireUser }, async (request, reply) => safe(reply, async () => {
    const input = z.object({ phone: z.string().trim().min(1).max(80) }).strict().safeParse(request.body);
    if (!input.success) throw new BlingError(400, 'Telefone inválido');
    const phone = normalizeBlingLookupPhone(input.data.phone);
    if (!phone) throw new BlingError(400, 'Telefone brasileiro inválido');
    const { store } = ready();
    if (!(await store.status(request.user!.companyId)).connected) return { status: 'unavailable' as const, syncedAt: null };
    return contactDirectory!.existence(request.user!.companyId, phone);
  }));
  app.post(`${base}/products/catalog-sync`, { preHandler: requireAdmin }, async (request, reply) => safe(reply, async () => {
    if (Object.keys(request.query as object).length || Object.keys((request.body ?? {}) as object).length) {
      throw new BlingError(400, 'Parâmetros inválidos');
    }
    ready();
    return catalog!.refresh(request.user!.companyId);
  }));

  app.get(`${base}/warehouses`, { preHandler: requireAdmin }, async (request, reply) => safe(reply, async () => {
    const parsed = warehouseQuery.safeParse(request.query);
    if (!parsed.success) throw new BlingError(400, 'Paginação ou filtros inválidos');
    const { page, limit, ...filters } = parsed.data;
    const query = new URLSearchParams({ pagina: String(page), limite: String(limit) });
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.set(key, String(value));
    return parseContract(z.object({ data: z.array(warehouseModel) }),
      await ready().client.read(request.user!.companyId, 'warehouses', query));
  }));
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
