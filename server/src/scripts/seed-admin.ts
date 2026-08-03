import { z } from 'zod';
import { closeDatabase, db } from '../db.js';
import { hashPassword } from '../security/password.js';

const seedConfig = z.object({
  INITIAL_ADMIN_NAME: z.string().min(2),
  INITIAL_ADMIN_EMAIL: z.string().email(),
  INITIAL_ADMIN_PASSWORD: z.string().min(12),
  INITIAL_COMPANY_NAME: z.string().min(2).default('Vitstock'),
}).parse(process.env);

async function seedAdmin() {
  const passwordHash = await hashPassword(seedConfig.INITIAL_ADMIN_PASSWORD);
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const company = await client.query<{ id: string }>(
      `INSERT INTO companies (name)
       SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM companies)
       RETURNING id`,
      [seedConfig.INITIAL_COMPANY_NAME],
    );
    const companyId = company.rows[0]?.id ?? (await client.query<{ id: string }>('SELECT id FROM companies ORDER BY created_at LIMIT 1')).rows[0]?.id;
    if (!companyId) throw new Error('Não foi possível criar ou localizar a empresa inicial');

    await client.query(
      `INSERT INTO users (company_id, name, email, password_hash, role, must_change_password)
       VALUES ($1, $2, lower($3), $4, 'admin', true)
       ON CONFLICT (company_id, email) DO UPDATE
       SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, active = true`,
      [companyId, seedConfig.INITIAL_ADMIN_NAME, seedConfig.INITIAL_ADMIN_EMAIL, passwordHash],
    );
    await client.query('COMMIT');
    console.log('Administrador inicial criado ou atualizado.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

seedAdmin()
  .then(() => closeDatabase())
  .catch(async (error) => {
    console.error('Falha ao criar administrador:', error);
    await closeDatabase();
    process.exitCode = 1;
  });
