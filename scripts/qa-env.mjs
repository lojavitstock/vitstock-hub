import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const qaSecret = (label) => `${label}-${randomUUID()}-${'x'.repeat(64)}`;
const qaCredentialsPath = resolve(process.cwd(), '.qa', 'qa-credentials.json');

export function createQaEnv() {
  const qaPassword = qaSecret('qa-e2e-password');
  return {
    QA_MODE: 'true',
    NODE_ENV: 'development',
    PORT: '3001',
    DATABASE_URL: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa',
    EVOLUTION_API_URL: 'http://127.0.0.1:3999',
    EVOLUTION_API_KEY: 'qa-local-disabled-key',
    EVOLUTION_INSTANCE_NAME: 'vitstock_qa_mock',
    SESSION_SECRET: qaSecret('qa-local-session'),
    WEBHOOK_SECRET: qaSecret('qa-local-webhook'),
    FRONTEND_URL: 'http://localhost:3000',
    ALLOWED_FRONTEND_ORIGINS: 'http://127.0.0.1:3000',
    GOOGLE_CLIENT_ID: 'qa-local-google-client-id-not-real',
    GOOGLE_CLIENT_SECRET: 'qa-local-google-client-secret-not-real',
    QA_E2E_EMAIL: 'qa-admin-a@vitstock.test',
    QA_E2E_PASSWORD: qaPassword,
    QA_E2E_SECOND_EMAIL: 'qa-fernanda@vitstock.test',
    QA_E2E_SECOND_PASSWORD: qaPassword,
    VITE_API_URL: 'http://localhost:3001',
    VITE_USE_MOCK_DATA: 'false',
  };
}

export function writeQaCredentials(env) {
  if (!env.QA_E2E_EMAIL || !env.QA_E2E_PASSWORD) throw new Error('Credenciais QA ausentes; seed abortado.');
  mkdirSync(dirname(qaCredentialsPath), { recursive: true });
  writeFileSync(qaCredentialsPath, `${JSON.stringify({
    email: env.QA_E2E_EMAIL,
    password: env.QA_E2E_PASSWORD,
    secondEmail: env.QA_E2E_SECOND_EMAIL,
    secondPassword: env.QA_E2E_SECOND_PASSWORD,
  })}\n`, { mode: 0o600 });
}

export function readQaCredentials() {
  try {
    const parsed = JSON.parse(readFileSync(qaCredentialsPath, 'utf8'));
    if (typeof parsed.email === 'string' && typeof parsed.password === 'string' && parsed.email && parsed.password) return parsed;
  } catch {
    // O wrapper local exibirá uma mensagem clara se o seed ainda não tiver criado o arquivo.
  }
  return null;
}

function localHost(value) {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function validateQaEnv(env) {
  const errors = [];
  if (env.QA_MODE !== 'true') errors.push('QA_MODE=true');

  try {
    const database = new URL(env.DATABASE_URL || '');
    if (!localHost(env.DATABASE_URL) || database.port !== '55432' || database.pathname !== '/vitstock_qa') {
      errors.push('DATABASE_URL=PostgreSQL local 127.0.0.1:55432/vitstock_qa');
    }
  } catch {
    errors.push('DATABASE_URL válido');
  }

  try {
    const evolution = new URL(env.EVOLUTION_API_URL || '');
    if (!localHost(env.EVOLUTION_API_URL) || evolution.port !== '3999') {
      errors.push('EVOLUTION_API_URL apontando para mock local na porta 3999');
    }
  } catch {
    errors.push('EVOLUTION_API_URL válido');
  }

  if (env.GOOGLE_CLIENT_ID !== 'qa-local-google-client-id-not-real') errors.push('Google QA mock');
  if (env.GOOGLE_CLIENT_SECRET !== 'qa-local-google-client-secret-not-real') errors.push('Google QA mock');
  if (env.VITE_API_URL !== 'http://localhost:3001') errors.push('VITE_API_URL=http://localhost:3001');
  if (env.VITE_USE_MOCK_DATA !== 'false') errors.push('VITE_USE_MOCK_DATA=false');

  if (errors.length > 0) {
    throw new Error(`Ambiente QA/E2E inseguro ou incompleto. Abortando: ${errors.join(', ')}`);
  }
}
