import { expect, test, type Page } from '@playwright/test';

const apiBase = process.env.VITE_API_URL || 'http://localhost:3001';
const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;

async function login(page: Page) {
  const response = await page.request.post(`${apiBase}/api/auth/login`, { data: { email, password } });
  expect(response.status()).toBe(200);
}

async function createInbound(page: Page, remoteJid: string, content: string, name: string) {
  const response = await page.request.post(`${apiBase}/api/qa/evolution/inbound`, {
    data: { remoteJid, content, name },
  });
  expect(response.status()).toBe(200);
}

async function getSends(page: Page) {
  const response = await page.request.get(`${apiBase}/api/qa/evolution/sends`);
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    sends: Array<Record<string, unknown>>;
    mediaRequests: Array<Record<string, unknown>>;
  };
}

test('Nova mensagem busca, mantém destino pendente e materializa uma única conversa no primeiro envio', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);

  const suffix = Date.now().toString().slice(-7);
  const existingName = `New Message Existing ${suffix}`;
  const existingRemoteJid = `552199${suffix}@s.whatsapp.net`;
  const manualDigits = `552198${suffix}`;
  const manualRemoteJid = `${manualDigits}@s.whatsapp.net`;
  await createInbound(page, existingRemoteJid, `Conversa recente ${suffix}`, existingName);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible();
  const syncChats = page.getByRole('button', { name: 'Sincronizar Mensagens' });
  await expect(syncChats).toBeEnabled({ timeout: 15_000 });
  const newMessageButton = page.getByRole('button', { name: 'Nova mensagem' });
  await newMessageButton.click();

  const dialog = page.getByRole('dialog', { name: 'Nova mensagem' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Recentes', { exact: true })).toBeVisible();
  const existingOption = dialog.getByRole('button', { name: new RegExp(existingName) });
  await expect.poll(() => existingOption.isVisible().catch(() => false), { timeout: 15_000, intervals: [500, 1_000] }).toBe(true);

  const sendRequests: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/evolution/messages/send')) sendRequests.push(request.postDataJSON() as Record<string, unknown>);
  });
  await existingOption.click();
  await expect(dialog).toHaveCount(0);
  expect(sendRequests).toHaveLength(0);

  await newMessageButton.click();
  const nameSearchDialog = page.getByRole('dialog', { name: 'Nova mensagem' });
  const nameSearch = nameSearchDialog.getByRole('textbox', { name: 'Buscar nome ou digitar número' });
  await nameSearch.fill(existingName);
  await expect(nameSearchDialog.getByRole('heading', { name: 'Conversas existentes' })).toBeVisible();
  await expect(nameSearchDialog.getByRole('button', { name: new RegExp(existingName) })).toBeVisible();
  await nameSearch.press('Escape');
  await expect(nameSearchDialog).toHaveCount(0);

  await newMessageButton.click();
  const manualDialog = page.getByRole('dialog', { name: 'Nova mensagem' });
  const search = manualDialog.getByRole('textbox', { name: 'Buscar nome ou digitar número' });
  await search.fill(manualDigits);
  const manualOption = manualDialog.getByRole('button', { name: /Conversar com/ });
  await expect(manualOption).toBeVisible();
  await manualOption.click();
  await expect(manualDialog).toHaveCount(0);
  expect(sendRequests).toHaveLength(0);

  const pendingAttachmentButton = page.getByRole('button', { name: 'Anexar arquivo' });
  await expect(pendingAttachmentButton).toBeDisabled();
  const pendingSends = await getSends(page);
  expect(pendingSends.sends).toHaveLength((await getSends(page)).sends.length);

  const composer = page.locator('textarea[placeholder*="Digite sua mensagem"]');
  await expect(composer).toBeVisible();
  const before = pendingSends;
  const firstText = `Primeira mensagem ${suffix}`;
  const sendResponse = page.waitForResponse((response) => response.url().endsWith('/api/evolution/messages/send'));
  await composer.fill(firstText);
  await composer.press('Enter');
  expect((await sendResponse).status()).toBe(200);
  await expect.poll(async () => (await getSends(page)).sends.length, { timeout: 15_000 }).toBeGreaterThan(before.sends.length);
  const after = await getSends(page);
  const lastSend = after.sends.at(-1);
  expect(lastSend).toEqual(expect.objectContaining({ number: manualRemoteJid }));
  expect(String(lastSend?.text || '')).toContain(firstText);
  expect(sendRequests.at(-1)).toEqual(expect.objectContaining({ remoteJid: manualRemoteJid }));
  await expect(pendingAttachmentButton).toBeEnabled();
  await expect(page.getByRole('button', { name: `Abrir conversa com +${manualDigits}` })).toHaveCount(1);
});

test('send-media e resolver exigem destino autorizado e preservam a identidade provider', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);

  const resolve = async (body: Record<string, unknown>) => {
    const response = await page.request.post(`${apiBase}/api/evolution/conversations/resolve-destination`, { data: body });
    return { response, body: await response.json().catch(() => ({})) as Record<string, any> };
  };

  const pn = await resolve({ conversationId: '5521990000001@s.whatsapp.net' });
  expect(pn.response.status()).toBe(200);
  expect(pn.body.remoteJid).toBe('5521990000001@s.whatsapp.net');
  const lid = await resolve({ conversationId: '164700000001@lid' });
  expect(lid.response.status()).toBe(200);
  expect(lid.body.remoteJid).toBe('164700000001@lid');

  const multiContactsResponse = await page.request.get(`${apiBase}/api/contacts?q=${encodeURIComponent('Contato QA com dois números')}&limit=20`);
  expect(multiContactsResponse.status()).toBe(200);
  const multiContacts = await multiContactsResponse.json() as { contacts?: Array<{ id: string; name: string }> };
  const multiContact = multiContacts.contacts?.find((contact) => contact.name === 'Contato QA com dois números');
  expect(multiContact).toBeTruthy();
  const multi = await resolve({ contactId: multiContact!.id });
  expect(multi.response.status()).toBe(200);
  expect(multi.body.kind).toBe('multiple');
  expect(multi.body.options).toHaveLength(3);
  expect(multi.body.options).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'existing', conversationId: '5521990000002@s.whatsapp.net' }),
    expect.objectContaining({ kind: 'existing', conversationId: '5521990000022@s.whatsapp.net' }),
    expect.objectContaining({ kind: 'phone', phone: '55219900000022' }),
  ]));

  const syncGoogle = await page.request.post(`${apiBase}/api/google/sync`, { data: {} });
  expect(syncGoogle.status()).toBe(200);
  const googleContactsResponse = await page.request.get(`${apiBase}/api/contacts?q=${encodeURIComponent('Novo Contato Google QA')}&limit=20`);
  expect(googleContactsResponse.status()).toBe(200);
  const googleContacts = await googleContactsResponse.json() as { contacts?: Array<{ id: string; name: string }> };
  const googleContact = googleContacts.contacts?.find((contact) => contact.name === 'Novo Contato Google QA');
  expect(googleContact).toBeTruthy();
  const google = await resolve({ contactId: googleContact!.id });
  expect(google.response.status()).toBe(200);
  expect(google.body.kind).toBe('new_phone');
  expect(google.body.remoteJid).toBe('5521990000100@s.whatsapp.net');

  const arbitrary = await resolve({ conversationId: '999999999@lid' });
  expect(arbitrary.response.status()).toBe(404);
  const crossTenant = await resolve({ conversationId: '5521988000001@s.whatsapp.net' });
  expect(crossTenant.response.status()).toBe(404);

  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const sendMedia = async (remoteJid: string, number: string, clientMessageId: string) => page.request.post(`${apiBase}/api/evolution/messages/send-media`, {
    data: {
      number,
      remoteJid,
      mediatype: 'image',
      mimetype: 'image/png',
      media: image,
      clientMessageId,
    },
  });

  const before = await getSends(page);
  const pnMedia = await sendMedia('5521990000001@s.whatsapp.net', '', `qa-media-pn-${Date.now()}`);
  expect(pnMedia.status()).toBe(200);
  const lidMedia = await sendMedia('164700000001@lid', '', `qa-media-lid-${Date.now()}`);
  expect(lidMedia.status()).toBe(200);
  const groupMedia = await sendMedia('120363000000@g.us', '120363000000@g.us', `qa-media-group-${Date.now()}`);
  expect(groupMedia.status()).toBe(200);
  const mismatchMedia = await sendMedia('5521990000001@s.whatsapp.net', '5521990000099', `qa-media-mismatch-${Date.now()}`);
  expect(mismatchMedia.status()).toBe(200);
  const arbitraryMedia = await sendMedia('999999999@lid', '', `qa-media-arbitrary-${Date.now()}`);
  expect(arbitraryMedia.status()).toBe(404);
  const crossTenantMedia = await sendMedia('5521988000001@s.whatsapp.net', '', `qa-media-cross-tenant-${Date.now()}`);
  expect(crossTenantMedia.status()).toBe(404);

  await expect.poll(async () => (await getSends(page)).sends.length, { timeout: 15_000 }).toBeGreaterThan(before.sends.length + 3);
  const newSends = (await getSends(page)).sends.slice(before.sends.length).filter((send) => send.mediatype === 'image');
  expect(newSends.map((send) => send.number)).toEqual([
    '5521990000001@s.whatsapp.net',
    '164700000001@lid',
    '120363000000@g.us',
    '5521990000001@s.whatsapp.net',
  ]);
});
