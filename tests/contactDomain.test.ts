import { strict as assert } from 'node:assert';
import test from 'node:test';
import { normalizeContactEmail, normalizeContactPhone, orderedContactPair, parseContactCsv, splitContactValues } from '../server/src/contactDomain';
import { canMergeContacts } from '../server/src/contactMerge';

test('normalizes phone and email values deterministically', () => {
  assert.equal(normalizeContactPhone('+55 (21) 99999-0000'), '5521999990000');
  assert.equal(normalizeContactEmail('  CLIENTE@EXAMPLE.COM '), 'cliente@example.com');
  assert.deepEqual(splitContactValues('a; b\nc'), ['a', 'b', 'c']);
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
