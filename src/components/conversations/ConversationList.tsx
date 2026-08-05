import React from 'react';
import { MessageSquare, Search } from 'lucide-react';
import { Conversation } from '../../types';
import { ContactPhoto } from './ContactPhoto';
import { formatMessageTimestamp } from './conversationFormatters';

type ConversationListProps = {
  conversations: Conversation[];
  visibleConversations: Conversation[];
  activeConversationId: string;
  needsResponse: (conversation: Conversation) => boolean;
  onSelectConversation: (conversation: Conversation) => void;
};

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  visibleConversations,
  activeConversationId,
  needsResponse,
  onSelectConversation,
}) => {
  if (conversations.length === 0) {
    return (
      <div className="space-y-2 p-8 text-center">
        <MessageSquare className="mx-auto h-8 w-8 text-zinc-600" />
        <p className="text-xs font-bold text-zinc-400">Nenhuma conversa encontrada</p>
        <p className="text-[11px] text-zinc-500">Assim que um cliente enviar mensagem no seu WhatsApp, ela aparecerá aqui em tempo real.</p>
      </div>
    );
  }

  if (visibleConversations.length === 0) {
    return (
      <div className="space-y-2 p-8 text-center">
        <Search className="mx-auto h-8 w-8 text-zinc-600" />
        <p className="text-xs font-bold text-zinc-400">Nenhum atendimento corresponde à busca</p>
        <p className="text-[11px] text-zinc-500">Tente outro nome ou número de telefone.</p>
      </div>
    );
  }

  return (
    <>
      {visibleConversations.map((conversation) => {
        const isSelected = conversation.id === activeConversationId;
        const shouldRespond = needsResponse(conversation);

        return (
          <button
            key={conversation.id}
            type="button"
            onClick={() => onSelectConversation(conversation)}
            className={`relative flex w-full items-start gap-3 border-l-4 p-3.5 text-left transition-colors ${
              isSelected
                ? 'border-amber-400 bg-[#2b353b]'
                : shouldRespond
                  ? 'border-emerald-400 bg-[#24383d] hover:bg-[#2a4247]'
                  : 'border-transparent hover:bg-[#222d33]'
            }`}
            aria-current={isSelected ? 'true' : undefined}
          >
            <ContactPhoto name={conversation.contact.name} avatar={conversation.contact.avatar} />

            <span className="min-w-0 flex-1">
              <span className="mb-1 flex items-center justify-between gap-2">
                <span className={`truncate text-xs ${shouldRespond ? 'font-extrabold text-white' : 'font-bold text-zinc-100'}`}>
                  {conversation.contact.name}
                </span>
                <span className="text-[10px] font-semibold text-zinc-500">
                  {formatMessageTimestamp(conversation.lastMessageAt, conversation.lastMessageTimestamp)}
                </span>
              </span>

              <span className={`mb-1.5 block truncate text-xs ${shouldRespond ? 'font-bold text-slate-200' : 'text-zinc-400'}`}>
                {conversation.lastMessage}
              </span>

              <span className="flex flex-wrap items-center gap-1.5">
                <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[9px] font-bold text-zinc-400">
                  {conversation.department}
                </span>
                {conversation.contact.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded px-1.5 py-0.5 text-[9px] font-bold"
                    style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
                  >
                    {tag.name}
                  </span>
                ))}
              </span>
            </span>
          </button>
        );
      })}
    </>
  );
};
