import { EventEmitter } from 'node:events';
import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { ServerResponse } from 'node:http';
import { phoneVariants } from '../src/utils/phone';
import { mergeConversationMessages } from '../src/utils/messageMerge';
import { normalizeEvolutionMessage } from '../src/services/evolutionMessageAdapter';
import { callMessageInfo } from '../src/utils/callMessage';
import { reconcileConversations } from '../src/utils/conversationReconciliation';
import { publishRealtimeEvent, registerRealtimeClient } from '../server/src/realtime';
import type { Conversation, Message } from '../src/types';

const message = (id: string, timestampMs: number, content: string, status: Message['status'] = 'sent'): Message => ({
  id,
  conversationId: 'conversation-1',
  sender: 'contact',
  content,
  timestampMs,
  timestamp: new Date(timestampMs).toISOString(),
  status,
});

const conversation = (id: string, overrides: Partial<Conversation> = {}): Conversation => ({
  id,
  contact: {
    id: `contact-${id}`,
    name: `Contato ${id}`,
    phone: `+55 21 99999-${id.padStart(4, '0')}`,
    avatar: `/avatar-${id}.png`,
    tags: [{ id: `tag-${id}`, name: 'Atendimento Geral', color: '#64748B' }],
    createdAt: '2026-08-10',
  },
  lastMessage: `Mensagem ${id}`,
  lastMessageTimestamp: '10:00',
  lastMessageAt: 1_700_000_000,
  lastMessageFromMe: false,
  lastMessageKey: {
    id: `message-${id}`,
    remoteJid: `5521999999${id}@s.whatsapp.net`,
    fromMe: false,
  },
  unreadCount: 0,
  needsResponse: false,
  status: 'open',
  department: 'Atendimento Geral',
  ...overrides,
});

const cloneConversation = (value: Conversation): Conversation => ({
  ...value,
  contact: { ...value.contact, tags: value.contact.tags.map((tag) => ({ ...tag })) },
  lastMessageKey: value.lastMessageKey ? { ...value.lastMessageKey } : undefined,
  assignedAttendant: value.assignedAttendant ? { ...value.assignedAttendant } : undefined,
});

test('phoneVariants cruza telefone brasileiro com e sem nono dígito', () => {
  const variants = phoneVariants('+55 (21) 98765-4321');
  assert.ok(variants.includes('5521987654321'));
  assert.ok(variants.includes('21987654321'));
  assert.ok(variants.includes('552187654321'));
  assert.ok(phoneVariants('21987654321').some((value) => variants.includes(value)));
});

test('mergeConversationMessages substitui duplicata e preserva ordem', () => {
  const merged = mergeConversationMessages(
    [message('a', 3000, 'antiga'), message('b', 1000, 'primeira')],
    [message('a', 3000, 'atualizada', 'read'), message('c', 2000, 'nova')],
  );
  assert.deepEqual(merged.map((item) => item.id), ['b', 'c', 'a']);
  assert.equal(merged.find((item) => item.id === 'a')?.content, 'atualizada');
  assert.equal(merged.find((item) => item.id === 'a')?.status, 'read');
});

test('reconcilia snapshot equivalente reutilizando array e objetos', () => {
  const previous = [conversation('a'), conversation('b')];
  const next = previous.map(cloneConversation);
  const reconciled = reconcileConversations(previous, next);

  assert.strictEqual(reconciled, previous);
  assert.strictEqual(reconciled[0], previous[0]);
  assert.strictEqual(reconciled[1], previous[1]);
});

test('reconcilia uma conversa alterada preservando as demais', () => {
  const previous = [conversation('a'), conversation('b')];
  const next = previous.map(cloneConversation);
  next[1] = { ...next[1], lastMessage: 'Mensagem atualizada' };
  const reconciled = reconcileConversations(previous, next);

  assert.notStrictEqual(reconciled, previous);
  assert.strictEqual(reconciled[0], previous[0]);
  assert.notStrictEqual(reconciled[1], previous[1]);
  assert.equal(reconciled[1].lastMessage, 'Mensagem atualizada');
});

test('reconcilia nova conversa preservando identidade dos itens antigos', () => {
  const previous = [conversation('a'), conversation('b')];
  const next = [...previous.map(cloneConversation), conversation('c')];
  const reconciled = reconcileConversations(previous, next);

  assert.notStrictEqual(reconciled, previous);
  assert.strictEqual(reconciled[0], previous[0]);
  assert.strictEqual(reconciled[1], previous[1]);
  assert.equal(reconciled[2].id, 'c');
});

test('reconcilia conversa removida preservando identidade dos itens restantes', () => {
  const previous = [conversation('a'), conversation('b'), conversation('c')];
  const next = [cloneConversation(previous[0]), cloneConversation(previous[2])];
  const reconciled = reconcileConversations(previous, next);

  assert.notStrictEqual(reconciled, previous);
  assert.strictEqual(reconciled[0], previous[0]);
  assert.strictEqual(reconciled[1], previous[2]);
  assert.deepEqual(reconciled.map((item) => item.id), ['a', 'c']);
});

test('reconcilia mudança de ordem sem recriar conversas equivalentes', () => {
  const previous = [conversation('a'), conversation('b')];
  const next = [cloneConversation(previous[1]), cloneConversation(previous[0])];
  const reconciled = reconcileConversations(previous, next);

  assert.notStrictEqual(reconciled, previous);
  assert.deepEqual(reconciled.map((item) => item.id), ['b', 'a']);
  assert.strictEqual(reconciled[0], previous[1]);
  assert.strictEqual(reconciled[1], previous[0]);
});

test('substitui conversa quando um campo visual relevante muda', () => {
  const previous = [conversation('a')];
  const next = [cloneConversation(previous[0])];
  next[0] = {
    ...next[0],
    contact: { ...next[0].contact, avatar: '/avatar-atualizado.png' },
  };
  const reconciled = reconcileConversations(previous, next);

  assert.notStrictEqual(reconciled, previous);
  assert.notStrictEqual(reconciled[0], previous[0]);
  assert.equal(reconciled[0].contact.avatar, '/avatar-atualizado.png');
});

test('normaliza assinatura do atendente, áudio e mensagem interativa', () => {
  const normalized = normalizeEvolutionMessage({
    key: { id: 'provider-1', fromMe: true },
    message: { audioMessage: { seconds: 12 }, conversation: '*Leonardo*\nOlá, cliente' },
    messageTimestamp: 1_700_000_000,
    status: 'DELIVERY_ACK',
  }, 0, 'conversation-1', 'Atendente');
  assert.equal(normalized.id, 'provider-1');
  assert.equal(normalized.senderName, 'Leonardo');
  assert.equal(normalized.content, 'Olá, cliente');
  assert.equal(normalized.mediaType, 'audio');
  assert.equal(normalized.mediaDuration, 12);
  assert.equal(normalized.status, 'delivered');
});

test('normaliza figurinha recebida sem transformá-la em mensagem genérica', () => {
  const normalized = normalizeEvolutionMessage({
    key: { id: 'sticker-1', fromMe: false },
    message: { stickerMessage: { mimetype: 'image/webp' } },
    pushName: 'Cliente',
    messageTimestamp: 1_700_000_001,
  }, 0, 'conversation-1', 'Atendente');
  assert.equal(normalized.mediaType, 'sticker');
  assert.match(normalized.content, /Figurinha/i);
  assert.equal(normalized.senderName, 'Cliente');
});

test('normaliza chamadas do WhatsApp como ligação perdida ou realizada', () => {
  const missed = callMessageInfo({ key: { fromMe: false } }, { callLogMessage: { callOutcome: 1, isVideo: false } });
  const completed = callMessageInfo({ key: { fromMe: true } }, { callLogMessage: { callOutcome: 0, durationSecs: 18 } });
  assert.equal(missed.label, 'Ligação de voz perdida');
  assert.equal(completed.label, 'Ligação de voz realizada');

  const normalized = normalizeEvolutionMessage({
    key: { id: 'call-1', fromMe: false },
    message: { callLogMessage: { callOutcome: 1, isVideo: false } },
    messageTimestamp: 1_700_000_002,
  }, 0, 'conversation-1', 'Atendente');
  assert.equal(normalized.content, '[Ligação de voz perdida]');
  assert.equal(normalized.metadata?.systemLabel, 'Ligação de voz perdida');
});

class FakeResponse extends EventEmitter {
  writableEnded = false;
  destroyed = false;
  chunks: string[] = [];

  write(value: string) {
    this.chunks.push(String(value));
    return true;
  }
}

test('canal realtime publica evento SSE somente enquanto o cliente está conectado', () => {
  const raw = new FakeResponse();
  const cleanup = registerRealtimeClient('company-test', raw as unknown as ServerResponse);
  publishRealtimeEvent('company-test', 'message.upsert', {
    remoteJid: '5521999999999@s.whatsapp.net',
    messageId: 'provider-1',
  });
  assert.equal(raw.chunks.length, 1);
  assert.match(raw.chunks[0] || '', /event: evolution/);
  assert.match(raw.chunks[0] || '', /"type":"message\.upsert"/);
  cleanup();
  publishRealtimeEvent('company-test', 'message.status', { messageId: 'provider-1', status: 'read' });
  assert.equal(raw.chunks.length, 1);
});
