import { strict as assert } from 'node:assert';
import test from 'node:test';
import { canonicalPhone, formatPhoneForDisplay, normalizeContactEmail, normalizeContactPhone, normalizePhoneIdentity, orderedContactPair, parseContactCsv, phoneIdentityKeys, splitContactValues } from '../server/src/contactDomain';
import { dedupeContactPhones } from '../src/utils/phone';
import { contactArchiveWhereClause, isContactVisibleInList } from '../server/src/contactList';
import { canMergeContacts } from '../server/src/contactMerge';
import { buildDuplicateGroups, isHubGoogleSameIdentity } from '../server/src/contactDuplicates';
import { phoneLookupKeys, upsertContactPhone } from '../server/src/contactPhones';

test('normalizes phone and email values deterministically', () => {
  assert.equal(normalizeContactPhone('+55 (21) 99999-0000'), '5521999990000');
  assert.equal(normalizeContactEmail('  CLIENTE@EXAMPLE.COM '), 'cliente@example.com');
  assert.deepEqual(splitContactValues('a; b\nc'), ['a', 'b', 'c']);
});

test('normalizes Brazilian input to one canonical identity only with country context', () => {
  const expected = '+5521999990000';
  assert.equal(canonicalPhone('+55 21 99999-0000'), expected);
  assert.equal(canonicalPhone('5521999990000'), expected);
  assert.equal(canonicalPhone('21999990000'), expected);
  assert.equal(canonicalPhone('(21) 99999-0000'), expected);
  assert.equal(formatPhoneForDisplay(expected), '(21) 99999-0000');
  assert.deepEqual(phoneIdentityKeys('(21) 99999-0000'), ['+5521999990000', '5521999990000', '21999990000']);
});

test('does not infer Brazil or a missing ninth digit without safe context', () => {
  assert.equal(normalizePhoneIdentity('2199990000').canonical, null);
  assert.equal(normalizePhoneIdentity('2199990000', { defaultCountry: 'BR' }).ambiguous, true);
  assert.equal(canonicalPhone('2199990000'), '+552199990000');
  assert.notEqual(canonicalPhone('2199990000'), canonicalPhone('21999990000'));
  assert.equal(canonicalPhone('+1 212 555 0100'), '+12125550100');
  assert.equal(normalizePhoneIdentity('12125550100').canonical, null);
});

test('parses quoted CSV rows for contact import', () => {
  assert.deepEqual(parseContactCsv('name,phone,company\nMaria,"+55 21 99999-0000","Loja, Centro"'), [{ name: 'Maria', phone: '+55 21 99999-0000', company: 'Loja, Centro' }]);
});

test('orders duplicate decision pairs independent of input order', () => {
  assert.deepEqual(orderedContactPair('b', 'a'), ['a', 'b']);
  assert.deepEqual(orderedContactPair('a', 'b'), ['a', 'b']);
});

test('merge guard rejects a source or target already merged', () => {
  assert.equal(canMergeContacts({ merged_into_contact_id: null }, { merged_into_contact_id: null }), true);
  assert.equal(canMergeContacts({ merged_into_contact_id: 'target' }, { merged_into_contact_id: null }), false);
  assert.equal(canMergeContacts({ merged_into_contact_id: null }, { merged_into_contact_id: 'other' }), false);
});

test('duplicate review groups related contacts once and keeps three-record groups intact', () => {
  const contacts = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const groups = buildDuplicateGroups(contacts, [
    { contactId: 'a', kind: 'phone', key: '+5521999990000' },
    { contactId: 'b', kind: 'phone', key: '+5521999990000' },
    { contactId: 'c', kind: 'phone', key: '+5521999990000' },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.contacts.map((contact) => contact.id), ['a', 'b', 'c']);
  assert.equal(groups[0]?.unresolvedPairCount, 3);
});

test('duplicate review accepts equivalent phone formats as the same evidence', () => {
  const contacts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const values = ['+5521999990000', '5521999990000', '21999990000'];
  const groups = buildDuplicateGroups(contacts, values.map((value, index) => ({
    contactId: contacts[index]!.id,
    kind: 'phone' as const,
    key: canonicalPhone(value, { defaultCountry: 'BR' })!,
    value,
  })));
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.reason, 'Mesmo telefone');
  assert.equal(groups[0]?.contacts.length, 3);
});

test('different decision removes only the decided pair from a duplicate group', () => {
  const contacts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const sources = contacts.map((contact) => ({ contactId: contact.id, kind: 'phone' as const, key: '+5521999990000' }));
  const groups = buildDuplicateGroups(contacts, sources, [{ contactAId: 'a', contactBId: 'b', decision: 'different' }]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.differentPairs, [['a', 'b']]);
  assert.equal(groups[0]?.unresolvedPairCount, 2);
  assert.equal(buildDuplicateGroups([{ id: 'a' }, { id: 'b' }], sources.slice(0, 2), [{ contactAId: 'a', contactBId: 'b', decision: 'different' }]).length, 0);
});

test('phone lookup keys cover canonical and legacy representations without guessing a ninth digit', () => {
  assert.deepEqual(phoneLookupKeys('(21) 99999-0000'), ['5521999990000', '21999990000']);
  assert.deepEqual(phoneLookupKeys('+5521999990000'), ['5521999990000', '21999990000']);
  assert.notDeepEqual(phoneLookupKeys('2199990000'), phoneLookupKeys('21999990000'));
});

test('contact list phone display deduplicates equivalent aliases and keeps the preferred value', () => {
  const phones = dedupeContactPhones([
    { phone: '21999990000', is_primary: false },
    { phone: '+5521999990000', is_primary: true },
    { phone: '5511999990000', is_primary: false },
  ]);
  assert.deepEqual(phones, [{ phone: '+5521999990000', is_primary: true }, { phone: '5511999990000', is_primary: false }]);
});

test('default contacts list hides archived and merged records while explicit archive view includes them', () => {
  const active = { archived_at: null, merged_into_contact_id: null };
  const archived = { archived_at: '2026-08-25T20:04:16.996Z', merged_into_contact_id: null };
  const merged = { archived_at: null, merged_into_contact_id: 'target' };
  assert.equal(isContactVisibleInList(active, false), true);
  assert.equal(isContactVisibleInList(archived, false), false);
  assert.equal(isContactVisibleInList(merged, false), false);
  assert.equal(isContactVisibleInList(archived, true), true);
  assert.equal(contactArchiveWhereClause(false), 'c.archived_at IS NULL AND c.merged_into_contact_id IS NULL');
  assert.equal(contactArchiveWhereClause(true), '');
});

test('phone upsert reuses a semantically equivalent legacy row', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const executor = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT id, normalized_phone')) {
        return { rows: [{ id: 'phone-1', normalized_phone: '21999990000', source: 'whatsapp' }] };
      }
      return { rows: [] };
    },
  };
  const result = await upsertContactPhone(executor, {
    companyId: 'company-1',
    contactId: 'contact-1',
    phone: '+55 (21) 99999-0000',
    isPrimary: true,
    source: 'google',
  });
  assert.deepEqual(result, { id: 'phone-1', created: false });
  assert.equal(calls.some((call) => call.sql.startsWith('INSERT INTO contact_phones')), false);
  const updateValues = calls.find((call) => call.sql.startsWith('UPDATE contact_phones'))?.values || [];
  assert.equal(updateValues[3], false);
  assert.equal(updateValues[4], '5521999990000');
});

test('Hub and Google records with WhatsApp evidence are excluded from duplicate review', () => {
  const hub = { id: 'hub', source: 'hub', google_resource_name: null, whatsapp_linked: true };
  const legacySystemWhatsapp = { id: 'legacy-system', source: 'system', google_resource_name: null, whatsapp_linked: true, conversation_count: 1 };
  const google = { id: 'google', source: 'google', google_resource_name: 'people/a', whatsapp_linked: false };
  const googleOther = { id: 'google-b', source: 'google', google_resource_name: 'people/b', whatsapp_linked: false };
  const sources = [
    { contactId: 'hub', kind: 'phone' as const, key: '+5521999990000' },
    { contactId: 'google', kind: 'phone' as const, key: '+5521999990000' },
  ];
  assert.equal(isHubGoogleSameIdentity(hub, google), true);
  assert.equal(isHubGoogleSameIdentity(legacySystemWhatsapp, google), true);
  assert.equal(buildDuplicateGroups([hub, google], sources).length, 0);
  assert.equal(buildDuplicateGroups([hub, google, googleOther], [
    ...sources,
    { contactId: 'google-b', kind: 'phone' as const, key: '+5521999990000' },
  ]).length, 1);
  assert.equal(buildDuplicateGroups([
    { id: 'manual', source: 'manual', google_resource_name: null, whatsapp_linked: false },
    google,
  ], [
    { contactId: 'manual', kind: 'phone' as const, key: '+5521999990000' },
    { contactId: 'google', kind: 'phone' as const, key: '+5521999990000' },
  ]).length, 1);
});
