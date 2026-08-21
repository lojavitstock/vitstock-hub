import { expect, test } from '@playwright/test';
import { attachBrowserDiagnostics, installBrowserDiagnostics, relevantBrowserErrors } from './support/diagnostics';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;

test('Atendimento abre a lista e uma conversa sem enviar mensagens', async ({ page }, testInfo) => {
  const diagnostics = installBrowserDiagnostics(page);

  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD para executar o fluxo autenticado');

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

  await attachBrowserDiagnostics(page, diagnostics, testInfo);
  expect(relevantBrowserErrors(diagnostics), 'erros fatais do navegador atribuíveis à aplicação').toEqual([]);
});
