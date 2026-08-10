import React from 'react';
import { MessageSquare, Search } from 'lucide-react';
import { Conversation } from '../../types';
import { ConversationListItem } from './ConversationListItem';

type ConversationListProps = {
  conversations: Conversation[];
  visibleConversations: Conversation[];
  activeConversationId: string;
  needsResponse: (conversation: Conversation) => boolean;
  needsAttention: (conversation: Conversation) => boolean;
  onSelectConversation: (conversation: Conversation) => void;
};

export const ConversationList = React.memo<ConversationListProps>(
  ({
  conversations,
  visibleConversations,
  activeConversationId,
  needsResponse,
  needsAttention,
  onSelectConversation,
}) => {
  if (conversations.length === 0) {
    return (
      <div className="mx-4 my-6 rounded-2xl border border-dashed border-[#3a474e] bg-[#1b252a] px-5 py-10 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#263239] text-amber-300">
          <MessageSquare className="h-5 w-5" />
        </span>
        <p className="text-[13px] font-bold text-slate-200">Nenhuma conversa encontrada</p>
        <p className="mt-1.5 text-[11px] leading-5 text-slate-400">Assim que um cliente enviar mensagem no seu WhatsApp, ela aparecerá aqui em tempo real.</p>
      </div>
    );
  }

  if (visibleConversations.length === 0) {
    return (
      <div className="mx-4 my-6 rounded-2xl border border-dashed border-[#3a474e] bg-[#1b252a] px-5 py-10 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#263239] text-slate-300">
          <Search className="h-5 w-5" />
        </span>
        <p className="text-[13px] font-bold text-slate-200">Nenhum atendimento corresponde à busca</p>
        <p className="mt-1.5 text-[11px] leading-5 text-slate-400">Tente outro nome ou número de telefone.</p>
      </div>
    );
  }

  return (
    <>
      {visibleConversations.map((conversation) => (
        <ConversationListItem
          key={conversation.id}
          conversation={conversation}
          isSelected={conversation.id === activeConversationId}
          needsResponse={needsResponse(conversation)}
          needsAttention={needsAttention(conversation)}
          onSelect={onSelectConversation}
        />
      ))}
    </>
  );
});
