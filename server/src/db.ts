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

export function createDatabasePool(max = poolMax) {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    // DB_POOL_MAX continues to bound the Hub pool; Bling uses one isolated
    // connection so provider waits cannot consume session/inbox/health slots.
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis,
  });
  pool.on('error', (error) => {
    console.error('[PostgreSQL] Conexão ociosa encerrada:', error);
  });
  return pool;
}

export const db = createDatabasePool();

export async function closeDatabase() {
  await db.end();
}
