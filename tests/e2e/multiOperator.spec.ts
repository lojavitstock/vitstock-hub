import { expect, test } from '@playwright/test';
import { attachBrowserDiagnostics, installBrowserDiagnostics, relevantBrowserErrors } from './support/diagnostics';

const primaryEmail = process.env.E2E_EMAIL?.trim();
const primaryPassword = process.env.E2E_PASSWORD;
const secondEmail = process.env.E2E_SECOND_EMAIL?.trim();
const secondPassword = process.env.E2E_SECOND_PASSWORD;

const login = async (page: import('@playwright/test').Page, email: string, password: string) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible();
};

test('dois operadores QA compartilham SSE e mantêm o lease da conversa', async ({ browser }, testInfo) => {
  test.skip(!primaryEmail || !primaryPassword || !secondEmail || !secondPassword, 'credenciais QA de dois operadores ausentes');

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const diagnosticsA = installBrowserDiagnostics(pageA);
  const diagnosticsB = installBrowserDiagnostics(pageB);

  try {
    await Promise.all([
      login(pageA, primaryEmail!, primaryPassword!),
      login(pageB, secondEmail!, secondPassword!),
    ]);
    const [meAResponse, meBResponse] = await Promise.all([
      contextA.request.get('http://localhost:3001/api/auth/me'),
      contextB.request.get('http://localhost:3001/api/auth/me'),
    ]);
    expect((await meAResponse.json()).user?.name).toBe('QA Admin A');
    expect((await meBResponse.json()).user?.name).toBe('Fernanda QA');

    const anaA = pageA.getByTitle('Ana QA — Olá, preciso de uma cotação QA.');
    const multiB = pageB.getByTitle('Contato QA com dois números — Thread do telefone principal.');
    await expect(anaA).toBeVisible();
    await expect(multiB).toBeVisible();
    await anaA.click();
    await multiB.click();

    const textA = `QA Leo ${Date.now()}`;
    const textB = `QA Fernanda ${Date.now()}`;
    const composerA = pageA.locator('textarea[placeholder*="Digite sua mensagem"]');
    const composerB = pageB.locator('textarea[placeholder*="Digite sua mensagem"]');
    await composerA.fill(textA);
    const sendAResponsePromise = pageA.waitForResponse((response) => response.url().endsWith('/api/evolution/messages/send'));
    await composerA.press('Enter');
    expect((await sendAResponsePromise).status()).toBe(200);
    await expect(pageA.locator('[data-message-id]').filter({ hasText: textA })).toBeVisible();

    await composerB.fill(textB);
    const sendBResponsePromise = pageB.waitForResponse((response) => response.url().endsWith('/api/evolution/messages/send'));
    await composerB.press('Enter');
    expect((await sendBResponsePromise).status()).toBe(200);
    await expect(pageB.locator('[data-message-id]').filter({ hasText: textB })).toBeVisible();

    // Both browsers receive company-scoped realtime updates even while viewing
    // different conversations; no cookie/session is shared between contexts.
    await expect(pageA.getByRole('button', { name: /Abrir conversa com Contato QA com dois números/ }).first()).toContainText(textB);
    await expect(pageB.getByRole('button', { name: /Abrir conversa com Ana QA/ }).first()).toContainText(textA);

    // Leo owns Ana's lease after the first send. Fernanda receives the
    // explicit contention response rather than a generic send failure.
    const leaseResponse = await contextB.request.post('http://localhost:3001/api/evolution/messages/send', {
      data: {
        number: '5521990000001',
        remoteJid: '5521990000001@s.whatsapp.net',
        text: `QA blocked ${Date.now()}`,
        clientMessageId: `qa-lease-${Date.now()}`,
      },
    });
    expect(leaseResponse.status()).toBe(409);
    const leaseBody = await leaseResponse.json();
    expect(leaseBody.code).toBe('conversation_lease_active');
    expect(String(leaseBody.error)).toContain('QA Admin A');

    expect(relevantBrowserErrors(diagnosticsA)).toEqual([]);
    expect(relevantBrowserErrors(diagnosticsB)).toEqual([]);
  } finally {
    await attachBrowserDiagnostics(pageA, diagnosticsA, testInfo);
    await attachBrowserDiagnostics(pageB, diagnosticsB, testInfo);
    await contextA.close();
    await contextB.close();
  }
});
