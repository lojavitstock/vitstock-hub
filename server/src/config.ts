import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: resolve(process.cwd(), '../.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env.local'), override: false });

export function normalizeFrontendOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function parseFrontendOrigins(value: string): string[] {
  return value
    .split(',')
    .map(normalizeFrontendOrigin)
    .filter((origin) => origin.length > 0 && !origin.includes('*'));
}

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  QA_MODE: z.preprocess((value) => value === true || value === 'true', z.boolean()).default(false),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(43),
  WEBHOOK_SECRET: z.string().min(43),
  FRONTEND_URL: z.string().url().transform(normalizeFrontendOrigin),
  ALLOWED_FRONTEND_ORIGINS: z.string().optional().default(''),
  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(16),
  EVOLUTION_INSTANCE_NAME: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(20).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(20).optional(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Configuração inválida ou ausente: ${fields}`);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === 'production';
export const isQaMode = config.QA_MODE;

export function isLocalHost(value: string) {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function validateQaRuntimeSafety(input: Pick<typeof config, 'DATABASE_URL' | 'EVOLUTION_API_URL' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>) {
  let databaseUrl: URL;
  let evolutionUrl: URL;
  try {
    databaseUrl = new URL(input.DATABASE_URL);
    evolutionUrl = new URL(input.EVOLUTION_API_URL);
  } catch {
    throw new Error('QA_MODE exige URLs válidas para PostgreSQL e Evolution mock locais');
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
  if (!isLocalHost(input.DATABASE_URL) || databaseUrl.port !== '55432' || databaseName !== 'vitstock_qa') {
    throw new Error('QA_MODE exige PostgreSQL local em 127.0.0.1:55432/vitstock_qa');
  }
  if (!isLocalHost(input.EVOLUTION_API_URL) || evolutionUrl.port !== '3999') {
    throw new Error('QA_MODE exige Evolution mock local na porta 3999');
  }
  if (!input.GOOGLE_CLIENT_ID?.startsWith('qa-local-') || !input.GOOGLE_CLIENT_SECRET?.startsWith('qa-local-')) {
    throw new Error('QA_MODE exige credenciais fictícias do Google QA; chamadas externas estão bloqueadas');
  }
}

if (isQaMode) validateQaRuntimeSafety(config);

const configuredFrontendOrigins = new Set([
  config.FRONTEND_URL,
  ...parseFrontendOrigins(config.ALLOWED_FRONTEND_ORIGINS),
]);

export function isAllowedFrontendOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string> = configuredFrontendOrigins,
): boolean {
  if (!origin) return false;
  const normalizedOrigin = normalizeFrontendOrigin(origin);
  if (!normalizedOrigin || normalizedOrigin.includes('*')) return false;
  return allowedOrigins.has(normalizedOrigin);
}
