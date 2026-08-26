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
    const dimensions = await tagScroll.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
    await tagScroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(page.getByRole('button', { name: 'Criar tag' })).toBeVisible();
    expect(await tagScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await tagScroll.hover();
    await page.mouse.wheel(-300, 0);
    await page.getByRole('button', { name: 'Criar tag' }).click();
    await expect(page.getByRole('dialog', { name: 'Nova tag' })).toBeVisible();
    const qaTagName = `QA E2E Tag ${Date.now()}`;
    await page.getByRole('dialog', { name: 'Nova tag' }).getByRole('textbox', { name: 'Nome', exact: true }).fill(qaTagName);
    await page.getByRole('button', { name: 'Criar', exact: true }).click();
    await expect(page.getByRole('button', { name: qaTagName })).toBeVisible();

    // Applying a tag updates only the active conversation and uses the same
    // realtime path as a later polling snapshot.
    await page.getByRole('button', { name: 'Gerenciar tags da conversa' }).click();
    const tagMenu = page.getByRole('menu', { name: 'Tags da conversa' });
    await expect(tagMenu).toBeVisible();
    await tagMenu.getByRole('menuitemcheckbox', { name: qaTagName }).click();
    await expect(tagMenu.getByRole('menuitemcheckbox', { name: qaTagName })).toHaveAttribute('aria-checked', 'true');

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
