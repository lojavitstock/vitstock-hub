import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { ensureQaBlingConnected, importQaProduct, nextQaBlingProductId } from './productFixtures';

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
  return importQaProduct(page.request, api, { blingProductId: nextQaBlingProductId(), name });
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

async function readBlingApiBudget(page: Page) {
  expect((await (await page.request.get(`${api}/api/qa/ready`)).json()).database).toBe('local-only');
  const pool = new Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  try { return Number((await pool.query("SELECT requests FROM bling_request_budgets WHERE budget='api'")).rows[0].requests); }
  finally { await pool.end(); }
}

async function providerSends(page: Page) {
  return (await (await page.request.get(`${api}/api/qa/evolution/sends`)).json()).sends as Array<Record<string, unknown>>;
}

test('produto pela UI: loading/double Enter, envio único, FK local, cartão e snapshot histórico', async ({ page }, testInfo) => {
  await login(page);
  const token = Date.now().toString().slice(-7);
  const name = `Produto Envio QA ${token}`;
  const contactName = `Product Send QA ${token}`;
  const remoteJid = `552199${token}@s.whatsapp.net`;
  const product = await createProduct(page, name);
  await prepareConversation(page, remoteJid, contactName);
  expect((await page.request.post(`${api}/api/integrations/bling/disconnect`)).status()).toBe(200);
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
  await expect(preview.getByLabel('Valor desta mensagem')).toHaveValue('28,00');
  await preview.getByLabel('Valor desta mensagem').fill('12,34');
  await preview.locator('[data-dialog-autofocus]').focus();
  let requests = 0;
  let clientMessageId = '';
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/evolution/messages/send-product', async (route) => {
    requests++;
    const payload = route.request().postDataJSON();
    expect(Object.keys(payload).sort()).toEqual(['clientMessageId', 'priceCentsOverride', 'productId', 'remoteJid']);
    expect(payload.priceCentsOverride).toBe(1234);
    expect(payload.remoteJid).toBe(remoteJid);
    clientMessageId = payload.clientMessageId;
    await gate;
    await route.continue();
  });
  const blingBudgetBeforeSend = await readBlingApiBudget(page);
  // Editable message pricing still shares the guarded Enter submit.
  await expect(preview.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(preview.getByRole('button', { name: 'Enviando...' })).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(preview).toBeVisible();
  expect(requests).toBe(1);
  expect(await readBlingApiBudget(page)).toBe(blingBudgetBeforeSend);
  release();
  await expect(preview).toHaveCount(0);
  const card = page.getByRole('article', { name: `Produto ${name}` });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('R$ 12,34');
  await expect(card.locator('xpath=ancestor::*[@data-message-id]').locator('p.whitespace-pre-wrap')).toHaveCount(0);
  await expect(composer).toHaveValue('Rascunho que não é a legenda');
  const refs = await readReferences(page, clientMessageId);
  expect(refs).toHaveLength(1);
  expect(refs[0]).toMatchObject({ status: 'sent', message_id: refs[0].id, product_name_snapshot: name, product_price_cents_snapshot: 1234, product_currency_snapshot: 'BRL' });
  expect(refs[0].id).not.toBe(refs[0].evolution_message_id);
  const sends = (await providerSends(page)).filter((send) => send.caption === `${name}\nR$ 12,34`);
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ number: remoteJid, mediatype: 'image', mimetype: 'image/png' });
  expect(String(sends[0].media)).toContain(encodeURIComponent(refs[0].product_image_object_key_snapshot));
  const catalogPrice = await (await page.request.get(`${api}/api/products/${product.id}`)).json();
  expect(catalogPrice.product.priceCents).toBe(2800);
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  await page.getByLabel('Buscar produto para pré-visualizar').fill(name);
  await page.getByRole('option', { name: new RegExp(name) }).click();
  const nextPreview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
  await expect(nextPreview.getByLabel('Valor desta mensagem')).toHaveValue('28,00');
  await nextPreview.getByRole('button', { name: 'Fechar prévia' }).click();
  const catalogEdit = await page.request.patch(`${api}/api/products/${product.id}`, { data: { name: `${name} editado`, imageBase64: png, imageMimeType: 'image/png' } });
  expect(catalogEdit.status()).toBe(200);
  expect((await catalogEdit.json()).product.priceCents).toBe(2800);
  await page.request.post(`${api}/api/products/${product.id}/archive`);
  await page.reload();
  await openConversation(page, contactName);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('R$ 12,34');
  await expect(card.locator('xpath=ancestor::*[@data-message-id]').locator('p.whitespace-pre-wrap')).toHaveCount(0);
  await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const after = await readReferences(page, clientMessageId);
  expect(after[0].metadata.productSnapshot).toEqual(refs[0].metadata.productSnapshot);
  await card.screenshot({ path: testInfo.outputPath('product-historical-card.png') });
  expect(errors).toEqual([]);
});

test('produto Bling: send usa cache sem provider call e sync preserva snapshots históricos', async ({ page }) => {
  await login(page);
  const pool = new Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  let productId: string | null = null;
  try {
    await page.request.post(`${api}/api/integrations/bling/disconnect`);
    const authorization = await (await page.request.post(`${api}/api/integrations/bling/connect`)).json();
    const callback = await page.request.get(authorization.url, { maxRedirects: 0 });
    expect(callback.status()).toBe(302);
    expect(callback.headers().location).toContain('bling=connected');
    await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'default' } });

    const token = Date.now().toString().slice(-7);
    const remoteJid = `552196${token}@s.whatsapp.net`;
    const product = await createProduct(page, `Linked send QA ${token}`);
    productId = product.id;
    const contactName = `Linked send contact ${token}`;
    await prepareConversation(page, remoteJid, contactName);
    const linked = await page.request.post(`${api}/api/products/${productId}/bling-link`, { data: { blingProductId: '101' } });
    expect(linked.status()).toBe(200);
    expect((await linked.json()).product).toMatchObject({ name: `Linked send QA ${token}`, priceCents: 2800, source: 'bling', bling: { name: 'Produto Bling QA' } });

    const apiBudget = async () => Number((await pool.query("SELECT requests FROM bling_request_budgets WHERE budget='api'")).rows[0].requests);
    expect((await page.request.post(`${api}/api/integrations/bling/disconnect`)).status()).toBe(200);
    const firstClientMessageId = randomUUID();
    const firstBudget = await apiBudget();
    const firstSend = await page.request.post(`${api}/api/evolution/messages/send-product`, {
      data: { productId, remoteJid, clientMessageId: firstClientMessageId },
    });
    expect(firstSend.status()).toBe(200);
    expect(await apiBudget()).toBe(firstBudget);
    const firstSnapshot = await readReferences(page, firstClientMessageId);
    expect(firstSnapshot).toHaveLength(1);
    expect(firstSnapshot[0]).toMatchObject({ product_name_snapshot: `Linked send QA ${token}`, product_price_cents_snapshot: 2800 });

    await ensureQaBlingConnected(page.request, api);
    expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'updated' } })).status()).toBe(200);
    const synced = await page.request.post(`${api}/api/products/${productId}/bling-sync`);
    expect(synced.status()).toBe(200);
    expect((await synced.json()).product).toMatchObject({ name: `Linked send QA ${token}`, priceCents: 4000, bling: { name: 'Produto Bling Atualizado QA' } });
    const preservedSnapshot = await readReferences(page, firstClientMessageId);
    expect(preservedSnapshot[0].product_name_snapshot).toBe(`Linked send QA ${token}`);
    expect(preservedSnapshot[0].product_price_cents_snapshot).toBe(2800);
    expect(preservedSnapshot[0].metadata.productSnapshot).toEqual(firstSnapshot[0].metadata.productSnapshot);

    const secondClientMessageId = randomUUID();
    const secondBudget = await apiBudget();
    const secondSend = await page.request.post(`${api}/api/evolution/messages/send-product`, {
      data: { productId, remoteJid, clientMessageId: secondClientMessageId, priceCentsOverride: 4990 },
    });
    expect(secondSend.status()).toBe(200);
    expect(await apiBudget()).toBe(secondBudget);
    const secondSnapshot = await readReferences(page, secondClientMessageId);
    expect(secondSnapshot).toHaveLength(1);
    expect(secondSnapshot[0]).toMatchObject({ product_name_snapshot: `Linked send QA ${token}`, product_price_cents_snapshot: 4990 });

    expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'price-updated' } })).status()).toBe(200);
    const newerSync = await page.request.post(`${api}/api/products/${productId}/bling-sync`);
    expect(newerSync.status()).toBe(200);
    expect((await newerSync.json()).product).toMatchObject({ name: `Linked send QA ${token}`, priceCents: 6000,
      bling: { name: 'Produto Bling Preço Atualizado QA' } });
    const historicalOverride = await readReferences(page, secondClientMessageId);
    expect(historicalOverride[0]).toMatchObject({ product_name_snapshot: `Linked send QA ${token}`, product_price_cents_snapshot: 4990 });
    await page.goto('/atendimento');
    await openConversation(page, contactName);
    await page.getByRole('button', { name: 'Produtos', exact: true }).click();
    await page.getByLabel('Buscar produto para pré-visualizar').fill(`Linked send QA ${token}`);
    await page.getByRole('option', { name: new RegExp(`Linked send QA ${token}`) }).click();
    const updatedPreview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
    await expect(updatedPreview.getByLabel('Valor desta mensagem')).toHaveValue('60,00');
    await updatedPreview.getByRole('button', { name: 'Fechar prévia' }).click();

    expect((await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'default' } })).status()).toBe(200);
    const relink = await page.request.post(`${api}/api/products/${productId}/bling-link`, { data: { blingProductId: '304' } });
    expect(relink.status()).toBe(200);
    expect((await relink.json()).product).toMatchObject({ name: `Linked send QA ${token}`, priceCents: 18000, source: 'bling', bling: { name: 'Produto Catálogo QA 304' } });
    const unlink = await page.request.delete(`${api}/api/products/${productId}/bling-link`);
    expect(unlink.status()).toBe(200);
    expect((await unlink.json()).product).toMatchObject({ name: `Linked send QA ${token}`, priceCents: 18000, source: 'manual', bling: null });
    for (const [clientMessageId, expectedName, expectedPrice] of [
      [firstClientMessageId, `Linked send QA ${token}`, 2800],
      [secondClientMessageId, `Linked send QA ${token}`, 4990],
    ] as const) {
      const historical = await readReferences(page, clientMessageId);
      expect(historical).toHaveLength(1);
      expect(historical[0]).toMatchObject({ product_name_snapshot: expectedName, product_price_cents_snapshot: expectedPrice });
    }
  } finally {
    if (productId) await page.request.post(`${api}/api/products/${productId}/archive`).catch(() => undefined);
    await page.request.post(`${api}/api/qa/bling/scenario`, { data: { scenario: 'default' } }).catch(() => undefined);
    await page.request.post(`${api}/api/integrations/bling/disconnect`).catch(() => undefined);
    await pool.end();
  }
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
  await expect(preview.locator('[data-dialog-autofocus]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  const composer = page.getByPlaceholder('Digite sua mensagem para o WhatsApp...');
  await composer.fill('');
  await composer.press('Enter');
  expect(ids).toHaveLength(0); // A valid, closed preview must not retain an Enter listener.
  await composer.fill(`\\${name}`);
  await expect(page.getByRole('listbox', { name: 'Opções de produtos' }).getByRole('option', { name: new RegExp(name) })).toBeVisible();
  await composer.press('Enter');
  await expect(preview.locator('[data-dialog-autofocus]')).toBeFocused();
  expect(ids).toHaveLength(0); // Selecting a shortcut previews; it does not send yet.
  await page.request.post(`${api}/api/qa/evolution/media-scenario`, { data: { scenario: 'reject' } });
  try {
    await page.keyboard.press('Enter');
    await expect(preview.getByRole('alert')).toContainText('Evolution API rejeitou');
    await expect(preview).toBeVisible();
    const refs = await readReferences(page, ids[0]);
    expect(refs).toHaveLength(1); expect(refs[0].status).toBe('failed');
    await expect(page.getByRole('article', { name: `Produto ${name}` })).toHaveCount(0);
  } finally {
    await page.request.post(`${api}/api/qa/evolution/media-scenario`, { data: { scenario: 'success' } });
  }
  await preview.getByRole('button', { name: 'Enviar', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
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
    expect(ownProductResponse.status()).toBe(409);
  } finally { await contextB.close(); }
  await page.request.post(`${api}/api/products/${product.id}/archive`);
  expect((await page.request.post(`${api}/api/evolution/messages/send-product`, {
    data: { productId: product.id, remoteJid: `9036${token}@lid`, clientMessageId: randomUUID() },
  })).status()).toBe(404);
});

test('preview: Enter inválido não fecha/envia, Esc e controles nativos, lifecycle e atalho direto', async ({ page }) => {
  await login(page);
  const token = Date.now().toString().slice(-7);
  const name = `Produto Teclado QA ${token}`;
  const product = await createProduct(page, name);
  let requests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/messages/send-product')) requests++; });
  await page.goto('/atendimento');
  await page.getByRole('button', { name: 'Nova mensagem', exact: true }).click();
  const newMessage = page.getByRole('dialog', { name: 'Nova mensagem' });
  await newMessage.getByRole('textbox', { name: 'Buscar nome ou digitar número' }).fill(`552197${token}`);
  await newMessage.getByRole('button', { name: /Conversar com/ }).click();
  const composer = page.getByPlaceholder('Digite sua mensagem para o WhatsApp...');
  await expect(page.getByRole('button', { name: 'Anexar arquivo' })).toBeDisabled();
  const openPicker = async () => {
    await page.getByRole('button', { name: 'Produtos', exact: true }).click();
    await page.getByLabel('Buscar produto para pré-visualizar').fill(name);
    await page.getByRole('option', { name: new RegExp(name) }).click();
  };
  await openPicker();
  const preview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
  await expect(preview.locator('[data-dialog-autofocus]')).toBeFocused();
  await expect(preview.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(preview).toBeVisible();
  expect(requests).toBe(0);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await composer.fill('');
  await composer.press('Enter');
  expect(requests).toBe(0);
  await openPicker();
  await expect(preview.locator('[data-dialog-autofocus]')).toBeFocused();
  await preview.getByRole('button', { name: 'Voltar' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Buscar produto para pré-visualizar')).toBeFocused();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await preview.getByRole('button', { name: 'Fechar prévia' }).click();
  await expect(preview).toHaveCount(0);
  await composer.fill(`\\${name}`);
  await page.getByRole('listbox', { name: 'Opções de produtos' }).getByRole('option', { name: new RegExp(name) }).click();
  await expect(preview.locator('[data-dialog-autofocus]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(preview).toBeVisible();
  expect(requests).toBe(0);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await page.request.post(`${api}/api/products/${product.id}/archive`);
});

test('timeline: imagem comum com caption de produto, texto e reply não viram cartão', async ({ page }) => {
  await login(page);
  const token = Date.now().toString().slice(-7);
  const contactName = `Timeline Caption QA ${token}`;
  const remoteJid = `552195${token}@s.whatsapp.net`;
  const caption = `Produto normal ${token}\nR$ 28,00`;
  const response = await page.request.post(`${api}/api/qa/evolution/inbound`, {
    data: { remoteJid, name: contactName, content: caption, mediaType: 'image' },
  });
  expect(response.status()).toBe(200);
  const { evolutionMessageId } = await response.json();
  await page.goto('/atendimento');
  await openConversation(page, contactName);
  const image = page.locator(`[data-message-id="${evolutionMessageId}"]`);
  await expect(image.locator('img[alt="Imagem WhatsApp"]')).toBeVisible();
  await expect(image.locator('p.whitespace-pre-wrap')).toHaveText(caption);
  await expect(image.getByRole('article')).toHaveCount(0);
  await image.getByRole('button', { name: 'Abrir ações da mensagem' }).click();
  await page.getByRole('menuitem', { name: 'Responder', exact: true }).click();
  const text = `Resposta comum QA ${token}`;
  await page.getByPlaceholder('Digite sua mensagem para o WhatsApp...').fill(text);
  await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  const reply = page.locator('[data-message-id]').filter({ has: page.locator('p.whitespace-pre-wrap', { hasText: text }) });
  await expect(reply).toHaveCount(1);
  await expect(reply.locator('p.whitespace-pre-wrap')).toHaveText(text);
  await expect(reply.getByTitle('Ir para a mensagem citada')).toContainText(caption);
  await expect(reply.getByRole('article')).toHaveCount(0);
  await page.reload();
  await openConversation(page, contactName);
  await expect(image.locator('p.whitespace-pre-wrap')).toHaveText(caption);
  await expect(reply.getByTitle('Ir para a mensagem citada')).toContainText(caption);
});
