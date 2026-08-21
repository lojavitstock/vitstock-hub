import type { Page, TestInfo } from '@playwright/test';

export type BrowserDiagnostic = {
  kind: 'console.error' | 'pageerror' | 'requestfailed' | 'http-error' | 'broken-image';
  message: string;
  url?: string;
  status?: number;
  resourceType?: string;
};

export type BrowserDiagnostics = {
  entries: BrowserDiagnostic[];
};

const MAX_MESSAGE_LENGTH = 600;

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value.slice(0, MAX_MESSAGE_LENGTH);
  }
}

function safeMessage(value: string): string {
  return value.replace(/(token|secret|password|authorization)=?[^\s&]*/gi, '$1=[redacted]').slice(0, MAX_MESSAGE_LENGTH);
}

export function installBrowserDiagnostics(page: Page): BrowserDiagnostics {
  const diagnostics: BrowserDiagnostics = { entries: [] };

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // Chromium reports failed network resources both as console errors and as
    // request/response events below. Keep the structured event to avoid
    // counting the same browser-level noise twice.
    if (/^Failed to load resource:/i.test(message.text())) return;
    diagnostics.entries.push({ kind: 'console.error', message: safeMessage(message.text()), url: safeUrl(page.url()) });
  });

  page.on('pageerror', (error) => {
    diagnostics.entries.push({ kind: 'pageerror', message: safeMessage(error.message), url: safeUrl(page.url()) });
  });

  page.on('requestfailed', (request) => {
    diagnostics.entries.push({
      kind: 'requestfailed',
      message: safeMessage(request.failure()?.errorText || 'request failed'),
      url: safeUrl(request.url()),
      resourceType: request.resourceType(),
    });
  });

  page.on('response', (response) => {
    if (response.status() < 400) return;
    diagnostics.entries.push({
      kind: 'http-error',
      message: response.statusText() || `HTTP ${response.status()}`,
      url: safeUrl(response.url()),
      status: response.status(),
      resourceType: response.request().resourceType(),
    });
  });

  return diagnostics;
}

export async function collectBrokenImages(page: Page, diagnostics: BrowserDiagnostics): Promise<void> {
  const brokenImages = await page.locator('img').evaluateAll((elements) => (elements as HTMLImageElement[])
    .filter((image) => image.getAttribute('src') && (!image.complete || image.naturalWidth === 0))
    .map((image) => ({
      src: image.getAttribute('src') || '',
      alt: image.getAttribute('alt') || '',
      conversation: image.closest('button')?.getAttribute('aria-label') || '',
    })));

  for (const image of brokenImages) {
    diagnostics.entries.push({
      kind: 'broken-image',
      message: `Imagem sem conteúdo carregado${image.conversation ? ` (${image.conversation})` : ''}${image.alt ? `: ${image.alt}` : ''}`,
      url: safeUrl(image.src),
      resourceType: 'image',
    });
  }
}

export async function attachBrowserDiagnostics(
  page: Page,
  diagnostics: BrowserDiagnostics,
  testInfo: TestInfo,
): Promise<void> {
  await collectBrokenImages(page, diagnostics);
  await testInfo.attach('browser-diagnostics.json', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
}

export function relevantBrowserErrors(diagnostics: BrowserDiagnostics): BrowserDiagnostic[] {
  return diagnostics.entries.filter((entry) => {
    // /api/auth/me returns 401 before a user logs in; that is expected for the smoke test.
    if (entry.kind === 'http-error' && entry.status === 401 && entry.url?.endsWith('/api/auth/me')) return false;
    return entry.kind === 'console.error' || entry.kind === 'pageerror';
  });
}
