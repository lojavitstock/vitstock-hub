import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseGroupMetadata } from '../server/src/groupMetadata';
import { providerPhoneDigits, providerPhoneJid } from '../server/src/whatsappIdentity';
import { providerIdentityKey, providerPhoneDigits as frontendProviderPhoneDigits } from '../src/utils/whatsappIdentity';

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
    { id: '120363000000@g.us', subject: 'Equipe antiga' },
    { id: 'not-a-group', subject: 'Ignorar' },
    { id: '120363000000@g.us', subject: 'Equipe atual', profilePicUrl: 'https://img.test/group.jpg' },
  ] }, 123);
  assert.deepEqual(groups, [{
    groupJid: '120363000000@g.us',
    subject: 'Equipe atual',
    picture: 'https://img.test/group.jpg',
    metadataUpdatedAt: 123,
  }]);
});
