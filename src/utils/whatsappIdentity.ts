export type ProviderIdentityInput = {
  remoteJid?: unknown;
  remoteJidAlt?: unknown;
  senderPn?: unknown;
  participantPn?: unknown;
  key?: {
    remoteJid?: unknown;
    remoteJidAlt?: unknown;
    senderPn?: unknown;
    participantPn?: unknown;
  };
  lastMessage?: ProviderIdentityInput;
};

export function isWhatsAppLid(value: unknown) {
  return typeof value === 'string' && value.trim().toLowerCase().endsWith('@lid');
}

export function providerPhoneDigits(input: ProviderIdentityInput) {
  const values = [
    input.remoteJidAlt,
    input.lastMessage?.key?.remoteJidAlt,
    input.key?.remoteJidAlt,
    input.senderPn,
    input.participantPn,
    input.lastMessage?.key?.senderPn,
    input.lastMessage?.key?.participantPn,
    input.key?.senderPn,
    input.key?.participantPn,
    input.remoteJid,
    input.lastMessage?.remoteJid,
    input.lastMessage?.key?.remoteJid,
    input.key?.remoteJid,
  ];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const candidate = value.trim();
    if (!candidate || isWhatsAppLid(candidate) || candidate.toLowerCase().endsWith('@g.us')) continue;
    const digits = candidate.split('@')[0].replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 20) return digits;
  }
  return '';
}

export function providerIdentityKey(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
