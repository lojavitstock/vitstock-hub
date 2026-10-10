import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLING_STOCK_SYNC_FAILURE_MESSAGE,
  BLING_STOCK_SYNC_INTERVAL_MS,
  parseBlingStockSnapshot,
  runBlingStockSyncCycle,
  startBlingStockSyncScheduler,
} from '../server/src/blingStockSync.js';
import { BlingError } from '../server/src/blingContract.js';

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number };

class FakeStockPool {
  lockAvailable = true;
  products: Array<{ company_id: string; product_id: string; bling_product_id: string }> = [];
  currentLinks = new Map<string, string>();
  stockUpdates: unknown[][] = [];
  stockUpdateSql: string[] = [];
  failureUpdates: unknown[][] = [];
  balanceDeletes: unknown[][] = [];
  balanceInserts: unknown[][] = [];
  transactionLog: string[] = [];

  async connect() { return new FakeStockClient(this); }

  async query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    if (sql.includes('SELECT p.company_id')) return { rows: this.products };
    if (sql.includes('SET stock_sync_attempted_at=now()')) {
      this.failureUpdates.push(values);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  }
}

class FakeStockClient {
  constructor(private readonly pool: FakeStockPool) {}
  async query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: this.pool.lockAvailable }] };
    if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      this.pool.transactionLog.push(sql);
      return { rows: [] };
    }
    if (sql.includes('SELECT link.bling_product_id')) {
      const key = `${String(values[0])}:${String(values[1])}`;
      return { rows: [{ bling_product_id: this.pool.currentLinks.get(key) }] };
    }
    if (sql.includes('SET stock_physical_total=$4')) {
      this.pool.stockUpdates.push(values);
      this.pool.stockUpdateSql.push(sql);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('DELETE FROM product_bling_stock_balances')) {
      this.pool.balanceDeletes.push(values);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO product_bling_stock_balances')) {
      this.pool.balanceInserts.push(values);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected client query: ${sql}`);
  }
  release() {}
}

const productRow = (id: string) => ({ company_id: 'tenant-a', product_id: `hub-${id}`, bling_product_id: id });
const providerSnapshot = (id: string, physical = 0, virtual = 0) => ({ data: [{
  produto: { id }, saldoFisicoTotal: physical, saldoVirtualTotal: virtual,
  depositos: [{ id: '555', descricao: 'QA', situacao: 1, padrao: true,
    desconsiderarSaldo: false, saldoFisico: physical, saldoVirtual: virtual }],
}] });

test('Bling stock snapshot accepts zero and absent warehouse details without inventing balances', () => {
  assert.deepEqual(parseBlingStockSnapshot({ data: [{ produto: { id: '123' }, saldoFisicoTotal: 0, saldoVirtualTotal: 0 }] }, '123'), {
    productId: '123', physicalTotal: 0, virtualTotal: 0, balances: null,
  });
  assert.throws(() => parseBlingStockSnapshot({ data: [{ produto: { id: '123' }, saldoVirtualTotal: 4 }] }, '123'), /incompleto/);
  assert.throws(() => parseBlingStockSnapshot({ data: [{ produto: { id: '124' }, saldoFisicoTotal: 1, saldoVirtualTotal: 1 }] }, '123'), /snapshot único/);
  assert.throws(() => parseBlingStockSnapshot({ data: [
    { produto: { id: '123' }, saldoFisicoTotal: 1, saldoVirtualTotal: 1 },
    { produto: { id: '123' }, saldoFisicoTotal: 2, saldoVirtualTotal: 2 },
  ] }, '123'), /snapshot único/);
  assert.throws(() => parseBlingStockSnapshot({ data: [{ produto: { id: '123' }, saldoFisicoTotal: Number.NaN, saldoVirtualTotal: 1 }] }, '123'));
});

test('Bling stock cycle serially reads exact linked IDs and updates only stock snapshot fields', async () => {
  const pool = new FakeStockPool();
  pool.products = [productRow('101'), productRow('202')];
  for (const product of pool.products) pool.currentLinks.set(`${product.company_id}:${product.product_id}`, product.bling_product_id);
  const requests: Array<{ company: string; resource: string; query: URLSearchParams; id?: string }> = [];
  let activeReads = 0;
  let maximumReads = 0;
  const result = await runBlingStockSyncCycle({ pool: pool as any, bling: { client: { async read(company: string, resource: string, query: URLSearchParams, id?: string) {
    activeReads += 1; maximumReads = Math.max(maximumReads, activeReads);
    requests.push({ company, resource, query: new URLSearchParams(query), id });
    await new Promise(resolve => setTimeout(resolve, 1));
    activeReads -= 1;
    return providerSnapshot(id!, id === '101' ? 7 : 0, id === '101' ? 9 : 0);
  } } } });

  assert.deepEqual(result, { skipped: false, products: 2, synced: 2, failed: 0 });
  assert.equal(maximumReads, 1, 'provider calls are serialized');
  assert.deepEqual(requests.map(request => [request.company, request.resource, request.query.get('idsProdutos[]'), request.id]), [
    ['tenant-a', 'stock', '101', '101'], ['tenant-a', 'stock', '202', '202'],
  ]);
  assert.deepEqual(pool.stockUpdates.map(values => values.slice(0, 5)), [
    ['tenant-a', 'hub-101', '101', 7, 9], ['tenant-a', 'hub-202', '202', 0, 0],
  ]);
  assert.equal(pool.balanceDeletes.length, 2);
  assert.equal(pool.balanceInserts.length, 2);
  assert.ok(pool.transactionLog.includes('COMMIT'));
  assert.equal(pool.stockUpdateSql.length, 2);
  assert.ok(pool.stockUpdateSql.every(sql => sql.includes('stock_physical_total') && sql.includes('stock_virtual_total')
    && sql.includes('stock_synced_at') && sql.includes('stock_sync_attempted_at') && sql.includes('stock_sync_error')
    && !/SET[\s\S]*?(?:bling_status|unit_price|unit_cost|name|description)\s*=/i.test(sql)));
});

test('Bling stock failure preserves valid totals and stores only a generic failure marker', async () => {
  const pool = new FakeStockPool();
  pool.products = [productRow('303')];
  pool.currentLinks.set('tenant-a:hub-303', '303');
  const result = await runBlingStockSyncCycle({ pool: pool as any, bling: { client: { async read() {
    throw new BlingError(502, 'provider body may contain sensitive data');
  } } } });
  assert.deepEqual(result, { skipped: false, products: 1, synced: 0, failed: 1 });
  assert.equal(pool.stockUpdates.length, 0, 'failure never overwrites the previous valid snapshot');
  assert.equal(pool.failureUpdates.length, 1);
  assert.equal(pool.failureUpdates[0]![3], BLING_STOCK_SYNC_FAILURE_MESSAGE);
  assert.ok(!JSON.stringify(pool.failureUpdates).includes('sensitive'));
});

test('Bling stock cycle stops provider requests for a tenant after rate limit and skips when lock is held', async () => {
  const pool = new FakeStockPool();
  pool.products = [productRow('401'), productRow('402')];
  let calls = 0;
  const limited = await runBlingStockSyncCycle({ pool: pool as any, bling: { client: { async read() { calls += 1; throw new BlingError(429, 'rate limited'); } } } });
  assert.deepEqual(limited, { skipped: false, products: 2, synced: 0, failed: 2 });
  assert.equal(calls, 1);
  assert.equal(pool.failureUpdates.length, 2);

  pool.lockAvailable = false;
  const skipped = await runBlingStockSyncCycle({ pool: pool as any, bling: { client: { async read() { calls += 1; return providerSnapshot('401'); } } } });
  assert.deepEqual(skipped, { skipped: true, products: 0, synced: 0, failed: 0 });
  assert.equal(calls, 1);
  assert.equal(BLING_STOCK_SYNC_INTERVAL_MS, 60 * 60 * 1000);
});

test('Bling stock scheduler remains disabled unless explicitly enabled with a client', () => {
  let providerCalls = 0;
  const warnings: string[] = [];
  const runtime = { client: { async read() { providerCalls += 1; return providerSnapshot('1'); } } };
  const disabled = startBlingStockSyncScheduler({ enabled: false, bling: runtime as any });
  const missingClient = startBlingStockSyncScheduler({ enabled: true, logger: { info() {}, warn(_data, message) { warnings.push(message); } } });
  assert.equal(disabled.enabled, false);
  assert.equal(missingClient.enabled, false);
  assert.equal(providerCalls, 0);
  assert.deepEqual(warnings, ['Sincronização automática de estoque Bling solicitada, mas a integração não está configurada']);
  assert.doesNotThrow(() => disabled.stop());
});

test('Bling stock scheduler serializes cycles and waits for an in-flight cycle on shutdown', async () => {
  const pool = new FakeStockPool();
  pool.products = [productRow('501')];
  pool.currentLinks.set('tenant-a:hub-501', '501');
  let calls = 0;
  let activeReads = 0;
  let maxActiveReads = 0;
  let started!: () => void;
  const readStarted = new Promise<void>(resolve => { started = resolve; });
  let finishRead!: () => void;
  const readGate = new Promise<void>(resolve => { finishRead = resolve; });
  const scheduler = startBlingStockSyncScheduler({
    enabled: true,
    pool: pool as any,
    intervalMs: 5,
    bling: { client: { async read() {
      calls += 1;
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      started();
      await readGate;
      activeReads -= 1;
      return providerSnapshot('501', 3, 4);
    } } } as any,
  });
  await readStarted;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 1, 'timer ticks must not start a concurrent cycle');
  assert.equal(maxActiveReads, 1);

  let stopped = false;
  const stopping = scheduler.stop().then(() => { stopped = true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(stopped, false, 'shutdown waits for the current transaction/cycle');
  finishRead();
  await stopping;
  assert.equal(stopped, true);
  assert.equal(calls, 1);
  assert.ok(pool.transactionLog.includes('COMMIT'));
});
