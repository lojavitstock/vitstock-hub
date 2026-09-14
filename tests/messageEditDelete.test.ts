import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  assertMessageMutationAllowed,
  deletedMessageMetadata,
  editedMessageMetadata,
  evolutionDeleteMessagePayload,
  evolutionEditMessagePayload,
  isProviderTimeout,
  MessageMutationError,
} from '../server/src/messageMutations';
import type { Conversation, Message } from '../src/types';
import { canDeleteMessageForEveryone, canEditMessage, messageMenuActionsFor } from '../src/utils/messageActions';
import { applyOutboundSendConfirmation } from '../src/utils/outboundMessageConfirmation';
import { reconcileRealtimeConversation, reconcileRealtimeMessages } from '../src/utils/realtimeUpdates';
import { normalizeEvolutionMessage } from '../src/services/evolutionMessageAdapter';

const key = (remoteJid = '5511999999999@s.whatsapp.net') => ({
  id: 'BAE5A1',
  remoteJid,
  remoteJidAlt: '5511999999999@lid',
  fromMe: true,
  participant: remoteJid.endsWith('@g.us') ? '5511888888888@s.whatsapp.net' : undefined,
  participantAlt: '100000000000001@lid',
  addressingMode: 'pn',
  senderPn: '5511999999999@s.whatsapp.net',
  participantPn: '5511888888888@s.whatsapp.net',
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'local-1',
  company_id: 'company-1',
  evolution_message_id: 'BAE5A1',
  sender: 'attendant',
  media_type: null,
  metadata: { sentByHub: true, providerKey: key() },
  evolution_remote_jid: '5511999999999@s.whatsapp.net',
  ...overrides,
});

const message = (id: string, content: string, overrides: Partial<Message> = {}): Message => ({
  id,
  conversationId: '5511999999999@s.whatsapp.net',
  sender: 'attendant',
  content,
  timestamp: '12:00',
  timestampMs: 1_700_000_000_000,
  status: 'sent',
  metadata: { sentByHub: true, providerKey: key() },
  rawKey: key(),
  ...overrides,
});

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: '5511999999999@s.whatsapp.net',
  contact: { id: 'contact-1', name: 'Cliente', phone: '+5511999999999', avatar: '', tags: [], createdAt: '2026-01-01' },
  lastMessage: 'antes',
  lastMessageTimestamp: '11:59',
  lastMessageAt: 1_699_999_000_000,
  lastMessageFromMe: true,
  lastMessageKey: { id: 'old', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true },
  unreadCount: 3,
  needsResponse: false,
  status: 'open',
  ...overrides,
});

test('edit payload uses only the v2.3.7 update contract and persisted PN key', () => {
  assert.deepEqual(evolutionEditMessagePayload(row(), ' texto novo '), {
    number: '5511999999999',
    text: 'texto novo',
    key: { id: 'BAE5A1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true },
  });
});

test('delete payload preserves group participant and does not fabricate aliases', () => {
  const groupKey = key('120363000000@g.us');
  const payload = evolutionDeleteMessagePayload(row({
    metadata: { sentByHub: true, providerKey: groupKey },
    evolution_remote_jid: '120363000000@g.us',
  }));
  assert.deepEqual(payload, {
    id: 'BAE5A1',
    remoteJid: '120363000000@g.us',
    fromMe: true,
    participant: '5511888888888@s.whatsapp.net',
  });
  assert.equal('remoteJidAlt' in payload, false);
  assert.equal('participantAlt' in payload, false);
});

test('unsafe LID edit and non-Hub messages are rejected before provider call', () => {
  assert.throws(
    () => assertMessageMutationAllowed(row({ metadata: { sentByHub: true, providerKey: key('100000000000001@lid') } }), 'edit', 'novo'),
    (error: unknown) => error instanceof MessageMutationError && error.code === 'MESSAGE_EDIT_PROVIDER_KEY_UNSUPPORTED',
  );
  assert.throws(
    () => assertMessageMutationAllowed(row({ sender: 'contact' }), 'delete'),
    (error: unknown) => error instanceof MessageMutationError && error.code === 'MESSAGE_NOT_SENT_BY_HUB',
  );
  assert.throws(
    () => assertMessageMutationAllowed(row({ metadata: { sentByHub: false, providerKey: key() } }), 'edit', 'novo'),
    (error: unknown) => error instanceof MessageMutationError && error.code === 'MESSAGE_NOT_SENT_BY_HUB',
  );
  assert.throws(
    () => assertMessageMutationAllowed(row({ metadata: { sentByHub: true } }), 'edit', 'novo'),
    (error: unknown) => error instanceof MessageMutationError && error.code === 'MESSAGE_PROVIDER_KEY_MISSING',
  );
  assert.throws(
    () => assertMessageMutationAllowed(row({ media_type: 'image' }), 'edit', 'novo'),
    (error: unknown) => error instanceof MessageMutationError && error.code === 'MESSAGE_EDIT_UNSUPPORTED_TYPE',
  );
  assert.throws(
    () => assertMessageMutationAllowed(row({ metadata: { sentByHub: true, providerKey: key(), deletedForEveryone: true } }), 'delete'),
    (error: unknown) => error instanceof MessageMutationError && error.code === 'MESSAGE_ALREADY_DELETED',
  );
});

test('delete accepts an exact LID key independently from the edit policy', () => {
  const lid = key('100000000000001@lid');
  assert.deepEqual(evolutionDeleteMessagePayload(row({ metadata: { sentByHub: true, providerKey: lid } })), {
    id: 'BAE5A1',
    remoteJid: '100000000000001@lid',
    fromMe: true,
  });
  assert.equal(isProviderTimeout({ name: 'TimeoutError' }), true);
  assert.equal(isProviderTimeout({ name: 'Error' }), false);
});

test('metadata mutation helpers preserve existing provider identity and unrelated metadata', () => {
  const original = { sentByHub: true, providerKey: key(), quotedMessage: { messageId: 'quoted-1' } };
  const edited = editedMessageMetadata(original, 'user-1', '2026-09-08T12:00:00.000Z');
  const deleted = deletedMessageMetadata(edited, 'user-1', '2026-09-08T12:01:00.000Z');
  assert.deepEqual(edited.providerKey, original.providerKey);
  assert.deepEqual(edited.quotedMessage, original.quotedMessage);
  assert.equal(deleted.deletedForEveryone, true);
  assert.equal(deleted.editedAt, edited.editedAt);
});

test('message menu exposes edit only for textual Hub PN messages and delete for complete groups', () => {
  const direct = message('direct', 'texto');
  assert.equal(canEditMessage(direct), true);
  assert.equal(canDeleteMessageForEveryone(direct), true);
  assert.ok(messageMenuActionsFor(direct).includes('edit'));
  assert.ok(messageMenuActionsFor(direct).includes('delete'));

  const group = message('group', 'texto', {
    rawKey: key('120363000000@g.us'),
    metadata: { sentByHub: true, providerKey: key('120363000000@g.us') },
  });
  assert.equal(canEditMessage(group), false);
  assert.equal(canDeleteMessageForEveryone(group), true);
  assert.equal(messageMenuActionsFor(group).includes('edit'), false);
  assert.equal(messageMenuActionsFor(group).includes('delete'), true);
});

test('confirmação do envio mantém a chave explícita para as ações do menu', () => {
  const optimistic = message('client-1', 'texto', {
    metadata: { sentByHub: true, clientMessageId: 'client-1' },
    rawKey: undefined,
    status: 'pending',
  });
  const confirmed = applyOutboundSendConfirmation(optimistic, {
    message: { evolutionMessageId: 'provider-1', status: 'sent', providerKey: key() },
  });

  assert.equal(confirmed.id, 'provider-1');
  assert.deepEqual(confirmed.metadata?.providerKey, key());
  assert.equal(canEditMessage(confirmed), true);
  assert.equal(canDeleteMessageForEveryone(confirmed), true);
});

test('SSE mantém ambas as ações quando a mensagem chega com providerKey completo', () => {
  const optimistic = message('client-sse', 'texto', {
    metadata: { sentByHub: true, clientMessageId: 'client-sse' },
    rawKey: undefined,
    status: 'pending',
  });
  const incoming = message('provider-sse', 'texto', {
    metadata: { sentByHub: true, clientMessageId: 'client-sse', providerKey: key() },
    rawKey: key(),
  });
  const reconciled = reconcileRealtimeMessages([optimistic], optimistic.conversationId, {
    type: 'message.upsert',
    remoteJid: optimistic.conversationId,
    message: incoming,
  });

  assert.equal(reconciled?.length, 1);
  assert.equal(canEditMessage(reconciled![0]), true);
  assert.equal(canDeleteMessageForEveryone(reconciled![0]), true);
});

test('histórico normalizado preserva as duas ações para outbound PN', () => {
  const reloaded = normalizeEvolutionMessage({
    key: key(),
    metadataScope: 'persisted_message',
    metadata: { sentByHub: true, providerKey: key(), sentByUserId: 'user-1', sentByUserName: 'Leo' },
    message: { conversation: '*Leo:*\ntexto' },
    messageTimestamp: 1_700_000_000,
  }, 0, key().remoteJid!, 'Leo');

  assert.equal(canEditMessage(reloaded), true);
  assert.equal(canDeleteMessageForEveryone(reloaded), true);
});

test('inbound, envio externo, apagada e chave parcial não recebem ações destrutivas', () => {
  const inbound = message('inbound', 'texto', {
    sender: 'contact',
    metadata: { providerKey: { ...key(), fromMe: false }, sentByHub: true },
  });
  const external = message('external', 'texto', { metadata: { providerKey: key(), sentByHub: false } });
  const deleted = message('deleted', 'texto', { metadata: { providerKey: key(), sentByHub: true, deletedForEveryone: true } });
  const partial = message('partial', 'texto', { metadata: { sentByHub: true, providerKey: { id: 'BAE5A1', fromMe: true } } });

  for (const candidate of [inbound, external, deleted, partial]) {
    assert.equal(canEditMessage(candidate), false);
    assert.equal(canDeleteMessageForEveryone(candidate), false);
    assert.equal(messageMenuActionsFor(candidate).includes('edit'), false);
    assert.equal(messageMenuActionsFor(candidate).includes('delete'), false);
  }

  const partialResponse = applyOutboundSendConfirmation(
    message('partial-response', 'texto', { metadata: { sentByHub: true }, status: 'pending' }),
    { message: { evolutionMessageId: 'BAE5A1', providerKey: { id: 'BAE5A1' } } },
  );
  assert.equal(partialResponse.metadata?.providerKey, undefined);
  assert.equal(canEditMessage(partialResponse), false);
  assert.equal(canDeleteMessageForEveryone(partialResponse), false);
});

test('LID bloqueia edição, mas exclusão usa a chave LID exata', () => {
  const lid = message('lid', 'texto', {
    metadata: { sentByHub: true, providerKey: key('100000000000001@lid') },
    rawKey: key('100000000000001@lid'),
  });
  assert.equal(canEditMessage(lid), false);
  assert.equal(canDeleteMessageForEveryone(lid), true);
  assert.equal(messageMenuActionsFor(lid).includes('edit'), false);
  assert.equal(messageMenuActionsFor(lid).includes('delete'), true);
});

test('message.updated replaces the same timeline item and never appends an unloaded target', () => {
  const current = [message('same', 'antes')];
  const updatedMessage = message('same', 'depois', { metadata: { ...current[0].metadata, editedAt: '2026-09-08T12:00:00.000Z' } });
  const updated = reconcileRealtimeMessages(current, current[0].conversationId, {
    type: 'message.updated',
    remoteJid: current[0].conversationId,
    message: updatedMessage,
    reason: 'edited',
  });
  assert.equal(updated?.length, 1);
  assert.equal(updated?.[0]?.content, 'depois');
  const unloaded = reconcileRealtimeMessages([], current[0].conversationId, { type: 'message.updated', message: updatedMessage });
  assert.ok(unloaded);
  assert.equal(unloaded?.length, 0);
});

test('message.updated changes only the last-message preview and preserves inbox activity state', () => {
  const current = [conversation({ lastMessageKey: { id: 'same', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true } })];
  const updated = reconcileRealtimeConversation(current, {
    type: 'message.updated',
    remoteJid: current[0].id,
    message: message('same', 'Mensagem apagada', { metadata: { deletedForEveryone: true }, conversationId: current[0].id }),
    reason: 'deleted',
  });
  assert.equal(updated?.[0]?.lastMessage, 'Mensagem apagada');
  assert.equal(updated?.[0]?.lastMessageAt, current[0].lastMessageAt);
  assert.equal(updated?.[0]?.unreadCount, current[0].unreadCount);
});
