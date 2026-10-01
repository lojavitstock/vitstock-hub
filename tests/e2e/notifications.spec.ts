import { expect, test } from '@playwright/test';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;

const login = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email!);
  await page.getByLabel('Senha').fill(password!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);
};

test('manifest PWA responde e o service worker registra no modo QA', async ({ page }) => {
  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json() as {
    name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: Array<{ src: string; sizes: string }>;
  };
  expect(manifest).toMatchObject({ name: 'Vitstock Hub', start_url: '/atendimento', scope: '/', display: 'standalone' });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: '/icons/vitstock-icon-192.png', sizes: '192x192' }),
    expect.objectContaining({ src: '/icons/vitstock-icon-512.png', sizes: '512x512' }),
  ]));
  const iconStatuses = await Promise.all(manifest.icons.map(async (icon) => (await page.request.get(icon.src)).status()));
  expect(iconStatuses).toEqual([200, 200]);

  await page.goto('/');
  const registered = await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration('/');
    return Boolean(registration?.active?.scriptURL.endsWith('/sw.js'));
  }, null, { timeout: 15_000 }).then(() => true).catch(() => false);
  expect(registered).toBe(true);
});

test('permissão só é solicitada pelo botão explícito nas configurações', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await page.addInitScript(() => {
    class NotificationPermissionMock {
      static permission: NotificationPermission = 'default';
      static requestCount = 0;
      static requestPermission = async () => {
        NotificationPermissionMock.requestCount += 1;
        NotificationPermissionMock.permission = 'granted';
        return NotificationPermissionMock.permission;
      };
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: NotificationPermissionMock });
  });
  await login(page);

  const initialPermission = await page.evaluate(() => Notification.permission);
  expect(initialPermission).toBe('default');
  await page.goto('/configuracoes?tab=application');
  await expect(page.getByRole('heading', { name: 'Aplicativo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ativar notificações' })).toBeVisible();
  expect(await page.evaluate(() => Notification.permission)).toBe('default');
  expect(await page.evaluate(() => (Notification as unknown as { requestCount: number }).requestCount)).toBe(0);

  await page.getByRole('button', { name: 'Ativar notificações' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Notificações ativadas' })).toBeVisible();
  expect(await page.evaluate(() => (Notification as unknown as { requestCount: number }).requestCount)).toBe(1);
});

test('mensagem inbound mock gera toast que abre a conversa; envio outbound não gera toast', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: async () => { throw new Error('Web Locks indisponível no teste'); } },
    });
  });
  const realtimeConnected = page.waitForResponse((response) => (
    response.url().includes('/api/evolution/events') && response.status() === 200
  ));
  await login(page);
  await page.bringToFront();

  const existingConversation = page.getByRole('button', { name: /Abrir conversa com/ }).first();
  await expect(existingConversation).toBeVisible({ timeout: 15_000 });
  await existingConversation.click();

  await realtimeConnected;

  const fixture = await page.evaluate(async () => {
    const response = await fetch('http://localhost:3001/api/qa/provider-only', {
      method: 'POST',
      credentials: 'include',
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  expect(fixture.status).toBe(200);
  const { remoteJid, name } = fixture.body as { remoteJid: string; name: string };
  const suffix = Date.now().toString().slice(-8);
  const content = `Mensagem inbound QA ${suffix}`;
  const injected = await page.evaluate(async (payload) => {
    const response = await fetch('http://localhost:3001/api/qa/evolution/inbound', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { remoteJid, name, content });
  expect(injected.status).toBe(200);

  const toast = page.getByRole('button', { name: `Abrir conversa: ${name}` });
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  await toast.click();
  await expect(page).toHaveURL(/\/atendimento$/);
  const selectedConversation = page.getByRole('button', { name: `Abrir conversa com ${name}` });
  await expect(selectedConversation).toHaveAttribute('aria-current', 'true');

  const outboundText = `Resposta outbound QA ${suffix}`;
  const sendResponse = page.waitForResponse((response) => (
    response.url().includes('/api/evolution/messages/send') && response.request().method() === 'POST'
  ));
  await page.locator('textarea[placeholder*="Digite sua mensagem"]').fill(outboundText);
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await sendResponse;
  await expect(page.getByRole('paragraph').filter({ hasText: outboundText })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Abrir conversa:/ })).toHaveCount(0);
});
