import React from 'react';
import { parseWhatsAppFormatting, type WhatsAppFormattingToken } from '../../utils/whatsappFormatting';

const renderToken = (token: WhatsAppFormattingToken, index: number): React.ReactNode => {
  if (token.type === 'text') return <React.Fragment key={index}>{token.value}</React.Fragment>;
  if (token.type === 'monospace') return <code key={index} className="rounded bg-black/20 px-1 font-mono">{token.value}</code>;
  const children = (token.children || parseWhatsAppFormatting(token.value)).map(renderToken);
  if (token.type === 'bold') return <strong key={index}>{children}</strong>;
  if (token.type === 'italic') return <em key={index}>{children}</em>;
  return <del key={index}>{children}</del>;
};

/** Renders only the native WhatsApp formatting subset as React nodes. */
export const WhatsAppFormattedText: React.FC<{ text: string }> = ({ text }) => (
  <>{parseWhatsAppFormatting(text).map(renderToken)}</>
);
