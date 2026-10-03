import React, { createContext, useContext, useRef } from 'react';
import type { Message } from '../../types';
import type { AttachmentDraft } from '../../utils/composerAttachment';

type ProductReturnState = {
  conversationId: string;
  drafts: Map<string, string>;
  attachments: Omit<AttachmentDraft, 'previewUrl'>[];
  isInternalNote: boolean;
  replyTo: Message | null;
};

const ProductReturnContext = createContext<React.MutableRefObject<ProductReturnState | null> | null>(null);

// Only the product-creation detour retains drafts; logout/reload releases them.
export const ProductReturnProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const state = useRef<ProductReturnState | null>(null);
  return <ProductReturnContext.Provider value={state}>{children}</ProductReturnContext.Provider>;
};

export function useProductReturnState() {
  const state = useContext(ProductReturnContext);
  if (!state) throw new Error('ProductReturnProvider ausente');
  return state;
}
