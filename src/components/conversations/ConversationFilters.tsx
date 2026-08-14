import React from 'react';
import { Archive } from 'lucide-react';
import { Conversation } from '../../types';

export type ConversationFilter = 'all' | 'unread' | 'unanswered' | 'groups' | 'delivery' | 'resolved';

type ConversationFiltersProps = {
  conversations: Conversation[];
  activeFilter: ConversationFilter;
  onFilterChange: (filter: ConversationFilter) => void;
  needsResponse: (conversation: Conversation) => boolean;
};

const FILTERS: Array<{ id: ConversationFilter; label: string; width: string }> = [
  { id: 'all', label: 'Todos', width: 'col-span-3' },
  { id: 'unread', label: 'Não lidas', width: 'col-span-3' },
  { id: 'unanswered', label: 'Não respondidas', width: 'col-span-3' },
  { id: 'groups', label: 'Grupos', width: 'col-span-2' },
  { id: 'delivery', label: 'Entregas', width: 'col-span-1' },
  { id: 'resolved', label: 'Resolvidas', width: 'col-span-1' },
];

export const ConversationFilters = React.memo<ConversationFiltersProps>(({
  conversations,
  activeFilter,
  onFilterChange,
  needsResponse,
}) => {
  const counts = React.useMemo(() => conversations.reduce<Record<ConversationFilter, number>>((result, conversation) => {
    if (conversation.unreadCount > 0) result.unread += 1;
    if (needsResponse(conversation)) result.unanswered += 1;
    if (conversation.isGroup) result.groups += 1;
    if (conversation.status === 'pending') result.delivery += 1;
    if (conversation.status === 'resolved') result.resolved += 1;
    return result;
  }, {
    all: conversations.length,
    unread: 0,
    unanswered: 0,
    groups: 0,
    delivery: 0,
    resolved: 0,
  }), [conversations, needsResponse]);

  return (
  <div className="grid grid-cols-8 gap-1.5 rounded-xl border border-[#3a474e] bg-[#141d22] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_8px_24px_rgba(0,0,0,0.14)]">
    {FILTERS.map(({ id, label, width }) => {
      const count = counts[id];
      const isActive = activeFilter === id;
      const isResolved = id === 'resolved';
      const effectiveWidth = id === 'all' || id === 'unread'
        ? 'col-span-2'
        : 'col-span-1';

      return (
        <button
          key={id}
          type="button"
          onClick={() => onFilterChange(id)}
          title={isResolved ? `${label}: ${count}` : undefined}
          aria-label={`${label}: ${count}`}
          aria-pressed={isActive}
          className={`${effectiveWidth || width} group relative flex h-10 min-w-0 items-center overflow-hidden rounded-lg border ${isResolved ? 'justify-center pl-2 pr-6' : 'justify-start pl-2.5 pr-8'} text-[11px] font-semibold tracking-[-0.01em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80 ${
            isActive
              ? 'border-amber-300/80 bg-gradient-to-b from-amber-300 to-amber-400 text-[#17130a] shadow-[0_4px_14px_rgba(251,191,36,0.18),inset_0_1px_0_rgba(255,255,255,0.55)]'
              : 'border-transparent bg-[#1b252a] text-slate-300 hover:border-[#46545c] hover:bg-[#222e34] hover:text-white'
          }`}
        >
          {isResolved ? (
            <Archive className="h-[17px] w-[17px] shrink-0" strokeWidth={2} aria-hidden="true" />
          ) : (
            <span className="truncate whitespace-nowrap">{label}</span>
          )}
          <span className={`inline-flex shrink-0 items-center justify-center rounded-md border font-extrabold leading-none tabular-nums ${
            isResolved
              ? 'absolute right-1 top-1 h-4 min-w-4 px-1 text-[9px]'
              : 'absolute right-1.5 top-1/2 h-5 min-w-6 -translate-y-1/2 px-1.5 text-[10px]'
          } ${
            isActive
              ? 'border-[#17130a]/15 bg-[#17130a] text-amber-300'
              : 'border-[#3b484f] bg-[#263239] text-slate-200 group-hover:border-[#52616a]'
          }`}>
            {count}
          </span>
        </button>
      );
    })}
  </div>
  );
});

ConversationFilters.displayName = 'ConversationFilters';
