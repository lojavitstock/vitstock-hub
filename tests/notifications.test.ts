import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { Message } from '../src/types';
import type { RealtimeEventPayload } from '../src/utils/realtimeUpdates';
import {
  showDesktopNotification,
  type DesktopNotificationRegistration,
  type DesktopNotificationRuntime,
} from '../src/utils/desktopNotification';
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
import {
  attachInstallPromptListeners,
  createInstallPromptController,
  isStandaloneDisplayMode,
  type DeferredInstallPrompt,
} from '../src/utils/pwaInstall';

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

test('captura antecipada de beforeinstallprompt preserva o evento antes do mount React', async () => {
  const target = new EventTarget();
  const controller = createInstallPromptController();
  attachInstallPromptListeners(target, controller);
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & DeferredInstallPrompt;
  let prompts = 0;
  event.prompt = async () => { prompts += 1; };
  event.userChoice = Promise.resolve({ outcome: 'accepted' });

  target.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(controller.hasCapturedPrompt(), true);
  assert.equal(controller.canInstall(), true);
  assert.deepEqual(await controller.promptInstall(), { outcome: 'accepted' });
  assert.equal(prompts, 1);
});

const makeDesktopNotificationRuntime = (
  overrides: Partial<DesktopNotificationRuntime> = {},
): DesktopNotificationRuntime => ({
  notificationSupported: true,
  permission: 'granted',
  secureContext: true,
  serviceWorkerSupported: true,
  getRegistration: async () => ({ active: {} } as DesktopNotificationRegistration),
  ready: async () => ({ active: {} } as DesktopNotificationRegistration),
  ...overrides,
});

test('desktop notification exige worker ready e usa a registration ativa', async () => {
  const calls: Array<{ title: string; options?: NotificationOptions }> = [];
  let readyCalls = 0;
  const runtime = makeDesktopNotificationRuntime({
    getRegistration: async () => ({ active: {} } as DesktopNotificationRegistration),
    ready: async () => {
      readyCalls += 1;
      return {
        active: {} as ServiceWorker,
        showNotification: async (title, options) => { calls.push({ title, options }); },
      } as DesktopNotificationRegistration;
    },
  });

  const result = await showDesktopNotification('Vitstock Hub', { body: 'Teste' }, runtime);

  assert.deepEqual(result, { ok: true, method: 'service-worker', serviceWorkerReady: true });
  assert.equal(readyCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, 'Vitstock Hub');
});

test('desktop notification retorna falha estruturada e sanitizada se showNotification rejeitar', async () => {
  const runtime = makeDesktopNotificationRuntime({
    ready: async () => ({
      active: {} as ServiceWorker,
      showNotification: async () => {
        const error = new Error('Falhou em https://private.example/ 90361234@lid token=abcdefghijklmnopqrstuvwxyz0123456789');
        error.name = 'NotAllowedError';
        throw error;
      },
    } as DesktopNotificationRegistration),
  });

  const result = await showDesktopNotification('Vitstock Hub', { body: 'Teste' }, runtime);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'show-notification-failed');
  assert.equal(result.serviceWorkerReady, true);
  assert.equal(result.errorName, 'NotAllowedError');
  assert.doesNotMatch(result.errorMessage || '', /private\.example|90361234|abcdefghijklmnopqrstuvwxyz/);
  assert.match(result.errorMessage || '', /\[url\]/);
  assert.match(result.errorMessage || '', /\[identity\]/);
  assert.match(result.errorMessage || '', /\[redacted\]/);
});

test('sem permission, APIs ou registration ativa não chama showNotification', async () => {
  let calls = 0;
  const registration = {
    active: {} as ServiceWorker,
    showNotification: async () => { calls += 1; },
  } as DesktopNotificationRegistration;

  const denied = await showDesktopNotification('Vitstock Hub', {}, makeDesktopNotificationRuntime({ permission: 'denied' }));
  assert.deepEqual(denied, { ok: false, reason: 'permission', serviceWorkerReady: false });

  const unsupported = await showDesktopNotification('Vitstock Hub', {}, makeDesktopNotificationRuntime({ serviceWorkerSupported: false }));
  assert.deepEqual(unsupported, { ok: false, reason: 'unsupported', serviceWorkerReady: false });

  const noRegistration = await showDesktopNotification('Vitstock Hub', {}, makeDesktopNotificationRuntime({
    getRegistration: async () => undefined,
    ready: async () => registration,
  }));
  assert.deepEqual(noRegistration, { ok: false, reason: 'service-worker-not-ready', serviceWorkerReady: false });
  assert.equal(calls, 0);
});

test('service worker sem registration ativa pronta retorna service-worker-not-ready', async () => {
  const result = await showDesktopNotification('Vitstock Hub', {}, makeDesktopNotificationRuntime({
    ready: async () => new Promise<DesktopNotificationRegistration | undefined>(() => undefined),
  }), 5);

  assert.deepEqual(result, { ok: false, reason: 'service-worker-not-ready', serviceWorkerReady: false });
});

test('fetch do service worker só responde navegação com passthrough de rede e não usa cache', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const handlers = new Map<string, (event: { request: Request; respondWith: (response: Promise<unknown>) => void }) => void>();
  const requests: Request[] = [];
  const worker = {
    addEventListener: (type: string, listener: (event: never) => void) => handlers.set(type, listener as (event: never) => void),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async () => undefined },
    location: { origin: 'https://hub-preview.vitstock.com.br' },
  };
  runInNewContext(source, {
    self: worker,
    URL,
    fetch: async (request: Request) => {
      requests.push(request);
      return { source: 'network' };
    },
  });

  const fetchHandler = handlers.get('fetch');
  assert.ok(fetchHandler);
  const navigation = { mode: 'navigate' } as Request;
  let navigationResponse: Promise<unknown> | undefined;
  fetchHandler({ request: navigation, respondWith: (response) => { navigationResponse = response; } });
  assert.equal((await navigationResponse as { source: string }).source, 'network');
  assert.deepEqual(requests, [navigation]);

  for (const request of [
    { mode: 'cors', url: '/api/evolution/events' },
    { mode: 'cors', url: '/api/contacts' },
    { mode: 'cors', url: 'https://evolution.example.test' },
  ] as Request[]) {
    let intercepted = false;
    fetchHandler({ request, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
  assert.equal(requests.length, 1);
  assert.doesNotMatch(source, /\bcaches?\s*\./i);
});
