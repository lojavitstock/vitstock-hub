import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { db } from './db.js';
import { BlingError, blingContactListModel, parseContract } from './blingContract.js';
import { normalizeBlingLookupPhone, type BlingLookupPhone } from './blingContactLookup.js';

export const BLING_CONTACT_DIRECTORY_PAGE_SIZE = 100;
export const BLING_CONTACT_DIRECTORY_MAX_PAGES = 250;
export const BLING_CONTACT_DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;

export type BlingContactDirectoryEntry = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  mobile: string | null;
  status: string | null;
};

export type BlingContactDirectoryGeneration = {
  id: string;
  syncedAt: string;
  count: number;
};

export interface BlingContactDirectoryRepository {
  tryAcquireSyncLock(companyId: string): Promise<(() => Promise<void>) | null>;
  activeGeneration(companyId: string): Promise<BlingContactDirectoryGeneration | null>;
  startGeneration(companyId: string, generationId: string): Promise<void>;
  upsertPage(companyId: string, generationId: string, entries: BlingContactDirectoryEntry[]): Promise<void>;
  publishGeneration(companyId: string, generationId: string): Promise<number>;
  discardGeneration(companyId: string, generationId: string): Promise<void>;
  findByPhone(companyId: string, generationId: string, digits: string, limit: number): Promise<BlingContactDirectoryEntry[]>;
  findById(companyId: string, generationId: string, contactId: string): Promise<BlingContactDirectoryEntry | null>;
}

export class PgBlingContactDirectoryRepository implements BlingContactDirectoryRepository {
  constructor(private pool: Pool = db) {}

  async tryAcquireSyncLock(companyId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [`bling-contact-directory:${companyId}`]);
      if (!result.rows[0]?.locked) { client.release(); return null; }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`bling-contact-directory:${companyId}`]); }
        finally { client.release(); }
      };
    } catch (error) { client.release(); throw error; }
  }

  async activeGeneration(companyId: string) {
    const result = await this.pool.query<{ generation_id: string; completed_at: Date | string; contact_count: number | string }>(
      `SELECT generation_id, completed_at, contact_count
       FROM bling_contact_directory_generations
       WHERE company_id=$1 AND status='active'`, [companyId]);
    const row = result.rows[0];
    return row ? { id: String(row.generation_id), syncedAt: new Date(row.completed_at).toISOString(), count: Number(row.contact_count) } : null;
  }

  async startGeneration(companyId: string, generationId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM bling_contact_directory_generations
        WHERE company_id=$1 AND (status='building' OR (status='retired' AND completed_at < now() - interval '30 days'))`, [companyId]);
      await client.query(`INSERT INTO bling_contact_directory_generations(company_id,generation_id,status)
        VALUES($1,$2,'building')`, [companyId, generationId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async upsertPage(companyId: string, generationId: string, entries: BlingContactDirectoryEntry[]) {
    if (!entries.length) return;
    const rows = entries.map(entry => ({
      id: entry.id,
      name: entry.name,
      document: entry.document,
      phone: entry.phone,
      mobile: entry.mobile,
      phone_digits: normalizeBlingLookupPhone(entry.phone)?.digits ?? null,
      mobile_digits: normalizeBlingLookupPhone(entry.mobile)?.digits ?? null,
      status: entry.status,
    }));
    await this.pool.query(`INSERT INTO bling_contact_directory_entries(
        company_id,generation_id,bling_contact_id,name,document,phone,mobile,phone_digits,mobile_digits,status)
      SELECT $1,$2,x.id,x.name,x.document,x.phone,x.mobile,x.phone_digits,x.mobile_digits,x.status
      FROM jsonb_to_recordset($3::jsonb) AS x(
        id text,name text,document text,phone text,mobile text,phone_digits text,mobile_digits text,status text)
      ON CONFLICT(company_id,generation_id,bling_contact_id) DO UPDATE SET
        name=EXCLUDED.name,document=EXCLUDED.document,phone=EXCLUDED.phone,mobile=EXCLUDED.mobile,
        phone_digits=EXCLUDED.phone_digits,mobile_digits=EXCLUDED.mobile_digits,status=EXCLUDED.status`,
    [companyId, generationId, JSON.stringify(rows)]);
  }

  async publishGeneration(companyId: string, generationId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const generation = await client.query<{ status: string }>(
        `SELECT status FROM bling_contact_directory_generations
         WHERE company_id=$1 AND generation_id=$2 FOR UPDATE`, [companyId, generationId]);
      if (generation.rows[0]?.status !== 'building') throw new Error('Geração do diretório Bling não está em construção');
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM bling_contact_directory_entries
         WHERE company_id=$1 AND generation_id=$2`, [companyId, generationId]);
      await client.query(`UPDATE bling_contact_directory_generations SET status='retired'
        WHERE company_id=$1 AND status='active'`, [companyId]);
      await client.query(`UPDATE bling_contact_directory_generations
        SET status='active',completed_at=clock_timestamp(),contact_count=$3
        WHERE company_id=$1 AND generation_id=$2`, [companyId, generationId, Number(count.rows[0]?.count || 0)]);
      await client.query('COMMIT');
      return Number(count.rows[0]?.count || 0);
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async discardGeneration(companyId: string, generationId: string) {
    await this.pool.query(`DELETE FROM bling_contact_directory_generations
      WHERE company_id=$1 AND generation_id=$2 AND status='building'`, [companyId, generationId]);
  }

  async findByPhone(companyId: string, generationId: string, digits: string, limit: number) {
    const result = await this.pool.query(`SELECT bling_contact_id AS id,name,document,phone,mobile,status
      FROM bling_contact_directory_entries
      WHERE company_id=$1 AND generation_id=$2 AND (phone_digits=$3 OR mobile_digits=$3)
      ORDER BY lower(name),bling_contact_id LIMIT $4`, [companyId, generationId, digits, limit]);
    return result.rows as BlingContactDirectoryEntry[];
  }

  async findById(companyId: string, generationId: string, contactId: string) {
    const result = await this.pool.query(`SELECT bling_contact_id AS id,name,document,phone,mobile,status
      FROM bling_contact_directory_entries
      WHERE company_id=$1 AND generation_id=$2 AND bling_contact_id=$3`, [companyId, generationId, contactId]);
    return result.rows[0] as BlingContactDirectoryEntry | undefined ?? null;
  }
}

type BlingContactReader = { read(companyId: string, resource: 'contacts', query: URLSearchParams): Promise<unknown> };
export type BlingContactDirectorySyncSummary = {
  generationId: string;
  syncedAt: string;
  contacts: number;
  pages: number;
};

export class BlingContactDirectoryService {
  private inFlight = new Map<string, Promise<BlingContactDirectorySyncSummary>>();

  constructor(
    private repository: BlingContactDirectoryRepository,
    private client: BlingContactReader,
    private now = Date.now,
  ) {}

  private fresh(snapshot: BlingContactDirectoryGeneration | null) {
    return Boolean(snapshot && this.now() - new Date(snapshot.syncedAt).getTime() < BLING_CONTACT_DIRECTORY_TTL_MS);
  }

  async status(companyId: string) {
    const snapshot = await this.repository.activeGeneration(companyId);
    return {
      ready: this.fresh(snapshot),
      stale: Boolean(snapshot && !this.fresh(snapshot)),
      syncing: this.inFlight.has(companyId),
      syncedAt: snapshot?.syncedAt ?? null,
      contacts: snapshot?.count ?? 0,
    };
  }

  async existence(companyId: string, phone: BlingLookupPhone) {
    const snapshot = await this.repository.activeGeneration(companyId);
    if (!this.fresh(snapshot)) return { status: 'unavailable' as const, syncedAt: snapshot?.syncedAt ?? null };
    const matches = await this.repository.findByPhone(companyId, snapshot!.id, phone.digits, 1);
    return { status: matches.length ? 'found' as const : 'not_found' as const, syncedAt: snapshot!.syncedAt };
  }

  async lookup(companyId: string, phone: BlingLookupPhone, contactId?: string) {
    const snapshot = await this.repository.activeGeneration(companyId);
    if (!this.fresh(snapshot)) throw new BlingError(503, 'O índice de contatos Bling precisa ser atualizado antes da consulta');
    if (contactId) {
      const selected = await this.repository.findById(companyId, snapshot!.id, contactId);
      if (!selected || ![selected.phone, selected.mobile].some(value => normalizeBlingLookupPhone(value)?.digits === phone.digits)) {
        throw new BlingError(404, 'O cadastro selecionado não corresponde ao telefone desta conversa');
      }
      return { snapshot: snapshot!, matches: [selected], truncated: false };
    }
    const matches = await this.repository.findByPhone(companyId, snapshot!.id, phone.digits, 21);
    return { snapshot: snapshot!, matches: matches.slice(0, 20), truncated: matches.length > 20 };
  }

  async refresh(companyId: string): Promise<BlingContactDirectorySyncSummary> {
    const active = this.inFlight.get(companyId);
    if (active) return active;
    const task = this.performSync(companyId);
    this.inFlight.set(companyId, task);
    try { return await task; }
    finally { if (this.inFlight.get(companyId) === task) this.inFlight.delete(companyId); }
  }

  private async performSync(companyId: string): Promise<BlingContactDirectorySyncSummary> {
    const release = await this.repository.tryAcquireSyncLock(companyId);
    if (!release) throw new BlingError(409, 'O diretório Bling já está sendo atualizado');
    const generationId = randomUUID();
    let started = false;
    try {
      await this.repository.startGeneration(companyId, generationId);
      started = true;
      const seen = new Set<string>();
      let pages = 0;
      for (let page = 1; page <= BLING_CONTACT_DIRECTORY_MAX_PAGES; page += 1) {
        const query = new URLSearchParams({ pagina: String(page), limite: String(BLING_CONTACT_DIRECTORY_PAGE_SIZE) });
        const response = parseContract(
          z.object({ data: z.array(blingContactListModel) }),
          await this.client.read(companyId, 'contacts', query),
        );
        pages = page;
        if (response.data.length > BLING_CONTACT_DIRECTORY_PAGE_SIZE) throw new BlingError(502, 'A página do diretório Bling excede o limite solicitado');
        if (response.data.some(contact => seen.has(contact.id))) throw new BlingError(502, 'A paginação do diretório Bling repetiu um cadastro');
        const entries = response.data.map(contact => ({
          id: contact.id,
          name: contact.nome,
          document: contact.numeroDocumento ?? null,
          phone: contact.telefone ?? null,
          mobile: contact.celular ?? null,
          status: contact.situacao ?? null,
        }));
        for (const entry of entries) seen.add(entry.id);
        await this.repository.upsertPage(companyId, generationId, entries);
        if (response.data.length < BLING_CONTACT_DIRECTORY_PAGE_SIZE) break;
        if (page === BLING_CONTACT_DIRECTORY_MAX_PAGES) throw new BlingError(502, 'A paginação do diretório Bling excedeu o limite seguro; o snapshot anterior foi preservado');
      }
      const contacts = await this.repository.publishGeneration(companyId, generationId);
      const snapshot = await this.repository.activeGeneration(companyId);
      if (!snapshot || snapshot.id !== generationId) throw new BlingError(503, 'O diretório de contatos Bling não foi publicado');
      return { generationId, syncedAt: snapshot.syncedAt, contacts, pages };
    } catch (error) {
      if (started) await this.repository.discardGeneration(companyId, generationId).catch(() => undefined);
      throw error;
    } finally { await release(); }
  }
}

