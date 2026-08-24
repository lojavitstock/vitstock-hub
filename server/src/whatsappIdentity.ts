/**
 * Provider identity helpers. A LID is an opaque technical identifier and
 * must never be interpreted as a phone number.
 */
export function isWhatsAppLid(value: unknown) {
  return typeof value === 'string' && value.trim().toLowerCase().endsWith('@lid');
}

export function isWhatsAppGroup(value: unknown) {
  return typeof value === 'string' && value.trim().toLowerCase().endsWith('@g.us');
}

export function phoneDigitsFromProviderValues(values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const candidate = value.trim();
    if (!candidate || isWhatsAppLid(candidate) || isWhatsAppGroup(candidate)) continue;
    const digits = (candidate.split('@')[0] || '').replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 20) return digits;
  }
  return '';
}

export function providerPhoneCandidates(value: any) {
  return [
    value?.remoteJidAlt,
    value?.lastMessage?.key?.remoteJidAlt,
    value?.key?.remoteJidAlt,
    value?.senderPn,
    value?.participantPn,
    value?.lastMessage?.key?.senderPn,
    value?.lastMessage?.key?.participantPn,
    value?.key?.senderPn,
    value?.key?.participantPn,
    value?.remoteJid,
    value?.id,
    value?.key?.remoteJid,
  ];
}

export function providerPhoneDigits(value: any) {
  return phoneDigitsFromProviderValues(providerPhoneCandidates(value));
}

export function providerPhoneJid(value: any) {
  const digits = providerPhoneDigits(value);
  return digits ? `${digits}@s.whatsapp.net` : '';
}
