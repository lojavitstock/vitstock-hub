import { EventEmitter } from 'node:events';
import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { ServerResponse } from 'node:http';
import { phoneVariants } from '../src/utils/phone';
import { mergeConversationMessages } from '../src/utils/messageMerge';
import { normalizeEvolutionMessage } from '../src/services/evolutionMessageAdapter';
import { callMessageInfo } from '../src/utils/callMessage';
import { reconcileConversations } from '../src/utils/conversationReconciliation';
import { createInFlightRequestCoordinator, createLatestRequestGuard } from '../src/utils/requestCoordinator';
import { reconcileRealtimeConversation, reconcileRealtimeMessages } from '../src/utils/realtimeUpdates';
import { REALTIME_RECONNECTED_EVENT, REALTIME_SAFETY_INTERVAL_MS } from '../src/utils/realtimeConfig';
import {
  CONVERSATION_MESSAGE_CACHE_LIMIT,
  readConversationMessagesCache,
  writeConversationMessagesCache,
} from '../src/utils/conversationMessagesCache';
import { publishRealtimeEvent, registerRealtimeClient } from '../server/src/realtime';
import {
  config,
  isAllowedFrontendOrigin,
  parseFrontendOrigins,
} from '../server/src/config';
import type { Conversation, Message } from '../src/types';

const message = (
  id: string,
  timestampMs: number,
  content: string,
  status: Message['status'] = 'sent',
  overrides: Partial<Message> = {},
): Message => ({
  id,
  conversationId: 'conversation-1',
  sender: 'contact',
  content,
  timestampMs,
  timestamp: new Date(timestampMs).toISOString(),
  status,
  ...overrides,
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

test('origem frontend principal Ã© permitida', () => {
  assert.equal(isAllowedFrontendOrigin(config.FRONTEND_URL), true);
});

test('origens adicionais normalizadas sÃ£o permitidas', () => {
  const additional = parseFrontendOrigins(
    ' https://preview.example.com/ , , https://staging.example.com ',
  );
  const allowedOrigins = new Set([config.FRONTEND_URL, ...additional]);

  assert.equal(isAllowedFrontendOrigin('https://preview.example.com', allowedOrigins), true);
  assert.equal(isAllowedFrontendOrigin('https://staging.example.com/', allowedOrigins), true);
});

test('origem desconhecida e domÃ­nio parecido sÃ£o rejeitados', () => {
  const allowedOrigins = new Set([config.FRONTEND_URL, 'https://preview.example.com']);

  assert.equal(isAllowedFrontendOrigin('https://unknown.example.com', allowedOrigins), false);
  assert.equal(isAllowedFrontendOrigin('https://preview.example.com.evil.test', allowedOrigins), false);
  assert.equal(isAllowedFrontendOrigin('https://evil-preview.example.com', allowedOrigins), false);
});

test('curingas nunca sÃ£o aceitos', () => {
  const allowedOrigins = new Set(parseFrontendOrigins('*.vercel.app, https://preview.example.com'));

  assert.equal(isAllowedFrontendOrigin('*.vercel.app', allowedOrigins), false);
  assert.equal(isAllowedFrontendOrigin('https://qualquer.vercel.app', allowedOrigins), false);
});

test('coordenador de inbox compartilha duas solicitações simultâneas equivalentes', async () => {
  const coordinator = createInFlightRequestCoordinator<string>();
  let calls = 0;
  let resolveRequest: (value: string) => void = () => undefined;
  const request = () => {
    calls += 1;
    return new Promise<string>((resolve) => { resolveRequest = resolve; });
  };

  const first = coordinator.run('inbox', request);
  const second = coordinator.run('inbox', request);
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveRequest('ok');
  assert.equal(await first, 'ok');
  assert.equal(calls, 1);
});

test('coordenador mantém solicitações de conversas diferentes independentes', async () => {
  const coordinator = createInFlightRequestCoordinator<string>();
  let calls = 0;
  const request = (value: string) => async () => {
    calls += 1;
    return value;
  };

  const first = coordinator.run('messages:conversation-a', request('a'));
  const second = coordinator.run('messages:conversation-b', request('b'));
  assert.notStrictEqual(first, second);
  assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
  assert.equal(calls, 2);
});

test('coordenador permite nova solicitação depois da conclusão', async () => {
  const coordinator = createInFlightRequestCoordinator<number>();
  let calls = 0;
  const request = async () => {
    calls += 1;
    return calls;
  };

  assert.equal(await coordinator.run('inbox', request), 1);
  assert.equal(await coordinator.run('inbox', request), 2);
  assert.equal(calls, 2);
});

test('reconciliação especial usa chave independente da busca comum', async () => {
  const coordinator = createInFlightRequestCoordinator<string>();
  let calls = 0;
  const request = async (value: string) => {
    calls += 1;
    return value;
  };

  const common = coordinator.run('messages:conversation-a:common', () => request('common'));
  const reconcile = coordinator.run('messages:conversation-a:reconcile', () => request('reconcile'));
  assert.deepEqual(await Promise.all([common, reconcile]), ['common', 'reconcile']);
  assert.equal(calls, 2);
});

test('guard de requisição impede resposta antiga de ser aplicada', () => {
  const guard = createLatestRequestGuard();
  const older = guard.begin();
  const newer = guard.begin();

  assert.equal(guard.isLatest(older), false);
  assert.equal(guard.isLatest(newer), true);
});

test('SSE de nova mensagem completa atualiza o histórico sem refetch', () => {
  const current = [message('a', 1000, 'anterior')];
  const incoming = message('b', 2000, 'nova mensagem');
  const updated = reconcileRealtimeMessages(current, 'conversation-1', {
    type: 'message.upsert',
    remoteJid: 'conversation-1',
    message: incoming,
  });

  assert.ok(updated);
  assert.notStrictEqual(updated, current);
  assert.equal(updated?.[1]?.id, 'b');
});

test('SSE repetido não duplica nem recria a mensagem', () => {
  const incoming = message('b', 2000, 'nova mensagem');
  const current = [message('a', 1000, 'anterior'), incoming];
  const updated = reconcileRealtimeMessages(current, 'conversation-1', {
    type: 'message.upsert',
    remoteJid: 'conversation-1',
    message: { ...incoming },
  });

  assert.strictEqual(updated, current);
});

test('SSE de status altera somente a mensagem correspondente', () => {
  const first = message('a', 1000, 'primeira');
  const second = message('b', 2000, 'segunda');
  const current = [first, second];
  const updated = reconcileRealtimeMessages(current, 'conversation-1', {
    type: 'message.status',
    remoteJid: 'conversation-1',
    messageId: 'b',
    status: 'delivered',
  });

  assert.ok(updated);
  assert.strictEqual(updated?.[0], first);
  assert.notStrictEqual(updated?.[1], second);
  assert.equal(updated?.[1]?.status, 'delivered');
});

test('SSE de upsert sem conteúdo solicita fallback em vez de inventar mensagem', () => {
  const updated = reconcileRealtimeMessages([], 'conversation-1', {
    type: 'message.upsert',
    remoteJid: 'conversation-1',
    messageId: 'provider-1',
    timestampMs: 2000,
  });

  assert.equal(updated, null);
});

test('SSE e polling equivalente preservam a mesma identidade do histórico', () => {
  const current = [message('a', 1000, 'anterior')];
  const incoming = message('b', 2000, 'nova mensagem');
  const eventResult = reconcileRealtimeMessages(current, 'conversation-1', {
    type: 'message.upsert',
    remoteJid: 'conversation-1',
    message: incoming,
  });
  assert.ok(eventResult);
  const pollingResult = mergeConversationMessages(eventResult || current, [{ ...incoming }]);

  assert.strictEqual(pollingResult, eventResult);
});

test('SSE atualiza preview de conversa não aberta sem carregar histórico', () => {
  const current = [conversation('conversation-1'), conversation('conversation-2')];
  const incoming = { ...message('new-2', 1_800_000_000_000, 'atualização do cliente'), conversationId: 'conversation-2' };
  const updated = reconcileRealtimeConversation(current, {
    type: 'message.upsert',
    remoteJid: 'conversation-2',
    message: incoming,
  });

  assert.ok(updated);
  assert.equal(updated?.[0]?.id, 'conversation-2');
  assert.equal(updated?.[0]?.lastMessage, 'atualização do cliente');
  assert.equal(updated?.[0]?.unreadCount, 1);
  assert.strictEqual(updated?.[1], current[0]);
});

test('SSE antigo não regride o preview nem a posição da conversa', () => {
  const latest = conversation('conversation-1', {
    lastMessage: 'mensagem nova',
    lastMessageAt: 1_800_000_000_000,
    lastMessageFromMe: true,
  });
  const other = conversation('conversation-2');
  const current = [latest, other];
  const stale = reconcileRealtimeConversation(current, {
    type: 'message.upsert',
    remoteJid: 'conversation-1',
    message: {
      ...message('old-message', 1_700_000_000_000, 'mensagem antiga'),
      conversationId: 'conversation-1',
    },
  });

  assert.strictEqual(stale, current);
  assert.equal(stale?.[0]?.lastMessage, 'mensagem nova');
  assert.strictEqual(stale?.[1], other);
});

test('SSE de status não altera preview nem ordenação do inbox', () => {
  const current = [conversation('conversation-1'), conversation('conversation-2')];
  const unchanged = reconcileRealtimeConversation(current, {
    type: 'message.status',
    remoteJid: 'conversation-2',
    messageId: 'message-2',
    status: 'delivered',
  });

  assert.strictEqual(unchanged, null);
});

test('SSE de mídia sem legenda usa resumo do tipo no preview', () => {
  const current = [conversation('conversation-1')];
  const updated = reconcileRealtimeConversation(current, {
    type: 'message.upsert',
    remoteJid: 'conversation-1',
    message: {
      ...message('image-1', 1_800_000_000_000, '', 'sent', {
        conversationId: 'conversation-1',
        mediaType: 'image',
      }),
    },
  });

  assert.equal(updated?.[0]?.lastMessage, '[Imagem]');
});

test('conversation.updated reconcilia responsável, status e leitura sem refetch', () => {
  const current = [conversation('conversation-1', { unreadCount: 2, lastMessageAt: 1_700_000_000_000 })];
  const assigned = reconcileRealtimeConversation(current, {
    type: 'conversation.updated',
    remoteJid: 'conversation-1',
    assignedUserId: 'user-1',
    assignedUserName: 'Leonardo',
  });
  assert.equal(assigned?.[0]?.assignedAttendant?.name, 'Leonardo');

  const resolved = reconcileRealtimeConversation(assigned || current, {
    type: 'conversation.updated',
    remoteJid: 'conversation-1',
    status: 'resolved',
  });
  assert.equal(resolved?.[0]?.status, 'resolved');
  assert.equal(resolved?.[0]?.needsResponse, false);

  const read = reconcileRealtimeConversation(resolved || current, {
    type: 'conversation.updated',
    remoteJid: 'conversation-1',
    messageTimestamp: 1_800_000_000_000,
  });
  assert.equal(read?.[0]?.unreadCount, 0);
});

test('política realtime usa intervalo de segurança de cinco minutos e evento explícito de reconexão', () => {
  assert.equal(REALTIME_SAFETY_INTERVAL_MS, 5 * 60 * 1000);
  assert.equal(REALTIME_RECONNECTED_EVENT, 'realtime.reconnected');
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

test('merge retorna o mesmo array para lote totalmente equivalente', () => {
  const current = [message('a', 1000, 'primeira'), message('b', 2000, 'segunda')];
  const incoming = current.map((item) => ({ ...item }));
  const merged = mergeConversationMessages(current, incoming);

  assert.strictEqual(merged, current);
  assert.strictEqual(merged[0], current[0]);
  assert.strictEqual(merged[1], current[1]);
});

test('merge faz append de mensagem nova preservando mensagens anteriores', () => {
  const first = message('a', 1000, 'primeira');
  const second = message('b', 2000, 'segunda');
  const current = [first, second];
  const merged = mergeConversationMessages(current, [message('c', 3000, 'terceira')]);

  assert.notStrictEqual(merged, current);
  assert.strictEqual(merged[0], first);
  assert.strictEqual(merged[1], second);
  assert.equal(merged[2]?.id, 'c');
});

test('merge preserva array quando o polling repete somente a última mensagem', () => {
  const last = message('b', 2000, 'segunda');
  const current = [message('a', 1000, 'primeira'), last];
  const merged = mergeConversationMessages(current, [{ ...last }]);

  assert.strictEqual(merged, current);
});

test('merge substitui somente a mensagem que mudou de status', () => {
  const first = message('a', 1000, 'primeira');
  const second = message('b', 2000, 'segunda');
  const current = [first, second];
  const merged = mergeConversationMessages(current, [message('b', 2000, 'segunda', 'delivered')]);

  assert.notStrictEqual(merged, current);
  assert.strictEqual(merged[0], first);
  assert.notStrictEqual(merged[1], second);
  assert.equal(merged[1]?.status, 'delivered');
});

test('merge reconcilia mensagem otimista com o ID real do provedor sem duplicar', () => {
  const optimistic = message('local-1', 1_700_000_000_000, 'Olá cliente', 'pending', {
    sender: 'attendant',
  });
  const provider = message('provider-1', 1_700_000_001_000, '*Leonardo*\nOlá cliente', 'sent', {
    sender: 'attendant',
    senderName: 'Leonardo',
    rawKey: { id: 'provider-1', remoteJid: '5521999999999@s.whatsapp.net', fromMe: true },
  });
  const merged = mergeConversationMessages([optimistic], [provider]);

  assert.deepEqual(merged.map((item) => item.id), ['provider-1']);
  assert.notStrictEqual(merged[0], optimistic);
  assert.equal(merged[0]?.status, 'sent');
});

test('merge insere mensagens antigas na paginação sem duplicar as atuais', () => {
  const currentFirst = message('b', 2000, 'segunda');
  const currentLast = message('c', 3000, 'terceira');
  const merged = mergeConversationMessages(
    [currentFirst, currentLast],
    [message('a', 1000, 'primeira'), { ...currentFirst }],
  );

  assert.deepEqual(merged.map((item) => item.id), ['a', 'b', 'c']);
  assert.strictEqual(merged[1], currentFirst);
  assert.strictEqual(merged[2], currentLast);
});

test('merge elimina duplicatas do lote recebido usando a última versão', () => {
  const current = [message('a', 1000, 'primeira')];
  const merged = mergeConversationMessages(current, [
    message('b', 2000, 'rascunho'),
    message('b', 2000, 'versão final', 'sent'),
  ]);

  assert.deepEqual(merged.map((item) => item.id), ['a', 'b']);
  assert.equal(merged[1]?.content, 'versão final');
});

test('merge ordena lote recebido fora de ordem cronológica', () => {
  const merged = mergeConversationMessages([], [
    message('c', 3000, 'terceira'),
    message('a', 1000, 'primeira'),
    message('b', 2000, 'segunda'),
  ]);

  assert.deepEqual(merged.map((item) => item.id), ['a', 'b', 'c']);
});

test('merge substitui somente mensagem com alteração real de metadado', () => {
  const unchanged = message('a', 1000, 'primeira');
  const changed = message('b', 2000, 'anúncio', 'sent', {
    metadata: { trafficSource: 'FB_Ads', trafficTitle: 'Oferta antiga' },
  });
  const incomingChanged = message('b', 2000, 'anúncio', 'sent', {
    metadata: { trafficSource: 'FB_Ads', trafficTitle: 'Oferta atualizada' },
  });
  const merged = mergeConversationMessages([unchanged, changed], [incomingChanged]);

  assert.strictEqual(merged[0], unchanged);
  assert.notStrictEqual(merged[1], changed);
  assert.equal(merged[1]?.metadata?.trafficTitle, 'Oferta atualizada');
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

test('cache de mensagens restaura A imediatamente depois de alternar para B', () => {
  const cache = new Map();
  const messagesA = [message('a-1', 1_700_000_000, 'A')];
  const messagesB = [message('b-1', 1_700_000_001, 'B')];
  writeConversationMessagesCache(cache, 'conversation-a', {
    messages: messagesA,
    hasMoreMessages: true,
    historyExpanded: true,
  });
  writeConversationMessagesCache(cache, 'conversation-b', {
    messages: messagesB,
    hasMoreMessages: false,
    historyExpanded: false,
  });

  const restored = readConversationMessagesCache(cache, 'conversation-a');
  assert.strictEqual(restored?.messages, messagesA);
  assert.equal(restored?.hasMoreMessages, true);
  assert.equal(restored?.historyExpanded, true);
});

test('cache preserva a reconciliação incremental e atualiza uma conversa fechada via realtime', () => {
  const cache = new Map();
  const existing = message('a-1', 1_700_000_000, 'A');
  writeConversationMessagesCache(cache, 'conversation-a', {
    messages: [existing],
    hasMoreMessages: true,
    historyExpanded: true,
  });
  const cached = readConversationMessagesCache(cache, 'conversation-a');
  const nextMessage = message('a-2', 1_700_000_001, 'Nova mensagem', 'sent', {
    conversationId: 'conversation-a',
  });
  const reconciled = reconcileRealtimeMessages(
    cached?.messages || [],
    'conversation-a',
    { type: 'message.upsert', message: nextMessage },
  );
  assert.ok(reconciled);
  writeConversationMessagesCache(cache, 'conversation-a', {
    ...cached!,
    messages: reconciled,
  });
  const updated = readConversationMessagesCache(cache, 'conversation-a');
  assert.strictEqual(updated?.messages[0], existing);
  assert.strictEqual(updated?.messages[1], nextMessage);
});

test('cache limitado descarta as conversas menos recentemente acessadas', () => {
  const cache = new Map();
  for (let index = 0; index < CONVERSATION_MESSAGE_CACHE_LIMIT + 1; index += 1) {
    writeConversationMessagesCache(cache, `conversation-${index}`, {
      messages: [],
      hasMoreMessages: false,
      historyExpanded: false,
    });
  }
  assert.equal(cache.size, CONVERSATION_MESSAGE_CACHE_LIMIT);
  assert.equal(cache.has('conversation-0'), false);
  assert.equal(cache.has(`conversation-${CONVERSATION_MESSAGE_CACHE_LIMIT}`), true);
});

test('cache preserva paginação e histórico carregado ao trocar de conversa', () => {
  const cache = new Map();
  const current = [message('current', 1_700_000_100, 'Atual')];
  const older = message('older', 1_700_000_000, 'Histórico antigo');
  writeConversationMessagesCache(cache, 'conversation-a', {
    messages: [older, ...current],
    hasMoreMessages: false,
    historyExpanded: true,
  });
  writeConversationMessagesCache(cache, 'conversation-b', {
    messages: [message('b-1', 1_700_000_200, 'B')],
    hasMoreMessages: false,
    historyExpanded: false,
  });
  const restored = readConversationMessagesCache(cache, 'conversation-a');
  assert.deepEqual(restored?.messages.map((item) => item.id), ['older', 'current']);
  assert.equal(restored?.historyExpanded, true);
});
