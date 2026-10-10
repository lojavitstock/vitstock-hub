import { expect, request, test, type Locator, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { deleteQaProductFixture, ensureQaBlingConnected, importQaProduct, nextQaBlingProductId } from './productFixtures';

const { Pool } = createRequire(import.meta.url)('../../server/node_modules/pg');

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;
const secondEmail = process.env.E2E_SECOND_EMAIL?.trim();
const secondPassword = process.env.E2E_SECOND_PASSWORD;
const apiUrl = process.env.VITE_API_URL || 'http://localhost:3001';
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const productFixturesForCleanup = new Set<string>();

test.afterEach(async ({ request }) => {
  for (const productId of productFixturesForCleanup) {
    await deleteQaProductFixture(request, apiUrl, productId).catch(() => undefined);
  }
  productFixturesForCleanup.clear();
});

const login = async (page: import('@playwright/test').Page, credentials = { email, password }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(credentials.email!);
  await page.getByLabel('Senha').fill(credentials.password!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);
};

const uploadValidProductImage = async (page: Page) => {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#eebb2c';
    context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"][aria-label="Imagem do produto"]').setInputFiles({
    name: 'produto-qa.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64'),
  });
};

const pasteImageIntoProductForm = async (dialog: Locator, mimeType: string, dataUrl: string, oversized = false) => {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return dialog.getByLabel('Nome local *').evaluate((input, payload) => {
    const source = Uint8Array.from(atob(payload.base64), (character) => character.charCodeAt(0));
    const bytes = payload.oversized ? new Uint8Array(1_000_001) : source;
    if (payload.oversized) bytes.set(source.slice(0, Math.min(source.length, bytes.length)));
    const file = new File([bytes], 'clipboard-image', { type: payload.mimeType });
    const item = { type: payload.mimeType, getAsFile: () => file };
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: [item] } });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  }, { base64, mimeType, oversized });
};

const pastePlainTextIntoProductName = async (page: Page, dialog: Locator, text: string) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  const name = dialog.getByLabel('Nome local *');
  await name.focus();
  await name.press('Control+V');
};

const openFreshProductConversation = async (page: Page) => {
  // Shared Ana QA may carry media/leases from other suites; product UX needs its own fixture.
  expect(new URL(apiUrl).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const admin = await request.newContext();
  const name = `Picker QA ${Date.now()}`;
  try {
    const marker = await admin.get(`${apiUrl}/api/qa/ready`);
    expect(await marker.json()).toMatchObject({ qaMode: true, evolution: 'mock-only' });
    expect((await admin.post(`${apiUrl}/api/auth/login`, { data: { email, password } })).status()).toBe(200);
    expect((await admin.post(`${apiUrl}/api/qa/evolution/inbound`, { data: {
      remoteJid: `552197${Date.now().toString().slice(-7)}@s.whatsapp.net`, name, content: 'Fixture isolada de Produtos',
    } })).status()).toBe(200);
  } finally { await admin.dispose(); }
  const conversation = page.getByRole('button', { name: `Abrir conversa com ${name}`, exact: true });
  await expect.poll(async () => {
    if (await conversation.isVisible().catch(() => false)) return true;
    const sync = page.getByRole('button', { name: 'Sincronizar Mensagens' });
    if (await sync.isEnabled().catch(() => false)) await sync.click();
    return conversation.isVisible().catch(() => false);
  }, { timeout: 20_000, intervals: [500, 1500, 3000] }).toBe(true);
  await conversation.click();
  return name;
};

test('+ abre cadastro na mesma aba SPA e retorno preserva atendimento sem enviar', async ({ page }, testInfo) => {
  test.skip(!email || !password, 'credenciais QA ausentes');
  const errors: string[] = [];
  const sends: string[] = [];
  let hubBlingRequests = 0;
  await login(page);
  await ensureQaBlingConnected(page.request, apiUrl);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (event) => {
    if (event.method() !== 'GET' && /\/api\/evolution\/(?:messages|media)\//.test(event.url())) sends.push(event.url());
    if (new URL(event.url()).pathname.startsWith('/api/integrations/bling/')) hubBlingRequests += 1;
  });
  const conversationName = await openFreshProductConversation(page);
  await expect(page.getByRole('heading', { name: new RegExp(`^${conversationName}(?:\\s|$)`) })).toBeVisible();
  const composer = page.getByPlaceholder('Digite sua mensagem para o WhatsApp...');
  await composer.fill('Rascunho preservado');
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'rascunho.png', mimeType: 'image/png', buffer: Buffer.from(tinyPng, 'base64') });
  await expect(page.getByTestId('attachment-draft')).toHaveCount(1);
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Produtos', exact: true });
  const add = picker.getByRole('button', { name: 'Adicionar produto', exact: true });
  const bounds = await add.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(add).toBeInViewport();
  await picker.screenshot({ path: testInfo.outputPath('picker-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  const originalPages = page.context().pages().length;
  const documentToken = `spa-${Date.now()}`;
  await page.evaluate((token) => { (window as any).__sameTabDocument = token; }, documentToken);
  await add.click();
  const settings = page;
  await expect(settings.getByRole('dialog', { name: 'Adicionar produto' })).toBeVisible();
  await expect(settings).toHaveURL(/\/configuracoes\?tab=products$/);
  expect(page.context().pages()).toHaveLength(originalPages);
  expect(await page.evaluate(() => (window as any).__sameTabDocument)).toBe(documentToken);
  const name = `Atalho Produto QA ${Date.now()}`;
  let id = '';
  try {
    const addDialog = settings.getByRole('dialog', { name: 'Adicionar produto' });
    await addDialog.getByLabel('Buscar produto no Bling para importar').fill('Produto Catálogo QA 322');
    await addDialog.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
    await addDialog.getByRole('button', { name: /Produto Catálogo QA 322/ }).click();
    await expect(addDialog.getByLabel('Nome local *')).toBeEnabled();
    await expect(addDialog.getByLabel('Preço no Bling')).toBeDisabled();
    await expect(addDialog.getByLabel('SKU')).toHaveValue('SKU-322');
    await expect(addDialog.getByLabel('Estoque virtual')).toHaveValue('5');
    await addDialog.getByLabel('Nome local *').fill(name);
    await addDialog.getByLabel('Imagem local para importação').setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: Buffer.from(tinyPng, 'base64') });
    const saved = settings.waitForResponse((response) => new URL(response.url()).pathname === '/api/products/bling-import' && response.request().method() === 'POST');
    await settings.getByRole('button', { name: 'Salvar produto' }).click();
    id = (await (await saved).json()).product.id;
    await expect(settings.getByText(`Produto Bling importado: “${name}”.`, { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/atendimento$/);
    expect(await page.evaluate(() => (window as any).__sameTabDocument)).toBe(documentToken);
    await expect(picker).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(`^${conversationName}(?:\\s|$)`) })).toBeVisible();
    await picker.getByLabel('Buscar produto para pré-visualizar').fill(name);
    await expect(picker.getByRole('option', { name: new RegExp(name) })).toBeVisible();
    await picker.getByRole('button', { name: 'Cancelar' }).click();
    await expect(composer).toHaveValue('Rascunho preservado');
    await expect(page.getByTestId('attachment-draft')).toHaveCount(1);
    await expect.poll(() => page.getByTestId('attachment-draft').locator('img')
      .evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const blingRequestsBeforeSuggestions = hubBlingRequests;
    await composer.fill(`Confira \\${name}`);
    const suggestions = page.getByRole('dialog', { name: 'Sugestões de produtos' });
    const option = suggestions.getByRole('option', { name: new RegExp(name) });
    await expect(option).toBeVisible();
    await expect(option).toContainText('R$ 180,00');
    await expect(option).toContainText('Qtd: 5');
    await expect(option).not.toContainText(/SKU|Estoque/i);
    const suggestionPrice = option.getByText('R$ 180,00', { exact: true });
    const suggestionQuantity = option.getByText('Qtd: 5', { exact: true });
    const priceAndQuantityRow = suggestionPrice.locator('..');
    await expect(priceAndQuantityRow.getByText('Qtd: 5', { exact: true })).toHaveCount(1);
    expect(await priceAndQuantityRow.getAttribute('class')).toContain('justify-between');
    expect(await suggestionQuantity.getAttribute('class')).not.toContain('text-red-300');
    await expect.poll(() => option.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    await suggestions.screenshot({ path: testInfo.outputPath('product-suggestions.png') });
    expect(hubBlingRequests).toBe(blingRequestsBeforeSuggestions);
    await composer.press('ArrowDown');
    await composer.press('ArrowUp');
    await composer.press('Enter');
    const preview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
    await expect(preview).toContainText(name);
    await expect(preview.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    await preview.getByRole('button', { name: 'Fechar prévia' }).click();
    await expect(composer).toHaveValue('Confira ');
    await expect(composer).toBeFocused();
    await composer.fill(`\\${name.toLowerCase()}`);
    await suggestions.getByRole('option', { name: new RegExp(name) }).click();
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: 'Fechar prévia' }).click();
    await composer.fill('\\nenhum-produto-qa-xyz');
    await expect(suggestions.getByText('Nenhum produto encontrado.')).toBeVisible();
    await composer.press('Enter');
    await expect(suggestions).toBeVisible();
    await composer.press('Escape');
    await expect(suggestions).toHaveCount(0);
    await composer.fill('/');
    const quick = page.getByRole('dialog', { name: 'Mensagens rápidas' });
    await expect(quick.getByRole('option').first()).toBeVisible();
    await composer.press('Enter');
    await expect(quick).toHaveCount(0);
    await expect(composer).not.toHaveValue('/');
    await page.getByRole('button', { name: /Nota Interna/ }).click();
    await page.getByPlaceholder('Digite uma nota interna para a equipe...').fill(`\\${name}`);
    await expect(suggestions).toHaveCount(0);
    expect(sends).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    if (id) {
      await page.request.post(`${apiUrl}/api/products/${id}/archive`).catch(() => undefined);
      await deleteQaProductFixture(page.request, apiUrl, id).catch(() => undefined);
    }
  }
});

test('busca de produtos descarta respostas antigas, mostra erro e não envia ao pressionar Enter', async ({ page }) => {
  test.skip(!email || !password, 'credenciais QA ausentes');
  await login(page);
  await page.getByRole('button', { name: /Abrir conversa com Ana QA/ }).first().click();
  const composer = page.getByPlaceholder('Digite sua mensagem para o WhatsApp...');
  const suggestions = page.getByRole('dialog', { name: 'Sugestões de produtos' });
  const sends: string[] = [];
  page.on('request', (event) => {
    if (event.method() !== 'GET' && /\/api\/evolution\/(?:messages|media)\//.test(event.url())) sends.push(event.url());
  });
  const product = (name: string) => ({ id: name, name, priceCents: 500, imageUrl: `data:image/png;base64,${tinyPng}` });
  await page.route('**/api/products?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('search');
    if (query === 'antigo') await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ status: query === 'erro' ? 503 : 200, contentType: 'application/json', headers: {
      'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true',
    }, body: JSON.stringify(query === 'erro' ? { error: 'Busca indisponível QA.' } : { products: query === 'antigo' ? [product('Resultado antigo')] : [product('Novo A'), product('Novo B')] }) });
  });
  const oldRequest = page.waitForRequest((event) => new URL(event.url()).searchParams.get('search') === 'antigo');
  await composer.fill('\\antigo');
  await oldRequest;
  await composer.fill('\\novo');
  await expect(suggestions.getByRole('option', { name: /Novo A/ })).toBeVisible();
  await expect(suggestions.getByText('O servidor demorou mais que o esperado para responder. Tente novamente.')).toHaveCount(0);
  await expect(suggestions.getByRole('option', { name: /Resultado antigo/ })).toHaveCount(0);
  await composer.press('ArrowDown');
  await expect(suggestions.getByRole('option', { name: /Novo B/ })).toHaveAttribute('aria-selected', 'true');
  await composer.press('Enter');
  const preview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
  await expect(preview).toContainText('Novo B');
  await preview.getByRole('button', { name: 'Fechar prévia' }).click();
  await composer.fill('\\erro');
  await expect(suggestions.getByRole('alert')).toHaveText('Busca indisponível QA.');
  await composer.press('Enter');
  await expect(suggestions).toBeVisible();
  await composer.press('Escape');
  await composer.fill('C:\\arquivo');
  await expect(suggestions).toHaveCount(0);
  expect(sends).toEqual([]);
});

test('atendente não vê + de cadastro e action=new não abre formulário sem permissão', async ({ page }) => {
  test.skip(!secondEmail || !secondPassword, 'credenciais QA ausentes');
  await login(page, { email: secondEmail, password: secondPassword });
  await openFreshProductConversation(page);
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Produtos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar produto', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Importar do Bling', exact: true })).toHaveCount(0);
  await page.goto('/configuracoes?tab=products&action=new');
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Adicionar produto' })).toHaveCount(0);
});

test('Product Library importa pelo Bling paginado e preserva campos vinculados na UI', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  const marker = await (await page.request.get(`${apiUrl}/api/qa/ready`)).json();
  expect(marker).toMatchObject({ qaMode: true, evolution: 'mock-only', database: 'local-only' });
  const qaPool = new Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  await page.request.post(`${apiUrl}/api/integrations/bling/disconnect`);
  const authorization = await (await page.request.post(`${apiUrl}/api/integrations/bling/connect`)).json();
  const callback = await page.request.get(authorization.url, { maxRedirects: 0 });
  expect(callback.status()).toBe(302);
  expect(callback.headers().location).toContain('bling=connected');
  await page.request.post(`${apiUrl}/api/qa/bling/scenario`, { data: { scenario: 'default' } });

  const externalRequests: string[] = [];
  let importPayload: Record<string, unknown> | null = null;
  let importedId: string | null = null;
  try {
  page.on('request', (requestEvent) => {
    if (new URL(requestEvent.url()).hostname.endsWith('bling.com.br')) externalRequests.push(requestEvent.url());
  });
  await page.route('**/api/products/bling-import', async (route) => {
    importPayload = route.request().postDataJSON();
    await route.continue();
  });

  await page.goto('/configuracoes?tab=products');
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar produto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Adicionar produto' });
  await expect(dialog.getByRole('button', { name: /Ativo \(A\)/ }).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Inativo \(I\)/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /Encerrado \(E\)/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Carregar mais', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Carregar mais', exact: true }).click();
  await expect(dialog.getByRole('button').filter({ hasText: 'ID 322' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Salvar produto' })).toBeDisabled();
  await expect(dialog.getByLabel('Nome local *')).toBeDisabled();
  await expect(dialog.getByLabel('Preço no Bling')).toBeDisabled();
  await expect(dialog.getByLabel('SKU')).toBeDisabled();
  await expect(dialog.getByLabel('Estoque virtual')).toBeDisabled();
  const search = dialog.getByLabel('Buscar produto no Bling para importar');
  await search.fill('Produto Catálogo QA 321');
  await dialog.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
  const item = dialog.getByRole('button', { name: /Produto Catálogo QA 321/ });
  await item.click();
  await expect(dialog.getByLabel('Nome local *')).toHaveValue('Produto Catálogo QA 321');
  await dialog.getByLabel('Nome local *').fill('Nome local QA 321');
  await expect(dialog.getByLabel('SKU')).toHaveValue('SKU-321');
  await expect(dialog.getByLabel('Estoque virtual')).toHaveValue('5');
  await expect(dialog.getByRole('button', { name: 'Salvar produto' })).toBeDisabled();
  await dialog.getByLabel('Imagem local para importação').setInputFiles({
    name: 'bling-import-qa.png', mimeType: 'image/png', buffer: Buffer.from(tinyPng, 'base64'),
  });
  await expect(dialog.getByRole('button', { name: 'Salvar produto' })).toBeEnabled();
  const importResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/products/bling-import'
  ));
  await dialog.getByRole('button', { name: 'Salvar produto', exact: true }).click();
  const completedImport = await importResponse;
  expect(completedImport.status()).toBe(201);
  importedId = (await completedImport.json()).product.id;
  const card = page.locator(`[data-product-id="${importedId}"]`);
  await expect(card).toHaveCount(1);
  const compactRow = card.getByRole('button', { name: 'Expandir Nome local QA 321', exact: true });
  await expect(compactRow).toHaveAttribute('aria-expanded', 'false');
  await expect(card).not.toContainText('R$ 180,00');
  await expect(card.getByRole('button', { name: 'Ações de Nome local QA 321', exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Editar nome/imagem', exact: true })).toHaveCount(0);
  const compactImage = await compactRow.locator('img').boundingBox();
  expect(compactImage?.width).toBe(48);
  expect(compactImage?.height).toBe(48);
  await compactRow.click();
  await expect(card.getByRole('button', { name: 'Recolher Nome local QA 321', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(card).toContainText('R$ 180,00');
  await expect(card).toContainText('Bling');
  await expect(card).toContainText('SKU: SKU-321');
  await expect(card).toContainText('Estoque virtual: 5');
  expect(importPayload && Object.keys(importPayload).sort()).toEqual(['blingProductId', 'imageBase64', 'imageMimeType', 'name']);
  expect(importPayload).toMatchObject({ blingProductId: '321', name: 'Nome local QA 321', imageMimeType: 'image/png' });

  await card.getByRole('button', { name: `Ações de Nome local QA 321`, exact: true }).click();
  const actionMenu = page.getByRole('menu', { name: 'Ações de Nome local QA 321', exact: true });
  await expect(actionMenu).toBeVisible();
  expect(await actionMenu.evaluate((element) => element.parentElement === document.body)).toBe(true);
  expect(await actionMenu.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
  expect((await actionMenu.getByRole('menuitem').allTextContents()).map((value) => value.trim())).toEqual([
    'Editar nome/imagem', 'Atualizar do Bling', 'Alterar produto Bling', 'Arquivar',
  ]);
  await expect(actionMenu.getByRole('menuitem', { name: 'Desvincular do Bling' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Editar nome/imagem', exact: true })).toHaveCount(0);
  const menuBox = await actionMenu.boundingBox();
  expect(menuBox && menuBox.x >= 0 && menuBox.y >= 0 && menuBox.x + menuBox.width <= 1280 && menuBox.y + menuBox.height <= 900).toBe(true);
  await actionMenu.getByRole('menuitem', { name: 'Editar nome/imagem', exact: true }).click();
  await expect(actionMenu).toHaveCount(0);
  const editDialog = page.getByRole('dialog', { name: 'Editar produto' });
  await expect(editDialog.getByLabel('Nome local *')).toBeEnabled();
  await expect(editDialog).toContainText('R$ 180,00');
  await uploadValidProductImage(page);
  await editDialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(card).toContainText('R$ 180,00');
  await expect(card).toContainText('SKU: SKU-321');
  await card.getByRole('button', { name: 'Ações de Nome local QA 321', exact: true }).click();
  const reopenedMenu = page.getByRole('menu', { name: 'Ações de Nome local QA 321', exact: true });
  await expect(reopenedMenu.getByRole('menuitem', { name: 'Atualizar do Bling', exact: true })).toBeVisible();
  await expect(reopenedMenu.getByRole('menuitem', { name: 'Alterar produto Bling', exact: true })).toBeVisible();
  await expect(reopenedMenu.getByRole('menuitem', { name: 'Desvincular do Bling', exact: true })).toHaveCount(0);
  await expect(reopenedMenu.getByRole('menuitem', { name: 'Arquivar', exact: true })).toBeVisible();
  expect(externalRequests).toEqual([]);
  } finally {
    if (importedId) {
      await qaPool.query('DELETE FROM products WHERE id=$1', [importedId]).catch(() => undefined);
    }
    await page.request.post(`${apiUrl}/api/qa/bling/scenario`, { data: { scenario: 'default' } }).catch(() => undefined);
    await page.request.post(`${apiUrl}/api/integrations/bling/disconnect`).catch(() => undefined);
    await qaPool.end();
  }
});

test('seleção Bling só expira em 10s, permite retry e ignora resposta antiga após troca', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  await ensureQaBlingConnected(page.request, apiUrl);
  await page.goto('/configuracoes?tab=products');
  await page.getByRole('button', { name: 'Adicionar produto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Adicionar produto' });
  await expect(dialog.getByRole('button', { name: /Produto Catálogo QA 321/ })).toBeVisible();
  await dialog.getByLabel('Imagem local para importação').setInputFiles({
    name: 'retry-preservado.png', mimeType: 'image/png', buffer: Buffer.from(tinyPng, 'base64'),
  });
  await expect(dialog.getByAltText('Prévia da imagem local')).toBeVisible();

  const corsHeaders = {
    'access-control-allow-origin': 'http://localhost:3000',
    'access-control-allow-credentials': 'true',
  };
  await page.route('**/api/integrations/bling/products/303', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify({ error: 'Detail indisponível imediatamente QA.' }) });
  });
  const search = dialog.getByLabel('Buscar produto no Bling para importar');
  await search.fill('Produto para Importar QA');
  await dialog.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
  await dialog.getByRole('button', { name: /Produto para Importar QA/ }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Detail indisponível imediatamente QA.');
  await expect(dialog.getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Alterar produto do Bling', exact: true }).click();
  await search.fill('Produto Catálogo QA 321');
  await dialog.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
  const product321 = dialog.getByRole('button', { name: /Produto Catálogo QA 321/ });
  await expect(product321).toBeVisible();

  let stock321Requests = 0;
  let detail321Requests = 0;
  let catalogRequests = 0;
  let timedOutStockRoute: import('@playwright/test').Route | null = null;
  const staleStockBody = JSON.stringify({ data: [{ produto: { id: '321' }, saldoFisicoTotal: 8, saldoVirtualTotal: 5 }] });
  page.on('request', (event) => {
    const path = new URL(event.url()).pathname;
    if (path === '/api/integrations/bling/products') catalogRequests += 1;
    if (path === '/api/integrations/bling/products/321') detail321Requests += 1;
  });
  await page.route('**/api/integrations/bling/products/321/stock', async (route) => {
    stock321Requests += 1;
    if (stock321Requests === 1) {
      timedOutStockRoute = route;
      return;
    }
    if (stock321Requests === 3) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders, body: staleStockBody }).catch(() => undefined);
      return;
    }
    await route.continue();
  });

  await page.clock.install({ time: new Date('2026-01-01T00:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:00.000Z'));
  const firstStockRequest = page.waitForRequest((event) => new URL(event.url()).pathname === '/api/integrations/bling/products/321/stock');
  await product321.click();
  await firstStockRequest;
  await expect(dialog.getByRole('status')).toContainText('Carregando dados do Bling...');
  await expect(dialog.getByLabel('Nome local *')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Salvar produto' })).toBeDisabled();
  await page.clock.fastForward(9_999);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toContainText('Carregando dados do Bling...');
  await page.clock.fastForward(1);
  await expect(dialog.getByRole('alert')).toHaveText('O servidor demorou mais que o esperado para responder. Tente novamente.');
  await expect(dialog.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeVisible();
  await expect(dialog.getByAltText('Prévia da imagem local')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Salvar produto' })).toBeDisabled();

  const catalogCallsBeforeRetry = catalogRequests;
  await dialog.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(dialog.getByLabel('Nome local *')).toHaveValue('Produto Catálogo QA 321');
  await expect(dialog.getByLabel('SKU')).toHaveValue('SKU-321');
  await expect(dialog.getByLabel('Estoque virtual')).toHaveValue('5');
  await expect(dialog.getByAltText('Prévia da imagem local')).toBeVisible();
  expect(detail321Requests).toBe(2);
  expect(stock321Requests).toBe(2);
  expect(catalogRequests).toBe(catalogCallsBeforeRetry);

  await dialog.getByRole('button', { name: 'Alterar produto do Bling', exact: true }).click();
  await search.fill('Produto Catálogo QA 321');
  await dialog.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
  await expect(product321).toBeVisible();
  const staleStockRequest = page.waitForRequest((event) => new URL(event.url()).pathname === '/api/integrations/bling/products/321/stock');
  await product321.click();
  await staleStockRequest;
  await dialog.getByRole('button', { name: 'Alterar produto do Bling', exact: true }).click();
  await search.fill('Produto Catálogo QA 322');
  await dialog.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
  await page.clock.fastForward(200);
  const product322 = dialog.getByRole('button', { name: /Produto Catálogo QA 322/ });
  await expect(product322).toBeVisible();
  await product322.click();
  await expect(dialog.getByLabel('Nome local *')).toHaveValue('Produto Catálogo QA 322');
  await expect(dialog.getByLabel('SKU')).toHaveValue('SKU-322');
  await expect(dialog.getByLabel('Estoque virtual')).toHaveValue('5');
  await new Promise((resolve) => setTimeout(resolve, 450));
  await expect(dialog.getByLabel('Nome local *')).toHaveValue('Produto Catálogo QA 322');
  await expect(dialog.getByLabel('SKU')).toHaveValue('SKU-322');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await timedOutStockRoute?.abort().catch(() => undefined);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
});

test('cards da Product Library iniciam compactos, mantêm accordion único e menu portal acessível', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  const firstName = `Sintra Fast Multiplicador QA ${Date.now()}`;
  const secondName = `V-Floc Concentrado QA ${Date.now()}`;
  const first = await importQaProduct(page.request, apiUrl, { blingProductId: nextQaBlingProductId(), name: firstName });
  productFixturesForCleanup.add(first.id);
  const second = await importQaProduct(page.request, apiUrl, { blingProductId: nextQaBlingProductId(), name: secondName });
  productFixturesForCleanup.add(second.id);
  await page.goto('/configuracoes?tab=products');
  const firstCard = page.locator(`[data-product-id="${first.id}"]`);
  const secondCard = page.locator(`[data-product-id="${second.id}"]`);
  const firstToggle = firstCard.getByRole('button', { name: `Expandir ${firstName}`, exact: true });
  const secondToggle = secondCard.getByRole('button', { name: `Expandir ${secondName}`, exact: true });

  await expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(secondToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(firstToggle).toContainText('Sintra Fast…');
  await expect(firstCard).not.toContainText('R$');
  await expect(firstCard).not.toContainText('SKU:');
  await expect(firstCard).not.toContainText('GTIN');
  await expect(firstCard).not.toContainText('Estoque virtual');
  await expect(firstCard).not.toContainText('Sincronizado:');
  await expect(firstCard.getByRole('button', { name: /Ações de/ })).toHaveCount(0);
  await expect(firstCard.getByRole('button', { name: 'Editar nome/imagem', exact: true })).toHaveCount(0);
  const thumb = await firstToggle.locator('img').boundingBox();
  expect(thumb?.width).toBe(48);
  expect(thumb?.height).toBe(48);

  await page.setViewportSize({ width: 390, height: 844 });
  await firstToggle.click();
  await expect(firstCard.getByRole('button', { name: `Recolher ${firstName}`, exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(firstCard).toContainText(firstName);
  await expect(firstCard).toContainText('R$ 28,00');
  await expect(firstCard).toContainText('Bling');
  await expect(firstCard).toContainText('SKU:');
  await expect(firstCard).toContainText('Estoque virtual: 5');
  await expect(firstCard).toContainText('Sincronizado:');

  await secondToggle.click();
  await expect(firstCard.getByRole('button', { name: `Expandir ${firstName}`, exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(secondCard.getByRole('button', { name: `Recolher ${secondName}`, exact: true })).toHaveAttribute('aria-expanded', 'true');
  await secondCard.getByRole('button', { name: `Recolher ${secondName}`, exact: true }).click();
  await expect(secondCard.getByRole('button', { name: `Expandir ${secondName}`, exact: true })).toHaveAttribute('aria-expanded', 'false');

  await firstCard.getByRole('button', { name: `Expandir ${firstName}`, exact: true }).click();
  const actionButton = firstCard.getByRole('button', { name: `Ações de ${firstName}`, exact: true });
  await actionButton.click();
  const menu = page.getByRole('menu', { name: `Ações de ${firstName}`, exact: true });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((element) => element.parentElement === document.body)).toBe(true);
  expect(await menu.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
  const menuBounds = await menu.boundingBox();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(menuBounds && menuBounds.x >= 0 && menuBounds.y >= 0
    && menuBounds.x + menuBounds.width <= viewport.width
    && menuBounds.y + menuBounds.height <= viewport.height).toBe(true);
  expect((await menu.getByRole('menuitem').allTextContents()).map((value) => value.trim())).toEqual([
    'Editar nome/imagem', 'Atualizar do Bling', 'Alterar produto Bling', 'Arquivar',
  ]);
  await expect(menu.getByRole('menuitem', { name: 'Desvincular do Bling' })).toHaveCount(0);
  await page.getByLabel('Buscar produto').click();
  await expect(menu).toHaveCount(0);
  await actionButton.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(actionButton).toBeFocused();
  await actionButton.click();
  await menu.getByRole('menuitem', { name: 'Editar nome/imagem', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Editar produto' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
});

test('Biblioteca de Produtos permite cadastrar, editar, buscar, pré-visualizar e arquivar sem envio real', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  await ensureQaBlingConnected(page.request, apiUrl);
  const productName = `Produto QA ${Date.now()}`;
  let createdProductId = '';
  const providerMutations: string[] = [];
  const imageResponseStatuses: number[] = [];
  page.on('request', (requestEvent) => {
    if (requestEvent.method() !== 'GET' && /\/api\/evolution\/(?:messages|media)\//.test(requestEvent.url())) {
      providerMutations.push(`${requestEvent.method()} ${requestEvent.url()}`);
    }
  });
  page.on('response', (responseEvent) => {
    if (/\/api\/products\/storage(?:\?|$)/.test(responseEvent.url())) imageResponseStatuses.push(responseEvent.status());
  });

  await page.goto('/configuracoes?tab=products');
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar produto' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Adicionar produto' });
  await addDialog.getByLabel('Buscar produto no Bling para importar').fill('Produto Catálogo QA 323');
  await addDialog.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
  await addDialog.getByRole('button', { name: /Produto Catálogo QA 323/ }).click();
  await expect(addDialog.getByLabel('Nome local *')).toBeEnabled();
  await expect(addDialog.getByLabel('Preço no Bling')).toBeDisabled();
  await expect(addDialog.getByLabel('SKU')).toHaveValue('SKU-323');
  await expect(addDialog.getByLabel('Estoque virtual')).toHaveValue('5');
  await addDialog.getByLabel('Nome local *').fill(productName);
  const browserGeneratedImages = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#eebb2c';
    context.fillRect(0, 0, 2, 2);
    return {
      png: canvas.toDataURL('image/png'),
      jpeg: canvas.toDataURL('image/jpeg'),
      webp: canvas.toDataURL('image/webp'),
    };
  });
  expect(browserGeneratedImages.webp).toMatch(/^data:image\/webp;base64,/);
  const browserGeneratedPngBase64 = browserGeneratedImages.png.split(',')[1];
  await addDialog.getByLabel('Imagem local para importação').setInputFiles({
    name: 'produto-qa.png',
    mimeType: 'image/png',
    buffer: Buffer.from(browserGeneratedPngBase64, 'base64'),
  });
  await expect(addDialog.getByAltText('Prévia da imagem local')).toBeVisible();
  const importImagePreview = addDialog.getByAltText('Prévia da imagem local');
  let previousImageUrl = await importImagePreview.getAttribute('src');
  for (const [mimeType, dataUrl] of [
    ['image/png', browserGeneratedImages.png],
    ['image/jpeg', browserGeneratedImages.jpeg],
    ['image/webp', browserGeneratedImages.webp],
  ] as const) {
    expect(await pasteImageIntoProductForm(addDialog, mimeType, dataUrl)).toBe(false);
    await expect(importImagePreview).not.toHaveAttribute('src', previousImageUrl!);
    previousImageUrl = await importImagePreview.getAttribute('src');
  }
  await addDialog.getByLabel('Nome local *').fill('Texto ');
  await pastePlainTextIntoProductName(page, addDialog, 'normal');
  await expect(addDialog.getByLabel('Nome local *')).toHaveValue('Texto normal');
  await addDialog.getByLabel('Nome local *').fill(productName);
  const imageBeforeInvalidPaste = await importImagePreview.getAttribute('src');
  await pasteImageIntoProductForm(addDialog, 'image/gif', browserGeneratedImages.png);
  await expect(addDialog.getByRole('alert')).toHaveText('Use uma imagem JPEG, PNG ou WebP.');
  await expect(importImagePreview).toHaveAttribute('src', imageBeforeInvalidPaste!);
  await pasteImageIntoProductForm(addDialog, 'image/png', browserGeneratedImages.png, true);
  await expect(addDialog.getByRole('alert')).toHaveText('A imagem deve ter entre 1 byte e 1 MB.');
  await expect(importImagePreview).toHaveAttribute('src', imageBeforeInvalidPaste!);
  await pasteImageIntoProductForm(addDialog, 'image/webp', browserGeneratedImages.webp);
  await expect(addDialog.getByRole('alert')).toHaveCount(0);
  await expect(importImagePreview).not.toHaveAttribute('src', imageBeforeInvalidPaste!);
  const created = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/products/bling-import');
  await page.getByRole('button', { name: 'Salvar produto' }).click();
  const createResponse = await created;
  expect(createResponse.status()).toBe(201);
  createdProductId = (await createResponse.json()).product.id;
  productFixturesForCleanup.add(createdProductId);

  const card = page.locator(`[data-product-id="${createdProductId}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: `Expandir ${productName}`, exact: true })).toHaveAttribute('aria-expanded', 'false');
  await card.getByRole('button', { name: `Expandir ${productName}`, exact: true }).click();
  await expect(card).toContainText('R$ 180,00');
  await expect(card).toContainText('SKU: SKU-323');
  await expect(card).toContainText('Estoque virtual: 5');
  await expect.poll(() => imageResponseStatuses.length).toBeGreaterThan(0);
  expect(imageResponseStatuses.at(-1)).toBe(200);
  await expect.poll(() => card.locator('img[alt^="Imagem do produto"]').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);

  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(card).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Buscar produto')).toBeVisible();
  await card.getByRole('button', { name: `Ações de ${productName}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Editar nome/imagem', exact: true }).click();
  await expect(page.getByLabel('Nome local *')).toHaveValue(productName);
  const editDialog = page.getByRole('dialog', { name: 'Editar produto' });
  await expect(editDialog).toContainText('Preço do catálogo · Bling');
  await expect(editDialog).toContainText('R$ 180,00');
  const editImagePreview = page.getByAltText('Pré-visualização da imagem do produto');
  const imageBeforeEditPaste = await editImagePreview.getAttribute('src');
  await pasteImageIntoProductForm(editDialog, 'image/jpeg', browserGeneratedImages.jpeg);
  await expect(editImagePreview).not.toHaveAttribute('src', imageBeforeEditPaste!);
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(card).toContainText('R$ 180,00');
  await page.getByLabel('Buscar produto').fill(productName);
  await expect(card).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/atendimento');
  const conversation = page.getByRole('button', { name: /Abrir conversa com Ana QA/ }).first();
  await expect(conversation).toBeVisible({ timeout: 15_000 });
  await conversation.click();
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Produtos' });
  await expect(picker).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await picker.getByLabel('Buscar produto para pré-visualizar').fill(productName);
  await picker.getByRole('option', { name: new RegExp(productName) }).click();
  const preview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(productName);
  await expect(preview).toContainText('SKU: SKU-323');
  await expect(preview).toContainText('Estoque virtual: 5');
  await expect(preview).toContainText('Preço cadastrado: R$ 180,00');
  await expect(preview.getByLabel('Valor desta mensagem')).toHaveValue('180,00');
  const blingBadge = preview.getByLabel('Vinculado ao Bling');
  await expect(blingBadge).toHaveAttribute('title', 'Vinculado ao Bling');
  expect(await blingBadge.getAttribute('class')).toContain('text-emerald-300');
  await preview.getByLabel('Valor desta mensagem').fill('49,90');
  await expect(preview).toContainText('Preço cadastrado: R$ 180,00');
  await expect(preview.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
  await expect(preview.getByText(/envio de produtos pelo WhatsApp ainda não está conectado/i)).toHaveCount(0);
  await preview.getByRole('button', { name: 'Voltar', exact: true }).click();
  await picker.getByRole('option', { name: new RegExp(productName) }).click();
  const resetPreview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
  await expect(resetPreview.getByLabel('Valor desta mensagem')).toHaveValue('180,00');
  await resetPreview.getByRole('button', { name: 'Fechar prévia' }).click();
  expect(providerMutations).toEqual([]);

  await page.goto('/configuracoes?tab=products');
  const refreshedCard = page.locator(`[data-product-id="${createdProductId}"]`);
  await expect(refreshedCard).toBeVisible();
  await expect(refreshedCard.getByRole('button', { name: `Expandir ${productName}`, exact: true })).toBeVisible();
  await refreshedCard.getByRole('button', { name: `Expandir ${productName}`, exact: true }).click();
  await refreshedCard.getByRole('button', { name: `Ações de ${productName}` }).click();
  await page.getByRole('menuitem', { name: 'Arquivar', exact: true }).click();
  const archiveDialog = page.getByRole('dialog', { name: 'Arquivar produto?' });
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(refreshedCard).toHaveCount(0);
  await expect(page.getByText('Produto arquivado.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/atendimento');
  await conversation.waitFor({ state: 'visible', timeout: 15_000 });
  await conversation.click();
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  const archivedPicker = page.getByRole('dialog', { name: 'Produtos' });
  await archivedPicker.getByLabel('Buscar produto para pré-visualizar').fill(productName);
  await expect(archivedPicker.getByText('Nenhum produto encontrado.')).toBeVisible();
  expect(providerMutations).toEqual([]);
  await deleteQaProductFixture(page.request, apiUrl, createdProductId);
});

test('UI bloqueia SKU duplicado após normalização por caixa e espaços', async ({ page }) => {
  test.skip(!email || !password, 'credenciais QA ausentes');
  await login(page);
  await ensureQaBlingConnected(page.request, apiUrl);
  const pool = new Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  let productId: string | null = null;
  try {
    const existing = await importQaProduct(page.request, apiUrl, {
      blingProductId: nextQaBlingProductId(), name: `SKU Base QA ${Date.now()}`,
    });
    productId = existing.id;
    const linked = await page.request.post(`${apiUrl}/api/products/${productId}/bling-link`, { data: { blingProductId: '101' } });
    expect(linked.status()).toBe(200);
    expect((await linked.json()).product.bling.code).toBe('SKU-101');
    expect((await page.request.post(`${apiUrl}/api/qa/bling/scenario`, { data: { scenario: 'sku-collision' } })).status()).toBe(200);

    await page.goto('/configuracoes?tab=products');
    await page.getByRole('button', { name: 'Adicionar produto', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Adicionar produto' });
    await dialog.getByLabel('Buscar produto no Bling para importar').fill('Produto Catálogo QA 321');
    await dialog.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
    await dialog.getByRole('button', { name: /Produto Catálogo QA 321/ }).click();
    await expect(dialog.getByLabel('SKU')).toHaveValue(' sku-101 ');
    await expect(dialog.getByRole('alert')).toContainText('Já existe um produto cadastrado no Hub com este SKU.');
    await dialog.getByLabel('Imagem local para importação').setInputFiles({
      name: 'duplicate-sku.png', mimeType: 'image/png', buffer: Buffer.from(tinyPng, 'base64'),
    });
    await expect(dialog.getByRole('button', { name: 'Salvar produto' })).toBeDisabled();
  } finally {
    await page.request.post(`${apiUrl}/api/qa/bling/scenario`, { data: { scenario: 'default' } }).catch(() => undefined);
    if (productId) await pool.query('DELETE FROM products WHERE id=$1', [productId]).catch(() => undefined);
    await pool.end();
  }
});

test('picker usa estoque efetivo cacheado na sugestão e prévia mantém o rótulo aprovado', async ({ page }) => {
  test.skip(!email || !password, 'credenciais QA ausentes');
  await login(page);
  await ensureQaBlingConnected(page.request, apiUrl);
  const pool = new Pool({ connectionString: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa' });
  const fixtures: Array<{ id: string; name: string; value: string; isNonPositive: boolean }> = [];
  let blingApiReads = 0;
  page.on('request', (event) => { if (new URL(event.url()).pathname.startsWith('/api/integrations/bling/')) blingApiReads += 1; });
  try {
    for (const [scenario, value, isNonPositive] of [
      ['default', '5', false],
      ['physical-only', '7', false],
      ['virtual-zero', '0', true],
      ['virtual-negative', '-2', true],
    ] as const) {
      expect((await page.request.post(`${apiUrl}/api/qa/bling/scenario`, { data: { scenario } })).status()).toBe(200);
      const name = `Estoque ${scenario} QA ${Date.now()}`;
      const product = await importQaProduct(page.request, apiUrl, { blingProductId: nextQaBlingProductId(), name });
      fixtures.push({ id: product.id, name, value, isNonPositive });
      const response = await page.request.get(`${apiUrl}/api/products/${product.id}`);
      expect(response.status()).toBe(200);
      const stored = (await response.json()).product;
      if (scenario === 'default') expect(stored.bling).toMatchObject({ stockPhysicalTotal: '8', stockVirtualTotal: '5' });
      if (scenario === 'physical-only') expect(stored.bling).toMatchObject({ stockPhysicalTotal: '7', stockVirtualTotal: null });
      if (scenario === 'virtual-zero') expect(stored.bling).toMatchObject({ stockPhysicalTotal: '8', stockVirtualTotal: '0' });
      if (scenario === 'virtual-negative') expect(stored.bling).toMatchObject({ stockPhysicalTotal: '8', stockVirtualTotal: '-2' });
    }
    expect((await page.request.post(`${apiUrl}/api/qa/bling/scenario`, { data: { scenario: 'default' } })).status()).toBe(200);
    await page.goto('/atendimento');
    const contactName = await openFreshProductConversation(page);
    const composer = page.getByPlaceholder('Digite sua mensagem para o WhatsApp...');
    const baselineBlingReads = blingApiReads;
    for (const fixture of fixtures) {
      await composer.fill(`\\${fixture.name}`);
      const suggestions = page.getByRole('dialog', { name: 'Sugestões de produtos' });
      const option = suggestions.getByRole('option', { name: new RegExp(fixture.name) });
      await expect(option).toBeVisible();
      await expect(option).toContainText(`R$ 28,00`);
      await expect(option).toContainText(`Qtd: ${fixture.value}`);
      await expect(option).not.toContainText(/SKU\s*:|Estoque(?:\s+(?:virtual|físico))?\s*:/i);
      const quantity = option.getByText(`Qtd: ${fixture.value}`, { exact: true });
      if (fixture.isNonPositive) expect(await quantity.getAttribute('class')).toContain('text-red-300');
      else expect(await quantity.getAttribute('class')).not.toContain('text-red-300');
      expect(blingApiReads).toBe(baselineBlingReads);
      if (fixture.value === '7') {
        await composer.press('ArrowDown');
        await composer.press('ArrowDown');
        await composer.press('Enter');
        const keyboardPreview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
        await expect(keyboardPreview.getByText('Estoque virtual: 7', { exact: true })).toBeVisible();
        await keyboardPreview.getByRole('button', { name: 'Fechar prévia' }).click();
      } else {
        await composer.press('Escape');
      }
    }
    await page.getByRole('button', { name: 'Produtos', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Produtos' });
    for (const fixture of fixtures) {
      await picker.getByLabel('Buscar produto para pré-visualizar').fill(fixture.name);
      await picker.getByRole('option', { name: new RegExp(fixture.name) }).click();
      const preview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
      const stock = preview.getByText(`Estoque virtual: ${fixture.value}`, { exact: true });
      await expect(stock).toBeVisible();
      const stockClass = await stock.getAttribute('class');
      if (fixture.isNonPositive) expect(stockClass).toContain('text-red-300');
      else expect(stockClass).not.toContain('text-red-300');
      await preview.getByRole('button', { name: 'Voltar', exact: true }).click();
    }
    expect(contactName).toContain('Picker QA');
  } finally {
    await page.request.post(`${apiUrl}/api/qa/bling/scenario`, { data: { scenario: 'default' } }).catch(() => undefined);
    for (const fixture of fixtures) await pool.query('DELETE FROM products WHERE id=$1', [fixture.id]).catch(() => undefined);
    await pool.end();
  }
});

test('Produtos respeita permissões de administrador e isolamento por empresa', async () => {
  test.skip(!email || !password || !secondEmail || !secondPassword, 'credenciais QA ausentes');
  const companyA = await request.newContext({ baseURL: apiUrl });
  const sameCompanyAttendant = await request.newContext({ baseURL: apiUrl });
  const companyB = await request.newContext({ baseURL: apiUrl });
  let productId = '';
  let productImageUrl = '';
  try {
    const adminLogin = await companyA.post('/api/auth/login', { data: { email, password } });
    const attendantLogin = await sameCompanyAttendant.post('/api/auth/login', { data: { email: secondEmail, password: secondPassword } });
    const tenantBLogin = await companyB.post('/api/auth/login', { data: { email: 'qa-admin-b@vitstock.test', password } });
    expect(adminLogin.ok()).toBeTruthy();
    expect(attendantLogin.ok()).toBeTruthy();
    expect(tenantBLogin.ok()).toBeTruthy();

    const productName = `Tenant isolation QA ${Date.now()}`;
    const manualCreate = await companyA.post('/api/products', {
      data: { name: productName, priceCents: 500, imageMimeType: 'image/png', imageBase64: tinyPng },
    });
    expect(manualCreate.status()).toBe(409);
    expect(await manualCreate.json()).toMatchObject({ code: 'bling_product_required' });
    const imported = await importQaProduct(companyA, apiUrl, { blingProductId: nextQaBlingProductId(), name: productName });
    productId = imported.id;
    const payload = await (await companyA.get(`/api/products/${productId}`)).json() as { product: { id: string; name: string; imageUrl: string; companyId?: string } };
    productImageUrl = payload.product.imageUrl;
    expect(payload.product.companyId).toBeUndefined();

    const adminList = await companyA.get('/api/products');
    const attendantList = await sameCompanyAttendant.get('/api/products');
    const otherTenantList = await companyB.get('/api/products');
    expect((await adminList.json()).products.some((item: { id: string }) => item.id === productId)).toBe(true);
    expect((await attendantList.json()).products.some((item: { id: string }) => item.id === productId)).toBe(true);
    expect((await otherTenantList.json()).products.some((item: { id: string }) => item.id === productId)).toBe(false);
    const caseInsensitiveSearch = await companyA.get(`/api/products?search=${encodeURIComponent(productName.toLowerCase())}`);
    expect((await caseInsensitiveSearch.json()).products.some((item: { id: string }) => item.id === productId)).toBe(true);
    expect((await companyA.get(`/api/products?search=${'x'.repeat(121)}`)).status()).toBe(400);
    const attendantCreate = await sameCompanyAttendant.post('/api/products', {
      data: { name: 'Forbidden QA', priceCents: 0, imageMimeType: 'image/png', imageBase64: tinyPng },
    });
    expect(attendantCreate.status()).toBe(403);
    expect((await companyB.get(`/api/products/${productId}`)).status()).toBe(404);
    expect((await companyB.patch(`/api/products/${productId}`, { data: { name: 'Cross tenant' } })).status()).toBe(404);
    expect((await companyB.post(`/api/products/${productId}/archive`)).status()).toBe(404);
    const imageUrl = new URL(productImageUrl);
    expect((await companyB.get(`${imageUrl.pathname}${imageUrl.search}`)).status()).toBe(404);

    const archived = await companyA.post(`/api/products/${productId}/archive`);
    expect(archived.status()).toBe(200);
    productId = '';
  } finally {
    if (productId) await companyA.post(`/api/products/${productId}/archive`).catch(() => undefined);
    await Promise.all([companyA.dispose(), sameCompanyAttendant.dispose(), companyB.dispose()]);
  }
});

test('mutations confirmadas continuam sucesso quando o refresh da lista falha', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  const productName = `Refresh QA ${Date.now()}`;
  const imported = await importQaProduct(page.request, apiUrl, { blingProductId: nextQaBlingProductId(), name: productName });
  await page.goto('/configuracoes?tab=products');
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible();

  let failNextListRefresh = false;
  const mutationRequests = { update: 0, archive: 0 };
  const corsHeaders = {
    'access-control-allow-origin': 'http://localhost:3000',
    'access-control-allow-credentials': 'true',
  };
  await page.route('**/api/products**', async (route) => {
    const requestEvent = route.request();
    const url = new URL(requestEvent.url());
    if (requestEvent.method() === 'GET' && url.pathname === '/api/products' && failNextListRefresh) {
      failNextListRefresh = false;
      await route.fulfill({ status: 503, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify({ error: 'Falha de refresh QA.' }) });
      return;
    }
    if (requestEvent.method() === 'PATCH' && /^\/api\/products\/[0-9a-f-]+$/i.test(url.pathname)) mutationRequests.update += 1;
    if (requestEvent.method() === 'POST' && /^\/api\/products\/[0-9a-f-]+\/archive$/i.test(url.pathname)) mutationRequests.archive += 1;
    await route.continue();
  });

  const card = page.locator(`[data-product-id="${imported.id}"]`);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: `Expandir ${productName}`, exact: true }).click();
  await card.getByRole('button', { name: `Ações de ${productName}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Editar nome/imagem', exact: true }).click();
  await page.getByLabel('Nome local *').fill(productName);
  failNextListRefresh = true;
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(card).toContainText('R$ 28,00');
  await expect(page.getByText('Produto atualizado.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Produto atualizado, mas não foi possível atualizar a lista.');
  expect(mutationRequests.update).toBe(1);

  await card.getByRole('button', { name: `Ações de ${productName}` }).click();
  await page.getByRole('menuitem', { name: 'Arquivar', exact: true }).click();
  const archiveDialog = page.getByRole('dialog', { name: 'Arquivar produto?' });
  failNextListRefresh = true;
  await archiveDialog.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Produto arquivado.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Produto arquivado, mas não foi possível atualizar a lista.');
  expect(mutationRequests.archive).toBe(1);
  await deleteQaProductFixture(page.request, apiUrl, imported.id);
});

test('falha real da mutation continua visível e submit repetido não duplica create', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  await ensureQaBlingConnected(page.request, apiUrl);
  await page.goto('/configuracoes?tab=products');
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible();

  let createRequests = 0;
  await page.route('**/api/products**', async (route) => {
    const requestEvent = route.request();
    if (requestEvent.method() === 'POST' && new URL(requestEvent.url()).pathname === '/api/products/bling-import') {
      createRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({ status: 500, contentType: 'application/json', headers: {
        'access-control-allow-origin': 'http://localhost:3000',
        'access-control-allow-credentials': 'true',
      }, body: JSON.stringify({ error: 'Falha real de gravação QA.' }) });
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: 'Adicionar produto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Adicionar produto' });
  await dialog.getByLabel('Buscar produto no Bling para importar').fill('Produto Catálogo QA 321');
  await dialog.getByRole('button', { name: 'Buscar no catálogo Bling' }).click();
  await dialog.getByRole('button', { name: /Produto Catálogo QA 321/ }).click();
  await dialog.getByLabel('Nome local *').fill(`Mutation failure QA ${Date.now()}`);
  await dialog.getByLabel('Imagem local para importação').setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: Buffer.from(tinyPng, 'base64') });
  await page.locator('[role="dialog"] form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  await expect(dialog.getByRole('alert')).toHaveText('Falha real de gravação QA.');
  await expect(dialog).toBeVisible();
  expect(createRequests).toBe(1);
  await expect(page.getByText('Produto Bling importado', { exact: false })).toHaveCount(0);
});
