import { expect, test } from '@playwright/test';
import { attachBrowserDiagnostics, installBrowserDiagnostics, relevantBrowserErrors } from './support/diagnostics';

const expectedApi = process.env.PLAYWRIGHT_EXPECTED_API_URL || 'https://vitstock-hub-api-preview.up.railway.app';
const productionHosts = new Set(['vitstock-hub.vercel.app', 'vitstock-hub-api-production.up.railway.app']);
const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;
const previewHost = new URL(process.env.PLAYWRIGHT_BASE_URL || 'https://vitstock-hub-git-preview-vitstocks-projects.vercel.app').hostname;
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

test('Preview smoke usa o frontend e o backend Preview sem escrita funcional', async ({ page }, testInfo) => {
  const diagnostics = installBrowserDiagnostics(page);
  const requestOrigins = new Set<string>();

  if (!bypassSecret) throw new Error('Preview E2E abortado: VERCEL_AUTOMATION_BYPASS_SECRET ausente');

  // The bypass header is scoped to Vercel requests only. It must never be
  // forwarded to the Railway API or any other origin.
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname !== previewHost) {
      await route.continue();
      return;
    }

    await route.continue({
      headers: {
        ...route.request().headers(),
        'x-vercel-protection-bypass': bypassSecret,
        'x-vercel-set-bypass-cookie': 'true',
      },
    });
  });

  page.on('request', (request) => {
    try {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) requestOrigins.add(url.origin);
    } catch {
      // O Playwright já registra requestfailed quando uma URL não é válida.
    }
  });

  try {
    expect(email, 'E2E_EMAIL deve estar carregado').toBeTruthy();
    expect(password, 'E2E_PASSWORD deve estar carregado').toBeTruthy();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Vitstock Hub' })).toBeVisible();
    await expect(page.getByLabel('E-mail')).toBeVisible();

    await page.getByLabel('E-mail').fill(email!);
    await page.getByLabel('Senha').fill(password!);
    await page.getByRole('button', { name: 'Entrar' }).click();
    const reachedInbox = await page.waitForURL(/\/atendimento(?:\?.*)?$/, { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    if (!reachedInbox) {
      const loginAlert = page.getByRole('alert');
      if (await loginAlert.isVisible()) {
        throw new Error(`Login do Preview rejeitado: ${(await loginAlert.innerText()).slice(0, 160)}`);
      }
      throw new Error(`Login do Preview não redirecionou; URL atual: ${new URL(page.url()).pathname}`);
    }
    await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible();

    expect([...requestOrigins].some((origin) => origin === expectedApi), 'o frontend deve chamar o backend Preview').toBe(true);
    expect([...requestOrigins].some((origin) => productionHosts.has(new URL(origin).hostname)), 'nenhum endpoint Production pode ser chamado').toBe(false);
    expect(relevantBrowserErrors(diagnostics), 'erros fatais atribuíveis à aplicação').toEqual([]);
  } finally {
    await attachBrowserDiagnostics(page, diagnostics, testInfo);
  }
});

test('Conexão WhatsApp Preview expõe estado real e QR sem acessar Production', async ({ page }, testInfo) => {
  const diagnostics = installBrowserDiagnostics(page);
  const evolutionResponses: Array<{ path: string; status: number }> = [];
  const previewHost = new URL(process.env.PLAYWRIGHT_BASE_URL || 'https://vitstock-hub-git-preview-vitstocks-projects.vercel.app').hostname;
  const productionHosts = new Set(['vitstock-hub.vercel.app', 'vitstock-hub-api-production.up.railway.app']);

  page.on('response', (response) => {
    const url = new URL(response.url());
    if (productionHosts.has(url.hostname)) throw new Error('nenhum endpoint Production pode ser chamado');
    if (url.pathname === '/api/evolution/status' || url.pathname === '/api/evolution/connect') {
      evolutionResponses.push({ path: url.pathname, status: response.status() });
    }
  });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === previewHost) {
      await route.continue({
        headers: {
          ...route.request().headers(),
          'x-vercel-protection-bypass': bypassSecret,
          'x-vercel-set-bypass-cookie': 'true',
        },
      });
      return;
    }
    await route.continue();
  });

  try {
    expect(bypassSecret, 'VERCEL_AUTOMATION_BYPASS_SECRET deve estar carregado').toBeTruthy();
    expect(email, 'E2E_EMAIL deve estar carregado').toBeTruthy();
    expect(password, 'E2E_PASSWORD deve estar carregado').toBeTruthy();

    await page.goto('/');
    await page.getByLabel('E-mail').fill(email!);
    await page.getByLabel('Senha').fill(password!);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL(/\/atendimento(?:\?.*)?$/);
    await page.goto('/configuracoes?tab=connections');

    await expect.poll(() => evolutionResponses.some((entry) => entry.path === '/api/evolution/status' && entry.status === 200), { timeout: 10_000 }).toBe(true);
    let connectionResult = 'pending';
    await expect.poll(async () => {
      connectionResult = await page.getByText('ONLINE (Conectado)').isVisible().catch(() => false)
        ? 'connected'
        : evolutionResponses.some((entry) => entry.path === '/api/evolution/connect' && entry.status === 200) ? 'qr' : 'pending';
      return connectionResult;
    }, { timeout: 25_000 }).toMatch(/connected|qr/);
    if (connectionResult !== 'connected') {
      await expect(page.getByAltText('QR Code WhatsApp')).toBeVisible({ timeout: 25_000 });
    }

    expect(evolutionResponses.filter((entry) => entry.status >= 400)).toEqual([]);
    expect(relevantBrowserErrors(diagnostics)).toEqual([]);
  } finally {
    await attachBrowserDiagnostics(page, diagnostics, testInfo);
  }
});
