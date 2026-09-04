import { expect, test, type Locator, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;
const remoteJid = '164700009999@lid';
const qaPhone = '5521990099999';
const qaContactName = 'Contato QA Scroll';
const oldOnlyRemoteJid = '164700009998@lid';
const oldOnlyPhone = '5521990099988';
const oldOnlyContactName = 'Contato QA Histórico Antigo';

type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  distanceFromBottom: number;
  messages: number;
  anchorId: string | null;
  anchorOffset: number | null;
};

const timeline = (page: Page) => page.locator('.chat-wallpaper');

async function login(page: Page) {
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email!);
  await page.getByLabel('Senha').fill(password!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);
}

async function getScrollMetrics(container: Locator): Promise<ScrollMetrics> {
  return container.evaluate((element) => {
    const node = element as HTMLDivElement;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    const containerRect = node.getBoundingClientRect();
    const anchor = Array.from(node.querySelectorAll<HTMLElement>('[data-message-id]')).find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
    });
    const anchorRect = anchor?.getBoundingClientRect();
    return {
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      distanceFromBottom,
      messages: node.querySelectorAll('[data-message-id]').length,
      anchorId: anchor?.dataset.messageId || null,
      anchorOffset: anchorRect ? anchorRect.top - containerRect.top : null,
    };
  });
}

async function injectInbound(
  page: Page,
  content: string,
  timestampMs?: number,
  target: { remoteJid?: string; phone?: string; name?: string } = {},
) {
  const response = await page.evaluate(async ({ content: nextContent, remoteJid: nextRemoteJid, phone: nextPhone, name: nextName, timestamp: nextTimestamp }) => {
    const result = await fetch('http://localhost:3001/api/qa/evolution/inbound', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        remoteJid: nextRemoteJid,
        phone: nextPhone,
        name: nextName,
        content: nextContent,
        ...(nextTimestamp ? { timestampMs: nextTimestamp } : {}),
      }),
    });
    return { status: result.status, body: await result.text() };
  }, {
    content,
    remoteJid: target.remoteJid || remoteJid,
    phone: target.phone || qaPhone,
    name: target.name || qaContactName,
    timestamp: timestampMs,
  });
  expect(response.status, response.body).toBe(200);
}

test('Atendimento mantém o final, preserva leitura e oferece retorno ao final', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  const container = timeline(page);
  const runId = Date.now();

  // A conversation with no recent activity must still open on its latest
  // persisted message. This is the regression for the former seven-day
  // presentation filter.
  const oldOnlyText = `Scroll QA única mensagem antiga ${runId}`;
  await injectInbound(
    page,
    oldOnlyText,
    Date.now() - (30 * 24 * 60 * 60 * 1000),
    { remoteJid: oldOnlyRemoteJid, phone: oldOnlyPhone, name: oldOnlyContactName },
  );

  // Gera volume suficiente para exercitar overflow e o carregamento de histórico.
  const oldBaseTimestamp = Date.now() - (8 * 24 * 60 * 60 * 1000);
  for (let index = 0; index < 150; index += 1) {
    const timestamp = index < 5 ? oldBaseTimestamp + (index * 1_000) : undefined;
    await injectInbound(page, `Scroll QA histórico ${runId}-${index}`, timestamp);
  }

  await expect.poll(async () => page.evaluate(async (nextRemoteJid) => {
    const response = await fetch('http://localhost:3001/api/evolution/chats', { credentials: 'include' });
    if (!response.ok) return false;
    const body = await response.json();
    return Array.isArray(body?.chats) && body.chats.some((chat: { remoteJid?: string; id?: string }) => (chat.remoteJid || chat.id) === nextRemoteJid);
  }, remoteJid), { timeout: 15_000 }).toBe(true);

  await page.reload();
  const oldOnlyConversation = page.locator('button[title*="Scroll QA única mensagem antiga"]').first();
  await expect(oldOnlyConversation).toBeVisible({ timeout: 15_000 });
  await oldOnlyConversation.click();
  await expect(container.locator('[data-message-id]').filter({ hasText: oldOnlyText })).toBeVisible({ timeout: 15_000 });
  await expect(container.getByRole('button', { name: /Carregar (histórico anterior|mensagens anteriores)/ })).toHaveCount(0);

  const targetConversation = page.locator('button[title*="Scroll QA histórico"]').first();
  await expect(targetConversation).toBeVisible({ timeout: 15_000 });
  await targetConversation.click();
  await expect(page.locator('[data-message-id]').first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await getScrollMetrics(container)).messages).toBeGreaterThan(1);

  // Caso A: abertura no final.
  await expect.poll(async () => (await getScrollMetrics(container)).distanceFromBottom).toBeLessThanOrEqual(4);

  // Caso B: leitura antiga não deve ser deslocada por uma nova mensagem.
  await page.waitForTimeout(500);
  await container.evaluate((element) => {
    const node = element as HTMLDivElement;
    node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 240);
    node.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(async () => (await getScrollMetrics(container)).distanceFromBottom).toBeGreaterThan(200);
  const beforeIncoming = await getScrollMetrics(container);
  await injectInbound(page, `Scroll QA nova durante leitura ${Date.now()}`);
  await expect.poll(async () => (await getScrollMetrics(container)).messages).toBeGreaterThan(beforeIncoming.messages);
  const afterIncoming = await getScrollMetrics(container);
  expect(Math.abs(afterIncoming.scrollTop - beforeIncoming.scrollTop)).toBeLessThanOrEqual(4);
  await expect(page.getByRole('button', { name: 'Ir para o final da conversa' })).toBeVisible();

  // Caso C: o botão independe de mensagens novas e retorna ao final.
  const jumpButton = page.getByRole('button', { name: 'Ir para o final da conversa' });
  const timelineBox = await container.boundingBox();
  const jumpButtonBox = await jumpButton.boundingBox();
  expect(timelineBox).not.toBeNull();
  expect(jumpButtonBox).not.toBeNull();
  expect(Math.abs((timelineBox!.x + timelineBox!.width / 2) - (jumpButtonBox!.x + jumpButtonBox!.width / 2))).toBeLessThanOrEqual(2);
  await jumpButton.click();
  await expect.poll(async () => (await getScrollMetrics(container)).distanceFromBottom).toBeLessThanOrEqual(4);
  await expect(page.getByRole('button', { name: 'Ir para o final da conversa' })).toBeHidden();

  // Caso D: envio do operador mantém a nova mensagem visível no final.
  const outboundText = `Scroll QA envio ${Date.now()}`;
  const composer = page.locator('textarea[placeholder*="Digite sua mensagem"]');
  await composer.fill(outboundText);
  await composer.press('Enter');
  const outboundMessage = container.locator('[data-message-id]').filter({ hasText: outboundText }).last();
  await expect(outboundMessage).toBeVisible({ timeout: 15_000 });
  await expect(outboundMessage.locator('p').first()).toHaveText(/:$/);
  await expect.poll(async () => (await getScrollMetrics(container)).distanceFromBottom).toBeLessThanOrEqual(4);

  // Caso E: prepend de histórico conserva a posição visual atual.
  await container.evaluate((element) => {
    const node = element as HTMLDivElement;
    node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 180);
    node.dispatchEvent(new Event('scroll'));
  });
  const beforePrepend = await getScrollMetrics(container);
  const historyButton = page.getByRole('button', { name: /Carregar (histórico anterior|mensagens anteriores)/ });
  await expect(historyButton).toBeVisible();
  const messagesBeforePrepend = beforePrepend.messages;
  await historyButton.evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(async () => (await getScrollMetrics(container)).messages).toBeGreaterThan(messagesBeforePrepend);
  const afterPrepend = await getScrollMetrics(container);
  expect(afterPrepend.anchorId).toBe(beforePrepend.anchorId);
  expect(Math.abs((afterPrepend.anchorOffset || 0) - (beforePrepend.anchorOffset || 0))).toBeLessThanOrEqual(12);
  expect(Math.abs((afterPrepend.scrollTop - beforePrepend.scrollTop) - (afterPrepend.scrollHeight - beforePrepend.scrollHeight))).toBeLessThanOrEqual(12);
});
