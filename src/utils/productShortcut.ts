import type { QuickReplyToken } from './quickReplies';

export function findProductToken(value: string, cursor: number): QuickReplyToken | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const match = /(?:^|\s)(\\[^\\\n\r]*)$/.exec(value.slice(0, safeCursor));
  if (!match) return null;
  const token = match[1]!;
  return { start: safeCursor - token.length, end: safeCursor, value: token };
}
