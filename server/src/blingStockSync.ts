import type { Pool } from 'pg';
import { z } from 'zod';
import { db } from './db.js';
import { BlingError, parseContract, stockModel } from './blingContract.js';
import type { BlingDependencies } from './bling.js';

export const BLING_STOCK_SYNC_INTERVAL_MS = 60 * 60 * 1000;
export const BLING_STOCK_SYNC_FAILURE_MESSAGE = 'A atualização automática de estoque falhou; os últimos valores válidos foram preservados.';

export type BlingStockSnapshot = {
  productId: string;
  physicalTotal: number;
  virtualTotal: number;
  balances: Array<{ warehouseId: string; physical: number; virtual: number }> | null;
};

const stockResponseSchema = z.object({ data: z.array(stockModel) });

export function parseBlingStockSnapshot(value: unknown, expectedProductId: string): BlingStockSnapshot {
  const response = parseContract(stockResponseSchema, value);
  const matching = response.data.filter((item) => item.produto.id === expectedProductId);
  if (matching.length !== 1) throw new BlingError(502, 'Bling não retornou um snapshot único para o produto solicitado');
  const row = matching[0]!;
  if (row.saldoFisicoTotal === undefined || row.saldoVirtualTotal === undefined) {
    throw new BlingError(502, 'O snapshot de estoque do Bling está incompleto');
  }
  const balances = row.depositos === undefined ? null : row.depositos.map((item) => {
    if (item.saldoFisico === undefined || item.saldoVirtual === undefined) {
      throw new BlingError(502, 'O snapshot por depósito do Bling está incompleto');
    }
    return { warehouseId: item.id, physical: item.saldoFisico, virtual: item.saldoVirtual };
  });
  return {
    productId: row.produto.id,
    physicalTotal: row.saldoFisicoTotal,
    virtualTotal: row.saldoVirtualTotal,
    balances,
  };
}

type LinkedProduct = { company_id: string; product_id: string; bling_product_id: string };

export async function runBlingStockSyncCycle(input: {
  bling: Pick<BlingDependencies, 'client'>;
  pool?: Pool;
  logger?: { info: (data: Record<string, unknown>, message: string) => void; warn: (data: Record<string, unknown>, message: string) => void };
}) {
  const pool = input.pool ?? db;
  const logger = input.logger;
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', ['bling-stock-sync:global']);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { skipped: true, products: 0, synced: 0, failed: 0 };

    const products = await pool.query<LinkedProduct>(
      `SELECT p.company_id, p.id AS product_id, link.bling_product_id
       FROM products p
       JOIN product_bling_links link ON link.company_id=p.company_id AND link.product_id=p.id
       JOIN bling_connections connection ON connection.company_id=p.company_id
       WHERE p.archived_at IS NULL AND link.bling_status='A'
       ORDER BY p.company_id, p.id`,
    );
    let synced = 0;
    let failed = 0;
    const haltedCompanies = new Set<string>();
    for (const item of products.rows) {
      if (haltedCompanies.has(item.company_id)) {
        failed += 1;
        await markStockSyncFailure(pool, item);
        continue;
      }
      try {
        const query = new URLSearchParams({ 'idsProdutos[]': item.bling_product_id });
        const raw = await input.bling.client.read(item.company_id, 'stock', query, item.bling_product_id);
        const snapshot = parseBlingStockSnapshot(raw, item.bling_product_id);
        if (await persistStockSnapshot(pool, item, snapshot)) synced += 1;
      } catch (error) {
        failed += 1;
        await markStockSyncFailure(pool, item);
        const statusCode = error instanceof BlingError ? error.statusCode : null;
        logger?.warn({ companyId: item.company_id, productId: item.product_id, statusCode,
          errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Falha em uma atualização automática de estoque Bling');
        if (statusCode === 403 || statusCode === 409 || statusCode === 429) haltedCompanies.add(item.company_id);
      }
    }
    logger?.info({ products: products.rows.length, synced, failed }, 'Ciclo de sincronização automática de estoque Bling concluído');
    return { skipped: false, products: products.rows.length, synced, failed };
  } finally {
    if (locked) await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', ['bling-stock-sync:global']).catch(() => undefined);
    lockClient.release();
  }
}

async function persistStockSnapshot(pool: Pool, item: LinkedProduct, snapshot: BlingStockSnapshot) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT link.bling_product_id
       FROM products p JOIN product_bling_links link ON link.company_id=p.company_id AND link.product_id=p.id
       WHERE p.company_id=$1 AND p.id=$2 AND p.archived_at IS NULL AND link.bling_status='A'
       FOR UPDATE OF p,link`, [item.company_id, item.product_id]);
    if (current.rows[0]?.bling_product_id !== item.bling_product_id) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `UPDATE product_bling_links
       SET stock_physical_total=$4, stock_virtual_total=$5,
           stock_synced_at=now(), stock_sync_attempted_at=now(), stock_sync_error=NULL, updated_at=now()
       WHERE company_id=$1 AND product_id=$2 AND bling_product_id=$3`,
      [item.company_id, item.product_id, item.bling_product_id, snapshot.physicalTotal, snapshot.virtualTotal]);
    if (snapshot.balances !== null) {
      await client.query('DELETE FROM product_bling_stock_balances WHERE company_id=$1 AND product_id=$2', [item.company_id, item.product_id]);
      for (const balance of snapshot.balances) {
        await client.query(
          `INSERT INTO product_bling_stock_balances(company_id,product_id,bling_warehouse_id,physical_balance,virtual_balance,synced_at)
           VALUES($1,$2,$3,$4,$5,now())`,
          [item.company_id, item.product_id, balance.warehouseId, balance.physical, balance.virtual]);
      }
    }
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function markStockSyncFailure(pool: Pool, item: LinkedProduct) {
  await pool.query(
    `UPDATE product_bling_links
     SET stock_sync_attempted_at=now(), stock_sync_error=$4
     WHERE company_id=$1 AND product_id=$2 AND bling_product_id=$3`,
    [item.company_id, item.product_id, item.bling_product_id, BLING_STOCK_SYNC_FAILURE_MESSAGE]);
}

export function startBlingStockSyncScheduler(input: {
  enabled: boolean;
  bling?: Pick<BlingDependencies, 'client'>;
  pool?: Pool;
  intervalMs?: number;
  logger?: { info: (data: Record<string, unknown>, message: string) => void; warn: (data: Record<string, unknown>, message: string) => void };
}) {
  if (!input.enabled) return { stop: () => undefined, enabled: false };
  if (!input.bling) {
    input.logger?.warn({}, 'Sincronização automática de estoque Bling solicitada, mas a integração não está configurada');
    return { stop: () => undefined, enabled: false };
  }
  let currentCycle: Promise<unknown> | null = null;
  const run = async () => {
    if (currentCycle) return currentCycle;
    currentCycle = (async () => {
      try {
        await runBlingStockSyncCycle({ bling: input.bling!, ...(input.pool ? { pool: input.pool } : {}), ...(input.logger ? { logger: input.logger } : {}) });
      }
      catch (error) {
        input.logger?.warn({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Ciclo de sincronização automática de estoque Bling falhou');
      }
      finally { currentCycle = null; }
    })();
    return currentCycle;
  };
  const timer = setInterval(() => void run(), input.intervalMs ?? BLING_STOCK_SYNC_INTERVAL_MS);
  timer.unref?.();
  void run();
  return { enabled: true, stop: async () => { clearInterval(timer); await currentCycle; } };
}
