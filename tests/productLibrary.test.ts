import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { findProductToken } from '../src/utils/productShortcut';
import { findQuickReplyToken, insertQuickReplyAtToken } from '../src/utils/quickReplies';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { decodeProductImage, ProductImageValidationError } from '../server/src/productImageValidation.js';
import { InMemoryProductStorage, R2ProductStorage, selectProductStorage } from '../server/src/productStorage.js';
import { ProductMessageCard } from '../src/components/conversations/ProductMessageCard';
import { productCaption, productSendSchema } from '../server/src/productSend.js';
import {
  formatBrlPrice,
  formatBrlPriceInput,
  isProductMessageSnapshot,
  normalizeBrlPriceDigits,
  parseBrlPriceCents,
  productStorageImageUrl,
} from '../src/utils/productLibrary';

const pngBytes = Buffer.from('89504e470d0a1a0a0000000049454e44', 'hex');

test('product send caption is deterministic and transport requires explicit existing identity', () => {
  const snapshot = { productId: '10000000-0000-4000-8000-000000000001', name: 'V-Floc 500ml', priceCents: 129900,
    currency: 'BRL' as const, imageObjectKey: 'products/tenant/product/image.png', imageMimeType: 'image/png' as const };
  assert.equal(productCaption(snapshot), 'V-Floc 500ml\nR$ 1.299,00');
  for (const remoteJid of ['5521999000001@s.whatsapp.net', '90360000@lid', '120363000001@g.us']) {
    assert.equal(productSendSchema.safeParse({ productId: snapshot.productId, remoteJid, clientMessageId: 'product-client-1' }).success, true);
  }
  assert.equal(productSendSchema.safeParse({ productId: snapshot.productId, remoteJid: 'status@broadcast', clientMessageId: 'product-client-1' }).success, false);
  assert.equal(productSendSchema.safeParse({ productId: snapshot.productId, number: '5521999000001', clientMessageId: 'product-client-1' }).success, false);
});

test('atalho de produto aceita nome com espaços, preserva texto e não muda o token de Quick Replies', () => {
  const value = 'Confira \\Produto amarelo depois';
  const cursor = value.indexOf(' depois');
  const token = findProductToken(value, cursor)!;
  assert.equal(token.value, '\\Produto amarelo');
  assert.deepEqual(insertQuickReplyAtToken(value, token, ''), { value: 'Confira  depois', cursor: 8 });
  assert.deepEqual(findProductToken('\\', 1), { start: 0, end: 1, value: '\\' });
  assert.equal(findProductToken('C:\\arquivo', 10), null);
  assert.equal(findProductToken('/saudacao', 9), null);
  assert.equal(findProductToken('\\Produto\nnova linha', 19), null);
  assert.deepEqual(findQuickReplyToken('Olá /saudacao', 12), { start: 4, end: 12, value: '/saudaca' });
  assert.equal(findQuickReplyToken('\\produto', 8), null);
});

test('produto valida imagens JPEG, PNG e WebP por assinatura e MIME real', () => {
  const cases = [
    { bytes: Buffer.from('ffd8ff010203', 'hex'), mime: 'image/jpeg' },
    { bytes: pngBytes, mime: 'image/png' },
    { bytes: Buffer.from('524946460000000057454250', 'hex'), mime: 'image/webp' },
  ] as const;
  for (const item of cases) {
    const decoded = decodeProductImage(item.bytes.toString('base64'), item.mime);
    assert.equal(decoded.mimeType, item.mime);
    assert.deepEqual(decoded.bytes, item.bytes);
    assert.equal(decoded.sizeBytes, item.bytes.length);
  }
});

test('migration modela produtos, arquivamento e snapshots tenant-safe para mensagens futuras', async () => {
  const migration = await readFile(new URL('../server/migrations/021_product_library.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS products/);
  assert.match(migration, /company_id UUID NOT NULL REFERENCES companies\(id\) ON DELETE CASCADE/);
  assert.match(migration, /price_cents INTEGER NOT NULL CHECK \(price_cents >= 0\)/);
  assert.match(migration, /currency CHAR\(3\) NOT NULL DEFAULT 'BRL' CHECK \(currency = 'BRL'\)/);
  assert.match(migration, /image_size_bytes INTEGER NOT NULL CHECK \(image_size_bytes BETWEEN 1 AND 1000000\)/);
  assert.match(migration, /archived_at TIMESTAMPTZ/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS message_product_refs/);
  assert.match(migration, /product_name_snapshot TEXT NOT NULL/);
  assert.match(migration, /product_price_cents_snapshot INTEGER NOT NULL CHECK \(product_price_cents_snapshot >= 0\)/);
  assert.match(migration, /product_image_object_key_snapshot TEXT NOT NULL/);
  assert.match(migration, /FOREIGN KEY \(company_id, message_id\) REFERENCES messages\(company_id, id\)/);
  assert.match(migration, /FOREIGN KEY \(company_id, product_id\) REFERENCES products\(company_id, id\)/);
});

test('produto rejeita base64 vazio, malformado, MIME spoof e payload acima de 1 MB', () => {
  assert.throws(() => decodeProductImage('', 'image/png'), ProductImageValidationError);
  assert.throws(() => decodeProductImage('not base64', 'image/png'), ProductImageValidationError);
  assert.throws(() => decodeProductImage(pngBytes.toString('base64'), 'image/jpeg'), /não corresponde/);
  const oversized = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(1_000_001)]);
  assert.throws(() => decodeProductImage(oversized.toString('base64'), 'image/png'), /1 MB/);
});

test('fake product storage é efêmero, isolado por empresa, copia bytes e reporta falha de gravação', async () => {
  const storage = new InMemoryProductStorage('http://127.0.0.1:3001');
  const bytes = Buffer.from('example image bytes');
  await storage.put('company-a', 'a/product/image.png', bytes, 'image/png');
  bytes[0] = 0;
  assert.equal(await storage.exists('company-a', 'a/product/image.png'), true);
  assert.equal(await storage.get('company-b', 'a/product/image.png'), null);
  assert.equal((await storage.get('company-a', 'a/product/image.png'))?.bytes.toString(), 'example image bytes');
  assert.equal(storage.buildUrl('a/product/image.png'), 'http://127.0.0.1:3001/api/products/storage?key=a%2Fproduct%2Fimage.png');
  await storage.remove('company-b', 'a/product/image.png');
  assert.equal(await storage.exists('company-a', 'a/product/image.png'), true);
  await storage.remove('company-a', 'a/product/image.png');
  assert.equal(await storage.exists('company-a', 'a/product/image.png'), false);

  const failingStorage = new InMemoryProductStorage('http://localhost:3001', () => true);
  await assert.rejects(failingStorage.put('company-a', 'key', Buffer.from('x'), 'image/png'), /write failed/);
});

const r2Config = {
  accountId: 'a'.repeat(32),
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key-never-printed',
  bucket: 'vitstock-hub-products-preview',
  publicBaseUrl: 'https://media-preview.vitstock.com.br/',
};

const mockS3Client = (send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => Promise<unknown>) => ({
  send: (command: unknown) => send(command as { constructor: { name: string }; input: Record<string, unknown> }),
  destroy: () => undefined,
}) as never;

test('R2 product storage exige configuração completa e nunca ativa sem driver explícito', () => {
  assert.throws(
    () => new R2ProductStorage({ ...r2Config, accessKeyId: '' }, mockS3Client(async () => ({}))),
    /R2_ACCESS_KEY_ID/,
  );
  assert.throws(
    () => new R2ProductStorage({ ...r2Config, publicBaseUrl: 'https://bucket.r2.dev' }, mockS3Client(async () => ({}))),
    /r2\.dev/,
  );
  assert.throws(
    () => new R2ProductStorage({ ...r2Config, publicBaseUrl: 'https://r2.dev' }, mockS3Client(async () => ({}))),
    /r2\.dev/,
  );

  const defaultMemory = selectProductStorage({
    allowMemory: true,
    memoryBaseUrl: 'http://127.0.0.1:3001',
    r2: r2Config,
  });
  assert.ok(defaultMemory instanceof InMemoryProductStorage);
  assert.equal(selectProductStorage({ allowMemory: false, memoryBaseUrl: 'http://localhost:3001', r2: r2Config }), null);
  assert.throws(
    () => selectProductStorage({ driver: 'memory', allowMemory: false, memoryBaseUrl: 'http://localhost:3001', r2: r2Config }),
    /only allowed for local or QA/,
  );
  assert.throws(
    () => selectProductStorage({ driver: 'r2', allowMemory: true, memoryBaseUrl: 'http://localhost:3001', r2: { ...r2Config, bucket: '' } }),
    /R2_BUCKET/,
  );
});

test('R2 product storage gera URL pública confiável e aplica PUT/GET/HEAD/DELETE', async () => {
  const commands: Array<{ constructor: { name: string }; input: Record<string, unknown> }> = [];
  const storage = new R2ProductStorage(r2Config, mockS3Client(async (command) => {
    commands.push(command);
    if (command.constructor.name === 'GetObjectCommand') {
      return {
        ContentType: 'image/png',
        Body: { transformToByteArray: async () => Uint8Array.from(pngBytes) },
      };
    }
    return {};
  }));
  const key = 'products/company-a/product-id/image-id.png';
  const bytes = Buffer.from(pngBytes);

  await storage.put('company-a', key, bytes, 'image/png');
  assert.equal(commands[0]?.constructor.name, 'PutObjectCommand');
  assert.equal(commands[0]?.input.Bucket, r2Config.bucket);
  assert.equal(commands[0]?.input.Key, key);
  assert.deepEqual(commands[0]?.input.Body, bytes);
  assert.equal(commands[0]?.input.ContentType, 'image/png');
  assert.equal(commands[0]?.input.ACL, undefined);
  assert.equal(commands[0]?.input.Metadata, undefined);

  assert.deepEqual(await storage.get('company-a', key), { bytes: pngBytes, mimeType: 'image/png' });
  assert.equal(commands[1]?.constructor.name, 'GetObjectCommand');
  assert.equal(await storage.exists('company-a', key), true);
  assert.equal(commands[2]?.constructor.name, 'HeadObjectCommand');
  await storage.remove('company-a', key);
  assert.equal(commands[3]?.constructor.name, 'DeleteObjectCommand');
  assert.equal(storage.buildUrl(key, 'http://localhost:3001'), `https://media-preview.vitstock.com.br/${key}`);
  storage.close();
});

test('R2 product storage trata 404 como ausente, propaga falhas e bloqueia chave de outro tenant', async () => {
  const missingError = Object.assign(new Error('Not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
  const commands: Array<{ constructor: { name: string }; input: Record<string, unknown> }> = [];
  const storage = new R2ProductStorage(r2Config, mockS3Client(async (command) => {
    commands.push(command);
    if (command.constructor.name === 'GetObjectCommand' || command.constructor.name === 'HeadObjectCommand') throw missingError;
    return {};
  }));
  const key = 'products/company-a/product-id/image-id.png';
  assert.equal(await storage.get('company-a', key), null);
  assert.equal(await storage.exists('company-a', key), false);
  assert.equal(await storage.get('company-b', key), null);
  assert.equal(await storage.exists('company-b', key), false);
  await storage.remove('company-b', key);
  assert.equal(commands.length, 2);

  const unavailable = Object.assign(new Error('R2 unavailable'), { name: 'ServiceUnavailable', $metadata: { httpStatusCode: 503 } });
  const failingStorage = new R2ProductStorage(r2Config, mockS3Client(async () => { throw unavailable; }));
  await assert.rejects(failingStorage.exists('company-a', key), /R2 unavailable/);
  await assert.rejects(failingStorage.get('company-a', key), /R2 unavailable/);
  await assert.rejects(failingStorage.remove('company-a', key), /R2 unavailable/);
  await assert.rejects(failingStorage.put('company-b', key, pngBytes, 'image/png'), /not scoped to the company/);
  storage.close();
  failingStorage.close();
});

test('preço BRL usa centavos inteiros e máscara previsível', () => {
  assert.equal(normalizeBrlPriceDigits('3990'), '3990');
  assert.equal(parseBrlPriceCents('3990'), 3990);
  assert.equal(formatBrlPriceInput('3990'), 'R$ 39,90');
  assert.equal(parseBrlPriceCents('129900'), 129900);
  assert.equal(formatBrlPriceInput('129900'), 'R$ 1.299,00');
  assert.equal(parseBrlPriceCents('0'), 0);
  assert.equal(parseBrlPriceCents(''), null);
  assert.equal(parseBrlPriceCents('2147483648'), null);
  assert.equal(formatBrlPrice(3990), 'R$ 39,90');
});

test('timeline diferencia produto por snapshot estruturado, não por imagem comum', () => {
  const snapshot = {
    productId: 'product-1',
    name: 'V-Floc 500ml',
    priceCents: 3990,
    currency: 'BRL',
    imageObjectKey: 'company/product/image.png',
  };
  assert.equal(isProductMessageSnapshot(snapshot), true);
  assert.equal(isProductMessageSnapshot({ ...snapshot, priceCents: -1 }), false);
  assert.equal(isProductMessageSnapshot({ mediaType: 'image', caption: 'V-Floc 500ml' }), false);
  assert.equal(productStorageImageUrl(snapshot.imageObjectKey), 'http://localhost:3001/api/products/storage?key=company%2Fproduct%2Fimage.png');

  const html = renderToStaticMarkup(React.createElement(ProductMessageCard, { snapshot }));
  assert.match(html, /aria-label="Produto V-Floc 500ml"/);
  assert.match(html, /R\$ 39,90/);
  assert.match(html, /api\/products\/storage\?key=company%2Fproduct%2Fimage.png/);
});
