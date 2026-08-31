import { expect, test } from '@playwright/test';
import { attachBrowserDiagnostics, installBrowserDiagnostics, relevantBrowserErrors } from './support/diagnostics';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;

test('provider-only chat accepts tags before the first reply', async ({ page }, testInfo) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  const diagnostics = installBrowserDiagnostics(page);

  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await page.getByLabel('E-mail').fill(email!);
    await page.getByLabel('Senha').fill(password!);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);

    const fixture = await page.request.post('http://localhost:3001/api/qa/provider-only');
    expect(fixture.ok()).toBe(true);
    const fixtureBody = await fixture.json() as { name?: string };
    expect(fixtureBody.name).toBeTruthy();
    await page.reload();

    const providerOnly = page.getByRole('button', { name: new RegExp(`Abrir conversa com ${fixtureBody.name}`) });
    await expect(providerOnly).toBeVisible({ timeout: 15_000 });
    await providerOnly.click();
    await expect(page.locator('[data-message-id]').first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Gerenciar tags da conversa' }).click();
    const tagMenu = page.getByRole('menu', { name: 'Tags da conversa' });
    await expect(tagMenu).toBeVisible();
    const traffic = tagMenu.getByRole('menuitemcheckbox', { name: 'Tráfego' });
    await traffic.click();
    await expect(traffic).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Conversa não encontrada', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('conversation-tags-sidebar').getByText('Tráfego', { exact: true })).toBeVisible();

    await traffic.click();
    await expect(traffic).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Gerenciar tags da conversa' }).click();

    const customName = `QA Provider Tag ${Date.now()}`;
    await page.getByTestId('conversation-tag-rail').getByRole('button', { name: 'Gerenciar tags', exact: true }).click();
    const tagManager = page.getByRole('dialog', { name: 'Gerenciar tags' });
    await tagManager.getByRole('textbox', { name: 'Nome', exact: true }).fill(customName);
    await tagManager.getByRole('button', { name: 'Criar', exact: true }).click();
    await tagManager.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(page.getByTestId('conversation-tag-rail').getByRole('button', { name: new RegExp(customName) })).toBeVisible();

    await page.getByRole('button', { name: 'Gerenciar tags da conversa' }).click();
    const customTag = page.getByRole('menu', { name: 'Tags da conversa' }).getByRole('menuitemcheckbox', { name: customName, exact: true });
    await customTag.click();
    await expect(customTag).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('conversation-tags-sidebar').getByText(customName, { exact: true })).toBeVisible();
    await customTag.click();
    await expect(customTag).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Gerenciar tags da conversa' }).click();

    await page.getByRole('button', { name: 'Concluído', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reabrir Conversa', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reabrir Conversa', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Concluído', exact: true })).toBeVisible();

    await page.getByTestId('conversation-tag-rail').getByRole('button', { name: 'Gerenciar tags', exact: true }).click();
    const customRow = page.getByRole('listitem').filter({ hasText: customName });
    await customRow.getByRole('button', { name: `Excluir tag ${customName}`, exact: true }).click();
    const deleteDialog = page.getByRole('alertdialog', { name: 'Excluir tag?' });
    await deleteDialog.getByRole('button', { name: 'Excluir tag', exact: true }).click();
    await expect(page.getByTestId('conversation-tag-rail').getByRole('button', { name: new RegExp(customName) })).toHaveCount(0);
    await tagManager.getByRole('button', { name: 'Fechar', exact: true }).click();

    const composer = page.locator('textarea[placeholder*="Digite sua mensagem"]');
    await composer.fill('Primeira resposta QA');
    await composer.press('Enter');
    await expect(page.locator('[data-message-id]').filter({ hasText: 'Primeira resposta QA' })).toBeVisible({ timeout: 15_000 });
    await expect(providerOnly).toBeVisible();
    await expect(page.getByText('Conversa não encontrada', { exact: true })).toHaveCount(0);
    expect(relevantBrowserErrors(diagnostics)).toEqual([]);
  } finally {
    await attachBrowserDiagnostics(page, diagnostics, testInfo);
  }
});
