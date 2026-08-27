import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { readQaCredentials } from './qa-env.mjs';

const npmCli = process.env.npm_execpath;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const apiURL = process.env.VITE_API_URL || 'http://localhost:3001';
const allowRemote = process.env.PLAYWRIGHT_ALLOW_REMOTE === 'true';
const qaCredentials = readQaCredentials();
const e2eEmail = process.env.E2E_EMAIL || qaCredentials?.email;
const e2ePassword = process.env.E2E_PASSWORD || qaCredentials?.password;
const e2eSecondEmail = process.env.E2E_SECOND_EMAIL || qaCredentials?.secondEmail;
const e2eSecondPassword = process.env.E2E_SECOND_PASSWORD || qaCredentials?.secondPassword;

function isLocal(value) {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.text();
  let data = null;
  try { data = JSON.parse(body); } catch { /* resposta não JSON */ }
  return { response, data };
}

if (!npmCli) throw new Error('Execute os testes E2E por npm run test:e2e.');
if (!allowRemote && (!isLocal(baseURL) || !isLocal(apiURL))) {
  throw new Error('E2E abortado: o alvo não é local. Para um Preview autorizado, defina PLAYWRIGHT_ALLOW_REMOTE=true explicitamente.');
}

if (!allowRemote) {
  if (!e2eEmail || !e2ePassword) throw new Error('E2E abortado: execute npm run dev:e2e antes para gerar credenciais QA efêmeras.');
  const backend = await getJson(`${apiURL}/health`);
  if (!backend.response.ok || backend.data?.database !== 'connected') {
    throw new Error(`E2E abortado: backend QA não está saudável (${backend.response.status}).`);
  }
  const marker = await getJson(`${apiURL}/api/qa/ready`);
  if (!marker.response.ok || marker.data?.qaMode !== true || marker.data?.evolution !== 'mock-only' || marker.data?.google !== 'mock-only') {
    throw new Error('E2E abortado: backend não confirmou QA_MODE com Evolution/Google mock-only.');
  }
  const frontend = await fetch(baseURL);
  if (!frontend.ok) throw new Error(`E2E abortado: frontend não está disponível (${frontend.status}).`);
}

const result = spawnSync(process.execPath, [npmCli, 'exec', '--', 'playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_BASE_URL: baseURL,
    E2E_EMAIL: e2eEmail || '',
    E2E_PASSWORD: e2ePassword || '',
    E2E_SECOND_EMAIL: e2eSecondEmail || '',
    E2E_SECOND_PASSWORD: e2eSecondPassword || '',
  },
});

process.exit(result.status ?? 1);
