import { expect, request, test, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;
const secondEmail = process.env.E2E_SECOND_EMAIL?.trim();
const secondPassword = process.env.E2E_SECOND_PASSWORD;
const apiUrl = process.env.VITE_API_URL || 'http://localhost:3001';
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
  await page.getByLabel('Imagem do produto').setInputFiles({
    name: 'produto-qa.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64'),
  });
};

test('+ abre cadastro em nova aba e atalho de produtos preserva atendimento sem enviar', async ({ page }, testInfo) => {
  test.skip(!email || !password, 'credenciais QA ausentes');
  const errors: string[] = [];
  const sends: string[] = [];
  await login(page);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (event) => {
    if (event.method() !== 'GET' && /\/api\/evolution\/(?:messages|media)\//.test(event.url())) sends.push(event.url());
  });
  await page.getByRole('button', { name: /Abrir conversa com Ana QA/ }).first().click();
  const composer = page.getByPlaceholder('Digite sua mensagem para o WhatsApp...');
  await composer.fill('Rascunho preservado');
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'rascunho.png', mimeType: 'image/png', buffer: Buffer.from(tinyPng, 'base64') });
  await expect(page.getByTestId('attachment-draft')).toHaveCount(1);
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Produtos', exact: true });
  const add = picker.getByRole('link', { name: 'Adicionar produto (nova aba)' });
  const bounds = await add.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(add).toBeInViewport();
  await picker.screenshot({ path: testInfo.outputPath('picker-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  const newTabPromise = page.context().waitForEvent('page');
  await add.click();
  const settings = await newTabPromise;
  settings.on('pageerror', (error) => errors.push(error.message));
  settings.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await expect(settings.getByRole('dialog', { name: 'Adicionar produto' })).toBeVisible();
  await expect(settings).toHaveURL(/\/configuracoes\?tab=products$/);
  const name = `Atalho Produto QA ${Date.now()}`;
  let id = '';
  try {
    await uploadValidProductImage(settings);
    await settings.getByLabel('Nome *').fill(name);
    await settings.getByLabel(/Valor/).fill('3990');
    const saved = settings.waitForResponse((response) => new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST');
    await settings.getByRole('button', { name: 'Salvar produto' }).click();
    id = (await (await saved).json()).product.id;
    await expect(settings.getByRole('status')).toContainText('Produto cadastrado.');
    await settings.close();
    await page.bringToFront();
    // Headless browsers do not always emit native focus when closing a tab.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await picker.getByLabel('Buscar produto para pré-visualizar').fill(name);
    await expect(picker.getByRole('option', { name: new RegExp(name) })).toBeVisible();
    await picker.getByRole('button', { name: 'Cancelar' }).click();
    await expect(composer).toHaveValue('Rascunho preservado');
    await expect(page.getByTestId('attachment-draft')).toHaveCount(1);
    await composer.fill(`Confira \\${name}`);
    const suggestions = page.getByRole('dialog', { name: 'Sugestões de produtos' });
    const option = suggestions.getByRole('option', { name: new RegExp(name) });
    await expect(option).toBeVisible();
    await expect(option).toContainText('R$ 39,90');
    await expect.poll(() => option.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    await suggestions.screenshot({ path: testInfo.outputPath('product-suggestions.png') });
    await composer.press('ArrowDown');
    await composer.press('ArrowUp');
    await composer.press('Enter');
    const preview = page.getByRole('dialog', { name: 'Pré-visualizar produto' });
    await expect(preview).toContainText(name);
    await expect(preview.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
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
    if (!settings.isClosed()) await settings.close();
    if (id) await page.request.post(`${apiUrl}/api/products/${id}/archive`);
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
  await page.getByRole('button', { name: /Abrir conversa com Ana QA/ }).first().click();
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Produtos', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Adicionar produto (nova aba)' })).toHaveCount(0);
  await page.goto('/configuracoes?tab=products&action=new');
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Adicionar produto' })).toHaveCount(0);
});

test('Biblioteca de Produtos permite cadastrar, editar, buscar, pré-visualizar e arquivar sem envio real', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  const productName = `Produto QA ${Date.now()}`;
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
  const browserGeneratedPngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#eebb2c';
    context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Imagem do produto').setInputFiles({
    name: 'produto-qa.png',
    mimeType: 'image/png',
    buffer: Buffer.from(browserGeneratedPngBase64, 'base64'),
  });
  await expect(page.getByAltText('Pré-visualização da imagem do produto')).toBeVisible();
  await page.getByLabel('Nome *').fill(productName);
  await page.getByLabel(/Valor/).fill('3990');
  await page.getByRole('button', { name: 'Salvar produto' }).click();

  const card = page.locator('article').filter({ hasText: productName }).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('R$ 39,90');
  await expect.poll(() => imageResponseStatuses.length).toBeGreaterThan(0);
  expect(imageResponseStatuses.at(-1)).toBe(200);
  await expect.poll(() => card.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);

  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(card).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Buscar produto')).toBeVisible();
  await card.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel(/Valor/).fill('129900');
  await page.getByRole('button', { name: 'Salvar produto' }).click();
  await expect(card).toContainText('R$ 1.299,00');
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
  await expect(preview.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
  await expect(preview.getByText(/envio de produtos pelo WhatsApp ainda não está conectado/i)).toBeVisible();
  expect(providerMutations).toEqual([]);

  await page.goto('/configuracoes?tab=products');
  const refreshedCard = page.locator('article').filter({ hasText: productName }).first();
  await expect(refreshedCard).toBeVisible();
  await refreshedCard.getByRole('button', { name: `Ações de ${productName}` }).click();
  await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
  const archiveDialog = page.getByRole('dialog', { name: 'Arquivar produto?' });
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(refreshedCard).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Produto arquivado.');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/atendimento');
  await conversation.waitFor({ state: 'visible', timeout: 15_000 });
  await conversation.click();
  await page.getByRole('button', { name: 'Produtos', exact: true }).click();
  const archivedPicker = page.getByRole('dialog', { name: 'Produtos' });
  await archivedPicker.getByLabel('Buscar produto para pré-visualizar').fill(productName);
  await expect(archivedPicker.getByText('Nenhum produto encontrado.')).toBeVisible();
  expect(providerMutations).toEqual([]);
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
    const create = await companyA.post('/api/products', {
      data: { name: productName, priceCents: 500, imageMimeType: 'image/png', imageBase64: tinyPng, companyId: '00000000-0000-4000-8000-000000000099' },
    });
    expect(create.status()).toBe(400);

    const created = await companyA.post('/api/products', {
      data: { name: productName, priceCents: 500, imageMimeType: 'image/png', imageBase64: tinyPng },
    });
    expect(created.status()).toBe(201);
    const payload = await created.json() as { product: { id: string; name: string; imageUrl: string; companyId?: string } };
    productId = payload.product.id;
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
    expect((await companyA.post('/api/products', {
      data: { name: 'Invalid price QA', priceCents: -1, imageMimeType: 'image/png', imageBase64: tinyPng },
    })).status()).toBe(400);
    expect((await companyA.post('/api/products', {
      data: { name: 'Invalid base64 QA', priceCents: 1, imageMimeType: 'image/png', imageBase64: 'not base64' },
    })).status()).toBe(400);
    expect((await companyA.post('/api/products', {
      data: { name: 'Spoofed MIME QA', priceCents: 1, imageMimeType: 'image/jpeg', imageBase64: tinyPng },
    })).status()).toBe(400);

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
  await page.goto('/configuracoes?tab=products');
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible();

  let failNextListRefresh = false;
  const mutationRequests = { create: 0, update: 0, archive: 0 };
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
    if (requestEvent.method() === 'POST' && url.pathname === '/api/products') mutationRequests.create += 1;
    if (requestEvent.method() === 'PATCH' && /^\/api\/products\/[0-9a-f-]+$/i.test(url.pathname)) mutationRequests.update += 1;
    if (requestEvent.method() === 'POST' && /^\/api\/products\/[0-9a-f-]+\/archive$/i.test(url.pathname)) mutationRequests.archive += 1;
    await route.continue();
  });

  const productName = `Refresh QA ${Date.now()}`;
  await page.getByRole('button', { name: 'Adicionar produto' }).click();
  await uploadValidProductImage(page);
  await page.getByLabel('Nome *').fill(productName);
  await page.getByLabel(/Valor/).fill('3990');
  failNextListRefresh = true;
  await page.getByRole('button', { name: 'Salvar produto' }).click();
  const card = page.locator('article').filter({ hasText: productName }).first();
  await expect(card).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Produto cadastrado.');
  await expect(page.getByRole('alert')).toContainText('Produto cadastrado, mas não foi possível atualizar a lista.');
  expect(mutationRequests.create).toBe(1);

  await card.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel(/Valor/).fill('129900');
  failNextListRefresh = true;
  await page.getByRole('button', { name: 'Salvar produto' }).click();
  await expect(card).toContainText('R$ 1.299,00');
  await expect(page.getByRole('status')).toContainText('Produto atualizado.');
  await expect(page.getByRole('alert')).toContainText('Produto atualizado, mas não foi possível atualizar a lista.');
  expect(mutationRequests.update).toBe(1);

  await card.getByRole('button', { name: `Ações de ${productName}` }).click();
  await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
  const archiveDialog = page.getByRole('dialog', { name: 'Arquivar produto?' });
  failNextListRefresh = true;
  await archiveDialog.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Produto arquivado.');
  await expect(page.getByRole('alert')).toContainText('Produto arquivado, mas não foi possível atualizar a lista.');
  expect(mutationRequests.archive).toBe(1);
});

test('falha real da mutation continua visível e submit repetido não duplica create', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  await page.goto('/configuracoes?tab=products');
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible();

  let createRequests = 0;
  await page.route('**/api/products**', async (route) => {
    const requestEvent = route.request();
    if (requestEvent.method() === 'POST' && new URL(requestEvent.url()).pathname === '/api/products') {
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
  await uploadValidProductImage(page);
  await page.getByLabel('Nome *').fill(`Mutation failure QA ${Date.now()}`);
  await page.getByLabel(/Valor/).fill('100');
  await page.locator('[role="dialog"] form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  const dialog = page.getByRole('dialog', { name: 'Adicionar produto' });
  await expect(dialog.getByRole('alert')).toHaveText('Falha real de gravação QA.');
  await expect(dialog).toBeVisible();
  expect(createRequests).toBe(1);
  await expect(page.getByText('Produto cadastrado.', { exact: true })).toHaveCount(0);
});
