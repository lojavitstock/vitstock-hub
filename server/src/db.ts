import pg from 'pg';
import { config, isProduction } from './config.js';

const configuredPoolMax = Number.parseInt(process.env.DB_POOL_MAX || '4', 10);
const poolMax = Number.isFinite(configuredPoolMax) ? Math.max(1, Math.min(configuredPoolMax, 8)) : 4;
const configuredConnectionTimeout = Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '8000', 10);
const connectionTimeoutMillis = Number.isFinite(configuredConnectionTimeout)
  ? Math.max(3_000, Math.min(configuredConnectionTimeout, 20_000))
  : 8_000;

const isRemoteDb = !config.DATABASE_URL.includes('localhost') && !config.DATABASE_URL.includes('127.0.0.1');
const useSsl = isProduction || isRemoteDb || config.DATABASE_URL.includes('sslmode=');

export const db = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  // O PostgreSQL Railway tem limite compartilhado de conexões; uma conexão
  // por processo evita que deploys sobrepostos esgotem o limite.
  // Permite as chamadas paralelas do inbox sem bloquear o pool em uma única conexão.
  // Em ambientes muito restritos, DB_POOL_MAX pode reduzir esse valor.
  max: poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis,
});

db.on('error', (error) => {
  console.error('[PostgreSQL] Conexão ociosa encerrada:', error);
});

export async function closeDatabase() {
  await db.end();
}
