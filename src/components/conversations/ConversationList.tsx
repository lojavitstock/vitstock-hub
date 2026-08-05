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
      {visibleConversations.map((conversation) => {
        const isSelected = conversation.id === activeConversationId;
        const shouldRespond = needsResponse(conversation);

        return (
          <button
            key={conversation.id}
            type="button"
            onClick={() => onSelectConversation(conversation)}
            title={`${conversation.contact.name} — ${conversation.lastMessage}`}
            aria-label={`Abrir conversa com ${conversation.contact.name}`}
            className={`relative flex min-h-[96px] w-full items-start gap-3 border-b border-[#273239] border-l-4 px-3.5 py-3 text-left transition-all duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300/80 ${
              isSelected
                ? 'border-l-amber-400 bg-[#2d3a40] shadow-[inset_3px_0_0_#EEBB2C]'
                : shouldRespond
                  ? 'border-l-emerald-400 bg-[#20343a] shadow-[inset_3px_0_0_#34d399] hover:bg-[#294147]'
                  : 'border-l-transparent hover:bg-[#222d33]'
            }`}
            aria-current={isSelected ? 'true' : undefined}
          >
            <ContactPhoto name={conversation.contact.name} avatar={conversation.contact.avatar} emphasized={isSelected || shouldRespond} />

            <span className="min-w-0 flex-1">
              <span className="mb-1 flex items-start justify-between gap-2">
                <span className={`truncate text-[13px] leading-5 ${shouldRespond ? 'font-extrabold text-white' : 'font-bold text-slate-100'}`}>
                  {conversation.contact.name}
                </span>
                <span className="shrink-0 pt-0.5 text-[11px] font-semibold tabular-nums text-slate-400">
                  {formatMessageTimestamp(conversation.lastMessageAt, conversation.lastMessageTimestamp)}
                </span>
              </span>

              <span className={`mb-2 block truncate text-[12px] leading-5 ${shouldRespond ? 'font-bold text-slate-200' : 'text-slate-300'}`}>
                {conversation.lastMessage}
              </span>

              <span className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-[#46535a] bg-[#263239] px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-slate-300">
                  {conversation.department}
                </span>
                {conversation.contact.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-4"
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
