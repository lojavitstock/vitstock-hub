import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { loadPreviewEnv } from './e2e-preview-env.mjs';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Execute os testes E2E por npm run test:e2e:preview.');

const preview = loadPreviewEnv();
const result = spawnSync(process.execPath, [npmCli, 'exec', '--', 'playwright', 'test', 'tests/e2e/preview.spec.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_MODE: 'preview',
    PLAYWRIGHT_BASE_URL: preview.baseURL,
    PLAYWRIGHT_EXPECTED_API_URL: preview.apiURL,
  },
});

process.exit(result.status ?? 1);
