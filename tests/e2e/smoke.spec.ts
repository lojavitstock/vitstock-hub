import { expect, test } from '@playwright/test';
import { attachBrowserDiagnostics, installBrowserDiagnostics, relevantBrowserErrors } from './support/diagnostics';

test('a aplicação abre e apresenta a tela inicial', async ({ page }, testInfo) => {
  const diagnostics = installBrowserDiagnostics(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vitstock Hub' })).toBeVisible();
  await expect(page.locator('body')).toContainText(/Vitstock Hub|Atendimento/);

  await attachBrowserDiagnostics(page, diagnostics, testInfo);
  expect(relevantBrowserErrors(diagnostics), 'erros fatais do navegador atribuíveis à aplicação').toEqual([]);
});
