import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const { Pool } = createRequire(import.meta.url)('../../server/node_modules/pg');
const api = process.env.VITE_API_URL || 'http://localhost:3001';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function login(page: Page) {
  expect(new URL(api).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const marker = await page.request.get(`${api}/api/qa/ready`);
  expect(await marker.json()).toMatchObject({ qaMode: true, database: 'local-only', evolution: 'mock-only' });
  const response = await page.request.post(`${api}/api/auth/login`, { data: { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD } });
  expect(response.status()).toBe(200);
}

async function createProduct(page: Page, name: string) {
  const response = await page.request.post(`${api}/api/products`, {
    data: { name, priceCents: 2800, imageBase64: png, imageMimeType: 'image/png' },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).product;
}

async function prepareConversation(page: Page, remoteJid: string, name: string) {
  const response = await page.request.post(`${api}/api/qa/evolution/inbound`, {
    data: { remoteJid, name, content: 'Conversa de teste de produto', isGroup: remoteJid.endsWith('@g.us') },
  });
  expect(response.status()).toBe(200);
}

async function openConversation(page: Page, name: string) {
  const conversation = page.getByRole('button', { name: `Abrir conversa com ${name}` });
  await expect.poll(async () => {
    if (await conversation.isVisible().catch(() => false)) return true;
    const sync = page.getByRole('button', { name: 'Sincronizar Mensagens' });
    if (await sync.isEnabled().catch(() => false)) await sync.click();
    return conversation.isVisible().catch(() => false);
  }, { timeout: 20_000, intervals: [500, 1500, 3000] }).toBe(true);
  await conversation.click();
}

async function readReferences(page: Page, clientMessageId: string) {
  // Never uses DATABASE_URL or .env.local: the QA marker is checked before a fixed, local-only connection.
  expect((await (await page.request.get(`${api}/api/qa/ready`)).json()).database).toBe('local-only');
  const pool = new Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  try {
    const result = await pool.query(`SELECT m.id, m.status, m.metadata, m.evolution_message_id, r.message_id,
      r.product_name_snapshot, r.product_price_cents_snapshot, r.product_currency_snapshot, r.product_image_object_key_snapshot
      FROM messages m LEFT JOIN message_product_refs r ON r.message_id = m.id AND r.company_id = m.company_id
      WHERE m.metadata->>'clientMessageId' = $1`, [clientMessageId]);
    return result.rows;
  } finally { await pool.end(); }
}

async function providerSends(page: Page) {
  return (await (await page.request.get(`${api}/api/qa/evolution/sends`)).json()).sends as Array<Record<string, unknown>>;
}

test('produto pela UI: loading/double click, envio único, FK local, cartão e snapshot histórico', async ({ page }, testInfo) => {
  await login(page);
  const token = Date.now().toString().slice(-7);
  const name = `Produto Envio QA ${token}`;
  const contactName = `Product Send QA ${token}`;
  const remoteJid = `552199${token}@s.whatsapp.net`;
  const product = await createProduct(page, name);
  await prepareConversation(page, remoteJid, contactName);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/atendimento');
  await openConversation(page, contactName);
  const composer = page.getByPlaceholder('Digite sua mensagem para o WhatsApp...');
  await composer.fill('Rascunho que não é a legenda');
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  await page.getByLabel('Buscar produto para pré-visualizar').fill(name);
  await page.getByRole('option', { name: new RegExp(name) }).click();
  const preview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
  let requests = 0;
  let clientMessageId = '';
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/evolution/messages/send-product', async (route) => {
    requests++;
    const payload = route.request().postDataJSON();
    expect(Object.keys(payload).sort()).toEqual(['clientMessageId', 'productId', 'remoteJid']);
    expect(payload.remoteJid).toBe(remoteJid);
    clientMessageId = payload.clientMessageId;
    await gate;
    await route.continue();
  });
  await preview.getByRole('button', { name: 'Enviar', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(preview.getByRole('button', { name: 'Enviando...' })).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  release();
  await expect(preview).toHaveCount(0);
  const card = page.getByRole('article', { name: `Produto ${name}` });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('R$ 28,00');
  await expect(composer).toHaveValue('Rascunho que não é a legenda');
  const refs = await readReferences(page, clientMessageId);
  expect(refs).toHaveLength(1);
  expect(refs[0]).toMatchObject({ status: 'sent', message_id: refs[0].id, product_name_snapshot: name, product_price_cents_snapshot: 2800, product_currency_snapshot: 'BRL' });
  expect(refs[0].id).not.toBe(refs[0].evolution_message_id);
  const sends = (await providerSends(page)).filter((send) => send.caption === `${name}\nR$ 28,00`);
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ number: remoteJid, mediatype: 'image', mimetype: 'image/png' });
  expect(String(sends[0].media)).toContain(encodeURIComponent(refs[0].product_image_object_key_snapshot));
  await page.request.patch(`${api}/api/products/${product.id}`, { data: { name: `${name} editado`, priceCents: 9999, imageBase64: png, imageMimeType: 'image/png' } });
  await page.request.post(`${api}/api/products/${product.id}/archive`);
  await page.reload();
  await openConversation(page, contactName);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('R$ 28,00');
  await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const after = await readReferences(page, clientMessageId);
  expect(after[0].metadata.productSnapshot).toEqual(refs[0].metadata.productSnapshot);
  await card.screenshot({ path: testInfo.outputPath('product-historical-card.png') });
  expect(errors).toEqual([]);
});

test('produto: provider failure mantém preview/erro, registro failed e retry idempotente', async ({ page }) => {
  await login(page);
  const token = Date.now().toString().slice(-7);
  const name = `Produto Falha QA ${token}`;
  const contactName = `Product Failure QA ${token}`;
  const remoteJid = `552198${token}@s.whatsapp.net`;
  const product = await createProduct(page, name);
  await prepareConversation(page, remoteJid, contactName);
  await page.goto('/atendimento');
  await openConversation(page, contactName);
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  await page.getByLabel('Buscar produto para pré-visualizar').fill(name);
  await page.getByRole('option', { name: new RegExp(name) }).click();
  const preview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
  const ids: string[] = [];
  page.on('request', (event) => { if (event.url().endsWith('/messages/send-product')) ids.push(event.postDataJSON().clientMessageId); });
  await page.request.post(`${api}/api/qa/evolution/media-scenario`, { data: { scenario: 'reject' } });
  try {
    await preview.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(preview.getByRole('alert')).toContainText('Evolution API rejeitou');
    await expect(preview).toBeVisible();
    const refs = await readReferences(page, ids[0]);
    expect(refs).toHaveLength(1); expect(refs[0].status).toBe('failed');
    await expect(page.getByRole('article', { name: `Produto ${name}` })).toHaveCount(0);
  } finally {
    await page.request.post(`${api}/api/qa/evolution/media-scenario`, { data: { scenario: 'success' } });
  }
  await preview.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(ids).toHaveLength(2); expect(ids[1]).toBe(ids[0]);
  const refs = await readReferences(page, ids[0]); expect(refs).toHaveLength(1); expect(refs[0].status).toBe('sent');
  await expect(page.getByRole('article', { name: `Produto ${name}` })).toHaveCount(1);
  await page.request.post(`${api}/api/products/${product.id}/archive`);
});

test('produto: destinos LID e grupo exatos, dedup e autoridade de tenant', async ({ page }) => {
  await login(page);
  const token = Date.now().toString().slice(-7);
  const name = `Produto Identity QA ${token}`;
  const product = await createProduct(page, name);
  for (const remoteJid of [`9036${token}@lid`, `120363${token}@g.us`]) {
    await prepareConversation(page, remoteJid, `Product Identity ${remoteJid}`);
    const payload = { productId: product.id, remoteJid, clientMessageId: randomUUID() };
    const send = () => page.request.post(`${api}/api/evolution/messages/send-product`, { data: payload });
    const responses = await Promise.all([send(), send()]);
    for (const response of responses) expect(response.status()).toBe(200);
    expect((await send()).status()).toBe(200);
    const calls = (await providerSends(page)).filter((entry) => entry.number === remoteJid && entry.caption === `${name}\nR$ 28,00`);
    expect(calls).toHaveLength(1);
    const refs = await readReferences(page, payload.clientMessageId); expect(refs).toHaveLength(1); expect(refs[0].message_id).toBe(refs[0].id);
  }
  const invalidDestination = await page.request.post(`${api}/api/evolution/messages/send-product`, {
    data: { productId: product.id, remoteJid: '903699999999999@lid', clientMessageId: randomUUID() },
  });
  expect(invalidDestination.status()).toBe(404);
  const contextB = await page.context().browser()!.newContext();
  try {
    expect((await contextB.request.post(`${api}/api/auth/login`, { data: { email: 'qa-admin-b@vitstock.test', password: process.env.E2E_PASSWORD } })).status()).toBe(200);
    expect((await contextB.request.post(`${api}/api/evolution/messages/send-product`, {
      data: { productId: product.id, remoteJid: `9036${token}@lid`, clientMessageId: randomUUID() },
    })).status()).toBe(404);
    const ownProductResponse = await contextB.request.post(`${api}/api/products`, {
      data: { name: `Produto Tenant B ${token}`, priceCents: 100, imageBase64: png, imageMimeType: 'image/png' },
    });
    expect(ownProductResponse.status()).toBe(201);
    const ownProduct = (await ownProductResponse.json()).product;
    expect((await contextB.request.post(`${api}/api/evolution/messages/send-product`, {
      data: { productId: ownProduct.id, remoteJid: `9036${token}@lid`, clientMessageId: randomUUID() },
    })).status()).toBe(404);
    await contextB.request.post(`${api}/api/products/${ownProduct.id}/archive`);
  } finally { await contextB.close(); }
  await page.request.post(`${api}/api/products/${product.id}/archive`);
  expect((await page.request.post(`${api}/api/evolution/messages/send-product`, {
    data: { productId: product.id, remoteJid: `9036${token}@lid`, clientMessageId: randomUUID() },
  })).status()).toBe(404);
});
