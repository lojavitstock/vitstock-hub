import { expect, test } from '@playwright/test';
import { attachBrowserDiagnostics, installBrowserDiagnostics, relevantBrowserErrors } from './support/diagnostics';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;

test('Atendimento abre a lista e uma conversa sem enviar mensagens', async ({ page }, testInfo) => {
  const diagnostics = installBrowserDiagnostics(page);

  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');

  try {
    await page.goto('/');
    await page.getByLabel('E-mail').fill(email!);
    await page.getByLabel('Senha').fill(password!);
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);
    await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible();

    const conversations = page.getByRole('button', { name: /Abrir conversa com/ });
    await expect(conversations.first()).toBeVisible({ timeout: 15_000 });
    await conversations.first().click();

    await expect(page.locator('textarea[placeholder*="Digite sua mensagem"]')).toBeVisible();
    await expect(page.locator('[data-message-id]').first()).toBeVisible({ timeout: 15_000 });

    const validAvatar = page.getByRole('button', { name: 'Abrir conversa com Contato QA Avatar Válido' });
    const missingAvatar = page.getByRole('button', { name: 'Abrir conversa com Contato QA Avatar Ausente' });
    const brokenAvatar = page.getByRole('button', { name: 'Abrir conversa com Contato QA Avatar Quebrado' });
    await expect(validAvatar).toBeVisible();
    await expect(missingAvatar).toBeVisible();
    await expect(brokenAvatar).toBeVisible();
    await expect.poll(() => validAvatar.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await expect(missingAvatar.locator('img')).toHaveCount(0);
    await expect.poll(() => brokenAvatar.locator('img').evaluate((image) => (image as HTMLImageElement).style.display === 'none')).toBe(true);

    const expectedAvatarFailures = diagnostics.entries.filter((entry) => entry.kind === 'http-error' && entry.url?.includes('/api/qa/avatar/') && entry.status === 404);
    expect(expectedAvatarFailures.length, 'o fixture de avatar 404 deve ser classificado como falha esperada').toBeGreaterThan(0);
    expect(relevantBrowserErrors(diagnostics), 'erros fatais do navegador atribuíveis à aplicação').toEqual([]);
  } finally {
    await attachBrowserDiagnostics(page, diagnostics, testInfo);
  }
});
