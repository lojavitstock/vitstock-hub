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
  private generations = new Map<string, { companyId: string; authorizationId: string; value: BlingContactDirectoryGeneration & { status: 'building' | 'active' | 'retired' }; entries: Map<string, BlingContactDirectoryEntry> }>();
  private active = new Map<string, string>();
  private authorizations = new Map<string, string>();
  locked = new Set<string>();

  setAuthorization(companyId: string, authorizationId: string) { this.authorizations.set(companyId, authorizationId); }

  async tryAcquireSyncLock(companyId: string) {
    if (this.locked.has(companyId)) return null;
    this.locked.add(companyId);
    return async () => { this.locked.delete(companyId); };
  }
  async activeGeneration(companyId: string) {
    const id = this.active.get(companyId);
    const generation = id ? this.generations.get(id) : undefined;
    return generation?.authorizationId === this.authorizations.get(companyId)
      ? { id: generation.value.id, syncedAt: generation.value.syncedAt, count: generation.value.count } : null;
  }
  async currentAuthorizationId(companyId: string) { return this.authorizations.get(companyId) ?? null; }
  async startGeneration(companyId: string, generationId: string, authorizationId: string) {
    if (this.authorizations.get(companyId) !== authorizationId) throw new BlingError(409, 'authorization changed');
    this.generations.set(generationId, { companyId, authorizationId, value: { id: generationId, syncedAt: '', count: 0, status: 'building' }, entries: new Map() });
  }
  async upsertPage(companyId: string, generationId: string, entries: BlingContactDirectoryEntry[]) {
    const generation = this.generations.get(generationId);
    assert.equal(generation?.companyId, companyId);
    for (const entry of entries) generation!.entries.set(entry.id, entry);
  }
  async publishGeneration(companyId: string, generationId: string) {
    const generation = this.generations.get(generationId);
    assert.equal(generation?.companyId, companyId);
    if (generation?.authorizationId !== this.authorizations.get(companyId)) throw new BlingError(409, 'authorization changed');
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
    if (generation?.companyId !== companyId || generation.authorizationId !== this.authorizations.get(companyId) || generation.value.status !== 'active') return [];
    return [...generation.entries.values()].filter(entry => [entry.phone, entry.mobile]
      .some(value => normalizeBlingLookupPhone(value)?.digits === digits)).slice(0, limit);
  }
  async findById(companyId: string, generationId: string, contactId: string) {
    const generation = this.generations.get(generationId);
    if (generation?.companyId !== companyId || generation.authorizationId !== this.authorizations.get(companyId) || generation.value.status !== 'active') return null;
    return generation.entries.get(contactId) ?? null;
  }
  async seed(companyId: string, generationId: string, entries: BlingContactDirectoryEntry[]) {
    const authorizationId = this.authorizations.get(companyId) ?? `authorization-${companyId}`;
    this.authorizations.set(companyId, authorizationId);
    await this.startGeneration(companyId, generationId, authorizationId);
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
  repository.setAuthorization('company-a', 'authorization-a');
  repository.setAuthorization('company-b', 'authorization-b');
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
  repository.setAuthorization('company-a', 'authorization-a');
  await repository.seed('company-a', 'generation-previous', [entry]);
  const service = new BlingContactDirectoryService(repository, { async read() { throw new BlingError(502, 'provider failure'); } });
  await assert.rejects(service.refresh('company-a'), /provider failure/);
  assert.equal((await repository.activeGeneration('company-a'))?.id, 'generation-previous');
  const lookup = await service.lookup('company-a', normalizeBlingLookupPhone(entry.mobile)!);
  assert.deepEqual(lookup.matches.map(match => match.id), [entry.id]);
});

test('Bling contact directory reports stale data and refuses a concurrent refresh lock', async () => {
  const repository = new MemoryContactDirectory();
  repository.setAuthorization('company-a', 'authorization-a');
  await repository.seed('company-a', 'generation-stale', [entry]);
  const service = new BlingContactDirectoryService(repository, { async read() { throw new Error('unexpected provider call'); } }, () => Date.now() + 25 * 60 * 60 * 1000);
  const status = await service.status('company-a');
  assert.equal(status.ready, false);
  assert.equal(status.stale, true);
  assert.equal((await service.existence('company-a', normalizeBlingLookupPhone(entry.mobile)!)).status, 'unavailable');
  repository.locked.add('company-a');
  await assert.rejects(service.refresh('company-a'), error => error instanceof BlingError && error.statusCode === 409);
});

test('Bling contact directory is unavailable after OAuth authorization changes until a new snapshot is synced', async () => {
  const repository = new MemoryContactDirectory();
  repository.setAuthorization('company-a', 'account-a-authorization');
  repository.setAuthorization('company-b', 'account-b-authorization');
  const service = new BlingContactDirectoryService(repository, { async read() { return { data: [{
    id: entry.id, nome: entry.name, numeroDocumento: entry.document, telefone: entry.phone, celular: entry.mobile, situacao: 'A',
  }] }; } });
  const phone = normalizeBlingLookupPhone(entry.mobile)!;

  await service.refresh('company-a');
  assert.equal((await service.existence('company-a', phone)).status, 'found');
  const oldGenerationId = (await repository.activeGeneration('company-a'))!.id;

  repository.setAuthorization('company-a', 'account-b-authorization');
  assert.deepEqual(await service.status('company-a'), { ready: false, stale: false, syncing: false, syncedAt: null, contacts: 0 });
  assert.deepEqual(await service.existence('company-a', phone), { status: 'unavailable', syncedAt: null });
  await assert.rejects(service.lookup('company-a', phone), error => error instanceof BlingError && error.statusCode === 503);
  assert.equal(repository.generations.has(oldGenerationId), true, 'the previous generation remains retained as history');
  assert.equal((await service.existence('company-b', phone)).status, 'unavailable', 'authorization and data remain tenant-scoped');

  await service.refresh('company-a');
  assert.equal((await service.existence('company-a', phone)).status, 'found');
});

test('Bling contact directory refuses publication when OAuth authorization changes during provider sync', async () => {
  const repository = new MemoryContactDirectory();
  repository.setAuthorization('company-a', 'authorization-before');
  await repository.seed('company-a', 'generation-before', [entry]);
  let entered!: () => void;
  const providerEntered = new Promise<void>(resolve => { entered = resolve; });
  let finish!: (value: unknown) => void;
  const providerResult = new Promise<unknown>(resolve => { finish = resolve; });
  const service = new BlingContactDirectoryService(repository, { async read() { entered(); return providerResult; } });
  const sync = service.refresh('company-a');
  await providerEntered;
  repository.setAuthorization('company-a', 'authorization-after');
  finish({ data: [{ id: entry.id, nome: 'Conta A antiga', numeroDocumento: null, telefone: entry.phone, celular: entry.mobile, situacao: 'A' }] });

  await assert.rejects(sync, error => error instanceof BlingError && error.statusCode === 409);
  assert.equal(repository.generations.get('generation-before')?.value.status, 'active');
  assert.equal((await service.status('company-a')).ready, false);
  assert.equal((await service.existence('company-a', normalizeBlingLookupPhone(entry.mobile)!)).status, 'unavailable');
  assert.equal([...repository.generations.values()].some(generation => generation.value.status === 'building'), false);
});
