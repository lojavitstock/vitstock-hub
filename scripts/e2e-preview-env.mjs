import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { config: loadDotenv } = require('../server/node_modules/dotenv');

export const PREVIEW_FRONTEND_URL = 'https://vitstock-hub-git-preview-vitstocks-projects.vercel.app';
export const PREVIEW_API_URL = 'https://vitstock-hub-api-preview.up.railway.app';
const PRODUCTION_HOSTS = new Set(['vitstock-hub.vercel.app', 'vitstock-hub-api-production.up.railway.app']);

function normalizeUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Preview E2E abortado: ${name} inválida`);
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed;
}

export function validatePreviewEnv(env) {
  const required = ['VERCEL_AUTOMATION_BYPASS_SECRET', 'E2E_EMAIL', 'E2E_PASSWORD', 'PLAYWRIGHT_BASE_URL'];
  const missing = required.filter((name) => !String(env[name] || '').trim());
  if (missing.length > 0) throw new Error(`Preview E2E abortado: variáveis ausentes: ${missing.join(', ')}`);

  const baseUrl = normalizeUrl(String(env.PLAYWRIGHT_BASE_URL).trim(), 'PLAYWRIGHT_BASE_URL');
  if (baseUrl.protocol !== 'https:' || baseUrl.hostname !== new URL(PREVIEW_FRONTEND_URL).hostname || baseUrl.pathname !== '/') {
    throw new Error('Preview E2E abortado: PLAYWRIGHT_BASE_URL não corresponde ao frontend Preview autorizado');
  }
  if (PRODUCTION_HOSTS.has(baseUrl.hostname) || ['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname)) {
    throw new Error('Preview E2E abortado: o alvo não é um frontend Preview autorizado');
  }

  return { baseURL: baseUrl.toString(), apiURL: PREVIEW_API_URL };
}

export function loadPreviewEnv(envPath = resolve(process.cwd(), '.env.e2e.preview.local')) {
  if (!existsSync(envPath)) throw new Error('Preview E2E abortado: .env.e2e.preview.local não encontrado');
  loadDotenv({ path: envPath, override: true });
  return validatePreviewEnv(process.env);
}
