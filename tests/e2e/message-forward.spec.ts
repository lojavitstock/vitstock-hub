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

type InboundOptions = {
  mediaType?: 'image';
  mediaAvailable?: boolean;
  phone?: string;
  isGroup?: boolean;
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
};

async function createInbound(page: Page, remoteJid: string, content: string, name = 'Cliente Forward QA', options: InboundOptions = {}) {
  const response = await page.request.post(`${apiBase}/api/qa/evolution/inbound`, {
    data: { remoteJid, content, name, ...options },
  });
  expect(response.status()).toBe(200);
  return await response.json() as { evolutionMessageId: string };
}

async function getEvolutionSendState(page: Page) {
  const response = await page.request.get(`${apiBase}/api/qa/evolution/sends`);
  expect(response.status()).toBe(200);
  return await response.json() as {
    sends: Array<Record<string, unknown>>;
    mediaRequests: Array<Record<string, unknown>>;
  };
}

async function openForwardDialog(page: Page, sourceName: string, sourceMessageId: string) {
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
  const sourceMessage = page.locator(`[data-message-id="${sourceMessageId}"]`);
  await expect(sourceMessage).toBeVisible({ timeout: 15_000 });
  await sourceMessage.getByRole('button', { name: 'Abrir ações da mensagem' }).click();
  await page.getByRole('menuitem', { name: 'Encaminhar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Encaminhar mensagem' });
  await expect(dialog).toBeVisible();
  return dialog;
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

test('encaminha imagem pela mesma UI, recupera a mídia e preserva a legenda', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);

  const suffix = Date.now().toString().slice(-7);
  const sourceName = `Forward Image UI Source ${suffix}`;
  const destinationName = `Forward Image UI Destination ${suffix}`;
  const sourceCaption = `Legenda da imagem UI ${suffix}`;
  const source = await createInbound(page, `552197${suffix}@s.whatsapp.net`, sourceCaption, sourceName, { mediaType: 'image' });
  const destinationRemoteJid = `552196${suffix}@s.whatsapp.net`;
  await createInbound(page, destinationRemoteJid, `Destino imagem ${suffix}`, destinationName);
  const beforeState = await getEvolutionSendState(page);

  const dialog = await openForwardDialog(page, sourceName, source.evolutionMessageId);
  await expect(dialog).toContainText(`Imagem — ${sourceCaption}`);
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
  expect(forwardRequests).toHaveLength(0);
  await expect(dialog).toContainText(`Destino: ${destinationName}`);

  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/evolution/messages/forward'));
  await dialog.getByRole('button', { name: 'Encaminhar', exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect.poll(() => forwardRequests.length).toBe(1);
  expect(forwardRequests[0]).toEqual(expect.objectContaining({
    sourceMessageId: source.evolutionMessageId,
    destinationRemoteJid,
  }));
  await expect(dialog).toHaveCount(0);

  const afterState = await getEvolutionSendState(page);
  const newSends = afterState.sends.slice(beforeState.sends.length);
  const send = newSends.at(-1);
  expect(send).toEqual(expect.objectContaining({ number: destinationRemoteJid, mediatype: 'image', mimetype: 'image/png' }));
  expect(String(send?.media || '')).not.toHaveLength(0);
  expect(String(send?.caption || '')).toContain(sourceCaption);
  expect('quoted' in (send || {})).toBe(false);
  expect(afterState.mediaRequests.some((request) => request.id === source.evolutionMessageId && request.remoteJid === `552197${suffix}@s.whatsapp.net`)).toBe(true);
});

test('forward image uses the persisted provider key for PN, LID and group and rejects unavailable media', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);

  const suffix = Date.now().toString().slice(-7);
  const sourceRemoteJid = `552195${suffix}@s.whatsapp.net`;
  const sourceCaption = `Legenda original ${suffix}`;
  const source = await createInbound(page, sourceRemoteJid, sourceCaption, `Forward Image Source ${suffix}`, { mediaType: 'image' });
  const destinations = [
    `552194${suffix}@s.whatsapp.net`,
    `16470000000${suffix.slice(-2)}@lid`,
    `12036300000${suffix.slice(-2)}@g.us`,
  ];
  for (const [index, destinationRemoteJid] of destinations.entries()) {
    await createInbound(page, destinationRemoteJid, `Destino ${index} ${suffix}`, `Forward Image Destination ${index} ${suffix}`, { isGroup: destinationRemoteJid.endsWith('@g.us') });
  }
  const noCaption = await createInbound(page, `552193${suffix}@s.whatsapp.net`, '', `Forward Image No Caption ${suffix}`, { mediaType: 'image' });
  const broken = await createInbound(page, `552192${suffix}@s.whatsapp.net`, '', `Forward Image Broken ${suffix}`, { mediaType: 'image', mediaAvailable: false });
  const beforeState = await getEvolutionSendState(page);
  const clientMessageIds = destinations.map((_, index) => `qa-forward-image-${Date.now()}-${index}`);

  for (const [index, destinationRemoteJid] of destinations.entries()) {
    const clientMessageId = clientMessageIds[index];
    const response = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
      data: { sourceMessageId: source.evolutionMessageId, destinationRemoteJid, clientMessageId },
    });
    expect(response.status()).toBe(200);
    const body = await response.json() as { remoteJid?: string; evolution?: { key?: { remoteJid?: string } } };
    expect(body.remoteJid).toBe(destinationRemoteJid);
    expect(body.evolution?.key?.remoteJid).toBe(destinationRemoteJid);
  }

  const noCaptionResponse = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
    data: { sourceMessageId: noCaption.evolutionMessageId, destinationRemoteJid: destinations[0], clientMessageId: `qa-forward-image-no-caption-${Date.now()}` },
  });
  expect(noCaptionResponse.status()).toBe(200);

  const brokenResponse = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
    data: { sourceMessageId: broken.evolutionMessageId, destinationRemoteJid: destinations[0], clientMessageId: `qa-forward-image-broken-${Date.now()}` },
  });
  expect(brokenResponse.status()).toBe(422);
  expect((await brokenResponse.json()).code).toBe('forward_media_unavailable');

  const injectedMedia = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
    data: { sourceMessageId: source.evolutionMessageId, destinationRemoteJid: destinations[0], media: 'arbitrary', base64: 'arbitrary', url: 'https://example.test/image', clientMessageId: `qa-forward-image-injected-${Date.now()}` },
  });
  expect(injectedMedia.status()).toBe(400);

  const stateAfterFirstPass = await getEvolutionSendState(page);
  const newSends = stateAfterFirstPass.sends.slice(beforeState.sends.length);
  expect(newSends).toHaveLength(destinations.length + 1);
  expect(newSends.slice(0, destinations.length).map((send) => send.number)).toEqual(destinations);
  for (const send of newSends.slice(0, destinations.length)) {
    expect(send.mediatype).toBe('image');
    expect(send.mimetype).toBe('image/png');
    expect(String(send.media || '')).not.toHaveLength(0);
    expect(String(send.caption || '')).toContain(sourceCaption);
    expect('quoted' in send).toBe(false);
  }
  expect(newSends.at(-1)?.number).toBe(destinations[0]);
  expect(newSends.at(-1)?.caption).toBeUndefined();
  expect(stateAfterFirstPass.mediaRequests.some((request) => request.id === source.evolutionMessageId && request.remoteJid === sourceRemoteJid)).toBe(true);
  expect(stateAfterFirstPass.mediaRequests.some((request) => request.id === broken.evolutionMessageId)).toBe(true);

  const retry = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
    data: { sourceMessageId: source.evolutionMessageId, destinationRemoteJid: destinations[0], clientMessageId: clientMessageIds[0] },
  });
  expect(retry.status()).toBe(200);
  expect((await getEvolutionSendState(page)).sends).toHaveLength(stateAfterFirstPass.sends.length);
});

test('falha de recuperação da imagem mantém o diálogo aberto e permite cancelar', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);

  const suffix = Date.now().toString().slice(-7);
  const sourceName = `Forward Broken Image ${suffix}`;
  const destinationName = `Forward Broken Destination ${suffix}`;
  const source = await createInbound(page, `552191${suffix}@s.whatsapp.net`, '', sourceName, { mediaType: 'image', mediaAvailable: false });
  const destinationRemoteJid = `552190${suffix}@s.whatsapp.net`;
  await createInbound(page, destinationRemoteJid, `Destino quebrado ${suffix}`, destinationName);

  const dialog = await openForwardDialog(page, sourceName, source.evolutionMessageId);
  const search = dialog.getByRole('textbox', { name: 'Buscar conversa de destino' });
  await search.fill(destinationName);
  await dialog.getByRole('option', { name: new RegExp(destinationName) }).click();
  const forwardRequests: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/evolution/messages/forward')) forwardRequests.push(request.postDataJSON() as Record<string, unknown>);
  });
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/evolution/messages/forward'));
  await dialog.getByRole('button', { name: 'Encaminhar', exact: true }).click();
  expect((await responsePromise).status()).toBe(422);
  await expect(dialog.getByRole('alert')).toContainText('Não foi possível recuperar a imagem');
  await expect(dialog).toBeVisible();
  expect(forwardRequests).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(forwardRequests).toHaveLength(1);
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

test('encaminha localização fixa pela UI sem enviar coordenadas no payload do Hub', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);

  const suffix = Date.now().toString().slice(-7);
  const sourceName = `Forward Location UI Source ${suffix}`;
  const destinationName = `Forward Location UI Destination ${suffix}`;
  const source = await createInbound(page, `552188${suffix}@s.whatsapp.net`, '', sourceName, {
    location: { latitude: -22.9068, longitude: -43.1729, name: 'Ponto do Rio', address: 'Endereço QA' },
  });
  const destinationRemoteJid = `552187${suffix}@s.whatsapp.net`;
  await createInbound(page, destinationRemoteJid, `Destino localização ${suffix}`, destinationName);
  const beforeState = await getEvolutionSendState(page);

  const dialog = await openForwardDialog(page, sourceName, source.evolutionMessageId);
  await expect(dialog).toContainText('Localização compartilhada');
  const forwardRequests: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/evolution/messages/forward')) forwardRequests.push(request.postDataJSON() as Record<string, unknown>);
  });
  expect(forwardRequests).toHaveLength(0);

  await dialog.getByRole('textbox', { name: 'Buscar conversa de destino' }).fill(destinationName);
  await dialog.getByRole('option', { name: new RegExp(destinationName) }).click();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/evolution/messages/forward'));
  await dialog.getByRole('button', { name: 'Encaminhar', exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect.poll(() => forwardRequests.length).toBe(1);
  expect(forwardRequests[0]).toEqual(expect.objectContaining({
    sourceMessageId: source.evolutionMessageId,
    destinationRemoteJid,
  }));
  expect(forwardRequests[0]).not.toHaveProperty('latitude');
  expect(forwardRequests[0]).not.toHaveProperty('longitude');
  expect(forwardRequests[0]).not.toHaveProperty('name');
  expect(forwardRequests[0]).not.toHaveProperty('address');
  await expect(dialog).toHaveCount(0);

  const afterState = await getEvolutionSendState(page);
  const send = afterState.sends.slice(beforeState.sends.length).at(-1);
  expect(send).toEqual(expect.objectContaining({
    number: destinationRemoteJid,
    latitude: -22.9068,
    longitude: -43.1729,
    name: 'Ponto do Rio',
    address: 'Endereço QA',
  }));
  expect(send).not.toHaveProperty('url');
  expect(send).not.toHaveProperty('text');
});

test('forward location preserves PN, LID and group identities, validates coordinates and is idempotent', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);

  const suffix = Date.now().toString().slice(-7);
  const source = await createInbound(page, `552186${suffix}@s.whatsapp.net`, '', `Forward Location API Source ${suffix}`, {
    location: { latitude: 0, longitude: 0 },
  });
  const destinations = [
    `552185${suffix}@s.whatsapp.net`,
    `16470000000${suffix.slice(-2)}@lid`,
    `12036300000${suffix.slice(-2)}@g.us`,
  ];
  for (const [index, destinationRemoteJid] of destinations.entries()) {
    await createInbound(page, destinationRemoteJid, `Destino localização ${index} ${suffix}`, `Forward Location Destination ${index} ${suffix}`, {
      isGroup: destinationRemoteJid.endsWith('@g.us'),
    });
  }
  const beforeState = await getEvolutionSendState(page);
  const clientMessageIds = destinations.map((_, index) => `qa-forward-location-${Date.now()}-${index}`);

  for (const [index, destinationRemoteJid] of destinations.entries()) {
    const response = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
      data: {
        sourceMessageId: source.evolutionMessageId,
        destinationRemoteJid,
        clientMessageId: clientMessageIds[index],
      },
    });
    expect(response.status()).toBe(200);
    const body = await response.json() as { remoteJid?: string; evolution?: { key?: { remoteJid?: string } } };
    expect(body.remoteJid).toBe(destinationRemoteJid);
    expect(body.evolution?.key?.remoteJid).toBe(destinationRemoteJid);
  }

  const afterState = await getEvolutionSendState(page);
  const newSends = afterState.sends.slice(beforeState.sends.length);
  expect(newSends).toHaveLength(destinations.length);
  expect(newSends.map((send) => send.number)).toEqual(destinations);
  for (const send of newSends) {
    expect(send).toEqual(expect.objectContaining({ latitude: 0, longitude: 0, name: '', address: '' }));
    expect(send).not.toHaveProperty('url');
    expect(send).not.toHaveProperty('text');
  }

  const retry = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
    data: { sourceMessageId: source.evolutionMessageId, destinationRemoteJid: destinations[0], clientMessageId: clientMessageIds[0] },
  });
  expect(retry.status()).toBe(200);
  expect((await retry.json()).deduplicated).toBe(true);
  expect((await getEvolutionSendState(page)).sends).toHaveLength(afterState.sends.length);

  const invalidSource = await createInbound(page, `552184${suffix}@s.whatsapp.net`, '', `Forward Invalid Location ${suffix}`, {
    location: { latitude: 91, longitude: 0 },
  });
  const invalid = await page.request.post(`${apiBase}/api/evolution/messages/forward`, {
    data: { sourceMessageId: invalidSource.evolutionMessageId, destinationRemoteJid: destinations[0], clientMessageId: `qa-forward-location-invalid-${Date.now()}` },
  });
  expect(invalid.status()).toBe(422);
  expect((await invalid.json()).code).toBe('source_location_invalid');
  expect((await getEvolutionSendState(page)).sends).toHaveLength(afterState.sends.length);
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
