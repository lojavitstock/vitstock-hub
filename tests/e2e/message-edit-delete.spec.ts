import { expect, test } from '@playwright/test';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;

const openQaConversation = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  const loginField = page.getByLabel('E-mail');
  const atendimentoHeading = page.getByRole('heading', { name: 'Atendimento' });
  await expect.poll(async () => (
    await loginField.isVisible().catch(() => false)
      || await atendimentoHeading.isVisible().catch(() => false)
  ), { timeout: 15_000 }).toBe(true);
  if (await loginField.isVisible().catch(() => false)) {
    await page.getByLabel('E-mail').fill(email!);
    await page.getByLabel('Senha').fill(password!);
    await page.getByRole('button', { name: 'Entrar' }).click();
  }
  await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);
  await expect(atendimentoHeading).toBeVisible();
  const conversation = page.getByRole('button', { name: /Abrir conversa com Ana QA/ }).first();
  await expect(conversation).toBeVisible({ timeout: 15_000 });
  await conversation.click();
  await expect(page.locator('textarea[placeholder*="Digite sua mensagem"]')).toBeVisible();
}

const sendQaText = async (page: import('@playwright/test').Page, text: string) => {
  const composer = page.locator('textarea[placeholder*="Digite sua mensagem"]');
  await composer.fill(text);
  const response = page.waitForResponse((candidate) => candidate.url().endsWith('/api/evolution/messages/send'));
  await composer.press('Enter');
  expect((await response).status()).toBe(200);
  const item = page.locator('[data-message-id]').filter({ hasText: text }).last();
  await expect(item).toBeVisible({ timeout: 15_000 });
  return item;
};

test('envia, edita e mantém a mensagem editada após reload', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await openQaConversation(page);
  const original = `QA edição ${Date.now()}`;
  const edited = `${original} atualizada`;
  const item = await sendQaText(page, original);
  await item.getByRole('button', { name: 'Abrir ações da mensagem' }).click();
  await page.getByRole('menuitem', { name: 'Editar', exact: true }).click();
  const composer = page.locator('textarea[placeholder*="Edite sua mensagem"]');
  await expect(composer).toHaveValue(original);
  await expect(page.getByText('Editando mensagem', { exact: true })).toBeVisible();
  await composer.fill(edited);
  await composer.press('Enter');
  const editedItem = page.locator('[data-message-id]').filter({ hasText: edited }).last();
  await expect(editedItem).toBeVisible({ timeout: 15_000 });
  await expect(editedItem).toContainText('editada');

  await page.reload();
  await openQaConversation(page);
  const reloadedItem = page.locator('[data-message-id]').filter({ hasText: edited }).last();
  await expect(reloadedItem).toBeVisible({ timeout: 15_000 });
  await expect(reloadedItem).toContainText('editada');
});

test('envia, apaga e mantém a posição da mensagem apagada após reload', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await openQaConversation(page);
  const original = `QA exclusão ${Date.now()}`;
  const item = await sendQaText(page, original);
  await item.getByRole('button', { name: 'Abrir ações da mensagem' }).click();
  await page.getByRole('menuitem', { name: 'Apagar para todos', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Apagar mensagem para todos?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Apagar para todos', exact: true }).click();
  const deletedItem = page.locator('[data-message-id]').filter({ hasText: 'Mensagem apagada' }).last();
  await expect(deletedItem).toBeVisible({ timeout: 15_000 });
  await expect(deletedItem).toContainText('Mensagem apagada');

  await page.reload();
  await openQaConversation(page);
  await expect(page.locator('[data-message-id]').filter({ hasText: 'Mensagem apagada' }).last()).toBeVisible({ timeout: 15_000 });
});
