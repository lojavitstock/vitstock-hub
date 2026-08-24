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
  metadata?: {
    participantPhone?: unknown;
    participantJid?: unknown;
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
    input.metadata?.participantPhone,
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

export function isSyntheticDisplayName(value: unknown) {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  return name === 'Contato' || name === 'Participante' || /^Participante …\S+$/.test(name);
}

const usableDisplayName = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (!name || isSyntheticDisplayName(name) || ['Você', 'WhatsApp Business'].includes(name) || /^\+?[\d\s().-]+$/.test(name)) return undefined;
  return name;
};

export function providerDisplayName(input: any, preferred: unknown[] = []) {
  const candidates = [
    ...preferred,
    input?.identityName,
    input?.savedName,
    input?.contactName,
    input?.name,
    input?.pushName,
    input?.notify,
    input?.verifiedName,
    input?.businessName,
    input?.lastMessage?.participantName,
    input?.lastMessage?.pushName,
    input?.lastMessage?.notify,
    input?.lastMessage?.verifiedName,
  ];
  return candidates.map(usableDisplayName).find(Boolean);
}

export function providerFallbackDisplayName(input: any, explicitPhone = '') {
  const knownName = providerDisplayName(input);
  if (knownName) return knownName;

  const phone = explicitPhone || providerPhoneDigits(input);
  if (phone) return `+${phone}`;

  const jid = [
    input?.remoteJid,
    input?.id,
    input?.participant,
    input?.metadata?.participantJid,
    input?.lastMessage?.key?.remoteJid,
    input?.key?.remoteJid,
  ]
    .find((value) => typeof value === 'string' && value.trim());
  if (typeof jid === 'string') {
    const value = jid.trim().split('@')[0];
    if (jid.trim().toLowerCase().endsWith('@lid') && value.length > 4) return `Participante …${value.slice(-4)}`;
  }
  return 'Participante';
}
