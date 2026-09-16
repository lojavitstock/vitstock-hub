import { expect, test, type Page } from '@playwright/test';

const apiBase = process.env.VITE_API_URL || 'http://localhost:3001';
const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;

async function login(page: Page, credentials = { email, password }) {
  const response = await page.request.post(`${apiBase}/api/auth/login`, {
    data: credentials,
  });
  expect(response.status()).toBe(200);
}

async function createInbound(page: Page, remoteJid: string, content: string, name = 'Cliente Forward QA') {
  const response = await page.request.post(`${apiBase}/api/qa/evolution/inbound`, {
    data: { remoteJid, content, name },
  });
  expect(response.status()).toBe(200);
  return await response.json() as { evolutionMessageId: string };
}

test('encaminha texto pela UI para um destino existente sem envio prematuro', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);

  const suffix = Date.now().toString().slice(-7);
  const sourceRemoteJid = `552199${suffix}@s.whatsapp.net`;
  const destinationRemoteJid = `552198${suffix}@s.whatsapp.net`;
  const sourceName = `Forward UI Source ${suffix}`;
  const destinationName = `Forward UI Destination ${suffix}`;
  const sourceText = `Texto UI para encaminhar ${suffix}`;
  const source = await createInbound(page, sourceRemoteJid, sourceText, sourceName);
  await createInbound(page, destinationRemoteJid, `Destino preparado ${suffix}`, destinationName);

  await page.goto('/');
  await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible();
  const syncChats = page.getByRole('button', { name: 'Sincronizar Mensagens' });
  await expect(syncChats).toBeEnabled({ timeout: 15_000 });
  const sourceConversation = page.getByRole('button', { name: `Abrir conversa com ${sourceName}` });
  await expect.poll(async () => {
    if (await sourceConversation.isVisible().catch(() => false)) return true;
    await syncChats.click();
    return sourceConversation.isVisible().catch(() => false);
  }, { timeout: 20_000, intervals: [500, 1_500, 3_000] }).toBe(true);
  await sourceConversation.click();

  const sourceMessage = page.locator('[data-message-id]').filter({ hasText: sourceText }).last();
  await expect(sourceMessage).toBeVisible({ timeout: 15_000 });
  const sourceMessageId = await sourceMessage.getAttribute('data-message-id');
  expect(sourceMessageId).toBe(source.evolutionMessageId);
  await sourceMessage.getByRole('button', { name: 'Abrir ações da mensagem' }).click();
  await page.getByRole('menuitem', { name: 'Encaminhar', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Encaminhar mensagem' });
  await expect(dialog).toBeVisible();
  const forwardRequests: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/evolution/messages/forward')) forwardRequests.push(request.postDataJSON() as Record<string, unknown>);
  });
  expect(forwardRequests).toHaveLength(0);

  const search = dialog.getByRole('textbox', { name: 'Buscar conversa de destino' });
  await search.fill(destinationName);
  const destination = dialog.getByRole('option', { name: new RegExp(destinationName) });
  await expect(destination).toBeVisible();
  await destination.click();
  await expect(dialog).toContainText(`Destino: ${destinationName}`);
  expect(forwardRequests).toHaveLength(0);

  const confirm = dialog.getByRole('button', { name: 'Encaminhar', exact: true });
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/evolution/messages/forward'));
  await confirm.dblclick();
  expect((await responsePromise).status()).toBe(200);
  await expect.poll(() => forwardRequests.length).toBe(1);
  expect(forwardRequests[0]).toEqual(expect.objectContaining({
    sourceMessageId: source.evolutionMessageId,
    destinationRemoteJid,
  }));
  expect(String(forwardRequests[0]?.clientMessageId || '')).toMatch(/^forward-/);
  await expect(dialog).toHaveCount(0);
});

test('forward text uses existing PN, LID and group identities and is idempotent', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);

  const source = await createInbound(page, `552199100${Date.now().toString().slice(-6)}@s.whatsapp.net`, 'Texto original para encaminhar');
  const destinations = [
    '5521990000001@s.whatsapp.net',
    '164700000001@lid',
    '120363000000@g.us',
  ];

  for (const [index, destinationRemoteJid] of destinations.entries()) {
    const clientMessageId = `qa-forward-${Date.now()}-${index}`;
    const response = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
      data: {
        sourceMessageId: source.evolutionMessageId,
        destinationRemoteJid,
        clientMessageId,
      },
    });
    expect(response.status()).toBe(200);
    const body = await response.json() as {
      remoteJid?: string;
      evolution?: { key?: { remoteJid?: string } };
    };
    expect(body.remoteJid).toBe(destinationRemoteJid);
    expect(body.evolution?.key?.remoteJid).toBe(destinationRemoteJid);

    const retry = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
      data: { sourceMessageId: source.evolutionMessageId, destinationRemoteJid, clientMessageId },
    });
    expect(retry.status()).toBe(200);
    expect((await retry.json()).deduplicated).toBe(true);
  }
});

test('forward text rejects arbitrary destinations, cross-tenant records and number payloads', async ({ page, browser }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  const source = await createInbound(page, `552199101${Date.now().toString().slice(-6)}@s.whatsapp.net`, 'Fonte isolada para QA');

  const invalid = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
    data: { sourceMessageId: source.evolutionMessageId, destinationRemoteJid: 'status@broadcast', clientMessageId: `qa-forward-invalid-${Date.now()}` },
  });
  expect(invalid.status()).toBe(400);

  const inaccessible = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
    data: { sourceMessageId: source.evolutionMessageId, destinationRemoteJid: '999999999999999@lid', clientMessageId: `qa-forward-missing-${Date.now()}` },
  });
  expect(inaccessible.status()).toBe(404);

  const numberPayload = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
    data: { sourceMessageId: source.evolutionMessageId, destinationRemoteJid: '5521990000001@s.whatsapp.net', number: '5521888888888', clientMessageId: `qa-forward-number-${Date.now()}` },
  });
  expect(numberPayload.status()).toBe(400);

  const tenantB = await browser.newPage();
  try {
    await login(tenantB, { email: 'qa-admin-b@vitstock.test', password });
    const sourceB = await createInbound(tenantB, `552198${Date.now().toString().slice(-8)}@s.whatsapp.net`, 'Fonte de outra empresa');

    const foreignSource = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
      data: { sourceMessageId: sourceB.evolutionMessageId, destinationRemoteJid: '5521990000001@s.whatsapp.net', clientMessageId: `qa-forward-foreign-source-${Date.now()}` },
    });
    expect(foreignSource.status()).toBe(404);

    const foreignDestination = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
      data: { sourceMessageId: source.evolutionMessageId, destinationRemoteJid: '5521988000001@s.whatsapp.net', clientMessageId: `qa-forward-foreign-destination-${Date.now()}` },
    });
    expect(foreignDestination.status()).toBe(404);
  } finally {
    await tenantB.close();
  }
});
