import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  buildExplicitConversationLookup,
  classifyExplicitConversationMatches,
  explicitPhoneAliasRemoteJid,
  explicitPhoneAliasRemoteJids,
  normalizeManualNewMessagePhone,
} from '../server/src/newMessageDestination';
import { normalizeManualPhone, recentPrivateConversations } from '../src/utils/newMessage';
import { Conversation } from '../src/types';

const conversation = (id: string, phone: string, lastMessageAt: number, options: Partial<Conversation> = {}): Conversation => ({
  id,
  contact: { id, name: id, phone, tags: [], createdAt: '2026-01-01' },
  lastMessage: id,
  lastMessageTimestamp: id,
  lastMessageAt,
  unreadCount: 0,
  status: 'open',
  department: 'Atendimento Geral',
  ...options,
});

test('new outbound phone requires a valid complete phone while explicit provider aliases remain lookup candidates', () => {
  assert.deepEqual(normalizeManualNewMessagePhone('+55 (21) 99888-7766'), {
    digits: '5521998887766',
    remoteJid: '5521998887766@s.whatsapp.net',
    phone: '+5521998887766',
  });
  assert.deepEqual(normalizeManualNewMessagePhone('(21) 99999-9999'), {
    digits: '5521999999999',
    remoteJid: '5521999999999@s.whatsapp.net',
    phone: '+5521999999999',
  });
  assert.deepEqual(normalizeManualNewMessagePhone('+1 202 555 0123'), {
    digits: '12025550123',
    remoteJid: '12025550123@s.whatsapp.net',
    phone: '+12025550123',
  });
  assert.deepEqual(normalizeManualNewMessagePhone('00 1 202 555 0123'), {
    digits: '12025550123',
    remoteJid: '12025550123@s.whatsapp.net',
    phone: '+12025550123',
  });
  assert.equal(normalizeManualNewMessagePhone('76900441'), undefined);
  assert.equal(normalizeManualNewMessagePhone('+76900441'), undefined);
  assert.equal(explicitPhoneAliasRemoteJid('76900441'), '76900441@s.whatsapp.net');
  assert.equal(explicitPhoneAliasRemoteJid('76900441@lid'), undefined);
  assert.deepEqual(explicitPhoneAliasRemoteJids('21999000055'), [
    '21999000055@s.whatsapp.net',
    '5521999000055@s.whatsapp.net',
  ]);
  assert.equal(normalizeManualPhone('+1 202 555 0123'), '12025550123');
  assert.equal(normalizeManualPhone('21 99900-0055'), '5521999000055');
  assert.equal(normalizeManualPhone('76900441'), '');
  assert.equal(normalizeManualPhone('1234567'), '');
  assert.equal(normalizeManualPhone('opaque-123@lid'), '');
});

test('new-message identity lookup is exact, tenant-scoped, alias-aware, and does not choose among candidates', () => {
  const lookup = buildExplicitConversationLookup('company-a', '76504441@s.whatsapp.net');
  assert.deepEqual(lookup.values, ['company-a', '76504441@s.whatsapp.net']);
  assert.match(lookup.text, /c\.company_id = \$1::uuid/);
  assert.match(lookup.text, /c\.evolution_remote_jid = \$2::text/);
  assert.match(lookup.text, /explicit_identity\.identity = c\.evolution_remote_jid/);
  assert.match(lookup.text, /explicit_identity\.aliases @> ARRAY\[\$2::text\]/);
  assert.match(lookup.text, /c\.is_group = false/);
  assert.doesNotMatch(lookup.text, /contact\.name|pushName|avatar|created_at|updated_at|LIMIT 1/i);

  const first = { id: 'conversation-a', contact_id: 'contact-b', evolution_remote_jid: '903644441@lid' };
  assert.deepEqual(classifyExplicitConversationMatches([]), { kind: 'none' });
  assert.deepEqual(classifyExplicitConversationMatches([first]), { kind: 'existing', conversation: first });
  assert.deepEqual(classifyExplicitConversationMatches([first, first]), { kind: 'existing', conversation: first });
  assert.deepEqual(classifyExplicitConversationMatches([
    first,
    { id: 'conversation-c', contact_id: 'contact-d', evolution_remote_jid: '903644442@lid' },
  ]), { kind: 'ambiguous' });
});

test('recent private conversations use real activity and explicit ids without collapsing PN/LID', () => {
  const result = recentPrivateConversations([
    conversation('lid-contact@lid', '+5521999990000', 20),
    conversation('5521999990000@s.whatsapp.net', '+5521999990000', 10),
    conversation('group@g.us', 'group@g.us', 100, { isGroup: true }),
    conversation('pending@s.whatsapp.net', '+5521999991111', 200, { isPending: true }),
  ]);
  assert.deepEqual(result.map((item) => item.id), ['lid-contact@lid', '5521999990000@s.whatsapp.net']);
});
