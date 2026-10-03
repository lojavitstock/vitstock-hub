import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireUser } from './auth.js';
import type { BlingDependencies } from './bling.js';
import { BlingError, idSchema, parseContract, productDetailModel } from './blingContract.js';
import { toBlingProductLinkSnapshot } from './blingProductLink.js';
import { config, isAllowedFrontendOrigin, isLocalHost } from './config.js';
import { db } from './db.js';
import { decodeProductImage, ProductImageValidationError } from './productImageValidation.js';
import type { ProductImageMimeType } from './productImageValidation.js';
import type { ProductStorage } from './productStorage.js';

const productNameSchema = z.string().trim().min(1).max(120);
const priceCentsSchema = z.number().int().min(0).max(2_147_483_647);
const imageBase64Schema = z.string().min(1).max(1_333_336);
const imageMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);

const createProductSchema = z.object({
  name: productNameSchema,
  priceCents: priceCentsSchema,
  imageBase64: imageBase64Schema,
  imageMimeType: imageMimeTypeSchema,
}).strict();

const updateProductSchema = z.object({
  name: productNameSchema.optional(),
  priceCents: priceCentsSchema.optional(),
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
};

type ProductBlingLinkRow = {
  company_id: string;
  product_id: string;
  bling_product_id: string;
  bling_name: string;
  bling_code: string | null;
  bling_price_cents: number | null;
  bling_situacao: 'A' | 'I';
  bling_formato: 'S' | 'V' | 'E';
  last_synced_at: string;
  created_at: string;
  updated_at: string;
};

const productColumns = `id, company_id, name, price_cents, currency, image_object_key,
  image_mime_type, image_size_bytes, archived_at, created_at, updated_at`;

const localApiBaseForOrigin = (origin?: string) => {
  if (!origin || !isAllowedFrontendOrigin(origin) || !isLocalHost(origin)) return undefined;
  const url = new URL(origin);
  url.port = String(config.PORT);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.origin;
};

const toPublicProduct = (row: ProductRow, storage: ProductStorage, imageBaseUrl?: string) => ({
  id: row.id,
  name: row.name,
  priceCents: Number(row.price_cents),
  currency: 'BRL' as const,
  imageUrl: storage.buildUrl(row.image_object_key, imageBaseUrl),
  imageMimeType: row.image_mime_type,
  imageSizeBytes: Number(row.image_size_bytes),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toPublicBlingLink = (row: ProductBlingLinkRow) => ({
  productId: row.product_id,
  blingProductId: row.bling_product_id,
  blingName: row.bling_name,
  blingCode: row.bling_code,
  blingPriceCents: row.bling_price_cents === null ? null : Number(row.bling_price_cents),
  blingSituacao: row.bling_situacao,
  blingFormato: row.bling_formato,
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

export async function registerProductRoutes(app: FastifyInstance, storage: ProductStorage, bling?: BlingDependencies) {
  app.get('/api/products', { preHandler: requireUser }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Busca de produtos inválida.' });
    const companyId = request.user!.companyId;
    const search = parsed.data.search?.trim();
    const result = search
      ? await db.query<ProductRow>(
        `SELECT ${productColumns} FROM products
         WHERE company_id = $1 AND archived_at IS NULL AND name ILIKE $2 ESCAPE '\\'
         ORDER BY lower(name), id`,
        [companyId, `%${escapeLike(search)}%`],
      )
      : await db.query<ProductRow>(
        `SELECT ${productColumns} FROM products
         WHERE company_id = $1 AND archived_at IS NULL
         ORDER BY lower(name), id`,
        [companyId],
      );
    const imageBaseUrl = localApiBaseForOrigin(request.headers.origin);
    return { products: result.rows.map((row) => toPublicProduct(row, storage, imageBaseUrl)) };
  });

  app.get('/api/products/bling-links', { preHandler: requireUser }, async (request) => {
    const result = await db.query<ProductBlingLinkRow>(
      `SELECT company_id, product_id, bling_product_id, bling_name, bling_code,
              bling_price_cents, bling_situacao, bling_formato, last_synced_at,
              created_at, updated_at
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
      `SELECT ${productColumns} FROM products
       WHERE company_id = $1 AND id = $2 AND archived_at IS NULL LIMIT 1`,
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
      const value = await bling.client.read(companyId, 'product', new URLSearchParams(), body.data.blingProductId);
      const detail = parseContract(z.object({ data: productDetailModel }), value).data;
      if (detail.id !== body.data.blingProductId) throw new BlingError(502, 'Identidade do produto Bling não confere');
      const snapshot = toBlingProductLinkSnapshot(detail);
      const result = await db.query<ProductBlingLinkRow>(
        `INSERT INTO product_bling_links
          (company_id, product_id, bling_product_id, bling_name, bling_code,
           bling_price_cents, bling_situacao, bling_formato, last_synced_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
         ON CONFLICT (company_id, product_id) DO UPDATE SET
           bling_product_id = EXCLUDED.bling_product_id,
           bling_name = EXCLUDED.bling_name,
           bling_code = EXCLUDED.bling_code,
           bling_price_cents = EXCLUDED.bling_price_cents,
           bling_situacao = EXCLUDED.bling_situacao,
           bling_formato = EXCLUDED.bling_formato,
           last_synced_at = EXCLUDED.last_synced_at,
           updated_at = EXCLUDED.updated_at
         RETURNING company_id, product_id, bling_product_id, bling_name, bling_code,
                   bling_price_cents, bling_situacao, bling_formato, last_synced_at,
                   created_at, updated_at`,
        [companyId, params.data.id, snapshot.blingProductId, snapshot.blingName, snapshot.blingCode,
          snapshot.blingPriceCents, snapshot.blingSituacao, snapshot.blingFormato],
      );
      return { link: toPublicBlingLink(result.rows[0]!) };
    } catch (error) {
      if (error instanceof BlingError) return reply.code(error.statusCode).send({ error: error.message });
      if ((error as { code?: string })?.code === '23505') return reply.code(409).send({ error: 'Este produto Bling já está vinculado a outro produto local.' });
      throw error;
    }
  });

  app.delete('/api/products/:id/bling-link', { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseId(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Produto inválido.' });
    const result = await db.query<{ product_id: string }>(
      `DELETE FROM product_bling_links WHERE company_id = $1 AND product_id = $2 RETURNING product_id`,
      [request.user!.companyId, params.data.id],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Vínculo Bling não encontrado.' });
    return { unlinked: true, productId: result.rows[0].product_id };
  });

  app.post('/api/products', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Informe nome, valor em centavos e imagem válidos.', code: 'invalid_product' });
    let image;
    try {
      image = decodeProductImage(parsed.data.imageBase64, parsed.data.imageMimeType);
    } catch (error) {
      const response = sendValidationError(reply, error);
      if (response) return response;
      throw error;
    }

    const companyId = request.user!.companyId;
    const id = randomUUID();
    const key = imageKey(companyId, id, image.mimeType);
    try {
      await storage.put(companyId, key, image.bytes, image.mimeType);
    } catch {
      return reply.code(503).send({ error: 'O armazenamento de imagens está indisponível.', code: 'product_storage_unavailable' });
    }
    try {
      const result = await db.query<ProductRow>(
        `INSERT INTO products (id, company_id, name, price_cents, currency, image_object_key, image_mime_type, image_size_bytes)
         VALUES ($1, $2, $3, $4, 'BRL', $5, $6, $7)
         RETURNING ${productColumns}`,
        [id, companyId, parsed.data.name, parsed.data.priceCents, key, image.mimeType, image.sizeBytes],
      );
      return reply.code(201).send({ product: toPublicProduct(result.rows[0]!, storage, localApiBaseForOrigin(request.headers.origin)) });
    } catch (error) {
      await removeNewImageBestEffort(request, storage, companyId, key);
      throw error;
    }
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
      const result = await db.query<ProductRow>(
        `UPDATE products
         SET name = $3,
             price_cents = $4,
             image_object_key = $5,
             image_mime_type = $6,
             image_size_bytes = $7,
             updated_at = now()
         WHERE company_id = $1 AND id = $2 AND archived_at IS NULL
         RETURNING ${productColumns}`,
        [companyId, current.id, parsed.data.name ?? current.name, parsed.data.priceCents ?? Number(current.price_cents), nextKey, image?.mimeType ?? current.image_mime_type, image?.sizeBytes ?? Number(current.image_size_bytes)],
      );
      if (!result.rows[0]) {
        if (image) await removeNewImageBestEffort(request, storage, companyId, nextKey);
        return reply.code(404).send({ error: 'Produto não encontrado.' });
      }
      return { product: toPublicProduct(result.rows[0], storage, localApiBaseForOrigin(request.headers.origin)) };
    } catch (error) {
      if (image) await removeNewImageBestEffort(request, storage, companyId, nextKey);
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
