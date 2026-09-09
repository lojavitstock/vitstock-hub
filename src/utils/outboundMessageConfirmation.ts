import type { Message } from '../types';

type ProviderMessageKey = NonNullable<NonNullable<Message['metadata']>['providerKey']>;

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

/**
 * The backend only exposes providerKey when the provider returned a complete
 * outbound identity. A partial response may still update the visible id, but
 * it must not become mutation authority in the client.
 */
export const isCompleteOutboundProviderKey = (value: unknown): value is ProviderMessageKey => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const key = value as Record<string, unknown>;
  return isNonEmptyString(key.id)
    && isNonEmptyString(key.remoteJid)
    && key.fromMe === true;
};

const messageIdFromSendResult = (result: any) => {
  const value = result?.message?.evolutionMessageId || result?.message?.id;
  return isNonEmptyString(value) ? value.trim() : undefined;
};

/**
 * Apply an authenticated send response to the optimistic timeline item.
 * Explicit provider identity is copied to metadata; the raw fallback remains
 * display/media-only and cannot enable edit/delete by itself.
 */
export const applyOutboundSendConfirmation = (
  message: Message,
  result: any,
  fallbackRemoteJid = message.conversationId,
): Message => {
  const providerMessageId = messageIdFromSendResult(result);
  const providerKey = isCompleteOutboundProviderKey(result?.message?.providerKey)
    ? result.message.providerKey
    : undefined;

  return {
    ...message,
    id: providerMessageId || message.id,
    status: result?.message?.status || result?.status || 'sent',
    ...(providerMessageId
      ? {
          rawKey: providerKey || {
            id: providerMessageId,
            remoteJid: fallbackRemoteJid,
            fromMe: true,
          },
        }
      : {}),
    ...(providerKey
      ? { metadata: { ...(message.metadata || {}), providerKey } }
      : {}),
  };
};
