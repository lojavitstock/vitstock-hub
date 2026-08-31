import { isWhatsAppGroup, isWhatsAppLid } from './whatsappIdentity.js';

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
