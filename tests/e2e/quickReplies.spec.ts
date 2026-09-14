import { expect, test } from '@playwright/test';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;
const secondEmail = process.env.E2E_SECOND_EMAIL?.trim();
const secondPassword = process.env.E2E_SECOND_PASSWORD;

const login = async (page: import('@playwright/test').Page, credentials = { email, password }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(credentials.email!);
  await page.getByLabel('Senha').fill(credentials.password!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);
};

test('usuário autenticado abre o formulário de nova resposta nas configurações', async ({ page }) => {
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

test('atalho com acento mostra a orientação de validação sem enviar', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await login(page);
  await page.goto('/configuracoes?tab=quickReplies');
  await page.getByRole('button', { name: 'Nova resposta' }).click();
  await page.getByLabel('Atalho').fill('/saudação');
  await page.getByLabel('Título').fill('Saudação QA');
  await page.getByLabel('Mensagem').fill('Olá!');
  await page.getByRole('button', { name: 'Salvar mensagem' }).click();
  await expect(page.getByRole('alert')).toHaveText('Use apenas letras sem acento, números, hífen (-) e sublinhado (_).');
});

test('atendente gerencia uma resposta rápida compartilhada da própria empresa', async ({ page }) => {
  test.skip(!secondEmail || !secondPassword, 'defina E2E_SECOND_EMAIL e E2E_SECOND_PASSWORD no ambiente QA');
  await login(page, { email: secondEmail, password: secondPassword });
  await page.goto('/configuracoes?tab=quickReplies');
  await expect(page.getByRole('button', { name: 'Nova resposta' })).toBeVisible();

  const shortcut = `/qa-atendente-${Date.now()}`;
  await page.getByRole('button', { name: 'Nova resposta' }).click();
  await page.getByLabel('Atalho').fill(shortcut);
  await page.getByLabel('Título').fill('Resposta do atendente');
  await page.getByLabel('Mensagem').fill('Mensagem compartilhada QA.');
  await page.getByRole('button', { name: 'Salvar mensagem' }).click();
  await expect(page.getByText(shortcut, { exact: true })).toBeVisible();

  const card = page.locator('div.items-start.justify-between').filter({ hasText: shortcut }).first();
  await card.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Título').fill('Resposta do atendente editada');
  await page.getByRole('button', { name: 'Salvar mensagem' }).click();
  await expect(page.getByText('Resposta do atendente editada', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await card.getByRole('button', { name: 'Excluir' }).click();
  await expect(page.getByText(shortcut, { exact: true })).toHaveCount(0);
});
