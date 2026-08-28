import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseGroupMetadata } from '../server/src/groupMetadata';
import { providerPhoneDigits, providerPhoneJid } from '../server/src/whatsappIdentity';
import { providerDisplayName, providerFallbackDisplayName, providerIdentityKey, providerPhoneDigits as frontendProviderPhoneDigits } from '../src/utils/whatsappIdentity';
import { buildParticipantIdentityMap, enrichRecordsWithParticipantIdentities, participantAliasKeysFromRecord, participantDisplayNameFromSources, participantFallbackNameFromRecord, participantJidFromRecord, participantNameFromRecord, participantPhoneFromRecord } from '../server/src/participantIdentity';
import { qaGroupMetadataRecords, qaGroupParticipantIdentityRecords, qaGroupParticipantRecords, qaIndividualIdentityRecords, qaNewGroupParticipantWebhookRecords } from '../server/src/qa';
import { normalizeEvolutionMessage } from '../src/services/evolutionMessageAdapter';

test('LID identity never becomes a phone number', () => {
  assert.equal(providerPhoneDigits({ remoteJid: '164794086760597@lid' }), '');
  assert.equal(frontendProviderPhoneDigits({ remoteJid: '164794086760597@lid' }), '');
});

test('explicit alternate phone identity resolves a LID conversation', () => {
  const record = {
    remoteJid: '164794086760597@lid',
    remoteJidAlt: '5521997402785@s.whatsapp.net',
  };
  assert.equal(providerPhoneDigits(record), '5521997402785');
  assert.equal(providerPhoneJid(record), '5521997402785@s.whatsapp.net');
  assert.equal(frontendProviderPhoneDigits(record), '5521997402785');
});

test('identity keys are stable and case-insensitive', () => {
  assert.equal(providerIdentityKey('  120363000000@G.US '), '120363000000@g.us');
});

test('group metadata parser normalizes, filters, and deduplicates provider results', () => {
  const groups = parseGroupMetadata({ data: [
    { id: '120363000000@G.US', subject: 'Equipe antiga' },
    { id: 'not-a-group', subject: 'Ignorar' },
    { id: '120363000000@g.us', subject: 'Equipe atual', pictureUrl: 'https://img.test/group.jpg' },
  ] }, 123);
  assert.deepEqual(groups, [{
    groupJid: '120363000000@g.us',
    subject: 'Equipe atual',
    picture: 'https://img.test/group.jpg',
    metadataUpdatedAt: 123,
  }]);
});

test('participant identity keeps LID opaque, rejects numeric names, and enriches history by stable JID', () => {
  const oldRecord = { key: { participant: '123456789@lid' }, metadata: {} };
  const recentRecord = {
    key: { participant: '123456789@LID' },
    pushName: 'Participante QA',
    senderPn: '+5521999999999',
    participantAvatar: 'https://img.test/participant.jpg',
    metadata: {},
  };
  const identities = buildParticipantIdentityMap([oldRecord, recentRecord]);
  assert.equal(identities.size, 1);
  const identity = identities.get('123456789@lid');
  assert.equal(identity?.displayName, 'Participante QA');
  assert.equal(identity?.participantPhone, '5521999999999');
  const enriched = enrichRecordsWithParticipantIdentities([oldRecord, recentRecord], identities);
  assert.equal(enriched[0]?.metadata?.participantName, 'Participante QA');
  assert.equal(enriched[0]?.metadata?.participantJid, '123456789@lid');
  assert.equal(enriched[0]?.metadata?.participantAvatar, 'https://img.test/participant.jpg');
  assert.equal(participantNameFromRecord({ pushName: '5521999999999' }), undefined);
  assert.equal(participantNameFromRecord({ participantName: '5521999999999', pushName: 'Participante QA' }), 'Participante QA');
  assert.equal(participantPhoneFromRecord({ key: { participant: '123456789@lid' } }), undefined);
});

test('explicit LID and phone aliases share one canonical participant identity', () => {
  const records = [
    { key: { participant: 'opaque-2968@lid' }, participantPn: '5521999992968@s.whatsapp.net', metadata: {}, pushName: 'Sidney Lisboa Chaves' },
    { key: { participant: '5521999992968@s.whatsapp.net' }, senderPn: '5521999992968@s.whatsapp.net', metadata: {}, pushName: 'Sidney Lisboa Chaves' },
  ];
  const identities = buildParticipantIdentityMap(records);
  const lidIdentity = identities.get('opaque-2968@lid');
  const phoneIdentity = identities.get('5521999992968@s.whatsapp.net');
  assert.equal(lidIdentity?.canonicalId, 'phone:5521999992968');
  assert.equal(phoneIdentity?.canonicalId, 'phone:5521999992968');
  assert.equal(lidIdentity?.participantPhone, '5521999992968');
  assert.deepEqual(lidIdentity?.aliases, phoneIdentity?.aliases);
  assert.equal(participantAliasKeysFromRecord({ key: { participant: '164794086760597@lid' } }).includes('phone:164794086760597'), false);
});

test('canonical participant fields survive adapter normalization for SSE and polling', () => {
  const message = normalizeEvolutionMessage({
    key: { id: 'canonical-group-message', remoteJid: '120363000000@g.us', participant: 'opaque@lid', fromMe: false },
    participantPn: '5521999992968@s.whatsapp.net',
    participantCanonicalId: 'phone:5521999992968',
    participantAliases: ['jid:opaque@lid', 'phone:5521999992968', 'jid:5521999992968@s.whatsapp.net'],
    participantName: 'Sidney Lisboa Chaves',
    message: { conversation: 'Mensagem canônica' },
    messageTimestamp: 1_000,
  }, 0, '120363000000@g.us', 'Atendente');
  assert.equal(message.metadata?.participantCanonicalId, 'phone:5521999992968');
  assert.equal(message.metadata?.participantName, 'Sidney Lisboa Chaves');
  assert.equal(message.metadata?.participantAliases?.includes('jid:opaque@lid'), true);
});

test('QA group fixture covers PN, LID, retroactive enrichment, and unknown fallback', () => {
  const records = qaGroupParticipantRecords();
  const identities = buildParticipantIdentityMap(records);
  assert.equal(identities.get('5521999000001@s.whatsapp.net')?.displayName, 'Participante A');
  assert.equal(identities.get('222222222@lid')?.participantPhone, '5521999000002');
  assert.equal(identities.get('333333333@lid')?.displayName, 'Participante C');
  assert.equal(identities.get('444444444@lid')?.displayName, undefined);
  const enriched = enrichRecordsWithParticipantIdentities(records, identities);
  assert.equal(enriched[0]?.metadata?.participantName, 'Participante C');
  assert.equal(enriched[0]?.metadata?.participantJid, '333333333@lid');
  assert.equal(enriched[4]?.metadata?.participantName, undefined);
});

test('QA group metadata fixture covers direct picture, lookup fallback and no-picture fallback', () => {
  const groups = parseGroupMetadata(qaGroupMetadataRecords());
  assert.equal(groups.find((group) => group.groupJid === '120363000000@g.us')?.picture?.endsWith('/valid.svg'), true);
  assert.equal(groups.find((group) => group.groupJid === '120363000001@g.us')?.picture, undefined);
  assert.equal(groups.find((group) => group.groupJid === '120363000002@g.us')?.picture, undefined);
});

test('individual identity fallback prefers real names and business metadata', () => {
  assert.equal(providerDisplayName({ pushName: 'Contato', remoteJidAlt: '5521999000001@s.whatsapp.net' }), undefined);
  assert.equal(providerFallbackDisplayName({ pushName: 'Contato', remoteJidAlt: '5521999000001@s.whatsapp.net' }), '+5521999000001');
  assert.equal(providerDisplayName({ verifiedName: 'Empresa QA', pushName: 'Contato' }), 'Empresa QA');
});

test('pushName de uma mensagem outbound não renomeia o destinatário', () => {
  const outboundChat = {
    name: 'Leonardo',
    lastMessage: {
      key: { fromMe: true },
      pushName: 'Fernanda',
    },
  };
  const inboundChat = {
    name: undefined,
    lastMessage: {
      key: { fromMe: false },
      pushName: 'Leonardo',
    },
  };

  assert.equal(providerDisplayName(outboundChat), 'Leonardo');
  assert.equal(providerDisplayName(inboundChat), 'Leonardo');
});

test('individual historical synthetic name is replaced by explicit PN or opaque fallback', () => {
  assert.equal(providerFallbackDisplayName({ savedName: 'Contato', remoteJidAlt: '5521999000002@s.whatsapp.net' }), '+5521999000002');
  assert.equal(providerFallbackDisplayName({ savedName: 'Contato', remoteJid: '444444444@lid' }), 'Participante …4444');
});

test('group participant fallback preserves PN and never converts an opaque LID', () => {
  assert.equal(providerFallbackDisplayName({ metadata: { participantPhone: '5521999000003@s.whatsapp.net', participantJid: '222222222@lid' } }), '+5521999000003');
  assert.equal(providerFallbackDisplayName({ metadata: { participantJid: '333333333@lid' } }), 'Participante …3333');
});

test('QA individual identity fixtures resolve real, PN, business and opaque identities', () => {
  const [realName, phone, historical, business, opaque] = qaIndividualIdentityRecords();
  assert.equal(providerDisplayName(realName), 'Cliente Real QA');
  assert.equal(providerFallbackDisplayName(phone), '+5521999000014');
  assert.equal(providerFallbackDisplayName(historical), '+5521999000015');
  assert.equal(providerDisplayName(business), 'Empresa QA');
  assert.equal(providerFallbackDisplayName(opaque), 'Participante …8888');
});

test('learned identity supersedes a historical synthetic contact name', () => {
  assert.equal(providerDisplayName({ savedName: 'Contato', pushName: 'Nome aprendido QA' }), 'Nome aprendido QA');
});

test('frontend participant display uses canonical participant and sender fields before LID fallback', () => {
  assert.equal(providerDisplayName({ participantName: 'Vitstock', senderName: 'Vitstock', participantJid: '3886962216992@lid' }), 'Vitstock');
  assert.equal(providerDisplayName({ metadata: { participantName: 'Vitstock' }, participantJid: '3886962216992@lid' }), 'Vitstock');
});

test('group participant display priority uses Google, provider, phone and opaque LID fallbacks', () => {
  const [google, whatsapp, phone, lid, historical, historicalGoogle] = qaGroupParticipantIdentityRecords();
  assert.equal(participantDisplayNameFromSources(google), 'Google A');
  assert.equal(participantDisplayNameFromSources(whatsapp), 'WhatsApp B');
  assert.equal(participantDisplayNameFromSources(phone), '+5521999000103');
  assert.equal(participantDisplayNameFromSources(lid), 'Participante …4444');
  assert.equal(participantDisplayNameFromSources(historical), '+5521999000105');
  assert.equal(participantDisplayNameFromSources(historicalGoogle), 'Google F');
});

test('new group webhook identity is available before realtime publication', () => {
  const [withPushName, withSenderPn, unknown, known, withPn] = qaNewGroupParticipantWebhookRecords();
  const identities = buildParticipantIdentityMap([withPushName, withSenderPn, unknown, known, withPn]);
  assert.equal(identities.get('123456992@lid')?.displayName, 'Vitstock');
  assert.equal(identities.get('123456993@lid')?.participantPhone, '5521999000093');
  assert.equal(identities.get('123456994@lid')?.displayName, undefined);
  assert.equal(identities.get('123456995@lid')?.displayName, 'Participante conhecido QA');
  assert.equal(identities.get('5521999000096@s.whatsapp.net')?.participantJid, '5521999000096@s.whatsapp.net');

  const enriched = enrichRecordsWithParticipantIdentities(
    [withPushName, withSenderPn, unknown, known, withPn],
    identities,
  );
  assert.equal(enriched[0]?.metadata?.participantName, 'Vitstock');
  assert.equal(enriched[1]?.metadata?.participantPhone, '5521999000093');
  assert.equal(participantFallbackNameFromRecord(enriched[2]), 'Participante …6994');
  assert.equal(enriched[3]?.metadata?.participantName, 'Participante conhecido QA');
});

test('frontend never treats a technical participant fallback as a real name', () => {
  const message = normalizeEvolutionMessage({
    key: { id: 'qa-fallback', remoteJid: '120363000000@g.us', participant: '123456992@lid', fromMe: false },
    message: { conversation: 'Mensagem QA' },
    metadata: { participantJid: '123456992@lid', participantName: 'Participante …6992' },
    messageTimestamp: 1_000,
  }, 0, '120363000000@g.us', 'Atendente');
  assert.equal(message.metadata?.participantName, undefined);
  assert.equal(message.senderName, 'Participante …6992');
});

test('message ids are never mistaken for participant identities', () => {
  assert.equal(participantJidFromRecord({ id: 'evolution-message-123', message: { conversation: 'Mensagem QA' } }), '');
});
