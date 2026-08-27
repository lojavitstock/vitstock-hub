import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const isPreview = process.env.PLAYWRIGHT_MODE === 'preview';
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (isPreview && !bypassSecret) {
  throw new Error('Preview E2E abortado: VERCEL_AUTOMATION_BYPASS_SECRET ausente');
}

export default defineConfig({
  testDir: './tests/e2e',
  // Preview-only specs require the remote Vercel bypass and must not run as
  // part of the isolated localhost/QA suite.
  testIgnore: isPreview ? [] : ['**/preview.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    // Protection bypass headers must never be captured in traces.
    trace: isPreview ? 'off' : 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
