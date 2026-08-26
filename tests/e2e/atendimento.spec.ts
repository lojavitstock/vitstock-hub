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
    await tagMenu.getByRole('menuitemcheckbox', { name: editedTagName }).click();
    await expect(tagMenu.getByRole('menuitemcheckbox', { name: editedTagName })).toHaveAttribute('aria-checked', 'true');

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

    const validAvatar = page.getByRole('button', { name: 'Abrir conversa com Contato QA Avatar Válido' });
    const missingAvatar = page.getByRole('button', { name: 'Abrir conversa com Contato QA Avatar Ausente' });
    const brokenAvatar = page.getByRole('button', { name: 'Abrir conversa com Contato QA Avatar Quebrado' });
    await expect(validAvatar).toBeVisible();
    await expect(missingAvatar).toBeVisible();
    await expect(brokenAvatar).toBeVisible();
    await expect.poll(() => validAvatar.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await expect(missingAvatar.locator('img')).toHaveCount(0);
    await expect.poll(() => brokenAvatar.locator('img').evaluate((image) => (image as HTMLImageElement).style.display === 'none')).toBe(true);

    const expectedAvatarFailures = diagnostics.entries.filter((entry) => entry.url?.includes('/api/qa/avatar/broken.svg')
      && ((entry.kind === 'http-error' && entry.status === 404) || entry.kind === 'requestfailed'));
    expect(expectedAvatarFailures.length, 'o fixture de avatar quebrado deve ser classificado como falha esperada').toBeGreaterThan(0);
    expect(relevantBrowserErrors(diagnostics), 'erros fatais do navegador atribuíveis à aplicação').toEqual([]);
  } finally {
    await attachBrowserDiagnostics(page, diagnostics, testInfo);
  }
});
