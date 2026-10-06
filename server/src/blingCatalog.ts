import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { db } from './db.js';
import { BlingError, parseContract, productListModel } from './blingContract.js';
import type { BlingApiClient } from './blingClient.js';
import { z } from 'zod';

export const BLING_CATALOG_PAGE_SIZE = 100;
export const BLING_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PROVIDER_PAGES = 10_000;
const GENERATION_RETENTION_MS = 24 * 60 * 60 * 1000;

export type BlingCatalogType = 'T' | 'P' | 'S' | 'E' | 'PS' | 'C' | 'V';

const catalogTypeFilters: Record<BlingCatalogType, string> = {
  T: 'TRUE',
  P: "product_type = 'P'",
  S: "product_type IN ('S', 'N')",
  E: "product_type = 'P' AND product_format = 'E'",
  PS: "product_type = 'P' AND product_format = 'S' AND parent_product_id IS NULL",
  C: "product_type = 'P' AND product_format = 'V' AND parent_product_id IS NULL",
  V: "product_type = 'P' AND parent_product_id IS NOT NULL",
};

export type BlingCatalogProduct = {
  id: string;
  nome: string;
  codigo?: string;
  preco?: number;
  tipo: 'S' | 'P' | 'N';
  situacao: 'A';
  formato: 'S' | 'V' | 'E';
  idProdutoPai?: string;
};

export type BlingCatalogGeneration = {
  id: string;
  syncedAt: string;
  status: 'active' | 'retired';
};

export type BlingCatalogSearchPlan = {
  all: boolean;
  normalizedName: string;
  nameTokens: string[];
  normalizedSku: string | null;
};

export function normalizeBlingCatalogText(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function createBlingCatalogSearchPlan(query: string): BlingCatalogSearchPlan {
  const trimmed = query.trim();
  const normalizedName = normalizeBlingCatalogText(trimmed);
  return {
    all: trimmed.length === 0,
    normalizedName,
    nameTokens: normalizedName ? normalizedName.split(' ') : [],
    normalizedSku: trimmed ? trimmed.toLowerCase() : null,
  };
}

export interface BlingCatalogRepository {
  tryAcquireSyncLock(companyId: string): Promise<(() => Promise<void>) | null>;
  activeGeneration(companyId: string): Promise<BlingCatalogGeneration | null>;
  generation(companyId: string, generationId: string): Promise<BlingCatalogGeneration | null>;
  startGeneration(companyId: string, generationId: string): Promise<void>;
  upsertPage(companyId: string, generationId: string, products: BlingCatalogProduct[]): Promise<void>;
  publishGeneration(companyId: string, generationId: string): Promise<number>;
  discardGeneration(companyId: string, generationId: string): Promise<void>;
  search(input: { companyId: string; generationId: string; plan: BlingCatalogSearchPlan;
    page: number; limit: number; type: BlingCatalogType }): Promise<{ data: BlingCatalogProduct[]; total: number }>;
}

export class PgBlingCatalogRepository implements BlingCatalogRepository {
  constructor(private pool: Pool = db) {}

  async tryAcquireSyncLock(companyId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [`bling-catalog:${companyId}`]);
      if (!result.rows[0]?.locked) { client.release(); return null; }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`bling-catalog:${companyId}`]); }
        finally { client.release(); }
      };
    } catch (error) { client.release(); throw error; }
  }

  async activeGeneration(companyId: string) {
    const result = await this.pool.query(`SELECT generation_id AS id, completed_at AS synced_at, status
      FROM bling_product_catalog_generations WHERE company_id=$1 AND status='active'`, [companyId]);
    const row = result.rows[0];
    return row ? { id: String(row.id), syncedAt: new Date(row.synced_at).toISOString(), status: 'active' as const } : null;
  }

  async generation(companyId: string, generationId: string) {
    const result = await this.pool.query(`SELECT generation_id AS id, completed_at AS synced_at, status
      FROM bling_product_catalog_generations WHERE company_id=$1 AND generation_id=$2
        AND status IN ('active','retired') AND completed_at IS NOT NULL`, [companyId, generationId]);
    const row = result.rows[0];
    return row ? { id: String(row.id), syncedAt: new Date(row.synced_at).toISOString(), status: row.status as 'active' | 'retired' } : null;
  }

  async startGeneration(companyId: string, generationId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM bling_product_catalog_generations
        WHERE company_id=$1 AND (status='building' OR (status='retired' AND completed_at < now() - ($2 * interval '1 millisecond')))`,
      [companyId, GENERATION_RETENTION_MS]);
      await client.query(`INSERT INTO bling_product_catalog_generations(company_id,generation_id,status)
        VALUES($1,$2,'building')`, [companyId, generationId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async upsertPage(companyId: string, generationId: string, products: BlingCatalogProduct[]) {
    if (!products.length) return;
    const records = products.map(product => ({
      id: product.id,
      name: product.nome,
      normalized_name: normalizeBlingCatalogText(product.nome),
      sku: product.codigo?.trim() || null,
      normalized_sku: product.codigo?.trim() ? product.codigo.trim().toLowerCase() : null,
      product_type: product.tipo,
      product_format: product.formato,
      price: product.preco ?? null,
      parent_product_id: product.idProdutoPai ?? null,
    }));
    await this.pool.query(`INSERT INTO bling_product_catalog_entries(
        company_id,generation_id,bling_product_id,name,normalized_name,sku,normalized_sku,
        product_type,status,product_format,price,parent_product_id,synced_at)
      SELECT $1,$2,x.id,x.name,x.normalized_name,x.sku,x.normalized_sku,x.product_type,'A',
        x.product_format,x.price,x.parent_product_id,clock_timestamp()
      FROM jsonb_to_recordset($3::jsonb) AS x(
        id text,name text,normalized_name text,sku text,normalized_sku text,
        product_type text,product_format text,price numeric,parent_product_id text)
      ON CONFLICT(company_id,generation_id,bling_product_id) DO UPDATE SET
        name=EXCLUDED.name,normalized_name=EXCLUDED.normalized_name,sku=EXCLUDED.sku,
        normalized_sku=EXCLUDED.normalized_sku,product_type=EXCLUDED.product_type,
        status=EXCLUDED.status,product_format=EXCLUDED.product_format,price=EXCLUDED.price,
        parent_product_id=EXCLUDED.parent_product_id,synced_at=EXCLUDED.synced_at`,
    [companyId, generationId, JSON.stringify(records)]);
  }

  async publishGeneration(companyId: string, generationId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const generation = await client.query(`SELECT status FROM bling_product_catalog_generations
        WHERE company_id=$1 AND generation_id=$2 FOR UPDATE`, [companyId, generationId]);
      if (generation.rows[0]?.status !== 'building') throw new Error('Geração de catálogo não está em construção');
      const count = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM bling_product_catalog_entries
        WHERE company_id=$1 AND generation_id=$2`, [companyId, generationId]);
      await client.query(`UPDATE bling_product_catalog_generations SET status='retired'
        WHERE company_id=$1 AND status='active'`, [companyId]);
      await client.query(`UPDATE bling_product_catalog_generations SET status='active',completed_at=clock_timestamp()
        WHERE company_id=$1 AND generation_id=$2`, [companyId, generationId]);
      await client.query('COMMIT');
      return Number(count.rows[0]?.count || 0);
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async discardGeneration(companyId: string, generationId: string) {
    await this.pool.query(`DELETE FROM bling_product_catalog_generations
      WHERE company_id=$1 AND generation_id=$2 AND status='building'`, [companyId, generationId]);
  }

  async search({ companyId, generationId, plan, page, limit, type }: Parameters<BlingCatalogRepository['search']>[0]) {
    const values = [companyId, generationId, plan.all, plan.normalizedSku, plan.nameTokens,
      plan.normalizedName];
    const typeFilter = catalogTypeFilters[type];
    const queryFilter = `($3::boolean OR ($4::text IS NOT NULL AND normalized_sku=$4)
      OR (cardinality($5::text[]) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest($5::text[]) AS tokens(token) WHERE position(token IN normalized_name)=0)))`;
    const where = `company_id=$1 AND generation_id=$2 AND status='A' AND ${typeFilter} AND ${queryFilter}`;
    const count = await this.pool.query<{ total: string }>(`SELECT count(*)::text AS total
      FROM bling_product_catalog_entries WHERE ${where}`, values.slice(0, 5));
    const rows = await this.pool.query(`SELECT bling_product_id AS id,name AS nome,sku AS codigo,
        price::double precision AS preco,product_type AS tipo,status AS situacao,
        product_format AS formato,parent_product_id AS "idProdutoPai"
      FROM bling_product_catalog_entries WHERE ${where}
      ORDER BY CASE
        WHEN $4::text IS NOT NULL AND normalized_sku=$4 THEN 0
        WHEN $6::text <> '' AND normalized_name=$6 THEN 1
        WHEN $6::text <> '' AND left(normalized_name,length($6))=$6 THEN 2
        ELSE 3 END,normalized_name,bling_product_id
      LIMIT $7 OFFSET $8`, [...values, limit, (page - 1) * limit]);
    const data = rows.rows.map(row => ({
      id: String(row.id), nome: String(row.nome),
      ...(row.codigo === null ? {} : { codigo: String(row.codigo) }),
      ...(row.preco === null ? {} : { preco: Number(row.preco) }),
      tipo: row.tipo as BlingCatalogProduct['tipo'], situacao: row.situacao as 'A',
      formato: row.formato as BlingCatalogProduct['formato'],
      ...(row.idProdutoPai === null ? {} : { idProdutoPai: String(row.idProdutoPai) }),
    }));
    return { data, total: Number(count.rows[0]?.total || 0) };
  }
}

export type BlingProductReader = Pick<BlingApiClient, 'read'>;
const catalogPageContract = z.object({ data: z.array(productListModel) });
type SyncSummary = { generationId: string; syncedAt: string; products: number; pages: number };
type SnapshotResult = { snapshot: BlingCatalogGeneration; stale: boolean; refreshFailed: boolean; refreshing: boolean };

export class BlingCatalogService {
  private readonly inFlight = new Map<string, Promise<SyncSummary>>();
  constructor(private repository: BlingCatalogRepository, private client: BlingProductReader,
    private now = Date.now, private sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}

  private fresh(snapshot: BlingCatalogGeneration | null) {
    return !!snapshot && this.now() - new Date(snapshot.syncedAt).getTime() < BLING_CATALOG_TTL_MS;
  }

  async search(companyId: string, input: { query: string; page: number; limit: number;
    type: BlingCatalogType; generationId?: string }) {
    let state: SnapshotResult;
    if (input.generationId) {
      const snapshot = await this.repository.generation(companyId, input.generationId);
      if (!snapshot) throw new BlingError(409, 'A busca expirou; execute a consulta novamente');
      state = { snapshot, stale: !this.fresh(snapshot), refreshFailed: false, refreshing: false };
    } else state = await this.ensureSnapshot(companyId, false);
    const result = await this.repository.search({ companyId, generationId: state.snapshot.id,
      plan: createBlingCatalogSearchPlan(input.query), page: input.page, limit: input.limit, type: input.type });
    return { ...result, page: input.page, limit: input.limit, hasMore: input.page * input.limit < result.total,
      generationId: state.snapshot.id, syncedAt: state.snapshot.syncedAt, stale: state.stale,
      refreshFailed: state.refreshFailed, refreshing: state.refreshing };
  }

  async refresh(companyId: string): Promise<SyncSummary> {
    const active = this.inFlight.get(companyId);
    if (active) return active;
    const initial = await this.repository.activeGeneration(companyId);
    const task = this.performSync(companyId, true, initial?.id ?? null);
    this.inFlight.set(companyId, task);
    try { return await task; }
    finally { if (this.inFlight.get(companyId) === task) this.inFlight.delete(companyId); }
  }

  private async ensureSnapshot(companyId: string, force: boolean): Promise<SnapshotResult> {
    let active = await this.repository.activeGeneration(companyId);
    if (!force && this.fresh(active)) return { snapshot: active!, stale: false, refreshFailed: false, refreshing: false };
    const inFlight = this.inFlight.get(companyId);
    if (inFlight) {
      if (active) return { snapshot: active, stale: !this.fresh(active), refreshFailed: false, refreshing: true };
      await inFlight;
      active = await this.repository.activeGeneration(companyId);
      if (active) return { snapshot: active, stale: !this.fresh(active), refreshFailed: false, refreshing: false };
      throw new BlingError(503, 'Catálogo Bling não disponível');
    }
    const task = this.performSync(companyId, force, active?.id ?? null);
    this.inFlight.set(companyId, task);
    try {
      const summary = await task;
      const snapshot = await this.repository.generation(companyId, summary.generationId);
      if (!snapshot) throw new BlingError(503, 'Catálogo Bling não disponível');
      return { snapshot, stale: !this.fresh(snapshot), refreshFailed: false, refreshing: false };
    } catch (error) {
      active = await this.repository.activeGeneration(companyId);
      if (active) return { snapshot: active, stale: true, refreshFailed: true, refreshing: false };
      throw error;
    } finally { if (this.inFlight.get(companyId) === task) this.inFlight.delete(companyId); }
  }

  private async performSync(companyId: string, force: boolean, initialGenerationId?: string | null): Promise<SyncSummary> {
    let release = await this.repository.tryAcquireSyncLock(companyId);
    if (!release) {
      if (!force) {
        const active = await this.repository.activeGeneration(companyId);
        if (active) return { generationId: active.id, syncedAt: active.syncedAt, products: 0, pages: 0 };
      }
      const deadline = this.now() + 120_000;
      while (this.now() < deadline) {
        await this.sleep(250);
        const active = await this.repository.activeGeneration(companyId);
        if (active && (!force || active.id !== (initialGenerationId ?? null))) {
          return { generationId: active.id, syncedAt: active.syncedAt, products: 0, pages: 0 };
        }
        release = await this.repository.tryAcquireSyncLock(companyId);
        if (release) break;
      }
      if (!release) throw new BlingError(503, 'Catálogo Bling está sendo atualizado; tente novamente');
    }

    const generationId = randomUUID();
    let started = false;
    try {
      const active = await this.repository.activeGeneration(companyId);
      if (!force && this.fresh(active)) return { generationId: active!.id, syncedAt: active!.syncedAt, products: 0, pages: 0 };
      if (force && active && initialGenerationId !== undefined && active.id !== initialGenerationId) {
        return { generationId: active.id, syncedAt: active.syncedAt, products: 0, pages: 0 };
      }
      await this.repository.startGeneration(companyId, generationId);
      started = true;
      let products = 0;
      let pages = 0;
      const seenProductIds = new Set<string>();
      for (let page = 1; page <= MAX_PROVIDER_PAGES; page += 1) {
        const query = new URLSearchParams({ criterio: '2', pagina: String(page), limite: String(BLING_CATALOG_PAGE_SIZE) });
        const raw = await this.client.read(companyId, 'products', query);
        const data = parseContract(catalogPageContract, raw).data;
        pages = page;
        if (data.length > BLING_CATALOG_PAGE_SIZE) throw new BlingError(502, 'Página do catálogo Bling excede o limite solicitado');
        if (data.some(product => seenProductIds.has(product.id))) throw new BlingError(502, 'Paginação do catálogo Bling repetiu produto');
        if (data.some(product => product.situacao !== 'A')) throw new BlingError(502, 'Resposta do catálogo Bling contém produto não ativo');
        if (data.some(product => product.preco !== undefined && !Number.isFinite(product.preco))) {
          throw new BlingError(502, 'Preço inválido na resposta do catálogo Bling');
        }
        if (data.length === 0) break;
        for (const product of data) seenProductIds.add(product.id);
        const projected = data.map(product => ({ ...product, situacao: 'A' as const }));
        await this.repository.upsertPage(companyId, generationId, projected);
        products += projected.length;
        if (page === MAX_PROVIDER_PAGES) throw new BlingError(502, 'Paginação do catálogo Bling excedeu o limite');
      }
      const publishedProducts = await this.repository.publishGeneration(companyId, generationId);
      const snapshot = await this.repository.activeGeneration(companyId);
      if (!snapshot || snapshot.id !== generationId) throw new BlingError(503, 'Catálogo Bling não foi publicado');
      return { generationId, syncedAt: snapshot.syncedAt, products: publishedProducts, pages };
    } catch (error) {
      if (started) await this.repository.discardGeneration(companyId, generationId).catch(() => undefined);
      throw error;
    } finally { await release?.(); }
  }
}
