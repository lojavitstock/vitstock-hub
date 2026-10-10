import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLING_CONTACT_DIRECTORY_PAGE_SIZE,
  BlingContactDirectoryService,
  type BlingContactDirectoryEntry,
  type BlingContactDirectoryGeneration,
  type BlingContactDirectoryRepository,
} from '../server/src/blingContactDirectory.js';
import { BlingError } from '../server/src/blingContract.js';
import { normalizeBlingLookupPhone } from '../server/src/blingContactLookup.js';

class MemoryContactDirectory implements BlingContactDirectoryRepository {
  private generations = new Map<string, { companyId: string; value: BlingContactDirectoryGeneration & { status: 'building' | 'active' | 'retired' }; entries: Map<string, BlingContactDirectoryEntry> }>();
  private active = new Map<string, string>();
  locked = new Set<string>();

  async tryAcquireSyncLock(companyId: string) {
    if (this.locked.has(companyId)) return null;
    this.locked.add(companyId);
    return async () => { this.locked.delete(companyId); };
  }
  async activeGeneration(companyId: string) {
    const id = this.active.get(companyId);
    const generation = id ? this.generations.get(id) : undefined;
    return generation ? { id: generation.value.id, syncedAt: generation.value.syncedAt, count: generation.value.count } : null;
  }
  async startGeneration(companyId: string, generationId: string) {
    this.generations.set(generationId, { companyId, value: { id: generationId, syncedAt: '', count: 0, status: 'building' }, entries: new Map() });
  }
  async upsertPage(companyId: string, generationId: string, entries: BlingContactDirectoryEntry[]) {
    const generation = this.generations.get(generationId);
    assert.equal(generation?.companyId, companyId);
    for (const entry of entries) generation!.entries.set(entry.id, entry);
  }
  async publishGeneration(companyId: string, generationId: string) {
    const generation = this.generations.get(generationId);
    assert.equal(generation?.companyId, companyId);
    const previousId = this.active.get(companyId);
    if (previousId) this.generations.get(previousId)!.value.status = 'retired';
    generation!.value = { ...generation!.value, status: 'active', syncedAt: new Date().toISOString(), count: generation!.entries.size };
    this.active.set(companyId, generationId);
    return generation!.entries.size;
  }
  async discardGeneration(companyId: string, generationId: string) {
    const generation = this.generations.get(generationId);
    if (generation?.companyId === companyId && generation.value.status === 'building') this.generations.delete(generationId);
  }
  async findByPhone(companyId: string, generationId: string, digits: string, limit: number) {
    const generation = this.generations.get(generationId);
    if (generation?.companyId !== companyId || generation.value.status !== 'active') return [];
    return [...generation.entries.values()].filter(entry => [entry.phone, entry.mobile]
      .some(value => normalizeBlingLookupPhone(value)?.digits === digits)).slice(0, limit);
  }
  async findById(companyId: string, generationId: string, contactId: string) {
    const generation = this.generations.get(generationId);
    if (generation?.companyId !== companyId || generation.value.status !== 'active') return null;
    return generation.entries.get(contactId) ?? null;
  }
  async seed(companyId: string, generationId: string, entries: BlingContactDirectoryEntry[]) {
    await this.startGeneration(companyId, generationId);
    await this.upsertPage(companyId, generationId, entries);
    await this.publishGeneration(companyId, generationId);
  }
}

const contact = (index: number) => ({
  id: String(920_000_000_000_000_000n + BigInt(index)),
  nome: `Contato Diretório QA ${index}`,
  numeroDocumento: null,
  telefone: null,
  celular: null,
  situacao: 'A' as const,
});
const entry: BlingContactDirectoryEntry = {
  id: '920000000000000999', name: 'Cliente QA', document: null,
  phone: '+55 21 4000-1234', mobile: '+55 (21) 99123-4567', status: 'A',
};

test('Bling contact directory sync paginates bounded pages and subsequent lookup stays local and exact', async () => {
  const repository = new MemoryContactDirectory();
  const providerContacts = Array.from({ length: BLING_CONTACT_DIRECTORY_PAGE_SIZE }, (_, index) => contact(index + 1));
  providerContacts.push({ ...contact(999), id: entry.id, nome: entry.name, telefone: entry.phone, celular: entry.mobile });
  const queries: URLSearchParams[] = [];
  const service = new BlingContactDirectoryService(repository, { async read(_companyId, resource, query) {
    assert.equal(resource, 'contacts');
    queries.push(new URLSearchParams(query));
    const page = Number(query.get('pagina'));
    return { data: providerContacts.slice((page - 1) * BLING_CONTACT_DIRECTORY_PAGE_SIZE, page * BLING_CONTACT_DIRECTORY_PAGE_SIZE) };
  } });

  const sync = await service.refresh('company-a');
  assert.equal(sync.contacts, 101);
  assert.equal(sync.pages, 2);
  assert.deepEqual(queries.map(query => [query.get('pagina'), query.get('limite')]), [['1', '100'], ['2', '100']]);
  assert.equal((await service.status('company-a')).ready, true);

  const mobile = normalizeBlingLookupPhone('5521991234567')!;
  const found = await service.lookup('company-a', mobile);
  assert.deepEqual(found.matches.map(match => match.id), [entry.id]);
  assert.equal((await service.existence('company-a', mobile)).status, 'found');
  const landline = normalizeBlingLookupPhone(entry.phone)!;
  assert.deepEqual((await service.lookup('company-a', landline)).matches.map(match => match.id), [entry.id]);
  assert.equal((await service.existence('company-a', landline)).status, 'found');
  assert.equal((await service.existence('company-a', normalizeBlingLookupPhone('5521991234568')!)).status, 'not_found');
  assert.equal(queries.length, 2, 'conversation lookup and existence checks must not call the Bling API');
  assert.equal((await service.existence('company-b', mobile)).status, 'unavailable', 'directory state is tenant-scoped');
});

test('Bling contact directory failed refresh preserves the prior complete generation', async () => {
  const repository = new MemoryContactDirectory();
  await repository.seed('company-a', 'generation-previous', [entry]);
  const service = new BlingContactDirectoryService(repository, { async read() { throw new BlingError(502, 'provider failure'); } });
  await assert.rejects(service.refresh('company-a'), /provider failure/);
  assert.equal((await repository.activeGeneration('company-a'))?.id, 'generation-previous');
  const lookup = await service.lookup('company-a', normalizeBlingLookupPhone(entry.mobile)!);
  assert.deepEqual(lookup.matches.map(match => match.id), [entry.id]);
});

test('Bling contact directory reports stale data and refuses a concurrent refresh lock', async () => {
  const repository = new MemoryContactDirectory();
  await repository.seed('company-a', 'generation-stale', [entry]);
  const service = new BlingContactDirectoryService(repository, { async read() { throw new Error('unexpected provider call'); } }, () => Date.now() + 25 * 60 * 60 * 1000);
  const status = await service.status('company-a');
  assert.equal(status.ready, false);
  assert.equal(status.stale, true);
  assert.equal((await service.existence('company-a', normalizeBlingLookupPhone(entry.mobile)!)).status, 'unavailable');
  repository.locked.add('company-a');
  await assert.rejects(service.refresh('company-a'), error => error instanceof BlingError && error.statusCode === 409);
});
