import { expect, test } from '@playwright/test';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;

const loginAndOpenConversation = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email!);
  await page.getByLabel('Senha').fill(password!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);
  const conversation = page.getByRole('button', { name: /Abrir conversa com Ana QA/ }).first();
  await expect(conversation).toBeVisible({ timeout: 15_000 });
  await conversation.click();
  await expect(page.locator('textarea[placeholder*="Digite sua mensagem"]')).toBeVisible();
};

test('imagem colada vira draft local e não envia até o submit', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await loginAndOpenConversation(page);

  const sendMediaRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/evolution/messages/send-media')) sendMediaRequests.push(request.url());
  });

  const textarea = page.locator('textarea[placeholder*="Digite sua mensagem"]');
  await page.evaluate(() => {
    const textarea = document.querySelector('textarea[placeholder*="Digite sua mensagem"]');
    if (!textarea) throw new Error('composer textarea não encontrado');
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'colada.png', { type: 'image/png' }));
    textarea.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }));
  });

  await expect(page.getByTestId('attachment-draft')).toBeVisible();
  expect(sendMediaRequests).toHaveLength(0);
  await textarea.fill('Legenda ');
  await textarea.evaluate((element) => {
    element.focus();
    element.setSelectionRange(4, 4);
  });
  await page.getByRole('button', { name: 'Inserir emoji' }).click();
  await page.getByRole('button', { name: 'Inserir emoji 😂' }).click();
  await expect(textarea).toHaveValue('Lege😂nda ');
  await page.getByRole('button', { name: 'Inserir emoji 😂' }).click();
  await expect(textarea).toHaveValue('Lege😂😂nda ');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Selecionar emoji' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inserir emoji' }).click();
  await expect(page.getByRole('dialog', { name: 'Selecionar emoji' })).toBeVisible();
  await page.getByRole('heading', { name: 'Atendimento' }).click();
  await expect(page.getByRole('dialog', { name: 'Selecionar emoji' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remover anexo' }).click();
  await expect(page.getByTestId('attachment-draft')).toHaveCount(0);
  await expect(textarea).toHaveValue('Lege😂😂nda ');
  expect(sendMediaRequests).toHaveLength(0);
});

test('arquivo selecionado aceita legenda e envia mídia em uma ação', async ({ page }) => {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await loginAndOpenConversation(page);

  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: 'catalogo.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 QA fixture'),
  });
  await expect(page.getByTestId('attachment-draft')).toContainText('catalogo.pdf');
  const mediaResponses: string[] = [];
  page.on('response', async (response) => {
    if (!response.url().includes('/api/evolution/messages/send-media')) return;
    mediaResponses.push(`${response.status()} ${await response.text().catch(() => '')}`);
  });
  const textarea = page.locator('textarea[placeholder*="Digite sua mensagem"]');
  await textarea.fill('Confira o catálogo 😂');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect.poll(() => mediaResponses.length).toBeGreaterThan(0);
  await expect(page.getByTestId('attachment-draft'), mediaResponses.join(' | ')).toHaveCount(0);
  await expect(page.locator('[data-message-id]').last()).toContainText('Confira o catálogo 😂');
});
