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

test('admin abre o formulário de nova resposta nas configurações', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  await page.goto('/configuracoes?tab=quickReplies');
  await expect(page.getByRole('heading', { name: 'Respostas Rápidas' })).toBeVisible();
  await page.getByRole('button', { name: 'Nova resposta' }).click();
  await expect(page.getByRole('heading', { name: 'Nova mensagem rápida' })).toBeVisible();
  await expect(page.getByLabel('Atalho')).toBeVisible();
  await expect(page.getByLabel('Título')).toBeVisible();
  await expect(page.getByLabel('Mensagem')).toBeVisible();
});

test('atalho + do picker abre criação contextual sem enviar mensagem', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  const conversation = page.getByRole('button', { name: /Abrir conversa com Ana QA/ }).first();
  await expect(conversation).toBeVisible({ timeout: 15_000 });
  await conversation.click();
  await page.getByRole('button', { name: 'Mensagens rápidas' }).click();
  const picker = page.getByRole('dialog', { name: 'Mensagens rápidas' });
  await expect(picker).toBeVisible();
  const createButton = picker.getByRole('button', { name: 'Criar resposta rápida' });
  await expect(createButton).toBeVisible();
  await createButton.click();
  await expect(page).toHaveURL(/\/configuracoes\?tab=quickReplies&from=atendimento/);
  await expect(page.getByRole('heading', { name: 'Nova mensagem rápida' })).toBeVisible();
});
