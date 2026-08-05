import { EventEmitter } from 'node:events';
import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { ServerResponse } from 'node:http';
import { phoneVariants } from '../src/utils/phone';
import { mergeConversationMessages } from '../src/utils/messageMerge';
import { normalizeEvolutionMessage } from '../src/services/evolutionMessageAdapter';
import { callMessageInfo } from '../src/utils/callMessage';
import { publishRealtimeEvent, registerRealtimeClient } from '../server/src/realtime';
import type { Message } from '../src/types';

const message = (id: string, timestampMs: number, content: string, status: Message['status'] = 'sent'): Message => ({
  id,
  conversationId: 'conversation-1',
  sender: 'contact',
  content,
  timestampMs,
  timestamp: new Date(timestampMs).toISOString(),
  status,
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
