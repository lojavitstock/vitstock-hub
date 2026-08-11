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
