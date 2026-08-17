import { strict as assert } from 'node:assert';
import test from 'node:test';
import { normalizeContactEmail, normalizeContactPhone, orderedContactPair, parseContactCsv, splitContactValues } from '../server/src/contactDomain';

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
