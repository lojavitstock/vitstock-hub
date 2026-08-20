import { strict as assert } from 'node:assert';
import test from 'node:test';
import { canonicalPhone, formatPhoneForDisplay, normalizeContactEmail, normalizeContactPhone, normalizePhoneIdentity, orderedContactPair, parseContactCsv, phoneIdentityKeys, splitContactValues } from '../server/src/contactDomain';
import { canMergeContacts } from '../server/src/contactMerge';

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
