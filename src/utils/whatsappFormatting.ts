export type WhatsAppFormattingType = 'text' | 'bold' | 'italic' | 'strikethrough' | 'monospace';

export type WhatsAppFormattingToken = {
  type: WhatsAppFormattingType;
  value: string;
  children?: WhatsAppFormattingToken[];
};

const isWordCharacter = (value: string | undefined) => Boolean(value && /[\p{L}\p{N}]/u.test(value));

const canOpenDelimiter = (text: string, index: number, delimiter: '*' | '_' | '~') => {
  const next = text[index + delimiter.length];
  if (!next || /\s/.test(next)) return false;
  // Underscores inside words/URLs are literal characters, not italics.
  if (delimiter === '_' && isWordCharacter(text[index - 1]) && isWordCharacter(next)) return false;
  return true;
};

const canCloseDelimiter = (text: string, index: number, delimiter: '*' | '_' | '~') => {
  const previous = text[index - 1];
  if (!previous || /\s/.test(previous)) return false;
  if (delimiter === '_' && isWordCharacter(previous) && isWordCharacter(text[index + delimiter.length])) return false;
  return true;
};

const validInnerText = (value: string) => value.length > 0 && value.trim() === value;

const findClosingDelimiter = (text: string, delimiter: string, start: number) => {
  let index = start;
  while (index < text.length) {
    const found = text.indexOf(delimiter, index);
    if (found < 0) return -1;
    if (canCloseDelimiter(text, found, delimiter as '*' | '_' | '~')) return found;
    index = found + delimiter.length;
  }
  return -1;
};

const parseSegment = (text: string): WhatsAppFormattingToken[] => {
  const tokens: WhatsAppFormattingToken[] = [];
  let plain = '';
  const flushPlain = () => {
    if (plain) {
      tokens.push({ type: 'text', value: plain });
      plain = '';
    }
  };

  for (let index = 0; index < text.length;) {
    if (text.startsWith('```', index)) {
      const closing = text.indexOf('```', index + 3);
      if (closing >= 0) {
        const value = text.slice(index + 3, closing);
        if (validInnerText(value)) {
          flushPlain();
          tokens.push({ type: 'monospace', value });
          index = closing + 3;
          continue;
        }
      }
    }

    const delimiter = text[index] as '*' | '_' | '~';
    if ((delimiter === '*' || delimiter === '_' || delimiter === '~') && canOpenDelimiter(text, index, delimiter)) {
      const closing = findClosingDelimiter(text, delimiter, index + 1);
      if (closing >= 0) {
        const value = text.slice(index + 1, closing);
        if (validInnerText(value)) {
          flushPlain();
          const type: WhatsAppFormattingType = delimiter === '*' ? 'bold' : delimiter === '_' ? 'italic' : 'strikethrough';
          tokens.push({ type, value, children: parseSegment(value) });
          index = closing + 1;
          continue;
        }
      }
    }

    plain += text[index];
    index += 1;
  }
  flushPlain();
  return tokens;
};

/** Tokenizes the small, native WhatsApp formatting subset used by the Hub. */
export const parseWhatsAppFormatting = (text: string): WhatsAppFormattingToken[] => parseSegment(text || '');

const stripTokens = (tokens: WhatsAppFormattingToken[]): string => tokens.map((token) => (
  token.type === 'text' || token.type === 'monospace'
    ? token.value
    : stripTokens(token.children || parseSegment(token.value))
)).join('');

/** Removes WhatsApp formatting markers for compact previews and search. */
export const stripWhatsAppFormatting = (text: string) => stripTokens(parseWhatsAppFormatting(text || ''));
