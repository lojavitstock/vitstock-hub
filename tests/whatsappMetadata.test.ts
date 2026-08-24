import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseGroupMetadata } from '../server/src/groupMetadata';
import { providerPhoneDigits, providerPhoneJid } from '../server/src/whatsappIdentity';
import { providerDisplayName, providerFallbackDisplayName, providerIdentityKey, providerPhoneDigits as frontendProviderPhoneDigits } from '../src/utils/whatsappIdentity';
import { buildParticipantIdentityMap, enrichRecordsWithParticipantIdentities, participantDisplayNameFromSources, participantNameFromRecord, participantPhoneFromRecord } from '../server/src/participantIdentity';
import { qaGroupMetadataRecords, qaGroupParticipantIdentityRecords, qaGroupParticipantRecords, qaIndividualIdentityRecords } from '../server/src/qa';

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

test('group participant display priority uses Google, provider, phone and opaque LID fallbacks', () => {
  const [google, whatsapp, phone, lid, historical, historicalGoogle] = qaGroupParticipantIdentityRecords();
  assert.equal(participantDisplayNameFromSources(google), 'Google A');
  assert.equal(participantDisplayNameFromSources(whatsapp), 'WhatsApp B');
  assert.equal(participantDisplayNameFromSources(phone), '+5521999000103');
  assert.equal(participantDisplayNameFromSources(lid), 'Participante …4444');
  assert.equal(participantDisplayNameFromSources(historical), '+5521999000105');
  assert.equal(participantDisplayNameFromSources(historicalGoogle), 'Google F');
});
