const providerMessageTypes = [
  'conversation', 'extendedTextMessage', 'imageMessage', 'audioMessage', 'videoMessage',
  'documentMessage', 'stickerMessage', 'contactMessage', 'locationMessage', 'reactionMessage',
  'protocolMessage', 'associatedChildMessage', 'interactiveMessage', 'templateMessage',
  'buttonsMessage', 'listMessage', 'pollCreationMessage', 'pollUpdateMessage', 'callLogMessage',
  'call', 'placeholderMessage', 'secretEncryptedMessage', 'senderKeyDistributionMessage',
  'statusMentionMessage', 'deviceSentMessage',
];

export function unwrapProviderMessage(message: any) {
  let current = message || {};
  for (let index = 0; index < 6; index += 1) {
    const nested = current?.ephemeralMessage?.message
      || current?.viewOnceMessage?.message
      || current?.viewOnceMessageV2?.message
      || current?.documentWithCaptionMessage?.message
      || current?.associatedChildMessage?.message
      || current?.editedMessage?.message
      || current?.deviceSentMessage?.message;
    if (!nested) break;
    current = nested;
  }
  return current;
}

export function providerMessageType(record: any, message = unwrapProviderMessage(record?.message)) {
  const explicit = String(record?.messageType || '').trim();
  if (explicit) return explicit;
  return providerMessageTypes.find((type) => message?.[type]) || '';
}

/**
 * These Evolution/Baileys records synchronize encryption keys. They are not
 * user-visible WhatsApp messages and must never become timeline bubbles.
 */
export function isNonRenderableProviderMessage(record: any) {
  const rawMessage = record?.message || {};
  const message = unwrapProviderMessage(rawMessage);
  const type = providerMessageType(record, message);
  return type === 'secretEncryptedMessage'
    || type === 'senderKeyDistributionMessage'
    || Boolean(rawMessage?.deviceSentMessage && !rawMessage.deviceSentMessage?.message);
}
