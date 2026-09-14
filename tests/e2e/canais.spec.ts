import { expect, test, type Page } from '@playwright/test';

const adminEmail = process.env.E2E_EMAIL?.trim();
const adminPassword = process.env.E2E_PASSWORD;
const attendantEmail = process.env.E2E_SECOND_EMAIL?.trim();
const attendantPassword = process.env.E2E_SECOND_PASSWORD;
const qaApiUrl = 'http://localhost:3001';

const login = async (page: Page, email: string, password: string) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/atendimento(?:\?.*)?$/);
};

test('status lateral do WhatsApp navega para Canais', async ({ page }) => {
  test.skip(!adminEmail || !adminPassword, 'execute npm run dev:e2e para gerar credenciais QA');
  await login(page, adminEmail!, adminPassword!);

  const statusLink = page.getByRole('link', { name: 'WhatsApp conectado' });
  await expect(statusLink).toBeVisible();
  await statusLink.click();
  await expect(page).toHaveURL(/\/configuracoes\?tab=connections$/);
});

test('Canais não apresenta infraestrutura de produção no ambiente atual', async ({ page }) => {
  test.skip(!adminEmail || !adminPassword, 'execute npm run dev:e2e para gerar credenciais QA');
  await login(page, adminEmail!, adminPassword!);
  await page.goto('/configuracoes?tab=connections');

  await expect(page.getByRole('heading', { name: 'Gestão de Conexões WhatsApp (Evolution API)' })).toBeVisible();
  await expect(page.getByText('Conexão do canal WhatsApp com o provedor configurado neste ambiente', { exact: true })).toBeVisible();
  await expect(page.getByText(/produção na Oracle Cloud/i)).toHaveCount(0);
  await expect(page.getByText('Backend Railway', { exact: true })).toHaveCount(0);
  await expect(page.getByText('PostgreSQL (Railway)', { exact: true })).toHaveCount(0);
});

test('logout de Canais propaga desconexão para o status lateral', async ({ page }) => {
  test.skip(!adminEmail || !adminPassword, 'execute npm run dev:e2e para gerar credenciais QA');
  await login(page, adminEmail!, adminPassword!);
  await page.goto('/configuracoes?tab=connections');
  await expect(page.getByRole('button', { name: 'Desconectar e gerar novo QR Code' })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Desconectar e gerar novo QR Code' }).click();
  await expect(page.getByRole('link', { name: 'WhatsApp desconectado' })).toBeVisible();
});

test('atendente não pode gerenciar a conexão WhatsApp', async ({ page }) => {
  test.skip(!attendantEmail || !attendantPassword, 'execute npm run dev:e2e para gerar credenciais QA');
  await login(page, attendantEmail!, attendantPassword!);
  await page.goto('/configuracoes?tab=connections');

  await expect(page.getByRole('button', { name: 'Desconectar e gerar novo QR Code' })).toHaveCount(0);
  await expect(page.getByText('Apenas administradores podem conectar ou desconectar o WhatsApp.', { exact: true })).toBeVisible();
  await expect((await page.request.get(`${qaApiUrl}/api/evolution/connect`)).status()).toBe(403);
  await expect((await page.request.post(`${qaApiUrl}/api/evolution/logout`)).status()).toBe(403);
});
