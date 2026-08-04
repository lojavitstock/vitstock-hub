import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { closeDatabase, db } from '../db.js';

const migrationsDirectory = resolve(process.cwd(), 'migrations');

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function withConnectionRetry<T>(operation: () => Promise<T>, label: string) {
  const delays = [0, 3000, 6000, 12_000, 24_000];
  let lastError: unknown;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    const delay = delays[attempt] ?? 0;
    if (delay) await sleep(delay);
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (error?.code !== '53300' || attempt === delays.length - 1) throw error;
      console.warn(`PostgreSQL sem conexões disponíveis; nova tentativa de ${label} em breve.`);
    }
  }

  throw lastError;
}

async function migrate() {
  await withConnectionRetry(() => db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `), 'criação do controle de migrações');

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const alreadyApplied = await withConnectionRetry(
      () => db.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]),
      `verificação de ${file}`,
    );
    if (alreadyApplied.rowCount) continue;

    const client = await withConnectionRetry(() => db.connect(), `abertura de ${file}`);
    try {
      await client.query('BEGIN');
      await client.query(await readFile(resolve(migrationsDirectory, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Migração aplicada: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

migrate()
  .then(() => closeDatabase())
  .catch(async (error) => {
    console.error('Falha ao executar migrações:', error);
    await closeDatabase();
    process.exitCode = 1;
  });
