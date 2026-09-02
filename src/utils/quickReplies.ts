import type { QuickReply } from '../types';

export type QuickReplyContext = {
  contactName?: string;
  agentName?: string;
  companyName?: string;
};

export type QuickReplyToken = {
  start: number;
  end: number;
  value: string;
};

export const normalizeQuickReplyShortcut = (value: string) => value.trim().toLocaleLowerCase();

export const filterQuickReplies = (replies: QuickReply[], query: string) => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return replies;
  return replies.filter((reply) => [reply.shortcut, reply.title, reply.body].some((field) => field.toLocaleLowerCase().includes(normalized)));
};

export const resolveQuickReplyBody = (body: string, context: QuickReplyContext = {}) => {
  const contactName = context.contactName?.trim() || '';
  const firstName = contactName.split(/\s+/)[0] || '';
  const values: Record<string, string> = {
    nome: contactName,
    primeiro_nome: firstName,
    atendente: context.agentName?.trim() || 'Atendente',
    empresa: context.companyName?.trim() || 'Vitstock',
  };
  return body.replace(/\{(nome|primeiro_nome|atendente|empresa)\}/gi, (_match, key: string) => values[key.toLocaleLowerCase()] ?? '');
};

export const findQuickReplyToken = (value: string, cursor: number): QuickReplyToken | null => {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  let start = safeCursor;
  while (start > 0 && !/\s/.test(value[start - 1] || '')) start -= 1;
  const token = value.slice(start, safeCursor);
  if (!token.startsWith('/') || /\s/.test(token)) return null;
  return { start, end: safeCursor, value: token };
};

export const insertQuickReplyAtToken = (value: string, token: QuickReplyToken, body: string) => {
  const nextValue = `${value.slice(0, token.start)}${body}${value.slice(token.end)}`;
  return { value: nextValue, cursor: token.start + body.length };
};
