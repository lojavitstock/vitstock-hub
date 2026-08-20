import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  isEvolutionReactionEvent,
  isWhatsAppGroupJid,
  normalizeEvolutionMessage,
} from '../src/services/evolutionMessageAdapter';
import { reconcileConversations } from '../src/utils/conversationReconciliation';
import { reconcileRealtimeConversation, reconcileRealtimeMessages } from '../src/utils/realtimeUpdates';
import { applyProviderReaction, providerReactionUpdate } from '../server/src/messageReactions';
import type { Conversation, Message } from '../src/types';

const groupJid = '120363012345678901@g.us';
const participantJid = '5521999999999@s.whatsapp.net';
const group = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: groupJid,
  isGroup: true,
  groupName: 'Equipe',
  contact: { id: groupJid, name: 'Equipe', phone: groupJid, tags: [], createdAt: '2026-08-13' },
  lastMessage: 'Maria: Mensagem',
  lastMessageTimestamp: '10:00',
  lastMessageAt: 1_000,
  lastMessageFromMe: false,
  unreadCount: 0,
  needsResponse: false,
  status: 'open',
  department: 'Atendimento Geral',
  ...overrides,
});
const groupMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'group-message', conversationId: groupJid, sender: 'contact', senderName: 'Maria', content: 'Oi',
  timestamp: '10:00', timestampMs: 2_000, status: 'read', rawKey: { id: 'group-message', remoteJid: groupJid, participant: participantJid }, ...overrides,
});

test('group jid detection accepts g.us', () => assert.equal(isWhatsAppGroupJid(groupJid), true));
test('group jid detection rejects phone jid', () => assert.equal(isWhatsAppGroupJid('5521999999999@s.whatsapp.net'), false));
test('group jid detection rejects lid', () => assert.equal(isWhatsAppGroupJid('12345@lid'), false));
test('group inbound keeps conversation jid', () => {
  const message = normalizeEvolutionMessage({ key: { id: '1', remoteJid: groupJid, participant: participantJid }, pushName: 'Maria', message: { conversation: 'Oi' } }, 0, groupJid, 'Atendente');
  assert.equal(message.conversationId, groupJid);
});
test('group inbound shows participant name', () => {
  const message = normalizeEvolutionMessage({ key: { id: '1', remoteJid: groupJid, participant: participantJid }, pushName: 'Maria', message: { conversation: 'Oi' } }, 0, groupJid, 'Atendente');
  assert.equal(message.senderName, 'Maria');
});
test('group inbound stores participant jid metadata', () => {
  const message = normalizeEvolutionMessage({ key: { id: '1', remoteJid: groupJid, participant: participantJid }, pushName: 'Maria', message: { conversation: 'Oi' } }, 0, groupJid, 'Atendente');
  assert.equal(message.metadata?.participantJid, participantJid);
});
test('group raw key preserves participant', () => {
  const message = normalizeEvolutionMessage({ key: { id: '1', remoteJid: groupJid, participant: participantJid }, pushName: 'Maria', message: { conversation: 'Oi' } }, 0, groupJid, 'Atendente');
  assert.equal(message.rawKey.participant, participantJid);
});
test('group quoted message preserves participant', () => {
  const message = normalizeEvolutionMessage({ key: { id: '1', remoteJid: groupJid, participant: participantJid }, pushName: 'Maria', message: { extendedTextMessage: { text: 'reply', contextInfo: { stanzaId: 'original', participant: participantJid, quotedMessage: { conversation: 'old' } } } } }, 0, groupJid, 'Atendente');
  assert.equal(message.metadata?.quotedMessage?.key?.participant, participantJid);
});
test('group outbound remains attendant', () => {
  const message = normalizeEvolutionMessage({ key: { id: '1', remoteJid: groupJid, fromMe: true }, message: { conversation: 'sent' }, metadata: { sentByHub: true, sentByUserName: 'Leo' }, metadataScope: 'persisted_message' }, 0, groupJid, 'Atendente');
  assert.equal(message.sender, 'attendant');
  assert.equal(message.senderName, 'Leo');
});
test('group media preserves participant', () => {
  const message = normalizeEvolutionMessage({ key: { id: '1', remoteJid: groupJid, participant: participantJid }, pushName: 'Maria', message: { imageMessage: { caption: 'foto' } } }, 0, groupJid, 'Atendente');
  assert.equal(message.mediaType, 'image');
  assert.equal(message.senderName, 'Maria');
});
test('group reaction is metadata event', () => {
  const record = { key: { id: 'r', remoteJid: groupJid, participant: participantJid }, message: { reactionMessage: { key: { id: 'm', remoteJid: groupJid }, text: 'like' } } };
  assert.equal(isEvolutionReactionEvent(record), true);
});
test('group reaction targets original jid', () => {
  const update = providerReactionUpdate({ key: { id: 'r', remoteJid: groupJid, participant: participantJid }, message: { reactionMessage: { key: { id: 'm', remoteJid: groupJid }, text: 'like' } } });
  assert.equal(update?.targetRemoteJid, groupJid);
});
test('group reaction canonicalizes participant', () => {
  const update = providerReactionUpdate({ key: { id: 'r', participant: '5521999999999@c.us' }, message: { reactionMessage: { key: { id: 'm' }, text: 'like' } } });
  assert.equal(update?.reactorKey, 'jid:5521999999999');
});
test('group reactions keep distinct participants', () => {
  const first = providerReactionUpdate({ key: { participant: participantJid }, message: { reactionMessage: { key: { id: 'm' }, text: 'a' } } })!;
  const second = providerReactionUpdate({ key: { participant: '5521988888888@s.whatsapp.net' }, message: { reactionMessage: { key: { id: 'm' }, text: 'b' } } })!;
  const result = applyProviderReaction(applyProviderReaction([], first), second);
  assert.equal(result.length, 2);
});
test('group participant can replace reaction', () => {
  const result = applyProviderReaction([{ emoji: 'a', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', updatedAt: 1 }], { targetMessageId: 'm', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', emoji: 'b', fromMe: false, updatedAt: 2 });
  assert.equal(result[0]?.emoji, 'b');
});
test('group reaction removal removes participant only', () => {
  const result = applyProviderReaction([{ emoji: 'a', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', updatedAt: 1 }], { targetMessageId: 'm', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', emoji: '', fromMe: false, updatedAt: 2 });
  assert.equal(result.length, 0);
});
test('stale group reaction cannot regress state', () => {
  const result = applyProviderReaction([{ emoji: 'new', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', updatedAt: 20 }], { targetMessageId: 'm', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', emoji: 'old', fromMe: false, updatedAt: 10 });
  assert.equal(result[0]?.emoji, 'new');
});
test('group inbound realtime prefixes participant preview', () => {
  const result = reconcileRealtimeConversation([group()], { type: 'message.upsert', remoteJid: groupJid, message: groupMessage({ timestampMs: 3_000 }) });
  assert.equal(result?.[0]?.lastMessage, 'Maria: Oi');
});
test('group outbound realtime prefixes attendant preview', () => {
  const result = reconcileRealtimeConversation([group()], { type: 'message.upsert', remoteJid: groupJid, message: groupMessage({ sender: 'attendant', senderName: 'Leo', content: 'Aviso', timestampMs: 3_000 }) });
  assert.equal(result?.[0]?.lastMessage, 'Leo: Aviso');
});
test('group inbound realtime increments unread and needs response', () => {
  const result = reconcileRealtimeConversation([group()], { type: 'message.upsert', remoteJid: groupJid, message: groupMessage({ timestampMs: 3_000 }) });
  assert.equal(result?.[0]?.unreadCount, 1);
  assert.equal(result?.[0]?.needsResponse, true);
});
test('group inbound realtime reorders by real message timestamp', () => {
  const result = reconcileRealtimeConversation([group({ id: 'other' }), group()], { type: 'message.upsert', remoteJid: groupJid, message: groupMessage({ timestampMs: 3_000 }) });
  assert.equal(result?.[0]?.id, groupJid);
});
test('group reaction keeps inbox activity unchanged', () => {
  const current = [group({ lastMessage: 'Maria: Oi', lastMessageAt: 2_000, unreadCount: 2, needsResponse: true })];
  const result = reconcileRealtimeConversation(current, { type: 'message.upsert', reaction: true, remoteJid: groupJid, message: groupMessage({ timestampMs: 9_000, metadata: { reactions: [{ emoji: 'a', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', updatedAt: 9_000 }] } }) });
  assert.equal(result, current);
});
test('group identity fields are structurally reconciled', () => {
  const current = group({ groupAvatar: '/group.png' });
  assert.equal(reconcileConversations([current], [{ ...current }])[0], current);
});
test('group reaction does not add a timeline item', () => {
  const current = [groupMessage()];
  const result = reconcileRealtimeMessages(current, groupJid, { type: 'message.upsert', reaction: true, remoteJid: groupJid, message: groupMessage({ metadata: { reactions: [{ emoji: 'a', reactorKey: 'jid:5521999999999', actorId: 'jid:5521999999999', updatedAt: 2_000 }] } }) });
  assert.equal(result?.length, 1);
});
