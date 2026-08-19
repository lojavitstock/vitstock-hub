import { strict as assert } from 'node:assert';
import test from 'node:test';
import { findConversationForContactChat } from '../src/utils/contactChatNavigation';
import { Conversation } from '../src/types';

const conversation = (id: string, phone: string, isGroup = false): Conversation => ({
  id,
  isGroup,
  contact: { id, name: 'Contato', phone, tags: [], createdAt: '2026-01-01' },
  lastMessage: 'Olá',
  lastMessageTimestamp: 'Hoje',
  lastMessageAt: Date.now(),
  lastMessageFromMe: false,
  unreadCount: 0,
  needsResponse: false,
  status: 'open',
  department: 'Atendimento Geral',
});

test('resolves the exact provider JID before phone fallback, including @lid', () => {
  const lid = conversation('164794086760597@lid', '+5521997402785');
  const samePhone = conversation('5521997402785@s.whatsapp.net', '+5521997402785');
  assert.equal(findConversationForContactChat([lid, samePhone], {
    remoteJid: '164794086760597@lid',
    phone: '+5521997402785',
  }), lid);
});

test('uses phone fallback only when the private conversation is unambiguous', () => {
  const item = conversation('5521990000001@s.whatsapp.net', '+55 21 99900-0001');
  assert.equal(findConversationForContactChat([item], { phone: '21999000001' }), item);
  assert.equal(findConversationForContactChat([item, conversation('5521990000002@s.whatsapp.net', '+55 21 99900-0001')], { phone: '21999000001' }), undefined);
  assert.equal(findConversationForContactChat([conversation('120@g.us', '120@g.us', true)], { phone: '120' }), undefined);
});
