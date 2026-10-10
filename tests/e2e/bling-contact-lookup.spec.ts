import { expect, test } from '@playwright/test';
import { attachBrowserDiagnostics, installBrowserDiagnostics, relevantBrowserErrors } from './support/diagnostics';

const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD;

test('Cadastro no Bling apresenta Fone e Celular sem substituir um pelo outro', async ({ page }, testInfo) => {
  const diagnostics = installBrowserDiagnostics(page);
  test.skip(!email || !password, 'defina E2E_EMAIL e E2E_PASSWORD ou execute npm run dev:e2e');
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await page.getByLabel('E-mail').fill(email!);
    await page.getByLabel('Senha').fill(password!);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/atendimento(?:\?.*)?$/);

    let lookupCalls = 0;
    let returnEmptyPhoneFields = false;
    await page.route('**/api/integrations/bling/contact-lookup', async route => {
      lookupCalls += 1;
      const phoneFields = returnEmptyPhoneFields
        ? { phone: null, mobile: null }
        : { phone: '(21) 4000-0011', mobile: '(21) 99000-0011' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        status: 'found',
        contact: { id: 'qa-contact-phones', name: 'Contato QA', fantasy: null, document: null, zipCode: null,
          address: null, ...phoneFields, email: null },
        orders: [], ordersTruncated: false, ordersError: null, directorySyncedAt: '2026-10-10T00:00:00.000Z',
      }) });
    });

    const anaCard = page.getByRole('button', { name: /Abrir conversa com Ana QA/ }).first();
    await expect(anaCard).toBeVisible({ timeout: 15_000 });
    await anaCard.click();
    await expect(page.locator('textarea[placeholder*="Digite sua mensagem"]')).toBeVisible();
    await page.getByRole('button', { name: /Ana QA/ }).last().click();
    await expect(page.getByRole('heading', { name: 'Informações do contato' })).toBeVisible();
    await page.getByRole('button', { name: 'Verificar cadastro no Bling' }).click();

    const sheet = page.getByRole('dialog', { name: 'Cadastro no Bling' });
    await expect(sheet).toBeVisible();
    const fieldValue = (label: string) => sheet.locator('dt')
      .filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
    await expect(fieldValue('Fone')).toHaveText('(21) 4000-0011');
    await expect(fieldValue('Celular')).toHaveText('(21) 99000-0011');

    returnEmptyPhoneFields = true;
    await sheet.getByRole('button', { name: 'Atualizar cadastro' }).click();
    await expect(fieldValue('Fone')).toHaveText('Não informado');
    await expect(fieldValue('Celular')).toHaveText('Não informado');
    expect(lookupCalls).toBeGreaterThanOrEqual(2);
    expect(relevantBrowserErrors(diagnostics)).toEqual([]);
  } finally {
    await attachBrowserDiagnostics(page, diagnostics, testInfo);
  }
});
