import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { createDatabasePool } from './db.js';
import { integrationCipher } from './blingEncryption.js';
import { BlingError, type Tokens } from './blingContract.js';

export const stateHash = (state: string) => createHash('sha256').update(state).digest('hex');
export type Connection = { access: string; refresh: string; expires: number; connectedAt: string; authorizationId: string };
export interface BlingSession {
  get(): Promise<Connection | null>;
  save(tokens: Tokens, newAuthorization?: boolean): Promise<void>;
  remove(): Promise<void>;
  validState(hash: string): Promise<boolean>;
  budget(kind: 'api' | 'oauth'): Promise<void>;
  cooldown(kind: 'api' | 'oauth', ms: number): Promise<void>;
}
export interface BlingStore {
  close?(): Promise<void>;
  status(company: string): Promise<{ connected: boolean; connectedAt: string | null }>;
  createState(company: string, user: string): Promise<string>;
  consumeState(state: string, company: string, user: string): Promise<boolean>;
  locked<T>(company: string, action: (session: BlingSession) => Promise<T>): Promise<T>;
}
export class PgBlingStore implements BlingStore {
  // A provider stall must not occupy the Hub pool used by sessions/inbox/health.
  // One separate connection bounds integration pressure; PostgreSQL locks still
  // coordinate company refresh and global budgets across every replica.
  constructor(private cipher: ReturnType<typeof integrationCipher>, private sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)), private pool: Pool = createDatabasePool(1)) {}
  async close() { await this.pool.end(); }
  async status(company: string) {
    const result = await this.pool.query('SELECT connected_at FROM bling_connections WHERE company_id = $1', [company]);
    return { connected: !!result.rows[0], connectedAt: result.rows[0]?.connected_at.toISOString() ?? null };
  }
  async createState(company: string, user: string) {
    const state = randomBytes(32).toString('base64url');
    // INSERT and invalidation are atomic and company-locked below (no nested pool query).
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lock(client, company);
      await client.query('DELETE FROM bling_oauth_states WHERE expires_at < now()');
      await client.query('DELETE FROM bling_oauth_states WHERE company_id = $1', [company]);
      await client.query(`INSERT INTO bling_oauth_states(state_hash, company_id, user_id, expires_at)
        VALUES($1,$2,$3,now() + interval '5 minutes')`, [stateHash(state), company, user]);
      await client.query('COMMIT');
    } catch { await client.query('ROLLBACK'); throw new BlingError(503, 'Não foi possível iniciar a conexão Bling'); }
    finally { client.release(); }
    return state;
  }
  async consumeState(state: string, company: string, user: string) {
    const result = await this.pool.query(`UPDATE bling_oauth_states SET used_at = now()
      WHERE state_hash = $1 AND company_id = $2 AND user_id = $3 AND used_at IS NULL AND expires_at > now()
      RETURNING state_hash`, [stateHash(state), company, user]);
    return result.rows.length === 1;
  }
  private async lock(client: PoolClient, company: string) {
    await client.query("SET LOCAL lock_timeout = '12s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`bling:${company}`]);
  }
  async locked<T>(company: string, action: (session: BlingSession) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lock(client, company);
      // Stable lock order across API -> 401 -> OAuth and expiry -> OAuth -> API.
      await client.query("SELECT budget FROM bling_request_budgets WHERE budget='api' FOR UPDATE");
      const session: BlingSession = {
        get: async () => {
          const { rows } = await client.query('SELECT * FROM bling_connections WHERE company_id = $1', [company]);
          const row = rows[0];
          if (!row) return null;
          return { access: this.cipher.decrypt(row.access_token_encrypted, company, 'access'),
            refresh: this.cipher.decrypt(row.refresh_token_encrypted, company, 'refresh'),
            expires: row.access_token_expires_at.getTime(), connectedAt: row.connected_at.toISOString(),
            authorizationId: String(row.authorization_id) };
        },
        save: async (tokens, newAuthorization = false) => {
          await client.query(`INSERT INTO bling_connections(company_id,access_token_encrypted,refresh_token_encrypted,access_token_expires_at,authorization_id)
            VALUES($1,$2,$3,now() + ($4 * interval '1 second'),$5) ON CONFLICT(company_id) DO UPDATE SET
            access_token_encrypted=EXCLUDED.access_token_encrypted,refresh_token_encrypted=EXCLUDED.refresh_token_encrypted,
            access_token_expires_at=EXCLUDED.access_token_expires_at,
            authorization_id=CASE WHEN $6 THEN EXCLUDED.authorization_id ELSE bling_connections.authorization_id END,
            connected_at=CASE WHEN $6 THEN clock_timestamp() ELSE bling_connections.connected_at END,
            updated_at=now()`,
          [company, this.cipher.encrypt(tokens.access_token, company, 'access'), this.cipher.encrypt(tokens.refresh_token, company, 'refresh'),
            tokens.expires_in, randomUUID(), newAuthorization]);
        },
        remove: async () => {
          await client.query('DELETE FROM bling_connections WHERE company_id=$1', [company]);
          await client.query('DELETE FROM bling_oauth_states WHERE company_id=$1', [company]);
        },
        validState: async hash => (await client.query('SELECT state_hash FROM bling_oauth_states WHERE company_id=$1 AND state_hash=$2 AND used_at IS NOT NULL AND expires_at > now()', [company, hash])).rows.length === 1,
        cooldown: async (kind, ms) => {
          await client.query("UPDATE bling_request_budgets SET next_at=GREATEST(next_at,clock_timestamp()+($2 * interval '1 millisecond')) WHERE budget=$1", [kind, Math.ceil(ms)]);
        },
        budget: async kind => {
          // Same transaction/connection: safe even with DB_POOL_MAX=1. The global
          // row lock stays held through transport: no delayed reservations/bursts.
          // OAuth reserves BOTH clocks together immediately before transport.
          // Sequential reservations would compress one window after waiting on
          // the other (especially following a long provider cooldown).
          const kinds = kind === 'oauth' ? ['api', 'oauth'] as const : ['api'] as const;
          let wait = 0;
          for (const budget of kinds) {
            const { rows } = await client.query(`SELECT *, extract(epoch FROM (next_at - clock_timestamp()))*1000 AS wait_ms,
              day = (clock_timestamp() AT TIME ZONE 'UTC')::date AS same_day
              FROM bling_request_budgets WHERE budget=$1 FOR UPDATE`, [budget]);
            const row = rows[0];
            if (!row) throw new BlingError(503, 'Limite Bling indisponível');
            if (row.same_day && row.requests >= 120000) throw new BlingError(429, 'Limite diário Bling atingido');
            wait = Math.max(wait, Number(row.wait_ms));
          }
          if (wait > 10000) throw new BlingError(429, 'Bling temporariamente limitado; tente novamente');
          await this.sleep(wait);
          for (const budget of kinds) await client.query(`UPDATE bling_request_budgets SET next_at=clock_timestamp()+($2 * interval '1 millisecond'),
            requests=CASE WHEN day=(clock_timestamp() AT TIME ZONE 'UTC')::date THEN requests+1 ELSE 1 END,
            day=(clock_timestamp() AT TIME ZONE 'UTC')::date WHERE budget=$1`, [budget, budget === 'oauth' ? 3100 : 340]);
        },
      };
      // Transport/domain failures commit already rotated credentials and consumed
      // budgets. Never roll back a successful provider refresh after a failed GET.
      let value: T | undefined; let failure: unknown;
      try { value = await action(session); } catch (error) { failure = error; }
      await client.query('COMMIT');
      if (failure) throw failure;
      return value as T;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof BlingError) throw error;
      throw new BlingError(503, 'Integração Bling temporariamente indisponível');
    } finally { client.release(); }
  }
}
