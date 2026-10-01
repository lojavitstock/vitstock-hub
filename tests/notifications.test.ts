import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '../src/types';
import type { RealtimeEventPayload } from '../src/utils/realtimeUpdates';
import {
  buildConversationNavigationTarget,
  chooseNotificationPresentation,
  consumeConversationQuery,
  createCrossTabMessageNotificationDeduper,
  createMessageNotificationDeduper,
  fingerprintNotificationMessageId,
  getNotificationConversationId,
  getNotificationPreview,
  isNotifiableInboundMessage,
  notificationPermissionAllowsDesktop,
} from '../src/utils/messageNotification';
import { createInstallPromptController, isStandaloneDisplayMode } from '../src/utils/pwaInstall';

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'notification-message-1',
  conversationId: '5521990000001@s.whatsapp.net',
  sender: 'contact',
  content: 'Olá, chegou uma nova mensagem.',
  timestamp: '2026-10-01T12:00:00.000Z',
  timestampMs: 1_791_000_000_000,
  status: 'delivered',
  ...overrides,
});

const makeEvent = (overrides: Partial<RealtimeEventPayload> = {}): RealtimeEventPayload => ({
  type: 'message.upsert',
  remoteJid: '5521990000001@s.whatsapp.net',
  fromMe: false,
  message: makeMessage(),
  ...overrides,
});

test('somente uma mensagem inbound nova e visível é elegível para notificação', () => {
  assert.equal(isNotifiableInboundMessage(makeEvent()), true);
  assert.equal(isNotifiableInboundMessage(makeEvent({ fromMe: true })), false);
  assert.equal(isNotifiableInboundMessage(makeEvent({ message: makeMessage({ sender: 'attendant' }) })), false);
  assert.equal(isNotifiableInboundMessage(makeEvent({ message: makeMessage({ isInternalNote: true }) })), false);
  assert.equal(isNotifiableInboundMessage(makeEvent({ reaction: true })), false);
  assert.equal(isNotifiableInboundMessage(makeEvent({ incrementUnread: false })), false);
  assert.equal(isNotifiableInboundMessage(makeEvent({ type: 'message.updated' })), false);
  assert.equal(isNotifiableInboundMessage(makeEvent({ type: 'conversation.updated' })), false);
  assert.equal(isNotifiableInboundMessage(makeEvent({ message: makeMessage({ id: '' }) })), false);
});

test('dedupe local não repete o mesmo ID de mensagem', () => {
  const deduper = createMessageNotificationDeduper();
  const incoming = makeMessage();
  assert.equal(deduper.shouldNotify(incoming), true);
  assert.equal(deduper.shouldNotify(incoming), false);
});

test('decisão visual separa conversa ativa, outra conversa e aba oculta', () => {
  assert.equal(chooseNotificationPresentation({
    visible: true,
    focused: true,
    activeConversationId: 'conversation-a',
    notificationConversationId: 'conversation-a',
  }), 'none');
  assert.equal(chooseNotificationPresentation({
    visible: true,
    focused: true,
    activeConversationId: 'conversation-a',
    notificationConversationId: 'conversation-b',
  }), 'toast');
  assert.equal(chooseNotificationPresentation({
    visible: false,
    focused: false,
    activeConversationId: 'conversation-a',
    notificationConversationId: 'conversation-b',
  }), 'desktop');
  assert.equal(chooseNotificationPresentation({
    visible: true,
    focused: false,
    activeConversationId: 'conversation-a',
    notificationConversationId: 'conversation-a',
  }), 'desktop');
});

test('notificação nativa exige permissão granted sem solicitar permissão por conta própria', () => {
  assert.equal(notificationPermissionAllowsDesktop('default'), false);
  assert.equal(notificationPermissionAllowsDesktop('denied'), false);
  assert.equal(notificationPermissionAllowsDesktop('granted'), true);
});

test('destino usa somente o ID explícito da conversa, nunca phone ou alias', () => {
  const event = makeEvent({
    phone: '5521999999999',
    remoteJid: 'remote@lid',
    message: makeMessage({ conversationId: 'message@lid' }),
    messageId: 'other@s.whatsapp.net',
  });
  assert.equal(getNotificationConversationId(event), 'message@lid');
  assert.equal(getNotificationConversationId(makeEvent({ message: makeMessage({ conversationId: '' }) })), '5521990000001@s.whatsapp.net');
  assert.equal(getNotificationConversationId(makeEvent({ remoteJid: undefined, message: makeMessage({ conversationId: '' }), phone: '5521990000001' })), null);
});

test('preview is semantic for media and bounded for text', () => {
  assert.equal(getNotificationPreview(makeMessage({ content: 'texto longo', mediaType: 'image' })), 'Imagem');
  assert.equal(getNotificationPreview(makeMessage({ mediaType: 'audio' })), 'Mensagem de áudio');
  assert.equal(getNotificationPreview(makeMessage({ mediaType: 'video' })), 'Vídeo');
  assert.equal(getNotificationPreview(makeMessage({ mediaType: 'document' })), 'Documento');
  assert.equal(getNotificationPreview(makeMessage({ mediaType: 'sticker' })), 'Figurinha');
  assert.equal(getNotificationPreview(makeMessage({ metadata: { location: { latitude: 0, longitude: 0 } } })), 'Localização');
  assert.equal(getNotificationPreview(makeMessage({ content: '90361234@lid' })), 'Nova mensagem');
  const preview = getNotificationPreview(makeMessage({ content: '😀'.repeat(130) }), 120);
  assert.equal(Array.from(preview).length, 121);
  assert.equal(preview.endsWith('…'), true);
});

test('fingerprint não expõe o ID original e é estável', async () => {
  const first = await fingerprintNotificationMessageId('provider-message-id');
  const second = await fingerprintNotificationMessageId('provider-message-id');
  assert.ok(first);
  assert.notEqual(first, 'provider-message-id');
  assert.equal(first, second);
});

test('deduplicação compartilhada funciona entre instâncias e expira por TTL', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
  let now = 10_000;
  const firstTab = createCrossTabMessageNotificationDeduper(storage, { now: () => now, ttlMs: 100, maxRecords: 5 });
  const secondTab = createCrossTabMessageNotificationDeduper(storage, { now: () => now, ttlMs: 100, maxRecords: 5 });

  assert.equal(firstTab.shouldNotify('sha256-a'), true);
  assert.equal(secondTab.shouldNotify('sha256-a'), false);
  now += 101;
  assert.equal(secondTab.shouldNotify('sha256-a'), true);
});

test('target de click e query selecionam somente conversationId conhecido', () => {
  const id = '90361234@lid';
  assert.equal(buildConversationNavigationTarget(id), '/atendimento?conversation=90361234%40lid');
  assert.deepEqual(consumeConversationQuery({
    search: '?from=notification&conversation=90361234%40lid',
    hasLoadedConversations: false,
    conversationIds: [id],
  }), {
    ready: false,
    shouldRefresh: false,
    conversationId: null,
    search: '?from=notification&conversation=90361234%40lid',
  });
  assert.deepEqual(consumeConversationQuery({
    search: '?from=notification&conversation=90361234%40lid',
    hasLoadedConversations: true,
    conversationIds: [id],
  }), { ready: true, shouldRefresh: false, conversationId: id, search: '?from=notification' });
  assert.deepEqual(consumeConversationQuery({
    search: '?conversation=missing%40lid',
    hasLoadedConversations: true,
    conversationIds: [id],
  }), {
    ready: false,
    shouldRefresh: true,
    conversationId: null,
    search: '?conversation=missing%40lid',
  });
  assert.deepEqual(consumeConversationQuery({
    search: '?conversation=missing%40lid',
    hasLoadedConversations: true,
    conversationIds: [id],
    refreshAttempted: true,
  }), { ready: true, shouldRefresh: false, conversationId: null, search: '' });
});

test('install prompt é capturado, consumido uma vez e respeita estado instalado', async () => {
  let changes = 0;
  let prompts = 0;
  const controller = createInstallPromptController(() => { changes += 1; });
  const deferredPrompt = {
    prompt: async () => { prompts += 1; },
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  };

  assert.equal(controller.canInstall(), false);
  controller.capture(deferredPrompt);
  assert.equal(controller.canInstall(), true);
  assert.deepEqual(await controller.promptInstall(), { outcome: 'accepted' });
  assert.equal(prompts, 1);
  assert.equal(controller.canInstall(), false);
  controller.markInstalled();
  controller.capture(deferredPrompt);
  assert.equal(controller.isInstalled(), true);
  assert.equal(controller.canInstall(), false);
  assert.ok(changes >= 3);
  assert.equal(isStandaloneDisplayMode(true), true);
  assert.equal(isStandaloneDisplayMode(false), false);
});
