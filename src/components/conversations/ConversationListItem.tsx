import React, { useEffect, useRef } from 'react';
import { Conversation } from '../../types';
import { ContactPhoto } from './ContactPhoto';
import { formatConversationTimestamp } from './conversationFormatters';
import { stripWhatsAppFormatting } from '../../utils/whatsappFormatting';

type ConversationListItemProps = {
  conversation: Conversation;
  isSelected: boolean;
  isUnread: boolean;
  needsResponse: boolean;
  needsAttention: boolean;
  onSelect: (conversation: Conversation) => void;
  onResolveAvatar?: (conversationId: string) => void | Promise<void>;
};

const tagsAreEqual = (previous: Conversation['contact']['tags'], next: Conversation['contact']['tags']) => (
  previous.length === next.length
  && previous.every((tag, index) => {
    const nextTag = next[index];
    return nextTag?.id === tag.id && nextTag.name === tag.name && nextTag.color === tag.color;
  })
);

const areVisibleFieldsEqual = (previous: Conversation, next: Conversation) => (
  previous.id === next.id
  && previous.contact.name === next.contact.name
  && previous.contact.avatar === next.contact.avatar
  && previous.groupAvatar === next.groupAvatar
  && previous.lastMessage === next.lastMessage
  && previous.lastMessageAt === next.lastMessageAt
  && previous.lastMessageTimestamp === next.lastMessageTimestamp
  && previous.department === next.department
  && tagsAreEqual(previous.contact.tags, next.contact.tags)
);

export const ConversationListItem = React.memo<ConversationListItemProps>(({
  conversation,
  isSelected,
  isUnread,
  needsResponse,
  needsAttention,
  onSelect,
  onResolveAvatar,
}) => {
  const itemRef = useRef<HTMLButtonElement>(null);
  const handleSelect = () => onSelect(conversation);
  const preview = stripWhatsAppFormatting(conversation.lastMessage);

  useEffect(() => {
    if (!onResolveAvatar || conversation.isGroup || conversation.avatarSource === 'whatsapp') return undefined;
    let disposed = false;
    const resolve = () => {
      if (!disposed) void onResolveAvatar(conversation.id);
    };
    if (isSelected) resolve();
    if (typeof IntersectionObserver === 'undefined') {
      resolve();
      return () => { disposed = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) resolve();
    }, { threshold: 0.01 });
    if (itemRef.current) observer.observe(itemRef.current);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [conversation.avatarSource, conversation.contact.avatar, conversation.id, conversation.isGroup, isSelected, onResolveAvatar]);

  return (
    <button
      type="button"
      ref={itemRef}
      onClick={handleSelect}
      title={`${conversation.contact.name} — ${preview}`}
      aria-label={`Abrir conversa com ${conversation.contact.name}`}
      className={`relative flex min-h-[96px] w-full items-start gap-3 border-b border-[#273239] border-l-4 px-3.5 py-3 text-left transition-all duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300/80 ${
        needsAttention
          ? 'animate-attention-pulse border-l-red-400 bg-red-950/30 shadow-[inset_3px_0_0_#ef4444] hover:bg-red-950/45'
            : isSelected
              ? 'border-l-amber-400 bg-[#2d3a40] shadow-[inset_3px_0_0_#EEBB2C]'
            : isUnread
                ? 'border-l-emerald-400 bg-[#20343a] shadow-[inset_3px_0_0_#34d399] hover:bg-[#294147]'
              : 'border-l-transparent hover:bg-[#222d33]'
      }`}
      aria-current={isSelected ? 'true' : undefined}
    >
      <ContactPhoto name={conversation.contact.name} avatar={conversation.isGroup ? (conversation.groupAvatar || conversation.contact.avatar) : conversation.contact.avatar} emphasized={isSelected || needsAttention || isUnread} lazy />

      <span className="min-w-0 flex-1">
        <span className="mb-1 flex items-start justify-between gap-2">
          <span className={`truncate text-[14px] leading-5 ${needsAttention || needsResponse || isUnread ? 'font-extrabold text-white' : 'font-bold text-slate-100'}`}>
            {conversation.contact.name}
          </span>
          <span className="shrink-0 pt-0.5 text-[11px] font-semibold tabular-nums text-slate-400">
            {formatConversationTimestamp(conversation.lastMessageAt, conversation.lastMessageTimestamp)}
          </span>
        </span>

        <span className={`mb-2 block truncate text-[13px] leading-5 ${needsAttention ? 'font-bold text-red-100' : needsResponse ? 'font-bold text-slate-200' : isUnread ? 'font-semibold text-sky-100' : 'text-slate-300'}`}>
          {preview}
        </span>

        <span className="flex flex-wrap items-center gap-1.5">
          {conversation.department !== 'Atendimento Geral' && (
            <span className="rounded-md border border-[#46535a] bg-[#263239] px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-slate-300">
              {conversation.department}
            </span>
          )}
          {needsResponse && (
            <span className="rounded-md border border-emerald-300/25 bg-emerald-300/10 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-emerald-200">
              Não Respondido
            </span>
          )}
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
}, (previous, next) => (
  previous.isSelected === next.isSelected
  && previous.isUnread === next.isUnread
  && previous.needsResponse === next.needsResponse
  && previous.needsAttention === next.needsAttention
  && previous.onSelect === next.onSelect
  && previous.onResolveAvatar === next.onResolveAvatar
  && areVisibleFieldsEqual(previous.conversation, next.conversation)
));

ConversationListItem.displayName = 'ConversationListItem';
