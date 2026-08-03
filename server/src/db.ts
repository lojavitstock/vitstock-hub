import pg from 'pg';
import { config, isProduction } from './config.js';

export const db = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export async function closeDatabase() {
  await db.end();
}
