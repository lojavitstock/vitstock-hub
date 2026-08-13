import { EventEmitter } from 'node:events';
import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { ServerResponse } from 'node:http';
import { phoneVariants } from '../src/utils/phone';
import { mergeConversationMessages } from '../src/utils/messageMerge';
import { isEvolutionReactionEvent, normalizeEvolutionMessage } from '../src/services/evolutionMessageAdapter';
import { callMessageInfo } from '../src/utils/callMessage';
import { reconcileConversations, reconcileConversationsMonotonic } from '../src/utils/conversationReconciliation';
import { createInFlightRequestCoordinator, createLatestRequestGuard } from '../src/utils/requestCoordinator';
import { reconcileRealtimeConversation, reconcileRealtimeMessages } from '../src/utils/realtimeUpdates';
import { createMessageNotificationDeduper } from '../src/utils/messageNotification';
import { conversationNeedsResponse } from '../src/utils/conversationState';
import { getMessageIdentityValues, getNewIncomingMessageIds } from '../src/utils/messageActivity';
import { REALTIME_RECONNECTED_EVENT, REALTIME_SAFETY_INTERVAL_MS } from '../src/utils/realtimeConfig';
import {
  CONVERSATION_MESSAGE_CACHE_LIMIT,
  readConversationMessagesCache,
  writeConversationMessagesCache,
} from '../src/utils/conversationMessagesCache';
import { publishRealtimeEvent, registerRealtimeClient } from '../server/src/realtime';
import {
  evolutionMessageIdFromResponse,
  formatHubOutboundText,
  removeHubAgentPrefix,
} from '../server/src/outboundMessage';
import { createOutboundRequestCoordinator, outboundDispatchAction, outboundIdempotencyLockKey } from '../server/src/outboundIdempotency';
import { isNonRenderableProviderMessage, unwrapProviderMessage } from '../server/src/providerMessagePolicy';
import {
  applyProviderReaction,
  isProviderReactionEvent,
  providerReactionUpdate,
} from '../server/src/messageReactions';
import { toQuotedMessage } from '../src/utils/quotedMessage';
import { getDocumentPresentation } from '../src/utils/documentMedia';
import { isMediaViewerCloseKey, mediaViewerItemFrom } from '../src/utils/mediaViewer';
import { canDownloadMessageMedia, messageCopyText, messageMenuActionsFor } from '../src/utils/messageActions';
import {
  canRestoreComposerDraft,
  captureComposerSubmission,
  readConversationDraft,
  scheduleComposerFocus,
  writeConversationDraft,
} from '../src/utils/composerSubmission';
import {
  acquireConversationLease,
  canAcquireConversationLease,
  CONVERSATION_LEASE_SECONDS,
} from '../server/src/conversationLease';
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

test('indicador de novas mensagens ignora polling equivalente, saídas e histórico antigo', () => {
  const previous = [message('known', 200, 'já recebida')];
  const incoming = [
    message('known', 200, 'já recebida'),
    message('outgoing', 250, 'enviada', 'sent', { sender: 'attendant' }),
    message('old-history', 100, 'histórico antigo'),
    message('new-1', 300, 'nova mensagem'),
    message('new-1', 300, 'nova mensagem'),
  ];

  assert.deepEqual(getNewIncomingMessageIds(previous, incoming, true), ['new-1']);
  assert.deepEqual(getNewIncomingMessageIds(previous, incoming, false), []);
});

test('indicador aceita mensagem nova sem timestamp do provedor', () => {
  const previous = [message('known', 200, 'já recebida')];
  const incoming = [message('new-without-time', 0, 'nova mensagem')];

  assert.deepEqual(getNewIncomingMessageIds(previous, incoming, true), ['new-without-time']);
});

test('indicador reconhece a identidade rawKey e não duplica o evento SSE', () => {
  const previous = [message('client-id', 200, 'já recebida', 'read', {
    rawKey: { id: 'provider-id', remoteJid: 'conversation-1' },
  })];
  const duplicate = message('provider-id', 200, 'já recebida', 'read', {
    rawKey: { id: 'provider-id', remoteJid: 'conversation-1' },
  });

  assert.deepEqual(getMessageIdentityValues(previous[0]), ['client-id', 'provider-id']);
  assert.deepEqual(getNewIncomingMessageIds(previous, [duplicate], true), []);
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

test('deduplicador de notificacoes so aceita novas mensagens recebidas do cliente', () => {
  const deduper = createMessageNotificationDeduper();
  const incoming = message('notification-1', 2000, 'ola');

  assert.equal(deduper.shouldNotify(incoming), true);
  assert.equal(deduper.shouldNotify({ ...incoming }), false);
  assert.equal(deduper.shouldNotify({ ...incoming, id: 'notification-2', sender: 'attendant' }), false);
  assert.equal(deduper.shouldNotify({ ...incoming, id: 'notification-3', isInternalNote: true }), false);
});

test('não lida e não respondida permanecem estados independentes', () => {
  assert.equal(conversationNeedsResponse(conversation('read-unanswered', {
    unreadCount: 0,
    needsResponse: true,
    lastMessageFromMe: false,
  })), true);
  assert.equal(conversationNeedsResponse(conversation('read-answered', {
    unreadCount: 3,
    needsResponse: false,
    lastMessageFromMe: false,
  })), false);
  assert.equal(conversationNeedsResponse(conversation('legacy-unanswered', {
    unreadCount: 0,
    needsResponse: undefined,
    lastMessageFromMe: false,
  })), true);
  assert.equal(conversationNeedsResponse(conversation('legacy-answered', {
    unreadCount: 3,
    needsResponse: undefined,
    lastMessageFromMe: true,
  })), false);
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

test('SSE recebido com conversationId interno ainda atualiza JID @lid', () => {
  const lid = '164794086760597@lid';
  const current = [conversation(lid, {
    contact: {
      ...conversation(lid).contact,
      phone: '+5521997402785',
    },
  })];
  const updated = reconcileRealtimeConversation(current, {
    type: 'message.upsert',
    remoteJid: lid,
    phone: '5521997402785',
    message: {
      ...message('lid-message', 1_800_000_000_000, 'mensagem recebida'),
      conversationId: 'conversation-row-uuid',
    },
  });

  assert.equal(updated?.[0]?.lastMessage, 'mensagem recebida');
  assert.equal(updated?.[0]?.unreadCount, 1);
  assert.equal(updated?.[0]?.id, lid);
});

test('SSE recebido com JID canônico usa telefone quando o identificador interno diverge', () => {
  const current = [conversation('5521997402785@s.whatsapp.net', {
    contact: {
      ...conversation('5521997402785@s.whatsapp.net').contact,
      phone: '+5521997402785',
    },
  })];
  const updated = reconcileRealtimeConversation(current, {
    type: 'message.upsert',
    remoteJid: '5521997402785@lid',
    phone: '5521997402785',
    message: {
      ...message('canonical-message', 1_800_000_000_000, 'mensagem canônica'),
      conversationId: 'conversation-row-uuid',
    },
  });

  assert.equal(updated?.[0]?.lastMessage, 'mensagem canônica');
  assert.equal(updated?.[0]?.unreadCount, 1);
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

test('SSE equivalente confirma o ID do provedor sem mover a conversa novamente', () => {
  const other = conversation('conversation-2');
  const active = conversation('conversation-1', {
    lastMessage: 'Olá cliente',
    lastMessageAt: 1_800_000_000_000,
    lastMessageFromMe: true,
    lastMessageKey: { id: 'local-1', remoteJid: 'conversation-1', fromMe: true },
  });
  const current = [other, active];
  const updated = reconcileRealtimeConversation(current, {
    type: 'message.upsert',
    remoteJid: 'conversation-1',
    message: {
      ...message('provider-1', 1_799_999_999_000, '*Leonardo*\nOlá cliente', 'sent', {
        conversationId: 'conversation-1',
        sender: 'attendant',
        senderName: 'Leonardo',
        rawKey: { id: 'provider-1', remoteJid: 'conversation-1', fromMe: true },
      }),
    },
  });

  assert.ok(updated);
  assert.equal(updated?.[1]?.lastMessage, 'Olá cliente');
  assert.equal(updated?.[1]?.lastMessageAt, active.lastMessageAt);
  assert.equal(updated?.[1]?.lastMessageKey?.id, 'provider-1');
  assert.equal(updated?.[1]?.id, 'conversation-1');
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

test('lease de conversa usa cinco minutos, renova para o dono e bloqueia outro atendente', () => {
  const now = Date.parse('2026-08-12T12:00:00.000Z');
  const active = { ownerUserId: 'user-a', expiresAt: new Date(now + CONVERSATION_LEASE_SECONDS * 1000).toISOString() };

  assert.equal(CONVERSATION_LEASE_SECONDS, 300);
  assert.equal(canAcquireConversationLease(undefined, 'user-a', now), true);
  assert.equal(canAcquireConversationLease(active, 'user-a', now), true);
  assert.equal(canAcquireConversationLease(active, 'user-b', now), false);
  assert.equal(canAcquireConversationLease(active, 'user-b', now, true), true);
  assert.equal(canAcquireConversationLease(active, 'user-b', now + CONVERSATION_LEASE_SECONDS * 1000), true);
});

test('aquisição concorrente da mesma conversa retorna um único dono', async () => {
  let current: { ownerUserId: string; ownerName: string; expiresAt: Date } | undefined;
  const names = new Map([['user-a', 'Ana'], ['user-b', 'Bruno']]);
  const client = {
    query: async (_text: string, values?: unknown[]) => {
      const userId = String(values?.[2]);
      const force = Boolean(values?.[4]);
      const now = Date.now();
      const acquired = !current
        || current.expiresAt.getTime() <= now
        || current.ownerUserId === userId
        || force;
      if (acquired) {
        current = {
          ownerUserId: userId,
          ownerName: names.get(userId) || userId,
          expiresAt: new Date(now + CONVERSATION_LEASE_SECONDS * 1000),
        };
      }
      return {
        rows: current ? [{
          acquired,
          owner_user_id: current.ownerUserId,
          owner_name: current.ownerName,
          expires_at: current.expiresAt,
        }] : [],
      };
    },
  };
  const [first, second] = await Promise.all([
    acquireConversationLease(client as never, { companyId: '00000000-0000-0000-0000-000000000001', conversationId: '00000000-0000-0000-0000-000000000002', userId: 'user-a' }),
    acquireConversationLease(client as never, { companyId: '00000000-0000-0000-0000-000000000001', conversationId: '00000000-0000-0000-0000-000000000002', userId: 'user-b' }),
  ]);

  assert.equal(Number(first.acquired) + Number(second.acquired), 1);
  assert.equal(current?.ownerUserId, first.acquired ? 'user-a' : 'user-b');
});

test('realtime de lease atualiza somente a conversa correspondente', () => {
  const current = [conversation('conversation-1'), conversation('conversation-2')];
  const updated = reconcileRealtimeConversation(current, {
    type: 'conversation.updated',
    remoteJid: 'conversation-2',
    leaseOwnerUserId: 'user-a',
    leaseOwnerName: 'Ana',
    leaseExpiresAt: '2026-08-12T12:05:00.000Z',
  });
  assert.ok(updated);
  assert.strictEqual(updated?.[0], current[0]);
  assert.equal(updated?.[1]?.lease?.ownerName, 'Ana');
});

test('snapshot não remove lease observado enquanto a UI calcula a expiração localmente', () => {
  const active = conversation('conversation-1', {
    lease: {
      ownerUserId: 'user-a',
      ownerName: 'Ana',
      expiresAt: Date.now() + CONVERSATION_LEASE_SECONDS * 1000,
    },
  });
  const reconciled = reconcileConversationsMonotonic([active], [conversation('conversation-1')]);
  assert.equal(reconciled[0]?.lease?.ownerUserId, 'user-a');
});

test('expiração do lease não troca a referência da conversa nem reinicia a timeline', () => {
  const current = [conversation('conversation-1', {
    lease: {
      ownerUserId: 'user-a',
      ownerName: 'Ana',
      expiresAt: Date.now() - 1,
    },
  })];
  const reconciled = reconcileConversationsMonotonic(current, [conversation('conversation-1')]);

  assert.strictEqual(reconciled, current);
  assert.strictEqual(reconciled[0], current[0]);
  assert.ok((reconciled[0]?.lease?.expiresAt || 0) <= Date.now());
});

test('falha de lease deixa a mensagem otimista explicitamente falha, nunca enviada', () => {
  const optimistic = message('pending-lease', Date.now(), 'texto', 'pending', { sender: 'attendant' });
  const rejected = { ...optimistic, status: 'failed' as const };
  assert.equal(rejected.status, 'failed');
  assert.notEqual(rejected.status, 'sent');
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
    metadata: { sentByHub: true, sentByUserId: 'user-leonardo', sentByUserName: 'Leonardo', clientMessageId: 'local-1' },
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

test('reconcilia inbox monotonicamente e mantém atividade otimista no topo', () => {
  const previous = [
    conversation('a', { lastMessage: 'T2 local', lastMessageAt: 1_800_000_000_000, lastMessageFromMe: true }),
    conversation('b', { lastMessageAt: 1_700_000_000_000 }),
  ];
  const staleSnapshot = [
    cloneConversation(previous[1]),
    { ...cloneConversation(previous[0]), lastMessage: 'T1 antigo', lastMessageAt: 1_700_000_000_000 },
  ];
  const reconciled = reconcileConversationsMonotonic(previous, staleSnapshot);

  assert.equal(reconciled[0]?.lastMessage, 'T2 local');
  assert.equal(reconciled[0]?.lastMessageAt, 1_800_000_000_000);
  assert.equal(reconciled[0]?.id, 'a');
  assert.strictEqual(reconciled[1], previous[1]);
});

test('reconcilia snapshot duplicado sem restaurar unread já visualizado', () => {
  const previous = [conversation('a', {
    unreadCount: 0,
    needsResponse: true,
    lastMessage: 'Mensagem recebida',
    lastMessageAt: 1_800_000_000_000,
    lastMessageFromMe: false,
  })];
  const staleReadSnapshot = [{
    ...cloneConversation(previous[0]),
    unreadCount: 3,
  }];

  const reconciled = reconcileConversationsMonotonic(previous, staleReadSnapshot);
  assert.equal(reconciled[0]?.unreadCount, 0);
  assert.equal(reconciled[0]?.needsResponse, true);
});

test('reconcilia inbox monotonicamente e aceita atividade T3 mais nova', () => {
  const previous = [conversation('a', { lastMessage: 'T2 local', lastMessageAt: 1_800_000_000_000 })];
  const newerSnapshot = [{
    ...cloneConversation(previous[0]),
    lastMessage: 'T3 do servidor',
    lastMessageAt: 1_900_000_000_000,
  }];
  const reconciled = reconcileConversationsMonotonic(previous, newerSnapshot);

  assert.equal(reconciled[0]?.lastMessage, 'T3 do servidor');
  assert.equal(reconciled[0]?.lastMessageAt, 1_900_000_000_000);
  assert.notStrictEqual(reconciled[0], previous[0]);
});

test('reconcilia atividade local quando o JID muda mas o telefone permanece', () => {
  const previous = [conversation('lid-1', {
    contact: { ...conversation('lid-1').contact, phone: '+55 21 99999-1234' },
    lastMessage: 'T2 local',
    lastMessageAt: 1_800_000_000_000,
  })];
  const snapshot = [conversation('phone-1', {
    contact: { ...conversation('phone-1').contact, phone: '+55 21 99999-1234' },
    lastMessage: 'T1 antigo',
    lastMessageAt: 1_700_000_000_000,
  })];
  const reconciled = reconcileConversationsMonotonic(previous, snapshot);

  assert.equal(reconciled[0]?.id, 'phone-1');
  assert.equal(reconciled[0]?.lastMessage, 'T2 local');
  assert.equal(reconciled[0]?.lastMessageAt, 1_800_000_000_000);
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
    metadataScope: 'persisted_message',
    metadata: { sentByHub: true, sentByUserId: 'user-leonardo', sentByUserName: 'Leonardo', clientMessageId: 'local-hub-1' },
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

test('atribui autoria somente a envio interno persistido do Hub', () => {
  const internal = normalizeEvolutionMessage({
    key: { id: 'hub-1', fromMe: true },
    metadataScope: 'persisted_message',
    metadata: { sentByHub: true, sentByUserId: 'user-leonardo', sentByUserName: 'Leonardo' },
    message: { conversation: '*Leonardo*\nMensagem enviada pelo Hub' },
    messageTimestamp: 1_700_000_010,
  }, 0, 'conversation-1', 'Outro atendente');

  assert.equal(internal.sender, 'attendant');
  assert.equal(internal.senderName, 'Leonardo');
  assert.equal(internal.metadata?.sentOutsideHub, undefined);
  assert.equal(internal.content, 'Mensagem enviada pelo Hub');
});

test('mensagem fromMe sem correlação do Hub permanece externa', () => {
  const external = normalizeEvolutionMessage({
    key: { id: 'web-1', fromMe: true },
    pushName: 'Leonardo',
    message: { conversation: 'Mensagem enviada pelo WhatsApp Web' },
    messageTimestamp: 1_700_000_011,
  }, 0, 'conversation-1', 'Leonardo');

  assert.equal(external.sender, 'attendant');
  assert.equal(external.senderName, undefined);
  assert.equal(external.metadata?.sentOutsideHub, true);
  assert.equal(external.metadata?.sentByHub, undefined);
});

test('mensagem externa não herda usuário anterior ou assinatura simulada', () => {
  const external = normalizeEvolutionMessage({
    key: { id: 'cell-1', fromMe: true },
    message: { conversation: '*Leonardo*\nMensagem enviada pelo celular' },
    messageTimestamp: 1_700_000_012,
  }, 0, 'conversation-1', 'Mariana');

  assert.equal(external.senderName, undefined);
  assert.equal(external.metadata?.sentOutsideHub, true);
  assert.equal(external.content, '*Leonardo*\nMensagem enviada pelo celular');
});

test('confirmação do Hub reconcilia o envio otimista sem perder autoria', () => {
  const optimistic = message('local-hub-1', 1_700, 'Olá cliente', 'pending', {
    sender: 'attendant',
    senderName: 'Leonardo',
    metadata: { sentByHub: true, sentByUserId: 'user-leonardo', sentByUserName: 'Leonardo' },
  });
  const confirmed = message('provider-hub-1', 1_701, 'Olá cliente', 'sent', {
    sender: 'attendant',
    senderName: 'Leonardo',
    metadata: { sentByHub: true, sentByUserId: 'user-leonardo', sentByUserName: 'Leonardo', clientMessageId: 'local-hub-1' },
    rawKey: { id: 'provider-hub-1', remoteJid: '5521999999999@s.whatsapp.net', fromMe: true },
  });
  const merged = mergeConversationMessages([optimistic], [confirmed]);

  assert.deepEqual(merged.map((item) => item.id), ['provider-hub-1']);
  assert.equal(merged[0]?.senderName, 'Leonardo');
  assert.equal(merged[0]?.metadata?.sentOutsideHub, undefined);
});

test('confirmação posterior reutiliza clientMessageId após a resposta trocar o ID otimista', () => {
  const optimistic = message('provider-response-1', 1_700, 'Olá cliente', 'sent', {
    sender: 'attendant',
    senderName: 'Henrique',
    metadata: {
      sentByHub: true,
      sentByUserId: 'user-henrique',
      sentByUserName: 'Henrique',
      clientMessageId: 'local-henrique-1',
    },
  });
  const confirmed = message('provider-webhook-1', 1_701, 'Olá cliente', 'sent', {
    sender: 'attendant',
    senderName: 'Henrique',
    metadata: {
      sentByHub: true,
      sentByUserId: 'user-henrique',
      sentByUserName: 'Henrique',
      clientMessageId: 'local-henrique-1',
    },
    rawKey: { id: 'provider-webhook-1', remoteJid: '5521999999999@s.whatsapp.net', fromMe: true },
  });

  const merged = mergeConversationMessages([optimistic], [confirmed]);

  assert.deepEqual(merged.map((item) => item.id), ['provider-webhook-1']);
  assert.equal(merged[0]?.senderName, 'Henrique');
  assert.equal(merged[0]?.metadata?.sentByHub, true);
  assert.equal(merged[0]?.metadata?.sentByUserId, 'user-henrique');
});

test('snapshot externo com o mesmo ID não remove autoria interna já confirmada', () => {
  const persistedHubMessage = message('provider-hub-persisted', 1_700, 'Olá cliente', 'sent', {
    sender: 'attendant',
    senderName: 'Henrique',
    metadata: {
      sentByHub: true,
      sentByUserId: 'user-henrique',
      sentByUserName: 'Henrique',
      clientMessageId: 'local-henrique-persisted',
    },
  });
  const providerSnapshot = message('provider-hub-persisted', 1_700, '*Henrique*\nOlá cliente', 'delivered', {
    sender: 'attendant',
    metadata: { sentOutsideHub: true },
    rawKey: { id: 'provider-hub-persisted', remoteJid: '5521999999999@s.whatsapp.net', fromMe: true },
  });

  const merged = mergeConversationMessages([persistedHubMessage], [providerSnapshot]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.senderName, 'Henrique');
  assert.equal(merged[0]?.metadata?.sentByHub, true);
  assert.equal(merged[0]?.metadata?.sentOutsideHub, undefined);
  assert.equal(merged[0]?.metadata?.clientMessageId, 'local-henrique-persisted');
  assert.equal(merged[0]?.status, 'delivered');
});

test('autoria explícita permanece correta para atendentes distintos', () => {
  const agentA = message('local-a', 1_700, 'Mensagem A', 'pending', {
    sender: 'attendant',
    senderName: 'Leonardo',
    metadata: { sentByHub: true, sentByUserId: 'user-a', sentByUserName: 'Leonardo', clientMessageId: 'local-a' },
  });
  const agentB = message('local-b', 1_701, 'Mensagem B', 'pending', {
    sender: 'attendant',
    senderName: 'Henrique',
    metadata: { sentByHub: true, sentByUserId: 'user-b', sentByUserName: 'Henrique', clientMessageId: 'local-b' },
  });
  const confirmations = [
    message('provider-a', 1_702, 'Mensagem A', 'sent', {
      sender: 'attendant', senderName: 'Leonardo',
      metadata: { sentByHub: true, sentByUserId: 'user-a', sentByUserName: 'Leonardo', clientMessageId: 'local-a' },
    }),
    message('provider-b', 1_703, 'Mensagem B', 'sent', {
      sender: 'attendant', senderName: 'Henrique',
      metadata: { sentByHub: true, sentByUserId: 'user-b', sentByUserName: 'Henrique', clientMessageId: 'local-b' },
    }),
  ];

  const merged = mergeConversationMessages([agentA, agentB], confirmations);

  assert.deepEqual(merged.map((item) => item.senderName), ['Leonardo', 'Henrique']);
  assert.deepEqual(merged.map((item) => item.metadata?.sentByUserId), ['user-a', 'user-b']);
});

test('registro persistido do Hub mantém autoria após recarregar a conversa', () => {
  const reloaded = normalizeEvolutionMessage({
    key: { id: 'provider-reload-henrique', fromMe: true },
    metadataScope: 'persisted_message',
    metadata: {
      sentByHub: true,
      sentByUserId: 'user-henrique',
      sentByUserName: 'Henrique',
      clientMessageId: 'local-reload-henrique',
    },
    message: { conversation: '*Henrique*\nMensagem do atendimento' },
    messageTimestamp: 1_700_000_100,
  }, 0, 'conversation-1', 'Atendente');

  assert.equal(reloaded.senderName, 'Henrique');
  assert.equal(reloaded.content, 'Mensagem do atendimento');
  assert.equal(reloaded.metadata?.sentByHub, true);
  assert.equal(reloaded.metadata?.sentOutsideHub, undefined);
});

test('assinatura enviada à Evolution não contamina o conteúdo exibido do Leonardo', () => {
  const evolutionPayload = formatHubOutboundText('Leonardo', 'Nova Iguaçu consigo entregar via correios');
  const confirmed = normalizeEvolutionMessage({
    key: { id: 'provider-leonardo-clean', fromMe: true },
    metadataScope: 'persisted_message',
    metadata: {
      sentByHub: true,
      sentByUserId: 'user-leonardo',
      sentByUserName: 'Leonardo',
      clientMessageId: 'local-leonardo-clean',
    },
    message: { conversation: evolutionPayload },
    messageTimestamp: 1_700_000_110,
  }, 0, 'conversation-1', 'Atendente');

  assert.equal(evolutionPayload, '*Leonardo*\nNova Iguaçu consigo entregar via correios');
  assert.equal(removeHubAgentPrefix(evolutionPayload, 'Leonardo'), 'Nova Iguaçu consigo entregar via correios');
  assert.equal(confirmed.senderName, 'Leonardo');
  assert.equal(confirmed.content, 'Nova Iguaçu consigo entregar via correios');
});

test('extrai o ID explícito da Evolution para texto, reply, mídia, documento e caption', () => {
  const responses = [
    ['texto', { key: { id: 'text-1' } }, 'text-1'],
    ['reply', { message: { key: { id: 'reply-1' } } }, 'reply-1'],
    ['imagem', { data: { key: { id: 'image-1' } } }, 'image-1'],
    ['documento', { data: { message: { key: { id: 'document-1' } } } }, 'document-1'],
    ['caption', { response: { message: { key: { id: 'caption-1' } } } }, 'caption-1'],
  ] as const;

  for (const [, payload, expectedId] of responses) {
    assert.equal(evolutionMessageIdFromResponse(payload), expectedId);
  }
  assert.equal(evolutionMessageIdFromResponse({ data: { message: { id: 'sem-key' } } }), undefined);
});

test('mensagem do Henrique preserva conteúdo legítimo iniciado por asteriscos', () => {
  const evolutionPayload = formatHubOutboundText('Henrique', '*Oferta especial* para hoje');
  const confirmed = normalizeEvolutionMessage({
    key: { id: 'provider-henrique-clean', fromMe: true },
    metadataScope: 'persisted_message',
    metadata: {
      sentByHub: true,
      sentByUserId: 'user-henrique',
      sentByUserName: 'Henrique',
      clientMessageId: 'local-henrique-clean',
    },
    message: { conversation: evolutionPayload },
    messageTimestamp: 1_700_000_111,
  }, 0, 'conversation-1', 'Atendente');

  assert.equal(evolutionPayload, '*Henrique*\n*Oferta especial* para hoje');
  assert.equal(confirmed.senderName, 'Henrique');
  assert.equal(confirmed.content, '*Oferta especial* para hoje');
});

test('mensagem externa parecida não é correlacionada com envio otimista sem ID explícito', () => {
  const optimistic = message('local-hub-2', 1_700, 'Mesmo texto', 'pending', {
    sender: 'attendant',
    senderName: 'Leonardo',
    metadata: { sentByHub: true, sentByUserId: 'user-leonardo', sentByUserName: 'Leonardo' },
  });
  const external = message('external-provider-2', 1_701, 'Mesmo texto', 'sent', {
    sender: 'attendant',
    metadata: { sentOutsideHub: true },
    rawKey: { id: 'external-provider-2', remoteJid: '5521999999999@s.whatsapp.net', fromMe: true },
  });
  const merged = mergeConversationMessages([optimistic], [external]);

  assert.deepEqual(merged.map((item) => item.id), ['local-hub-2', 'external-provider-2']);
  assert.equal(merged[0]?.metadata?.sentByHub, true);
  assert.equal(merged[1]?.metadata?.sentOutsideHub, true);
});

test('confirmação com ID explícito substitui evento externo antecipado sem duplicar', () => {
  const optimistic = message('local-hub-3', 1_700, 'Mensagem do Hub', 'pending', {
    sender: 'attendant',
    senderName: 'Leonardo',
    metadata: { sentByHub: true, sentByUserId: 'user-leonardo', sentByUserName: 'Leonardo' },
  });
  const earlyWebhook = message('provider-hub-3', 1_701, 'Mensagem do Hub', 'sent', {
    sender: 'attendant',
    metadata: { sentOutsideHub: true },
    rawKey: { id: 'provider-hub-3', remoteJid: '5521999999999@s.whatsapp.net', fromMe: true },
  });
  const confirmed = {
    ...earlyWebhook,
    senderName: 'Leonardo',
    metadata: { sentByHub: true, sentByUserId: 'user-leonardo', sentByUserName: 'Leonardo', clientMessageId: 'local-hub-3' },
  };
  const merged = mergeConversationMessages([optimistic, earlyWebhook], [confirmed]);

  assert.deepEqual(merged.map((item) => item.id), ['provider-hub-3']);
  assert.equal(merged[0]?.senderName, 'Leonardo');
  assert.equal(merged[0]?.metadata?.sentOutsideHub, undefined);
});

test('retry e reprocessamento preservam autoria interna já persistida', () => {
  const failed = message('hub-retry-1', 1_700, 'Tentar novamente', 'failed', {
    sender: 'attendant',
    senderName: 'Leonardo',
    metadata: { sentByHub: true, sentByUserId: 'user-leonardo', sentByUserName: 'Leonardo' },
  });
  const reprocessed = { ...failed, status: 'sent' as const };
  const merged = mergeConversationMessages([failed], [reprocessed]);

  assert.equal(merged[0]?.metadata?.sentByHub, true);
  assert.equal(merged[0]?.metadata?.sentByUserName, 'Leonardo');
  assert.equal(merged[0]?.metadata?.sentOutsideHub, undefined);
});

test('reprocessamento de mensagem externa continua sem autoria interna', () => {
  const external = message('external-1', 1_700, 'Mensagem externa', 'sent', {
    sender: 'attendant',
    metadata: { sentOutsideHub: true },
  });
  const current = [external];
  const merged = mergeConversationMessages(current, [{ ...external }]);

  assert.strictEqual(merged, current);
  assert.equal(merged[0]?.senderName, undefined);
  assert.equal(merged[0]?.metadata?.sentOutsideHub, true);
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

test('associa contexto de anúncio somente à mensagem que o carrega', () => {
  const adMessage = normalizeEvolutionMessage({
    key: { id: 'ad-1', fromMe: false },
    message: {
      extendedTextMessage: {
        text: 'Olá, vim pelo anúncio',
        contextInfo: {
          conversionSource: 'FB_Ads',
          externalAdReply: { title: 'Oferta real', sourceUrl: 'https://example.com/oferta' },
        },
      },
    },
    messageTimestamp: 1_700_000_003,
  }, 0, 'conversation-1', 'Atendente');
  const commonMessage = normalizeEvolutionMessage({
    key: { id: 'common-1', fromMe: false },
    // Evolution can put a chat snapshot context on the record. It must not
    // become metadata for this ordinary message.
    contextInfo: {
      conversionSource: 'FB_Ads',
      externalAdReply: { title: 'Contexto da conversa', sourceUrl: 'https://example.com/context' },
    },
    metadata: {
      trafficSource: 'FB_Ads',
      trafficTitle: 'Metadata de outro contexto',
      trafficUrl: 'https://example.com/metadata',
    },
    message: { conversation: 'Mensagem comum' },
    messageTimestamp: 1_700_000_004,
  }, 1, 'conversation-1', 'Atendente');

  assert.equal(adMessage.metadata?.trafficSource, 'FB_Ads');
  assert.equal(adMessage.metadata?.trafficTitle, 'Oferta real');
  assert.equal(commonMessage.metadata?.trafficSource, undefined);
  assert.equal(commonMessage.metadata?.trafficTitle, undefined);
  assert.equal(commonMessage.metadata?.trafficUrl, undefined);
});

test('não herda metadata de anúncio entre mensagens durante o merge', () => {
  const adMessage = message('ad-1', 1_700, 'Mensagem de anúncio', 'read', {
    metadata: { trafficSource: 'FB_Ads', trafficTitle: 'Oferta real' },
  });
  const commonMessage = message('common-1', 1_701, 'Mensagem comum');
  const merged = mergeConversationMessages([adMessage], [commonMessage]);

  assert.equal(merged[0]?.metadata?.trafficSource, 'FB_Ads');
  assert.equal(merged[1]?.metadata?.trafficSource, undefined);
  assert.equal(merged[1]?.metadata?.trafficTitle, undefined);
});

test('preserva cada contexto de anúncio persistido no escopo da própria mensagem', () => {
  const firstAd = normalizeEvolutionMessage({
    key: { id: 'stored-ad-1', fromMe: false },
    metadataScope: 'persisted_message',
    metadata: { trafficSource: 'FB_Ads', trafficTitle: 'Oferta A', trafficUrl: 'https://example.com/a' },
    message: { conversation: 'Primeiro anúncio' },
    messageTimestamp: 1_700_000_005,
  }, 0, 'conversation-1', 'Atendente');
  const secondAd = normalizeEvolutionMessage({
    key: { id: 'stored-ad-2', fromMe: false },
    metadataScope: 'persisted_message',
    metadata: { trafficSource: 'Instagram', trafficTitle: 'Oferta B', trafficUrl: 'https://example.com/b' },
    message: { conversation: 'Segundo anúncio' },
    messageTimestamp: 1_700_000_006,
  }, 1, 'conversation-1', 'Atendente');

  assert.equal(firstAd.metadata?.trafficTitle, 'Oferta A');
  assert.equal(secondAd.metadata?.trafficTitle, 'Oferta B');
  assert.equal(firstAd.metadata?.trafficUrl, 'https://example.com/a');
  assert.equal(secondAd.metadata?.trafficUrl, 'https://example.com/b');
});

test('merge posterior sem metadata não copia anúncio da mensagem anterior', () => {
  const existingAd = message('ad-1', 1_700, 'Mensagem de anúncio', 'read', {
    metadata: { trafficSource: 'FB_Ads', trafficTitle: 'Oferta real' },
  });
  const existingCommon = message('common-1', 1_701, 'Mensagem comum');
  const current = [existingAd, existingCommon];
  const merged = mergeConversationMessages(
    current,
    [{ ...existingCommon }],
  );

  assert.strictEqual(merged, current);
  assert.equal(merged[1]?.metadata?.trafficSource, undefined);
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

test('resposta de atendente mantém referência explícita no estado otimista e na confirmação', () => {
  const original = message('customer-original', 1_700, 'Valores', 'read', {
    senderName: 'Daya',
    rawKey: { id: 'customer-original', remoteJid: '5521999999999@s.whatsapp.net', fromMe: false },
  });
  const quotedMessage = toQuotedMessage(original);
  const optimistic = message('client-reply-1', 1_701, 'Temos sim', 'pending', {
    sender: 'attendant',
    senderName: 'Henrique',
    metadata: { sentByHub: true, sentByUserId: 'user-henrique', sentByUserName: 'Henrique', clientMessageId: 'client-reply-1', quotedMessage },
  });
  const confirmed = message('evolution-reply-1', 1_701, 'Temos sim', 'sent', {
    sender: 'attendant',
    senderName: 'Henrique',
    metadata: { sentByHub: true, sentByUserId: 'user-henrique', sentByUserName: 'Henrique', clientMessageId: 'client-reply-1', quotedMessage },
  });

  const merged = mergeConversationMessages([original, optimistic], [confirmed]);
  assert.deepEqual(merged.map((item) => item.id), ['customer-original', 'evolution-reply-1']);
  assert.equal(merged[1]?.metadata?.quotedMessage?.messageId, 'customer-original');
  assert.equal(merged[1]?.metadata?.quotedMessage?.authorName, 'Daya');
  assert.equal(merged[1]?.senderName, 'Henrique');
});

test('normaliza resposta inbound da Evolution quando contextInfo vem ao lado de message', () => {
  const reply = normalizeEvolutionMessage({
    key: { id: 'reply-from-customer', fromMe: false },
    pushName: 'Cliente',
    messageContextScope: 'webhook',
    message: { conversation: 'Manda aí' },
    contextInfo: {
      stanzaId: 'hub-original',
      participant: '5521999999999@s.whatsapp.net',
      quotedMessage: { conversation: 'Temos sim' },
    },
    messageTimestamp: 1_700_000_200,
  }, 0, 'conversation-1', 'Atendente');
  const common = normalizeEvolutionMessage({
    key: { id: 'common-after-reply', fromMe: false },
    pushName: 'Cliente',
    contextInfo: { stanzaId: 'hub-original', quotedMessage: { conversation: 'Não pode vazar' } },
    metadata: { quotedMessage: { messageId: 'hub-original', content: 'Também não pode vazar' } },
    message: { conversation: 'Mensagem comum' },
    messageTimestamp: 1_700_000_201,
  }, 1, 'conversation-1', 'Atendente');

  assert.equal(reply.metadata?.quotedMessage?.messageId, 'hub-original');
  assert.equal(reply.metadata?.quotedMessage?.content, 'Temos sim');
  assert.equal(reply.metadata?.quotedMessage?.key?.participant, '5521999999999@s.whatsapp.net');
  assert.equal(common.metadata?.quotedMessage, undefined);
});

test('resposta inbound de imagem preserva o tipo citado no contexto do webhook', () => {
  const reply = normalizeEvolutionMessage({
    key: { id: 'reply-to-image', fromMe: false },
    pushName: 'Cliente',
    messageContextScope: 'webhook',
    message: { conversation: 'Gostei dessa foto' },
    contextInfo: {
      stanzaId: 'hub-image-original',
      participant: '5521999999999@s.whatsapp.net',
      quotedMessage: { imageMessage: { caption: 'Antes e depois' } },
    },
    messageTimestamp: 1_700_000_205,
  }, 0, 'conversation-1', 'Atendente');

  assert.equal(reply.metadata?.quotedMessage?.messageId, 'hub-image-original');
  assert.equal(reply.metadata?.quotedMessage?.mediaType, 'image');
  assert.equal(reply.metadata?.quotedMessage?.content, 'Antes e depois');
});

test('SSE e polling preservam a mesma referência de reply inbound', () => {
  const inboundReply = message('customer-reply-sse', 1_700, 'Perfeito', 'read', {
    metadata: {
      quotedMessage: {
        messageId: 'hub-original-sse',
        authorName: 'Henrique',
        sender: 'attendant',
        content: 'Podemos entregar amanhã',
        key: { id: 'hub-original-sse', remoteJid: '5521999999999@s.whatsapp.net', fromMe: true },
      },
    },
  });
  const realtime = reconcileRealtimeMessages([], 'conversation-1', { type: 'message.upsert', message: inboundReply });
  const polled = mergeConversationMessages(realtime || [], [{ ...inboundReply, metadata: { ...inboundReply.metadata, quotedMessage: { ...inboundReply.metadata!.quotedMessage! } } }]);

  assert.equal(realtime?.[0]?.metadata?.quotedMessage?.messageId, 'hub-original-sse');
  assert.equal(polled[0]?.metadata?.quotedMessage?.content, 'Podemos entregar amanhã');
});

test('respostas a mídia preservam uma prévia compacta sem carregar a mídia original', () => {
  const image = message('image-original', 1_700, '[Imagem]', 'read', {
    senderName: 'Cliente',
    mediaType: 'image',
    rawKey: { id: 'image-original', remoteJid: '5521999999999@s.whatsapp.net', fromMe: false },
  });
  const document = message('document-original', 1_701, '[Documento]', 'read', {
    senderName: 'Cliente',
    mediaType: 'document',
    rawKey: { id: 'document-original', remoteJid: '5521999999999@s.whatsapp.net', fromMe: false },
  });
  assert.equal(toQuotedMessage(image).mediaType, 'image');
  assert.equal(toQuotedMessage(document).mediaType, 'document');
});

test('documentos preservam nome, tipo e tamanho para o card da timeline', () => {
  const pdf = message('document-pdf', 1_702, '[Documento]', 'read', {
    mediaType: 'document',
    mediaUrl: 'data:application/pdf;base64,JVBERi0=',
    metadata: { document: { fileName: 'orcamento-agosto.pdf', mimeType: 'application/pdf', fileSize: 1_572_864 } },
  });
  const presentation = getDocumentPresentation(pdf);

  assert.equal(presentation.fileName, 'orcamento-agosto.pdf');
  assert.equal(presentation.extension, 'PDF');
  assert.equal(presentation.kind, 'pdf');
  assert.equal(presentation.formattedSize, '1.5 MB');
});

test('documentos sem preview e formatos desconhecidos mantêm fallback seguro', () => {
  const document = message('document-unknown', 1_703, '[Documento]', 'read', {
    mediaType: 'document',
    mediaUrl: 'https://media.example.invalid/expired',
    metadata: { document: { fileName: 'comprovante.bin' } },
  });
  const presentation = getDocumentPresentation(document);

  assert.equal(presentation.fileName, 'comprovante.bin');
  assert.equal(presentation.extension, 'BIN');
  assert.equal(presentation.kind, 'file');
  assert.equal(presentation.formattedSize, undefined);
});

test('documentos Office usam metadados sem tentar renderizar conteúdo como PDF', () => {
  const document = message('document-docx', 1_704, '[Documento]', 'read', {
    mediaType: 'document',
    metadata: { document: { fileName: 'proposta.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileSize: 12_288 } },
  });
  const presentation = getDocumentPresentation(document);

  assert.equal(presentation.kind, 'word');
  assert.equal(presentation.extension, 'DOCX');
  assert.equal(presentation.formattedSize, '12 KB');
});

test('adapter preserva metadados de documento recebidos para SSE e polling', () => {
  const normalized = normalizeEvolutionMessage({
    key: { id: 'incoming-pdf', fromMe: false },
    pushName: 'Cliente',
    message: {
      documentMessage: {
        fileName: 'laudo.pdf',
        mimetype: 'application/pdf',
        fileLength: '2048',
      },
    },
    messageTimestamp: 1_700_000_210,
  }, 0, 'conversation-1', 'Atendente');
  const merged = mergeConversationMessages([], [normalized]);

  assert.deepEqual(merged[0]?.metadata?.document, {
    fileName: 'laudo.pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
  });
});

test('viewer unificado escolhe imagem, PDF e vídeo sem abrir formatos Office', () => {
  const image = message('viewer-image', 1_705, '[Imagem]', 'read', { mediaType: 'image' });
  const pdf = message('viewer-pdf', 1_706, '[Documento]', 'read', {
    mediaType: 'document',
    metadata: { document: { fileName: 'laudo.pdf', mimeType: 'application/pdf' } },
  });
  const video = message('viewer-video', 1_707, '[Vídeo]', 'read', { mediaType: 'video' });
  const office = message('viewer-office', 1_708, '[Documento]', 'read', {
    mediaType: 'document',
    metadata: { document: { fileName: 'planilha.xlsx' } },
  });

  assert.equal(mediaViewerItemFrom(image, 'data:image/jpeg;base64,AA==')?.type, 'image');
  assert.equal(mediaViewerItemFrom(pdf, 'data:application/pdf;base64,JVBERi0=')?.type, 'pdf');
  assert.equal(mediaViewerItemFrom(video, 'data:video/mp4;base64,AA==')?.type, 'video');
  assert.equal(mediaViewerItemFrom(office, 'data:application/octet-stream;base64,AA=='), undefined);
  assert.equal(mediaViewerItemFrom(pdf, null), undefined);
});

test('viewer unificado fecha somente com Escape', () => {
  assert.equal(isMediaViewerCloseKey('Escape'), true);
  assert.equal(isMediaViewerCloseKey('Enter'), false);
  assert.equal(isMediaViewerCloseKey('v'), false);
});

test('menu de mensagem expõe responder e copiar, com download apenas para mídia', () => {
  const text = message('menu-text', 1_709, 'Texto do cliente');
  const document = message('menu-document', 1_710, '[Documento]', 'read', {
    mediaType: 'document',
    rawKey: { id: 'menu-document', remoteJid: '5521999999999@s.whatsapp.net', fromMe: false },
  });

  assert.deepEqual(messageMenuActionsFor(text), ['reply', 'copy']);
  assert.deepEqual(messageMenuActionsFor(document), ['reply', 'copy', 'download']);
  assert.equal(canDownloadMessageMedia(text), false);
  assert.equal(canDownloadMessageMedia(document), true);
  assert.equal(messageCopyText(text), 'Texto do cliente');
});

test('snapshot posterior sem reply não remove a referência persistida do envio interno', () => {
  const quotedMessage = {
    messageId: 'source', authorName: 'Leonardo', sender: 'attendant' as const, content: 'Original',
    key: { id: 'source', remoteJid: '5521999999999@s.whatsapp.net', fromMe: true },
  };
  const current = message('hub-reply-persisted', 1_700, 'Resposta', 'sent', {
    sender: 'attendant', senderName: 'Henrique',
    metadata: { sentByHub: true, sentByUserId: 'user-henrique', sentByUserName: 'Henrique', clientMessageId: 'local-reply', quotedMessage },
  });
  const providerSnapshot = message('hub-reply-persisted', 1_700, '*Henrique*\nResposta', 'delivered', {
    sender: 'attendant', metadata: { sentOutsideHub: true },
  });
  const merged = mergeConversationMessages([current], [providerSnapshot]);
  assert.equal(merged[0]?.metadata?.quotedMessage?.messageId, 'source');
  assert.equal(merged[0]?.metadata?.sentByHub, true);
  assert.equal(merged[0]?.content, 'Resposta');
});

test('mensagem citada sem original carregada mantém a referência sem criar mensagem artificial', () => {
  const reply = message('reply-with-unloaded-source', 1_700, 'Resposta', 'read', {
    metadata: { quotedMessage: { messageId: 'older-not-loaded', authorName: 'Contato', content: 'Histórico antigo' } },
  });
  const merged = mergeConversationMessages([], [reply]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.metadata?.quotedMessage?.messageId, 'older-not-loaded');
});

test('mensagens comuns não são tratadas como resposta apenas por terem conteúdo parecido', () => {
  const ordinary = message('ordinary', 1_700, 'Valores');
  const sameText = message('same-text', 1_701, 'Valores');
  const merged = mergeConversationMessages([ordinary], [sameText]);
  assert.equal(merged[0]?.metadata?.quotedMessage, undefined);
  assert.equal(merged[1]?.metadata?.quotedMessage, undefined);
});

test('Evolution reaction uses reactionMessage.key.id as the only target identity', () => {
  const event = {
    key: {
      id: 'reaction-event-1',
      remoteJid: '5521999999999@s.whatsapp.net',
      participant: '5521999999999@s.whatsapp.net',
      fromMe: false,
    },
    message: {
      reactionMessage: {
        key: { id: 'original-message-1', remoteJid: '5521988888888@s.whatsapp.net', fromMe: true },
        text: '\u2764\ufe0f',
      },
    },
  };

  const update = providerReactionUpdate(event);
  assert.equal(isProviderReactionEvent(event), true);
  assert.equal(isEvolutionReactionEvent(event), true);
  assert.equal(update?.targetMessageId, 'original-message-1');
  assert.equal(update?.reactorKey, 'jid:5521999999999');
  assert.equal(update?.emoji, '\u2764\ufe0f');
});

test('reaction SSE updates the original Hub message without adding a timeline item', () => {
  const original = message('original-reaction-target', 1_700, 'Original message', 'read', {
    sender: 'attendant',
    senderName: 'Henrique',
    metadata: { sentByHub: true, sentByUserId: 'henrique', sentByUserName: 'Henrique' },
  });
  const reacted = {
    ...original,
    metadata: {
      ...original.metadata,
      reactions: [{ emoji: '\ud83d\udc4d', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 1_700_000_000_000 }],
    },
  };
  const updated = reconcileRealtimeMessages([original], 'conversation-1', {
    type: 'message.upsert',
    reaction: true,
    message: reacted,
  });

  assert.equal(updated?.length, 1);
  assert.equal(updated?.[0]?.id, 'original-reaction-target');
  assert.deepEqual(updated?.[0]?.metadata?.reactions, reacted.metadata?.reactions);
  assert.equal(updated?.[0]?.metadata?.sentByHub, true);
});

test('equivalent reaction events from SSE, polling and refresh preserve identity', () => {
  const current = [message('reaction-stable', 1_700, 'Message', 'read', {
    metadata: {
      reactions: [{ emoji: '\ud83d\ude0d', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 1_700_000_000_000 }],
    },
  })];
  const equivalentSnapshot = {
    ...current[0],
    metadata: { reactions: [{ emoji: '\ud83d\ude0d', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 1_700_000_000_000 }] },
  };
  const sse = reconcileRealtimeMessages(current, 'conversation-1', {
    type: 'message.upsert',
    reaction: true,
    message: equivalentSnapshot,
  });
  const polling = mergeConversationMessages(sse || current, [equivalentSnapshot]);

  assert.equal(sse, current);
  assert.equal(polling, current);
  assert.equal(polling.length, 1);
  assert.equal(polling[0]?.metadata?.reactions?.length, 1);
});

test('a reaction can be replaced or removed by the same participant', () => {
  const initial = [
    { emoji: '\u2764\ufe0f', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 1_700_000_000_000 },
    { emoji: '\ud83d\udc4d', reactorKey: '__vitstock_self__', actorId: '__vitstock_self__', fromMe: true, updatedAt: 1_700_000_000_000 },
  ];
  const swapped = applyProviderReaction(initial, {
    targetMessageId: 'reaction-target',
    reactorKey: 'jid:5521999999999',
    emoji: '\ud83d\ude02',
    fromMe: false,
    updatedAt: 1_700_000_010_000,
  });
  const removed = applyProviderReaction(swapped, {
    targetMessageId: 'reaction-target',
    reactorKey: 'jid:5521999999999',
    emoji: '',
    fromMe: false,
    updatedAt: 1_700_000_020_000,
  });

  assert.deepEqual(swapped, [
    { emoji: '\ud83d\udc4d', reactorKey: '__vitstock_self__', actorId: '__vitstock_self__', fromMe: true, updatedAt: 1_700_000_000_000 },
    { emoji: '\ud83d\ude02', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 1_700_000_010_000 },
  ]);
  assert.deepEqual(removed, [{ emoji: '\ud83d\udc4d', reactorKey: '__vitstock_self__', actorId: '__vitstock_self__', fromMe: true, updatedAt: 1_700_000_000_000 }]);
});

test('reaction with a missing original is never associated by phone or content', () => {
  const event = {
    key: { id: 'reaction-missing-source', remoteJid: '5521999999999@s.whatsapp.net', fromMe: false },
    message: { reactionMessage: { key: { id: 'missing-original' }, text: '\ud83d\udc4d' } },
  };
  const update = providerReactionUpdate(event)!;
  const unrelated = message('same-content-but-not-target', 1_700, 'Similar message');

  assert.notEqual(unrelated.id, update.targetMessageId);
  assert.equal([unrelated].find((item) => item.id === update.targetMessageId), undefined);
  assert.equal(isEvolutionReactionEvent(event), true);
});

test('reactions preserve replies and external authorship metadata', () => {
  const current = [message('reply-with-reaction', 1_700, 'Reply', 'read', {
    metadata: {
      sentOutsideHub: true,
      quotedMessage: { messageId: 'source', content: 'Original' },
      reactions: [{ emoji: '\u2764\ufe0f', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 1_700_000_000_000 }],
    },
  })];
  const equivalent = {
    ...current[0],
    metadata: {
      ...current[0].metadata,
      quotedMessage: { ...current[0].metadata?.quotedMessage },
      reactions: [{ emoji: '\u2764\ufe0f', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 1_700_000_000_000 }],
    },
  };
  const merged = mergeConversationMessages(current, [equivalent]);

  assert.equal(merged, current);
  assert.equal(merged[0]?.metadata?.quotedMessage?.messageId, 'source');
  assert.equal(merged[0]?.metadata?.sentOutsideHub, true);
});

test('reaction updates normalize equivalent JID formats into one reactor key', () => {
  const bySwhatsapp = providerReactionUpdate({
    key: { id: 'reaction-1', participant: '5521999999999@s.whatsapp.net', fromMe: false },
    messageTimestamp: 1_700_000_000,
    message: { reactionMessage: { key: { id: 'target' }, text: '\ud83d\ude33' } },
  })!;
  const byCus = providerReactionUpdate({
    key: { id: 'reaction-2', participant: '5521999999999@c.us', fromMe: false },
    messageTimestamp: 1_700_000_010,
    message: { reactionMessage: { key: { id: 'target' }, text: '\u2764\ufe0f' } },
  })!;
  const swapped = applyProviderReaction(applyProviderReaction([], bySwhatsapp), byCus);

  assert.equal(bySwhatsapp.reactorKey, 'jid:5521999999999');
  assert.equal(byCus.reactorKey, bySwhatsapp.reactorKey);
  assert.deepEqual(swapped.map((reaction) => reaction.emoji), ['\u2764\ufe0f']);
});

test('a stale polling reaction cannot restore an older emoji after a newer change', () => {
  const current = [{
    emoji: '\u2764\ufe0f', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 2_000,
  }];
  const stale = applyProviderReaction(current, {
    targetMessageId: 'target', reactorKey: 'jid:5521999999999', emoji: '\ud83d\ude33', fromMe: false, updatedAt: 1_000,
  });

  assert.equal(stale, current);
  assert.equal(stale[0]?.emoji, '\u2764\ufe0f');
});

test('different participants retain one current reaction each on the same message', () => {
  const first = applyProviderReaction([], {
    targetMessageId: 'target', reactorKey: 'jid:5521999999999', emoji: '\u2764\ufe0f', fromMe: false, updatedAt: 1_000,
  });
  const next = applyProviderReaction(first, {
    targetMessageId: 'target', reactorKey: 'jid:5521988888888', emoji: '\ud83d\udc4d', fromMe: false, updatedAt: 1_001,
  });

  assert.equal(next.length, 2);
  assert.deepEqual(next.map((reaction) => reaction.reactorKey), ['jid:5521999999999', 'jid:5521988888888']);
});

test('a persisted reaction removal is not restored when the refreshed metadata is explicit', () => {
  const current = [message('hub-reaction-removed', 1_700, 'Message', 'sent', {
    sender: 'attendant',
    metadata: {
      sentByHub: true,
      sentByUserId: 'user-1',
      sentByUserName: 'Leonardo',
      reactions: [{ emoji: '\u2764\ufe0f', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 2_000 }],
    },
  })];
  const refreshed = {
    ...current[0],
    metadata: { sentByHub: true, sentByUserId: 'user-1', sentByUserName: 'Leonardo' },
  };
  const merged = mergeConversationMessages(current, [refreshed]);

  assert.notEqual(merged, current);
  assert.equal(merged[0]?.metadata?.reactions, undefined);
});

test('reaction events outside the loaded timeline are a no-op and do not request a reload fallback', () => {
  const current = [message('loaded-message', 1_700, 'Visible')];
  const result = reconcileRealtimeMessages(current, 'conversation-1', {
    type: 'message.upsert',
    reaction: true,
    message: {
      ...message('older-not-loaded', 1_600, 'Older'),
      metadata: {
        reactions: [{ emoji: '\ud83d\udc4d', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 1_700_000_000_000 }],
      },
    },
  });

  assert.equal(result, current);
  assert.deepEqual(result.map((item) => item.id), ['loaded-message']);
});

test('reaction metadata updates only the loaded target without changing message order', () => {
  const first = message('first', 1_000, 'First');
  const target = message('target', 2_000, 'Target');
  const current = [first, target];
  const updatedTarget = {
    ...target,
    metadata: {
      reactions: [{ emoji: '\ud83d\udc4d', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 2_100 }],
    },
  };
  const updated = reconcileRealtimeMessages(current, 'conversation-1', {
    type: 'message.upsert', reaction: true, message: updatedTarget,
  });

  assert.deepEqual(updated?.map((item) => item.id), ['first', 'target']);
  assert.equal(updated?.[0], first);
  assert.notEqual(updated?.[1], target);
});

test('reaction SSE updates a loaded target even when the conversation JID has changed', () => {
  const current = [message('provider-target', 2_000, 'Target')];
  const updated = reconcileRealtimeMessages(current, 'current-lid@lid', {
    type: 'message.upsert',
    reaction: true,
    message: {
      ...current[0],
      conversationId: 'current-phone@s.whatsapp.net',
      metadata: {
        reactions: [{ emoji: '\ud83d\udc4d', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', fromMe: false, updatedAt: 2_100 }],
      },
    },
  });

  assert.equal(updated?.length, 1);
  assert.equal(updated?.[0]?.metadata?.reactions?.[0]?.emoji, '\ud83d\udc4d');
});

test('outbound idempotency reuses an accepted client message id', () => {
  const key = outboundIdempotencyLockKey('company-a', 'client-message-a');
  assert.equal(key, 'vitstock:outbound:company-a:client-message-a');

  let evolutionCalls = 0;
  let storedStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | undefined;
  const submit = () => {
    const action = outboundDispatchAction(storedStatus);
    if (action === 'reuse') return action;
    evolutionCalls += 1;
    storedStatus = 'pending';
    return action;
  };

  assert.equal(submit(), 'create');
  assert.equal(submit(), 'reuse');
  assert.equal(evolutionCalls, 1);
  assert.equal(outboundDispatchAction('sent'), 'reuse');
  assert.equal(outboundDispatchAction('delivered'), 'reuse');
  assert.equal(outboundDispatchAction('read'), 'reuse');
});

test('concurrent outbound requests with the same client id dispatch Evolution once', async () => {
  const coordinator = createOutboundRequestCoordinator<string>();
  let evolutionCalls = 0;
  let resolveDispatch: (result: string) => void = () => undefined;
  const dispatch = () => {
    evolutionCalls += 1;
    return new Promise<string>((resolve) => { resolveDispatch = resolve; });
  };

  const first = coordinator.run('company-a:client-message-a', dispatch);
  const second = coordinator.run('company-a:client-message-a', dispatch);
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(evolutionCalls, 1);
  resolveDispatch('provider-message-a');
  assert.equal(await first, 'provider-message-a');
});

test('explicit retry only reopens a failed outbound message', () => {
  assert.equal(outboundDispatchAction('failed'), 'retry');
  assert.equal(outboundDispatchAction('pending'), 'reuse');
});

test('encryption protocol events are not renderable messages', () => {
  const secret = {
    key: { id: 'secret-event', remoteJid: '5511999999999@s.whatsapp.net' },
    messageType: 'secretEncryptedMessage',
    message: { secretEncryptedMessage: { ciphertext: 'abc' } },
  };
  const senderKey = {
    key: { id: 'key-event', remoteJid: '5511999999999@s.whatsapp.net' },
    message: { senderKeyDistributionMessage: { groupId: 'group' } },
  };
  assert.equal(isNonRenderableProviderMessage(secret), true);
  assert.equal(isNonRenderableProviderMessage(senderKey), true);
});

test('deviceSent wrapper preserves a real message', () => {
  const wrapped = {
    key: { id: 'device-sent', remoteJid: '5511999999999@s.whatsapp.net' },
    message: { deviceSentMessage: { message: { conversation: 'Texto real' } } },
  };
  assert.deepEqual(unwrapProviderMessage(wrapped.message), { conversation: 'Texto real' });
  assert.equal(isNonRenderableProviderMessage(wrapped), false);
});

test('reply snapshot is consumed by one send and never leaks to the next', () => {
  const replyTarget = message('quoted-source', 1_700, 'Mensagem original');
  const first = captureComposerSubmission({
    text: 'Primeira resposta',
    replyTarget,
    isInternalNote: false,
  });
  const second = captureComposerSubmission({
    text: 'Mensagem comum',
    replyTarget: null,
    isInternalNote: false,
  });

  assert.equal(first.replyTarget?.id, 'quoted-source');
  assert.equal(second.replyTarget, null);
});

test('drafts are isolated by conversation and a sent draft is cleared', () => {
  const drafts = new Map<string, string>();
  writeConversationDraft(drafts, 'conversation-a', 'Rascunho A');
  writeConversationDraft(drafts, 'conversation-b', 'Rascunho B');
  writeConversationDraft(drafts, 'conversation-a', '');

  assert.equal(readConversationDraft(drafts, 'conversation-a'), '');
  assert.equal(readConversationDraft(drafts, 'conversation-b'), 'Rascunho B');
});

test('failed send restores a draft only when no newer composer change exists', () => {
  assert.equal(canRestoreComposerDraft(7, 7), true);
  assert.equal(canRestoreComposerDraft(8, 7), false);
});

test('reply action schedules focus for the composer textarea', () => {
  let focused = false;
  scheduleComposerFocus(
    () => { focused = true; },
    (callback) => {
      callback(0);
      return 1;
    },
  );
  assert.equal(focused, true);
});
