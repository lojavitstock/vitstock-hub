import assert from 'node:assert/strict';
import test from 'node:test';
import { BlingCatalogService, BLING_CATALOG_PAGE_SIZE, BLING_CATALOG_TTL_MS, createBlingCatalogSearchPlan,
  normalizeBlingCatalogText, type BlingCatalogGeneration, type BlingCatalogProduct,
  type BlingCatalogRepository, type BlingCatalogSearchPlan } from '../server/src/blingCatalog.js';
import { BlingError } from '../server/src/blingContract.js';

class MemoryCatalog implements BlingCatalogRepository {
  private generations = new Map<string, { companyId: string; value: BlingCatalogGeneration; products: Map<string, BlingCatalogProduct> }>();
  private active = new Map<string, string>();
  private locks = new Set<string>();
  async tryAcquireSyncLock(companyId: string) {
    if (this.locks.has(companyId)) return null;
    this.locks.add(companyId);
    return async () => { this.locks.delete(companyId); };
  }
  async activeGeneration(companyId: string) {
    const id = this.active.get(companyId);
    const entry = id ? this.generations.get(id) : undefined;
    return entry ? { ...entry.value } : null;
  }
  async generation(companyId: string, generationId: string) {
    const entry = this.generations.get(generationId);
    return entry?.companyId === companyId && entry.value.status !== 'building' ? { ...entry.value } : null;
  }
  async startGeneration(companyId: string, generationId: string) {
    this.generations.set(generationId, { companyId, value: { id: generationId, syncedAt: '', status: 'building' }, products: new Map() });
  }
  async upsertPage(_companyId: string, generationId: string, products: BlingCatalogProduct[]) {
    const entry = this.generations.get(generationId);
    if (!entry) throw new Error('generation missing');
    for (const product of products) entry.products.set(product.id, product);
  }
  async publishGeneration(companyId: string, generationId: string) {
    const entry = this.generations.get(generationId);
    if (!entry) throw new Error('generation missing');
    const previous = this.active.get(companyId);
    if (previous) this.generations.get(previous)!.value.status = 'retired';
    entry.value.status = 'active';
    entry.value.syncedAt = new Date().toISOString();
    this.active.set(companyId, generationId);
    return entry.products.size;
  }
  async discardGeneration(_companyId: string, generationId: string) { this.generations.delete(generationId); }
  async seed(companyId: string, generationId: string, products: BlingCatalogProduct[]) {
    await this.startGeneration(companyId, generationId);
    await this.upsertPage(companyId, generationId, products);
    await this.publishGeneration(companyId, generationId);
  }
  async search(input: { companyId: string; generationId: string; plan: BlingCatalogSearchPlan; page: number;
    limit: number; type: 'T' | 'P' | 'S' | 'E' | 'PS' | 'C' | 'V' }) {
    const entry = this.generations.get(input.generationId);
    if (!entry || entry.companyId !== input.companyId) throw new Error('snapshot tenant mismatch');
    const tokens = input.plan.nameTokens;
    const matches = [...entry.products.values()].filter(product => product.situacao === 'A'
      && (input.type === 'T' || product.tipo === input.type)
      && (input.plan.all
        || (input.plan.normalizedSku !== null && product.codigo?.trim().toLowerCase() === input.plan.normalizedSku)
        || (tokens.length > 0 && tokens.every(token => normalizeBlingCatalogText(product.nome).includes(token)))))
      .sort((left, right) => {
        const leftName = normalizeBlingCatalogText(left.nome), rightName = normalizeBlingCatalogText(right.nome);
        const rank = (product: BlingCatalogProduct, name: string) => product.codigo?.trim().toLowerCase() === input.plan.normalizedSku && input.plan.normalizedSku !== null
          ? 0 : name === input.plan.normalizedName && input.plan.normalizedName ? 1
            : input.plan.normalizedName && name.startsWith(input.plan.normalizedName) ? 2 : 3;
        return rank(left, leftName) - rank(right, rightName) || leftName.localeCompare(rightName) || left.id.localeCompare(right.id);
      });
    const start = (input.page - 1) * input.limit;
    return { data: matches.slice(start, start + input.limit), total: matches.length };
  }
}

const activeProduct = (index: number): BlingCatalogProduct => ({
  id: String(910_000_000_000_000_000n + BigInt(index)),
  nome: index === 0 ? 'Shampoo Snow - Vonixx' : index === 1 ? 'Produto com nome VNX-SNOW500'
    : index === 2 ? 'Ácido Fast Limpador - Vonixx' : `Produto local QA ${index}`,
  codigo: index === 0 ? 'VNX-SNOW500' : index === 1 ? 'SKU-NAME-DECOY' : index === 2 ? 'ACIDO-FAST-01' : `SKU-${index}`,
  preco: 28, tipo: 'P', situacao: 'A', formato: 'S',
});

test('Bling catalog normalization is case/accent/punctuation insensitive and preserves SKU punctuation', () => {
  assert.equal(normalizeBlingCatalogText('  Ácido   Snow---Vonixx  '), 'acido snow vonixx');
  assert.deepEqual(createBlingCatalogSearchPlan(' vonixx   snow ').nameTokens, ['vonixx', 'snow']);
  assert.equal(createBlingCatalogSearchPlan(' VNX-SNOW500 ').normalizedSku, 'vnx-snow500');
  assert.deepEqual(createBlingCatalogSearchPlan('---').nameTokens, []);
  assert.equal(createBlingCatalogSearchPlan('   ').all, true);
});

test('Bling catalog sync requests active pages at 100, publishes once and cached search/pagination make no provider calls', async () => {
  const repository = new MemoryCatalog();
  const products = Array.from({ length: 205 }, (_, index) => activeProduct(index));
  const calls: URLSearchParams[] = [];
  const client = { async read(_company: string, resource: string, query: URLSearchParams) {
    assert.equal(resource, 'products'); calls.push(new URLSearchParams(query));
    const page = Number(query.get('pagina'));
    return { data: products.slice((page - 1) * BLING_CATALOG_PAGE_SIZE, page * BLING_CATALOG_PAGE_SIZE) };
  } };
  const service = new BlingCatalogService(repository, client as any);
  const sync = await service.refresh('company-a');
  assert.deepEqual(sync, { generationId: sync.generationId, syncedAt: sync.syncedAt, products: 205, pages: 4 });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(query => [query.get('criterio'), query.get('limite'), query.get('pagina')]), [
    ['2', '100', '1'], ['2', '100', '2'], ['2', '100', '3'], ['2', '100', '4'],
  ]);
  assert.ok(BLING_CATALOG_TTL_MS >= 60 * 60 * 1000);

  const matching = await service.search('company-a', { query: 'VNX-SNOW500', page: 1, limit: 20, type: 'T' });
  assert.equal(matching.data[0]?.id, products[0]!.id, 'the exact SKU ranks before name-token matches');
  for (const query of ['snow', 'vonixx', 'snow vonixx', 'vonixx snow', 'shampoo snow', 'snow shampoo vonixx', 'ÁCIDO']) {
    const result = await service.search('company-a', { query, page: 1, limit: 20, type: 'T' });
    if (query.toLowerCase() === 'ácido') assert.ok(result.data.some(item => item.id === products[2]!.id));
    else assert.ok(result.data.some(item => item.id === products[0]!.id), query);
  }
  for (const query of ['SNOW500', 'VNX-SNOW']) {
    const result = await service.search('company-a', { query, page: 1, limit: 20, type: 'T' });
    assert.ok(!result.data.some(item => item.id === products[0]!.id), `partial SKU must not match by SKU: ${query}`);
  }
  const page1 = await service.search('company-a', { query: '', page: 1, limit: 20, type: 'T' });
  const page2 = await service.search('company-a', { query: '', page: 2, limit: 20, type: 'T', generationId: page1.generationId });
  assert.equal(page1.data.length, 20);
  assert.equal(page2.data.length, 20);
  assert.equal(new Set([...page1.data, ...page2.data].map(item => item.id)).size, 40);
  assert.equal(calls.length, 4, 'fresh local searches and load-more must not call Bling');
});

test('Bling catalog does not treat a short non-empty page as end of sync and rejects repeated IDs', async () => {
  const repository = new MemoryCatalog();
  const products = [activeProduct(1), activeProduct(2), activeProduct(3)];
  const pages: Record<string, BlingCatalogProduct[]> = {
    '1': products.slice(0, 1),
    '2': products.slice(1),
    '3': [],
  };
  let calls = 0;
  const service = new BlingCatalogService(repository, { async read(_company: string, _resource: string, query: URLSearchParams) {
    calls += 1;
    return { data: pages[query.get('pagina') || '1'] };
  } } as any);
  const sync = await service.refresh('company-a');
  assert.equal(sync.products, 3);
  assert.equal(sync.pages, 3);
  assert.equal(calls, 3, 'an empty terminal page confirms the end after a short page');

  const before = await repository.activeGeneration('company-a');
  const repeated = new BlingCatalogService(repository, { async read(_company: string, _resource: string, query: URLSearchParams) {
    return { data: query.get('pagina') === '1' ? products.slice(0, 2) : [products[1]!] };
  } } as any);
  await assert.rejects(repeated.refresh('company-a'), /repetiu produto/);
  assert.equal((await repository.activeGeneration('company-a'))?.id, before?.id);
});

test('Bling failed or non-active partial sync leaves the last complete generation intact', async () => {
  const repository = new MemoryCatalog();
  const previous = activeProduct(1);
  await repository.seed('company-a', '00000000-0000-4000-8000-000000000001', [previous]);
  const activePage = Array.from({ length: 100 }, (_, index) => activeProduct(index + 10));
  const service = new BlingCatalogService(repository, { async read(_company: string, _resource: string, query: URLSearchParams) {
    if (query.get('pagina') === '2') throw new BlingError(502, 'provider page failure');
    return { data: activePage };
  } } as any);
  await assert.rejects(service.refresh('company-a'), /provider page failure/);
  assert.equal((await repository.activeGeneration('company-a'))?.id, '00000000-0000-4000-8000-000000000001');
  const retained = await service.search('company-a', { query: '', page: 1, limit: 20, type: 'T' });
  assert.deepEqual(retained.data.map(item => item.id), [previous.id]);

  const invalid = new BlingCatalogService(repository, { async read() {
    return { data: [{ ...activeProduct(55), situacao: 'I' }] };
  } } as any);
  await assert.rejects(invalid.refresh('company-a'), /não ativo/);
  assert.equal((await repository.activeGeneration('company-a'))?.id, '00000000-0000-4000-8000-000000000001');
});

test('Bling same-process concurrent refreshes share one complete provider scan', async () => {
  const repository = new MemoryCatalog();
  const products = Array.from({ length: 205 }, (_, index) => activeProduct(index));
  let calls = 0;
  const service = new BlingCatalogService(repository, { async read(_company: string, _resource: string, query: URLSearchParams) {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 2));
    const page = Number(query.get('pagina'));
    return { data: products.slice((page - 1) * 100, page * 100) };
  } } as any);
  const [first, second] = await Promise.all([service.refresh('company-a'), service.refresh('company-a')]);
  assert.equal(first.generationId, second.generationId);
  assert.equal(calls, 4);
});

test('Bling search marks the retained snapshot stale while another instance holds the sync lock', async () => {
  const repository = new MemoryCatalog();
  const product = activeProduct(1);
  await repository.seed('company-a', '00000000-0000-4000-8000-000000000001', [product]);
  const release = await repository.tryAcquireSyncLock('company-a');
  assert.ok(release);
  let providerCalls = 0;
  try {
    const service = new BlingCatalogService(repository, { async read() { providerCalls += 1; return { data: [] }; } } as any,
      () => Date.now() + BLING_CATALOG_TTL_MS + 1);
    const result = await service.search('company-a', { query: '', page: 1, limit: 20, type: 'T' });
    assert.equal(result.stale, true);
    assert.equal(result.data[0]?.id, product.id);
    assert.equal(providerCalls, 0, 'a second replica must not start another catalog scan');
  } finally { await release(); }
});
