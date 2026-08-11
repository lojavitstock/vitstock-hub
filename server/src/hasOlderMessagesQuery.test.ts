import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHasOlderMessagesQuery } from './hasOlderMessagesQuery.js';

function assertTypedParameters(query: ReturnType<typeof buildHasOlderMessagesQuery>) {
  assert.ok(query);
  const placeholders = [...query.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  const parameterNumbers = [...new Set(placeholders)].sort((left, right) => left - right);
  assert.deepEqual(parameterNumbers, query.values.map((_value, index) => index + 1));
  for (const parameterNumber of parameterNumbers) {
    assert.match(query.text, new RegExp(`\\$${parameterNumber}::`));
  }
}

test('usa parâmetros tipados para remoteJid, phone/canonical JID e timestamp', () => {
  const query = buildHasOlderMessagesQuery({
    companyId: '00000000-0000-0000-0000-000000000001',
    jids: ['164794086760597@lid', '5521997402785@s.whatsapp.net'],
    contactIds: ['00000000-0000-0000-0000-000000000002'],
    afterTimestamp: 1785850258031,
  });
  assertTypedParameters(query);
  assert.match(query!.text, /ANY\(\$2::text\[\]\)/);
  assert.match(query!.text, /ANY\(\$3::uuid\[\]\)/);
  assert.match(query!.text, /to_timestamp\(\$4::double precision \/ 1000\)/);
});

test('usa somente remoteJid quando não há phone/contactId associado', () => {
  const query = buildHasOlderMessagesQuery({
    companyId: '00000000-0000-0000-0000-000000000001',
    jids: ['5511999999999@s.whatsapp.net'],
    contactIds: [],
    afterTimestamp: 1785850258031,
  });
  assertTypedParameters(query);
  assert.equal(query!.values.length, 3);
  assert.doesNotMatch(query!.text, /ANY\(\$3::uuid\[\]\)/);
  assert.match(query!.text, /to_timestamp\(\$3::double precision \/ 1000\)/);
});

test('não monta query quando o timestamp está ausente ou nulo', () => {
  assert.equal(buildHasOlderMessagesQuery({ companyId: 'company', jids: ['contact@lid'], contactIds: [] }), null);
  assert.equal(buildHasOlderMessagesQuery({ companyId: 'company', jids: ['contact@s.whatsapp.net'], contactIds: [], afterTimestamp: null }), null);
  assert.equal(buildHasOlderMessagesQuery({ companyId: 'company', jids: ['contact@s.whatsapp.net'], contactIds: [], afterTimestamp: 0 }), null);
});

test('mantém @lid e @s.whatsapp.net como identificadores textuais', () => {
  for (const remoteJid of ['164794086760597@lid', '5511999999999@s.whatsapp.net']) {
    const query = buildHasOlderMessagesQuery({
      companyId: '00000000-0000-0000-0000-000000000001',
      jids: [remoteJid],
      contactIds: [],
      afterTimestamp: 1785850258031,
    });
    assertTypedParameters(query);
    assert.match(query!.text, /ANY\(\$2::text\[\]\)/);
  }
});
