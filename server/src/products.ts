import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { requireAdmin, requireUser } from './auth.js';
import type { BlingDependencies } from './bling.js';
import { BlingError, idSchema, parseContract, productDetailModel } from './blingContract.js';
import { toBlingProductSyncSnapshot, type BlingProductSyncSnapshot } from './blingProductLink.js';
import { config, isAllowedFrontendOrigin, isLocalHost } from './config.js';
import { db } from './db.js';
import { decodeProductImage, ProductImageValidationError } from './productImageValidation.js';
import type { ProductImageMimeType } from './productImageValidation.js';
import type { ProductStorage } from './productStorage.js';

const productNameSchema = z.string().trim().min(1).max(120);
const imageBase64Schema = z.string().min(1).max(1_333_336);
const imageMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);

const updateProductSchema = z.object({
  name: productNameSchema.optional(),
  imageBase64: imageBase64Schema.optional(),
  imageMimeType: imageMimeTypeSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'Informe ao menos uma alteração.' })
  .refine((value) => Boolean(value.imageBase64) === Boolean(value.imageMimeType), { message: 'Envie a imagem e o formato juntos.' });

const listQuerySchema = z.object({ search: z.string().trim().max(120).optional() }).strict();
const idParamsSchema = z.object({ id: z.string().uuid() }).strict();
const imageQuerySchema = z.object({ key: z.string().min(1).max(512) }).strict();
const blingLinkBodySchema = z.object({ blingProductId: idSchema }).strict();

type ProductRow = {
  id: string;
  company_id: string;
  name: string;
  price_cents: number;
  currency: string;
  image_object_key: string;
  image_mime_type: ProductImageMimeType;
  image_size_bytes: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  bling_product_id?: string | null;
  bling_parent_product_id?: string | null;
  bling_name?: string | null;
  bling_code?: string | null;
  bling_gtin?: string | null;
  bling_unit?: string | null;
  bling_price_cents?: number | null;
  bling_status?: 'A' | 'I' | null;
  bling_format?: 'S' | 'V' | 'E' | null;
  stock_physical_total?: string | null;
  stock_virtual_total?: string | null;
  last_synced_at?: string | null;
};

type ProductBlingLinkRow = {
  company_id: string;
  product_id: string;
  bling_product_id: string;
  bling_parent_product_id: string | null;
  bling_name: string;
  bling_code: string | null;
  bling_gtin: string | null;
  bling_unit: string | null;
  bling_price_cents: number;
  bling_status: 'A' | 'I';
  bling_format: 'S' | 'V' | 'E';
  stock_physical_total: string | null;
  stock_virtual_total: string | null;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
};

const productColumns = `id, company_id, name, price_cents, currency, image_object_key,
  image_mime_type, image_size_bytes, archived_at, created_at, updated_at`;
const publicProductColumns = `p.id, p.company_id, p.name, p.price_cents, p.currency, p.image_object_key,
  p.image_mime_type, p.image_size_bytes, p.archived_at, p.created_at, p.updated_at,
  l.bling_product_id, l.bling_parent_product_id, l.bling_name, l.bling_code, l.bling_gtin,
  l.bling_unit, l.bling_price_cents, l.bling_status, l.bling_format,
  l.stock_physical_total, l.stock_virtual_total, l.last_synced_at`;
const publicProductFrom = `FROM products p LEFT JOIN product_bling_links l
  ON l.company_id = p.company_id AND l.product_id = p.id`;

class ProductNotFoundError extends Error {}
class StaleBlingLinkError extends Error {}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    if (began) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function publicProductForCompany(
  row: ProductRow,
  storage: ProductStorage,
  imageBaseUrl?: string,
) {
  const linked = Boolean(row.bling_product_id);
  return {
    id: row.id,
    name: row.name,
    priceCents: Number(row.price_cents),
    currency: 'BRL' as const,
    imageUrl: storage.buildUrl(row.image_object_key, imageBaseUrl),
    imageMimeType: row.image_mime_type,
    imageSizeBytes: Number(row.image_size_bytes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: linked ? 'bling' as const : 'manual' as const,
    bling: linked ? {
      productId: row.bling_product_id!,
      name: row.bling_name!,
      ...(row.bling_parent_product_id ? { parentProductId: row.bling_parent_product_id } : {}),
      ...(row.bling_code !== null && row.bling_code !== undefined ? { code: row.bling_code } : {}),
      ...(row.bling_gtin ? { gtin: row.bling_gtin } : {}),
      ...(row.bling_unit ? { unit: row.bling_unit } : {}),
      status: row.bling_status!,
      format: row.bling_format!,
      stockPhysicalTotal: row.stock_physical_total,
      stockVirtualTotal: row.stock_virtual_total,
      syncedAt: row.last_synced_at!,
    } : null,
  };
}

const localApiBaseForOrigin = (origin?: string) => {
  if (!origin || !isAllowedFrontendOrigin(origin) || !isLocalHost(origin)) return undefined;
  const url = new URL(origin);
  url.port = String(config.PORT);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.origin;
};

const toPublicProduct = publicProductForCompany;

const toPublicBlingLink = (row: ProductBlingLinkRow) => ({
  productId: row.product_id,
  blingProductId: row.bling_product_id,
  blingParentProductId: row.bling_parent_product_id,
  blingName: row.bling_name,
  blingCode: row.bling_code,
  blingGtin: row.bling_gtin,
  blingUnit: row.bling_unit,
  blingPriceCents: Number(row.bling_price_cents),
  blingStatus: row.bling_status,
  blingFormat: row.bling_format,
  stockPhysicalTotal: row.stock_physical_total,
  stockVirtualTotal: row.stock_virtual_total,
  lastSyncedAt: row.last_synced_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const imageExtension = (mimeType: ProductImageMimeType) => mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
const imageKey = (companyId: string, productId: string, mimeType: ProductImageMimeType) => `products/${companyId}/${productId}/${randomUUID()}.${imageExtension(mimeType)}`;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const parseId = (params: unknown) => idParamsSchema.safeParse(params);

function sendValidationError(reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof ProductImageValidationError) return reply.code(400).send({ error: error.message, code: 'invalid_product_image' });
  return null;
}

async function removeNewImageBestEffort(
  request: { log: { error: (data: unknown, message: string) => void } },
  storage: ProductStorage,
  companyId: string,
  key: string,
) {
  try {
    await storage.remove(companyId, key);
  } catch (error) {
    request.log.error({ cleanupErrorName: error instanceof Error ? error.name : 'UnknownError' }, 'Falha ao remover imagem nova após erro de persistência do produto');
  }
}

async function fetchBlingProductSyncSnapshot(
  companyId: string,
  blingProductId: string,
  bling: BlingDependencies,
  use: 'selection' | 'existing-sync',
): Promise<BlingProductSyncSnapshot> {
  const detailValue = await bling.client.read(companyId, 'product', new URLSearchParams(), blingProductId);
  const rawData = detailValue && typeof detailValue === 'object' && !Array.isArray(detailValue)
    ? (detailValue as Record<string, unknown>).data
    : undefined;
  const rawDetail = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
    ? rawData as Record<string, unknown>
    : undefined;
  const rawId = rawDetail && idSchema.safeParse(rawDetail.id);
  // E is not accepted as a detail contract. For selection, an explicit E on
  // the matching product is only a reject-only signal (409), before stock or
  // persistence; detail reads and existing-link sync still fail closed (502).
  if (use === 'selection' && rawId?.success && rawId.data === blingProductId && rawDetail?.situacao === 'E') {
    throw new BlingError(409, 'Somente produtos ativos do Bling podem ser vinculados ou importados.');
  }
  const detail = parseContract(z.object({ data: productDetailModel }), detailValue).data;
  if (detail.id !== blingProductId) throw new BlingError(502, 'Identidade do produto Bling não confere');
  if (use === 'selection' && detail.situacao !== 'A') {
    throw new BlingError(409, 'Somente produtos ativos do Bling podem ser vinculados ou importados.');
  }
  const stockQuery = new URLSearchParams({ 'idsProdutos[]': blingProductId });
  const stockValue = await bling.client.read(companyId, 'stock', stockQuery, blingProductId);
  return toBlingProductSyncSnapshot(detail, stockValue, blingProductId);
}

async function persistBlingSnapshot(
  client: PoolClient,
  companyId: string,
  productId: string,
  snapshot: BlingProductSyncSnapshot,
  expectedCurrentBlingId?: string,
) {
  const product = await client.query<{ id: string }>(
    `SELECT id FROM products
     WHERE company_id = $1 AND id = $2 AND archived_at IS NULL
     FOR UPDATE`,
    [companyId, productId],
  );
  if (!product.rows[0]) throw new ProductNotFoundError();

  const currentLink = await client.query<{ bling_product_id: string }>(
    `SELECT bling_product_id FROM product_bling_links
     WHERE company_id = $1 AND product_id = $2 FOR UPDATE`,
    [companyId, productId],
  );
  if (expectedCurrentBlingId !== undefined && currentLink.rows[0]?.bling_product_id !== expectedCurrentBlingId) {
    throw new StaleBlingLinkError();
  }

  await client.query(
    `UPDATE products SET price_cents = $3, updated_at = now()
     WHERE company_id = $1 AND id = $2 AND archived_at IS NULL`,
    [companyId, productId, snapshot.priceCents],
  );
  await client.query(
    `INSERT INTO product_bling_links
      (company_id, product_id, bling_product_id, bling_parent_product_id,
       bling_name, bling_code, bling_gtin, bling_unit, bling_price_cents,
       bling_status, bling_format, stock_physical_total, stock_virtual_total,
       last_synced_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
     ON CONFLICT (company_id, product_id) DO UPDATE SET
       bling_product_id = EXCLUDED.bling_product_id,
       bling_parent_product_id = EXCLUDED.bling_parent_product_id,
       bling_name = EXCLUDED.bling_name,
       bling_code = EXCLUDED.bling_code,
       bling_gtin = EXCLUDED.bling_gtin,
       bling_unit = EXCLUDED.bling_unit,
       bling_price_cents = EXCLUDED.bling_price_cents,
       bling_status = EXCLUDED.bling_status,
       bling_format = EXCLUDED.bling_format,
       stock_physical_total = EXCLUDED.stock_physical_total,
       stock_virtual_total = EXCLUDED.stock_virtual_total,
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = EXCLUDED.updated_at`,
    [companyId, productId, snapshot.blingProductId, snapshot.parentProductId,
      snapshot.name, snapshot.code, snapshot.gtin, snapshot.unit, snapshot.priceCents,
      snapshot.status, snapshot.format, snapshot.physicalTotal, snapshot.virtualTotal],
  );

  await client.query(
    `DELETE FROM product_bling_stock_balances WHERE company_id = $1 AND product_id = $2`,
    [companyId, productId],
  );
  for (const balance of snapshot.balances) {
    await client.query(
      `INSERT INTO product_bling_stock_balances
        (company_id, product_id, bling_warehouse_id, physical_balance, virtual_balance, synced_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [companyId, productId, balance.warehouseId, balance.physicalBalance, balance.virtualBalance],
    );
  }

  const result = await client.query<ProductRow>(
    `SELECT ${publicProductColumns} ${publicProductFrom}
     WHERE p.company_id = $1 AND p.id = $2 LIMIT 1`,
    [companyId, productId],
  );
  if (!result.rows[0]) throw new ProductNotFoundError();
  return result.rows[0]!;
}

function sendBlingOperationError(reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof BlingError) return reply.code(error.statusCode).send({ error: error.message });
  if (error instanceof ProductNotFoundError) return reply.code(404).send({ error: 'Produto não encontrado.' });
  if (error instanceof StaleBlingLinkError) return reply.code(409).send({ error: 'O vínculo Bling mudou durante a sincronização. Atualize a tela e tente novamente.' });
  if ((error as { code?: string; constraint?: string })?.code === '23505'
    && (error as { constraint?: string }).constraint === 'product_bling_links_company_sku_unique') {
    return reply.code(409).send({ error: 'Já existe um produto cadastrado no Hub com este SKU.' });
  }
  if ((error as { code?: string })?.code === '23505') return reply.code(409).send({ error: 'Este produto Bling já está vinculado a outro produto local.' });
  return null;
}

export async function registerProductRoutes(app: FastifyInstance, storage: ProductStorage, bling?: BlingDependencies) {
  app.get('/api/products', { preHandler: requireUser }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Busca de produtos inválida.' });
    const companyId = request.user!.companyId;
    const search = parsed.data.search?.trim();
    const result = await db.query<ProductRow>(
      `SELECT ${publicProductColumns} ${publicProductFrom}
       WHERE p.company_id = $1 AND p.archived_at IS NULL
         AND ($2::text IS NULL OR p.name ILIKE $2 ESCAPE '\\')
       ORDER BY lower(p.name), p.id`,
      [companyId, search ? `%${escapeLike(search)}%` : null],
    );
    const imageBaseUrl = localApiBaseForOrigin(request.headers.origin);
    return { products: result.rows.map((row) => toPublicProduct(row, storage, imageBaseUrl)) };
  });

  app.get('/api/products/bling-links', { preHandler: requireUser }, async (request) => {
    const result = await db.query<ProductBlingLinkRow>(
      `SELECT company_id, product_id, bling_product_id, bling_parent_product_id,
              bling_name, bling_code, bling_gtin, bling_unit, bling_price_cents,
              bling_status, bling_format, stock_physical_total, stock_virtual_total,
              last_synced_at, created_at, updated_at
       FROM product_bling_links
       WHERE company_id = $1
       ORDER BY product_id`,
      [request.user!.companyId],
    );
    return { links: result.rows.map(toPublicBlingLink) };
  });

  app.get('/api/products/:id', { preHandler: requireUser }, async (request, reply) => {
    const parsed = parseId(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Produto inválido.' });
    const result = await db.query<ProductRow>(
      `SELECT ${publicProductColumns} ${publicProductFrom}
       WHERE p.company_id = $1 AND p.id = $2 AND p.archived_at IS NULL LIMIT 1`,
      [request.user!.companyId, parsed.data.id],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Produto não encontrado.' });
    return { product: toPublicProduct(result.rows[0], storage, localApiBaseForOrigin(request.headers.origin)) };
  });

  app.post('/api/products/:id/bling-link', { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseId(request.params);
    const body = blingLinkBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Produto ou vínculo Bling inválido.' });
    if (!bling) return reply.code(503).send({ error: 'Integração Bling não configurada.' });

    const companyId = request.user!.companyId;
    const localProduct = await db.query<{ id: string }>(
      `SELECT id FROM products WHERE company_id = $1 AND id = $2 AND archived_at IS NULL LIMIT 1`,
      [companyId, params.data.id],
    );
    if (!localProduct.rows[0]) return reply.code(404).send({ error: 'Produto não encontrado.' });

    const existingBlingLink = await db.query<{ product_id: string }>(
      `SELECT product_id FROM product_bling_links WHERE company_id = $1 AND bling_product_id = $2 LIMIT 1`,
      [companyId, body.data.blingProductId],
    );
    if (existingBlingLink.rows[0] && existingBlingLink.rows[0].product_id !== params.data.id) {
      return reply.code(409).send({ error: 'Este produto Bling já está vinculado a outro produto local.' });
    }

    try {
      const snapshot = await fetchBlingProductSyncSnapshot(companyId, body.data.blingProductId, bling, 'selection');
      const row = await inTransaction((client) => persistBlingSnapshot(client, companyId, params.data.id, snapshot));
      return { product: toPublicProduct(row, storage, localApiBaseForOrigin(request.headers.origin)) };
    } catch (error) {
      const response = sendBlingOperationError(reply, error);
      if (response) return response;
      throw error;
    }
  });

  app.post('/api/products/:id/bling-sync', { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseId(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Produto inválido.' });
    if (request.body !== undefined && !z.object({}).strict().safeParse(request.body).success) {
      return reply.code(400).send({ error: 'A sincronização usa somente o vínculo Bling atual.' });
    }
    if (!bling) return reply.code(503).send({ error: 'Integração Bling não configurada.' });

    const companyId = request.user!.companyId;
    const current = await db.query<{ id: string; bling_product_id: string | null }>(
      `SELECT p.id, l.bling_product_id ${publicProductFrom}
       WHERE p.company_id = $1 AND p.id = $2 AND p.archived_at IS NULL LIMIT 1`,
      [companyId, params.data.id],
    );
    if (!current.rows[0]) return reply.code(404).send({ error: 'Produto não encontrado.' });
    const blingProductId = current.rows[0].bling_product_id;
    if (!blingProductId) return reply.code(409).send({ error: 'Produto sem vínculo Bling para sincronizar.' });

    try {
      const snapshot = await fetchBlingProductSyncSnapshot(companyId, blingProductId, bling, 'existing-sync');
      const row = await inTransaction((client) => persistBlingSnapshot(
        client, companyId, params.data.id, snapshot, blingProductId,
      ));
      return { product: toPublicProduct(row, storage, localApiBaseForOrigin(request.headers.origin)) };
    } catch (error) {
      const response = sendBlingOperationError(reply, error);
      if (response) return response;
      throw error;
    }
  });

  const blingImportSchema = z.object({
    blingProductId: idSchema,
    name: productNameSchema,
    imageBase64: imageBase64Schema,
    imageMimeType: imageMimeTypeSchema,
  }).strict();
  app.post('/api/products/bling-import', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = blingImportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Produto Bling, nome local e imagem válidos são obrigatórios.' });
    if (!bling) return reply.code(503).send({ error: 'Integração Bling não configurada.' });

    const companyId = request.user!.companyId;
    let snapshot: BlingProductSyncSnapshot;
    try {
      snapshot = await fetchBlingProductSyncSnapshot(companyId, parsed.data.blingProductId, bling, 'selection');
    } catch (error) {
      const response = sendBlingOperationError(reply, error);
      if (response) return response;
      throw error;
    }

    let image: ReturnType<typeof decodeProductImage>;
    try {
      image = decodeProductImage(parsed.data.imageBase64, parsed.data.imageMimeType);
    } catch (error) {
      const response = sendValidationError(reply, error);
      if (response) return response;
      throw error;
    }

    const duplicate = await db.query<{ id: string }>(
      `SELECT product_id AS id FROM product_bling_links
       WHERE company_id = $1 AND bling_product_id = $2 LIMIT 1`,
      [companyId, snapshot.blingProductId],
    );
    if (duplicate.rows[0]) return reply.code(409).send({ error: 'Este produto Bling já está importado ou vinculado.' });

    const productId = randomUUID();
    const key = imageKey(companyId, productId, image.mimeType);
    try {
      await storage.put(companyId, key, image.bytes, image.mimeType);
    } catch {
      return reply.code(503).send({ error: 'O armazenamento de imagens está indisponível.', code: 'product_storage_unavailable' });
    }

    try {
      const row = await inTransaction(async (client) => {
        await client.query(
          `INSERT INTO products
            (id, company_id, name, price_cents, currency, image_object_key, image_mime_type, image_size_bytes)
           VALUES ($1, $2, $3, $4, 'BRL', $5, $6, $7)`,
          [productId, companyId, parsed.data.name, snapshot.priceCents, key, image.mimeType, image.sizeBytes],
        );
        return persistBlingSnapshot(client, companyId, productId, snapshot);
      });
      return reply.code(201).send({ product: toPublicProduct(row, storage, localApiBaseForOrigin(request.headers.origin)) });
    } catch (error) {
      await removeNewImageBestEffort(request, storage, companyId, key);
      const response = sendBlingOperationError(reply, error);
      if (response) return response;
      throw error;
    }
  });

  app.delete('/api/products/:id/bling-link', { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseId(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Produto inválido.' });
    return reply.code(409).send({
      error: 'Produtos do Hub precisam permanecer vinculados ao Bling. Altere o produto Bling ou arquive o cadastro.',
      code: 'bling_unlink_prohibited',
    });
  });

  app.post('/api/products', { preHandler: requireAdmin }, async (request, reply) => {
    return reply.code(409).send({
      error: 'Produtos novos precisam ser selecionados no Bling.',
      code: 'bling_product_required',
    });
  });

  app.patch('/api/products/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseId(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Produto inválido.' });
    const parsed = updateProductSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Informe uma alteração válida.', code: 'invalid_product' });

    const companyId = request.user!.companyId;
    const existing = await db.query<ProductRow>(
      `SELECT ${productColumns} FROM products
       WHERE company_id = $1 AND id = $2 AND archived_at IS NULL LIMIT 1`,
      [companyId, params.data.id],
    );
    const current = existing.rows[0];
    if (!current) return reply.code(404).send({ error: 'Produto não encontrado.' });
    let image: ReturnType<typeof decodeProductImage> | undefined;
    if (parsed.data.imageBase64 && parsed.data.imageMimeType) {
      try {
        image = decodeProductImage(parsed.data.imageBase64, parsed.data.imageMimeType);
      } catch (error) {
        const response = sendValidationError(reply, error);
        if (response) return response;
        throw error;
      }
    }

    const nextKey = image ? imageKey(companyId, current.id, image.mimeType) : current.image_object_key;
    if (image) {
      try {
        await storage.put(companyId, nextKey, image.bytes, image.mimeType);
      } catch {
        return reply.code(503).send({ error: 'O armazenamento de imagens está indisponível.', code: 'product_storage_unavailable' });
      }
    }

    try {
      const row = await inTransaction(async (client) => {
        const locked = await client.query<ProductRow>(
          `SELECT ${productColumns} FROM products
           WHERE company_id = $1 AND id = $2 AND archived_at IS NULL FOR UPDATE`,
          [companyId, current.id],
        );
        const lockedProduct = locked.rows[0];
        if (!lockedProduct) throw new ProductNotFoundError();
        await client.query(
          `UPDATE products
           SET name = $3,
               image_object_key = $4,
               image_mime_type = $5,
               image_size_bytes = $6,
               updated_at = now()
           WHERE company_id = $1 AND id = $2 AND archived_at IS NULL`,
          [companyId, current.id, parsed.data.name ?? lockedProduct.name, nextKey,
            image?.mimeType ?? lockedProduct.image_mime_type,
            image?.sizeBytes ?? Number(lockedProduct.image_size_bytes)],
        );
        const result = await client.query<ProductRow>(
          `SELECT ${publicProductColumns} ${publicProductFrom}
           WHERE p.company_id = $1 AND p.id = $2 AND p.archived_at IS NULL LIMIT 1`,
          [companyId, current.id],
        );
        if (!result.rows[0]) throw new ProductNotFoundError();
        return result.rows[0]!;
      });
      return { product: toPublicProduct(row, storage, localApiBaseForOrigin(request.headers.origin)) };
    } catch (error) {
      if (image) await removeNewImageBestEffort(request, storage, companyId, nextKey);
      if (error instanceof ProductNotFoundError) return reply.code(404).send({ error: 'Produto não encontrado.' });
      throw error;
    }
  });

  app.post('/api/products/:id/archive', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = parseId(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Produto inválido.' });
    const result = await db.query<{ id: string }>(
      `UPDATE products SET archived_at = now(), updated_at = now()
       WHERE company_id = $1 AND id = $2 AND archived_at IS NULL
       RETURNING id`,
      [request.user!.companyId, parsed.data.id],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Produto não encontrado.' });
    return { archived: true, id: result.rows[0].id };
  });

  app.get('/api/products/storage', { preHandler: requireUser }, async (request, reply) => {
    const parsed = imageQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Imagem inválida.' });
    const companyId = request.user!.companyId;
    const ownedKey = await db.query(
      `SELECT 1 FROM products WHERE company_id = $1 AND image_object_key = $2
       UNION ALL
       SELECT 1 FROM message_product_refs WHERE company_id = $1 AND product_image_object_key_snapshot = $2
       LIMIT 1`,
      [companyId, parsed.data.key],
    );
    if (!ownedKey.rowCount) return reply.code(404).send({ error: 'Imagem não encontrada.' });
    const object = await storage.get(companyId, parsed.data.key);
    if (!object) return reply.code(404).send({ error: 'Imagem não encontrada no armazenamento.' });
    reply
      .type(object.mimeType)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(object.bytes);
  });
}
