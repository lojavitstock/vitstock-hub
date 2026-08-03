import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { closeDatabase, db } from '../db.js';

const migrationsDirectory = resolve(process.cwd(), 'migrations');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const alreadyApplied = await db.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (alreadyApplied.rowCount) continue;

    const client = await db.connect();
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
