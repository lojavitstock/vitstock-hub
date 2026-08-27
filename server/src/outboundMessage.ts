const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const recordAt = (value: unknown, ...path: string[]) => path.reduce<unknown>((current, key) => (
  Array.isArray(current)
    ? current[Number(key)]
    : current && typeof current === 'object'
      ? (current as Record<string, unknown>)[key]
      : undefined
), value);

type EvolutionMessageReference = { messageId: string; sourcePath: string };

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

const isSendStatus = (value: unknown) => (
  ['PENDING', 'SENT', 'SUCCESS', 'OK', 'DELIVERED', 'READ'].includes(String(value || '').trim().toUpperCase())
);

const hasNonMessageEnvelopeMarker = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ['instance', 'instanceName', 'resource', 'resourceName', 'name'].some((key) => nonEmptyString(record[key]));
};

/**
 * Evolution may wrap the message key differently across sendText/sendMedia
 * responses. This extracts only explicit provider IDs; it never falls back to
 * message content, timestamps, phone numbers or any other heuristic.
 *
 * Generic `id` fields are accepted only inside an envelope that proves it is a
 * message response (send status or a message key). This prevents instance,
 * request and resource IDs from being mistaken for message IDs.
 */
export const evolutionMessageReferenceFromResponse = (payload: unknown): EvolutionMessageReference | undefined => {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
  if (!root) return undefined;

  const candidates: Array<{ value: unknown; sourcePath: string; explicit: boolean }> = [
    { value: recordAt(root, 'key', 'id'), sourcePath: 'key.id', explicit: true },
    { value: recordAt(root, 'message', 'key', 'id'), sourcePath: 'message.key.id', explicit: true },
    { value: recordAt(root, 'data', 'key', 'id'), sourcePath: 'data.key.id', explicit: true },
    { value: recordAt(root, 'data', 'message', 'key', 'id'), sourcePath: 'data.message.key.id', explicit: true },
    { value: recordAt(root, 'response', 'key', 'id'), sourcePath: 'response.key.id', explicit: true },
    { value: recordAt(root, 'response', 'message', 'key', 'id'), sourcePath: 'response.message.key.id', explicit: true },
    { value: recordAt(root, 'messages', '0', 'key', 'id'), sourcePath: 'messages[0].key.id', explicit: true },
    { value: recordAt(root, 'messageId'), sourcePath: 'messageId', explicit: true },
    { value: recordAt(root, 'data', 'messageId'), sourcePath: 'data.messageId', explicit: true },
    { value: recordAt(root, 'id'), sourcePath: 'id', explicit: false },
    { value: recordAt(root, 'data', 'id'), sourcePath: 'data.id', explicit: false },
  ];

  for (const candidate of candidates) {
    if (!nonEmptyString(candidate.value)) continue;
    if (candidate.explicit) return { messageId: candidate.value.trim(), sourcePath: candidate.sourcePath };

    const envelope = candidate.sourcePath === 'id' ? root : recordAt(root, 'data');
    if (hasNonMessageEnvelopeMarker(envelope)) continue;
    const hasMessageKey = Boolean(recordAt(envelope, 'key', 'id') || recordAt(envelope, 'message', 'key', 'id'));
    const hasSendStatus = isSendStatus(recordAt(envelope, 'status')) || isSendStatus(root.status);
    if (hasMessageKey || hasSendStatus) return { messageId: candidate.value.trim(), sourcePath: candidate.sourcePath };
  }
  return undefined;
};

export const evolutionMessageIdFromResponse = (payload: unknown) => (
  evolutionMessageReferenceFromResponse(payload)?.messageId
);

/** The Evolution payload retains the human-readable sender signature. */
export const formatHubOutboundText = (authorName: string, content: string) => {
  const author = authorName.trim();
  return author ? `*${author}*\n${content}` : content;
};

/** Removes only the server-generated leading signature from a Hub message. */
export const removeHubAgentPrefix = (content: string, authorName?: string) => {
  const author = authorName?.trim();
  if (!author) return content;
  return content.replace(new RegExp(`^\\*${escapeRegExp(author)}\\*\\r?\\n`), '');
};

/** Uses the exact provider key; no message text or timestamp is involved. */
export const evolutionReactionPayload = (
  key: { id: string; remoteJid: string; fromMe: boolean },
  reaction: string,
) => ({ key, reaction });
