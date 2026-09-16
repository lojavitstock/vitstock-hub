import { isWhatsAppGroup, isWhatsAppLid } from './whatsappIdentity.js';
import { isConversationalProviderJid } from './providerJidPolicy.js';

export type EvolutionRecipientStrategy = 'lid' | 'pn' | 'group';

export type EvolutionRecipient = {
  number: string;
  strategy: EvolutionRecipientStrategy;
};

/**
 * Resolve the provider recipient without ever interpreting an opaque LID as
 * a phone number. Evolution expects the complete @lid JID in `number`.
 * Existing PN and group formats are intentionally preserved.
 */
export function resolveEvolutionRecipient(input: {
  remoteJid?: string | null;
  canonicalPhone?: string | null;
}): EvolutionRecipient {
  const remoteJid = String(input.remoteJid || '').trim();
  const canonicalPhone = String(input.canonicalPhone || '').trim();

  if (isWhatsAppLid(remoteJid)) {
    return { number: remoteJid, strategy: 'lid' };
  }

  if (isWhatsAppGroup(remoteJid)) {
    return { number: remoteJid, strategy: 'group' };
  }

  return {
    number: canonicalPhone || remoteJid,
    strategy: 'pn',
  };
}

export function isValidEvolutionTextRecipient(input: {
  remoteJid?: unknown;
  number?: unknown;
}) {
  if (input.remoteJid !== undefined) {
    return typeof input.remoteJid === 'string' && isConversationalProviderJid(input.remoteJid.trim());
  }
  const number = typeof input.number === 'string' ? input.number.trim() : '';
  return /^\d{8,20}$/.test(number) || isWhatsAppGroup(number);
}

export function resolveEvolutionTextRecipient(input: {
  remoteJid?: string | null;
  number?: string | null;
}): EvolutionRecipient {
  const remoteJid = String(input.remoteJid || '').trim();
  if (remoteJid) return resolveEvolutionRecipient({ remoteJid });

  const number = String(input.number || '').trim();
  return resolveEvolutionRecipient({
    remoteJid: isWhatsAppGroup(number) ? number : undefined,
    canonicalPhone: number,
  });
}
