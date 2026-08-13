const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const recordAt = (value: unknown, ...path: string[]) => path.reduce<unknown>((current, key) => (
  current && typeof current === 'object' && !Array.isArray(current)
    ? (current as Record<string, unknown>)[key]
    : undefined
), value);

/**
 * Evolution may wrap the message key differently across sendText/sendMedia
 * responses. This extracts only explicit provider IDs; it never falls back to
 * message content, timestamps, phone numbers or any other heuristic.
 */
export const evolutionMessageIdFromResponse = (payload: unknown) => {
  const candidates = [
    recordAt(payload, 'key', 'id'),
    recordAt(payload, 'message', 'key', 'id'),
    recordAt(payload, 'data', 'key', 'id'),
    recordAt(payload, 'data', 'message', 'key', 'id'),
    recordAt(payload, 'response', 'key', 'id'),
    recordAt(payload, 'response', 'message', 'key', 'id'),
  ];
  return candidates.find((candidate): candidate is string => (
    typeof candidate === 'string' && candidate.trim().length > 0
  ))?.trim();
};

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
