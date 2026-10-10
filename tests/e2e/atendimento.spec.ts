import { expect, test } from '@playwright/test';
import { attachBrowserDiagnostics, installBrowserDiagnostics, relevantBrowserErrors } from './support/diagnostics';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;
const secondEmail = process.env.E2E_SECOND_EMAIL?.trim();
const secondPassword = process.env.E2E_SECOND_PASSWORD;

test('Atendimento abre a lista e uma conversa sem enviar mensagens', async ({ page }, testInfo) => {
  const diagnostics = installBrowserDiagnostics(page);

  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');

  try {
    await page.setViewportSize({ width: 1600, height: 900 });
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
    await expect(page.getByText('TAGS', { exact: true })).toBeVisible();

    // The tag rail is a single horizontal control with a fixed create action.
    await expect(page.getByRole('button', { name: /^Tudo/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Não lidas/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Não resp/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Tráfego/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /VIP Atendimento/ })).toBeVisible();
    const tagScroll = page.getByTestId('conversation-tag-scroll');
    const conversationCards = page.getByRole('button', { name: /Abrir conversa com/ });
    const allCount = await conversationCards.count();
    const unreadChip = page.getByTestId('conversation-tag-rail').getByRole('button', { name: /Não lidas/ });
    const unreadCount = Number((await unreadChip.getAttribute('aria-label'))?.split(':').pop() || 0);
    await unreadChip.click();
    await expect(unreadChip).toHaveAttribute('aria-pressed', 'true');
    await expect(conversationCards).toHaveCount(unreadCount);
    const unansweredChip = page.getByTestId('conversation-tag-rail').getByRole('button', { name: /Não resp/ });
    const unansweredCount = Number((await unansweredChip.getAttribute('aria-label'))?.split(':').pop() || 0);
    await unansweredChip.click();
    await expect(unansweredChip).toHaveAttribute('aria-pressed', 'true');
    await expect(conversationCards).toHaveCount(unansweredCount);
    await page.getByTestId('conversation-tag-rail').getByRole('button', { name: /^Tudo/ }).click();
    await expect(conversationCards).toHaveCount(allCount);
    const dimensions = await tagScroll.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
    await tagScroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    const tagManagerButton = page.getByTestId('conversation-tag-rail').getByRole('button', { name: 'Gerenciar tags', exact: true });
    await expect(tagManagerButton).toBeVisible();
    expect(await tagScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await tagScroll.hover();
    await page.mouse.wheel(-300, 0);
    await tagManagerButton.click();
    const tagManager = page.getByRole('dialog', { name: 'Gerenciar tags' });
    await expect(tagManager).toBeVisible();
    const qaTagName = `QA E2E Tag ${Date.now()}`;
    await tagManager.getByRole('textbox', { name: 'Nome', exact: true }).fill(qaTagName);
    await page.getByRole('button', { name: 'Criar', exact: true }).click();
    await expect(page.getByTestId('conversation-tag-rail').getByRole('button', { name: qaTagName })).toBeVisible();

    // The manager edits definitions locally without reloading the rail.
    await tagManager.getByRole('button', { name: `Editar tag ${qaTagName}` }).click();
    const editedTagName = `${qaTagName} Renomeada`;
    await tagManager.getByRole('textbox', { name: `Nome da tag ${qaTagName}` }).fill(editedTagName);
    await tagManager.getByRole('button', { name: `Selecionar cor #3B82F6 para ${qaTagName}` }).click();
    await tagManager.getByRole('button', { name: `Salvar tag ${qaTagName}` }).click();
    await expect(page.getByTestId('conversation-tag-rail').getByRole('button', { name: editedTagName })).toBeVisible();

    // Traffic is a protected system definition: it may be recolored but not renamed/deleted.
    const trafficRow = tagManager.getByRole('listitem').filter({ hasText: 'Tráfego' });
    await expect(trafficRow.getByRole('button', { name: /Editar tag Tráfego/ })).toBeVisible();
    await expect(trafficRow.getByRole('button', { name: /Excluir tag Tráfego/ })).toHaveCount(0);
    await trafficRow.getByRole('button', { name: /Editar tag Tráfego/ }).click();
    await expect(tagManager.getByRole('textbox', { name: /Nome da tag Tráfego/ })).toHaveAttribute('readonly', '');
    await tagManager.getByRole('button', { name: 'Cancelar' }).click();

    // Internal modal scrolling remains independent from the horizontal rail.
    const managerBody = tagManager.locator('div.min-h-0.flex-1.overflow-y-auto');
    await expect(managerBody).toBeVisible();
    const managerDimensions = await managerBody.evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(managerDimensions.scrollHeight).toBeGreaterThanOrEqual(managerDimensions.clientHeight);
    await tagManager.getByRole('button', { name: 'Fechar gerenciador de tags' }).nth(1).click();

    // Applying a tag updates only the active conversation and uses the same
    // realtime path as a later polling snapshot.
    await page.getByRole('button', { name: 'Gerenciar tags da conversa' }).click();
    const tagMenu = page.getByRole('menu', { name: 'Tags da conversa' });
    await expect(tagMenu).toBeVisible();
    await page.getByRole('heading', { name: 'Atendimento' }).click();
    await expect(tagMenu).toBeHidden();
    await page.getByRole('button', { name: 'Gerenciar tags da conversa' }).click();
    await expect(tagMenu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tagMenu).toBeHidden();
    await page.getByRole('button', { name: 'Gerenciar tags da conversa' }).click();
    await expect(tagMenu).toBeVisible();
    await tagMenu.getByRole('menuitemcheckbox', { name: editedTagName }).click();
    await expect(tagMenu.getByRole('menuitemcheckbox', { name: editedTagName })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('conversation-tags-sidebar').getByText(editedTagName, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Gerenciar tags da conversa' }).click();
    await tagManagerButton.click();
    const usedTagRow = page.getByRole('dialog', { name: 'Gerenciar tags' }).getByRole('listitem').filter({ hasText: editedTagName });
    await expect(usedTagRow.getByTestId('conversation-tag-usage')).toHaveText('1');
    await page.getByRole('dialog', { name: 'Gerenciar tags' }).getByRole('button', { name: 'Fechar gerenciador de tags' }).nth(1).click();
    await page.getByRole('button', { name: editedTagName }).click();
    await tagManagerButton.click();
    await page.getByRole('dialog', { name: 'Gerenciar tags' }).getByRole('button', { name: `Excluir tag ${editedTagName}` }).click();
    const deleteDialog = page.getByRole('alertdialog', { name: 'Excluir tag?' });
    await expect(deleteDialog).toContainText('1 conversa');
    await deleteDialog.getByRole('button', { name: 'Excluir tag' }).click();
    await expect(page.getByTestId('conversation-tag-rail').getByRole('button', { name: editedTagName })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Tudo/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await conversationCards.count()).toBeGreaterThan(1);
    await page.getByRole('dialog', { name: 'Gerenciar tags' }).getByRole('button', { name: 'Fechar gerenciador de tags' }).nth(1).click();
    await page.getByRole('button', { name: 'Gerenciar tags da conversa' }).click();
    await expect(tagMenu).toBeVisible();
    await conversationCards.nth(1).click();
    await expect(tagMenu).toBeHidden();

    const validAvatar = page.getByRole('button', { name: 'Abrir conversa com Contato QA Avatar Válido' });
    const missingAvatar = page.getByRole('button', { name: 'Abrir conversa com Contato QA Avatar Ausente' });
    const brokenAvatar = page.getByRole('button', { name: 'Abrir conversa com Contato QA Avatar Quebrado' });
    await expect(validAvatar).toBeVisible();
    await expect(missingAvatar).toBeVisible();
    await expect(brokenAvatar).toBeVisible();
    await expect.poll(() => validAvatar.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await expect(missingAvatar.locator('img')).toHaveCount(0);
    await expect(brokenAvatar.locator('img')).toHaveCount(0);
    await expect(brokenAvatar.locator('svg')).toHaveCount(1);

    const expectedAvatarFailures = diagnostics.entries.filter((entry) => entry.url?.includes('/api/qa/avatar/broken.svg')
      && ((entry.kind === 'http-error' && entry.status === 404) || entry.kind === 'requestfailed'));
    expect(expectedAvatarFailures.length, 'o fixture de avatar quebrado deve ser classificado como falha esperada').toBeGreaterThan(0);
    expect(relevantBrowserErrors(diagnostics), 'erros fatais do navegador atribuíveis à aplicação').toEqual([]);
  } finally {
    await attachBrowserDiagnostics(page, diagnostics, testInfo);
  }
});

test('resolver preserva o histórico, exige confirmação e permite reabrir pelo filtro', async ({ page }, testInfo) => {
  const diagnostics = installBrowserDiagnostics(page);
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await page.getByLabel('E-mail').fill(email!);
    await page.getByLabel('Senha').fill(password!);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);

    const cards = page.getByRole('button', { name: /Abrir conversa com/ });
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    const selectedCardName = await cards.first().getAttribute('aria-label');
    await cards.first().click();
    await expect(page.getByRole('button', { name: 'Concluído', exact: true })).toBeVisible();

    let statusRequests = 0;
    page.on('request', request => {
      if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/evolution/chats/status') statusRequests += 1;
    });
    await page.getByRole('button', { name: 'Concluído', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Resolver conversa?' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('histórico será preservado');
    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    await expect(confirm).toBeHidden();
    expect(statusRequests).toBe(0, 'cancelamento não deve alterar estado no backend');

    await page.getByRole('button', { name: 'Concluído', exact: true }).click();
    const resolvedResponse = page.waitForResponse(response => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === '/api/evolution/chats/status');
    await page.getByRole('dialog', { name: 'Resolver conversa?' }).getByRole('button', { name: 'Resolver conversa' }).click();
    expect((await resolvedResponse).status()).toBe(200);
    await expect(page.getByRole('dialog', { name: 'Resolver conversa?' })).toBeHidden();
    await expect(page.getByRole('button', { name: selectedCardName! })).toHaveCount(0);

    const resolvedFilter = page.getByRole('button', { name: /^Resolvidas:/ });
    await resolvedFilter.click();
    const resolvedCard = page.getByRole('button', { name: selectedCardName! });
    await expect(resolvedCard).toBeVisible();
    await resolvedCard.click();
    const reopenedResponse = page.waitForResponse(response => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === '/api/evolution/chats/status');
    await page.getByRole('button', { name: 'Reabrir Conversa', exact: true }).click();
    expect((await reopenedResponse).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Tudo', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Concluído', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: selectedCardName! })).toBeVisible();
    expect(relevantBrowserErrors(diagnostics), 'erros fatais atribuíveis à aplicação').toEqual([]);
  } finally {
    await attachBrowserDiagnostics(page, diagnostics, testInfo);
  }
});

test('nova mensagem inbound reabre conversa concluída e não duplica por replay, histórico ou status', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(!email || !password || !secondEmail || !secondPassword, 'são necessárias duas contas QA para validar a transição em tempo real');

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const diagnosticsA = installBrowserDiagnostics(pageA);
  const diagnosticsB = installBrowserDiagnostics(pageB);
  const login = async (page: import('@playwright/test').Page, loginEmail: string, loginPassword: string) => {
    await page.goto('/');
    await page.getByLabel('E-mail').fill(loginEmail);
    await page.getByLabel('Senha').fill(loginPassword);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);
    await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible();
  };
  const cardFor = (page: import('@playwright/test').Page, name: string) => page.getByRole('button', { name: new RegExp(`Abrir conversa com ${name}`) });
  const timelineText = (page: import('@playwright/test').Page, text: string) => page.locator('p.whitespace-pre-wrap').filter({ hasText: text });
  const ensureCardVisible = async (page: import('@playwright/test').Page, name: string) => {
    const card = cardFor(page, name);
    await expect.poll(async () => {
      if (await card.isVisible().catch(() => false)) return true;
      const sync = page.getByRole('button', { name: 'Sincronizar Mensagens' });
      if (await sync.isEnabled().catch(() => false)) await sync.click();
      return card.isVisible().catch(() => false);
    }, { timeout: 20_000, intervals: [500, 1_500, 3_000] }).toBe(true);
  };
  const sendWebhook = async (page: import('@playwright/test').Page, event: 'messages.upsert' | 'messages.set' | 'messages.update', data: Record<string, unknown>) => {
    const response = await page.request.post('http://localhost:3001/api/qa/evolution/webhook', { data: { event, data } });
    expect(response.status(), `${event} QA webhook`).toBe(202);
  };
  const resolve = async (page: import('@playwright/test').Page) => {
    await page.getByRole('button', { name: 'Concluído', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Resolver conversa?' });
    await expect(dialog).toBeVisible();
    const response = page.waitForResponse(result => result.request().method() === 'PATCH'
      && new URL(result.url()).pathname === '/api/evolution/chats/status');
    await dialog.getByRole('button', { name: 'Resolver conversa' }).click();
    expect((await response).status()).toBe(200);
    await expect(dialog).toBeHidden();
  };

  try {
    await Promise.all([login(pageA, email!, password!), login(pageB, secondEmail!, secondPassword!)]);
    const phone = `55219${Date.now().toString().slice(-8)}`;
    const remoteJid = `${phone}@s.whatsapp.net`;
    const name = `QA Reabertura ${Date.now()}`;
    const initialText = 'Histórico anterior à conclusão permanece';
    const seeded = await pageA.request.post('http://localhost:3001/api/qa/evolution/inbound', {
      data: { remoteJid, phone, name, content: initialText },
    });
    expect(seeded.status()).toBe(200);
    await Promise.all([ensureCardVisible(pageA, name), ensureCardVisible(pageB, name)]);

    await cardFor(pageA, name).click();
    await expect(timelineText(pageA, initialText)).toHaveText(initialText);
    await resolve(pageA);
    await expect(cardFor(pageA, name)).toHaveCount(0);
    await expect(cardFor(pageB, name)).toHaveCount(0);

    const liveMessageId = `qa-reopen-${Date.now()}`;
    const liveText = 'Nova mensagem inbound deve reabrir';
    const liveEvent = {
      key: { id: liveMessageId, remoteJid, fromMe: false },
      pushName: name,
      message: { conversation: liveText },
      messageTimestamp: Math.floor(Date.now() / 1000) + 1,
    };
    await sendWebhook(pageA, 'messages.upsert', liveEvent);
    await expect(cardFor(pageA, name)).toBeVisible();
    await expect(cardFor(pageA, name)).toContainText(liveText);
    await expect(cardFor(pageB, name)).toBeVisible();
    await expect(cardFor(pageB, name)).toContainText(liveText);

    await cardFor(pageB, name).click();
    await expect(timelineText(pageB, initialText)).toHaveText(initialText);
    await expect(timelineText(pageB, liveText)).toHaveText(liveText);
    await pageB.reload();
    await expect(pageB.getByRole('heading', { name: 'Atendimento' })).toBeVisible();
    await expect(cardFor(pageB, name)).toBeVisible();
    await cardFor(pageB, name).click();
    await expect(pageB.getByRole('button', { name: 'Concluído', exact: true })).toBeVisible();
    await expect(timelineText(pageB, initialText)).toHaveText(initialText);
    await expect(timelineText(pageB, liveText)).toHaveText(liveText);

    await resolve(pageB);
    await expect(cardFor(pageA, name)).toHaveCount(0);
    await expect(cardFor(pageB, name)).toHaveCount(0);

    await sendWebhook(pageA, 'messages.upsert', liveEvent);
    await expect(cardFor(pageA, name)).toHaveCount(0);
    await expect(cardFor(pageB, name)).toHaveCount(0);

    await sendWebhook(pageA, 'messages.set', {
      key: { id: `qa-set-${Date.now()}`, remoteJid, fromMe: false },
      pushName: name,
      message: { conversation: 'Snapshot histórico não reabre' },
      messageTimestamp: Math.floor(Date.now() / 1000) + 3,
    });
    await expect(cardFor(pageA, name)).toHaveCount(0);
    await expect(cardFor(pageB, name)).toHaveCount(0);

    const oldText = 'Inbound histórico não reabre';
    await sendWebhook(pageA, 'messages.upsert', {
      key: { id: `qa-old-${Date.now()}`, remoteJid, fromMe: false },
      pushName: name,
      message: { conversation: oldText },
      messageTimestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    await sendWebhook(pageA, 'messages.update', {
      key: { id: liveMessageId, remoteJid },
      update: { status: 'READ' },
    });
    await sendWebhook(pageA, 'messages.upsert', {
      key: { id: `qa-outbound-${Date.now()}`, remoteJid, fromMe: true },
      pushName: name,
      message: { conversation: 'Outbound não reabre' },
      messageTimestamp: Math.floor(Date.now() / 1000) + 2,
    });
    await expect(cardFor(pageA, name)).toHaveCount(0);
    await expect(cardFor(pageB, name)).toHaveCount(0);

    await pageB.getByRole('button', { name: /^Resolvidas:/ }).click();
    await expect(cardFor(pageB, name)).toBeVisible();
    await cardFor(pageB, name).click();
    await expect(pageB.getByRole('button', { name: 'Reabrir Conversa', exact: true })).toBeVisible();
    await expect(timelineText(pageB, initialText)).toHaveText(initialText);
    await expect(timelineText(pageB, liveText)).toHaveText(liveText);
    expect(relevantBrowserErrors(diagnosticsA)).toEqual([]);
    expect(relevantBrowserErrors(diagnosticsB)).toEqual([]);
  } finally {
    await attachBrowserDiagnostics(pageA, diagnosticsA, testInfo);
    await attachBrowserDiagnostics(pageB, diagnosticsB, testInfo);
    await contextA.close();
    await contextB.close();
  }
});
