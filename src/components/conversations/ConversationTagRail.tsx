import React, { useRef, useState } from 'react';
import { Plus, Tag as TagIcon } from 'lucide-react';
import type { Conversation, Tag } from '../../types';
import { conversationTagCount, type ConversationFilter } from '../../utils/conversationTagFilters';

type Props = {
  conversations: Conversation[];
  tags: Tag[];
  activeFilter: ConversationFilter;
  onFilterChange: (filter: ConversationFilter) => void;
  onCreateTag: (name: string, color: string) => Promise<void>;
  needsResponse?: (conversation: Conversation) => boolean;
};

const COLORS = ['#EABB19', '#3B82F6', '#10B981', '#F97316', '#A78BFA', '#EC4899', '#14B8A6', '#64748B', '#EF4444', '#84CC16'];

export const ConversationTagRail: React.FC<Props> = ({ conversations, tags, activeFilter, onFilterChange, onCreateTag, needsResponse }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, moved: false, startX: 0, startScroll: 0 });
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);

  const select = (filter: ConversationFilter) => {
    if (dragRef.current.moved) return;
    onFilterChange(filter);
  };
  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return;
    dragRef.current = { active: true, moved: false, startX: event.clientX, startScroll: scrollRef.current.scrollLeft };
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || !scrollRef.current) return;
    const delta = event.clientX - dragRef.current.startX;
    if (Math.abs(delta) > 4 && !dragRef.current.moved) {
      dragRef.current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    scrollRef.current.scrollLeft = dragRef.current.startScroll - delta;
  };
  const endDrag = () => { dragRef.current.active = false; window.setTimeout(() => { dragRef.current.moved = false; }, 0); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await onCreateTag(name.trim(), color);
    setName('');
    setCreateOpen(false);
  };
  const trafficTag = tags.find((tag) => tag.systemKey === 'traffic');
  const customTags = tags.filter((tag) => tag.systemKey !== 'traffic');
  const responsePredicate = needsResponse ?? ((conversation: Conversation) => conversation.needsResponse || (!conversation.lastMessageFromMe && conversation.status !== 'resolved'));
  const pill = (filter: ConversationFilter, label: string, count?: number, colorValue?: string) => (
    <button key={filter} type="button" onClick={() => select(filter)} aria-label={count === undefined ? label : `${label}: ${count}`} aria-pressed={activeFilter === filter} className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80 ${activeFilter === filter ? 'border-amber-300 bg-amber-300 text-[#17130a]' : 'border-transparent bg-[#1b252a] text-slate-300 hover:border-[#46545c] hover:bg-[#222e34] hover:text-white'}`}>
      {colorValue && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorValue }} aria-hidden="true" />}
      <span className="whitespace-nowrap">{label}</span>
      {count !== undefined && count > 0 && <span className={`rounded-md px-1 py-0.5 text-[9px] tabular-nums ${activeFilter === filter ? 'bg-[#17130a] text-amber-300' : 'bg-[#263239] text-slate-200'}`}>{count}</span>}
    </button>
  );

  return <>
    <div data-testid="conversation-tag-rail" className="flex items-center gap-1 rounded-xl border border-[#3a474e] bg-[#141d22] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_8px_24px_rgba(0,0,0,0.14)]">
      <div data-testid="conversation-tag-scroll" ref={scrollRef} className="flex min-w-0 flex-1 cursor-grab touch-pan-y select-none items-center gap-1 overflow-x-auto overscroll-x-contain whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden active:cursor-grabbing" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={(event) => { if (scrollRef.current && Math.abs(event.deltaY) > Math.abs(event.deltaX)) { scrollRef.current.scrollLeft += event.deltaY; event.preventDefault(); } }}>
        {pill('all', 'Tudo')}
        {pill('unread', 'Não lidas', conversations.filter((conversation) => conversation.unreadCount > 0).length)}
        {pill('unanswered', 'Não resp.', conversations.filter(responsePredicate).length)}
        {trafficTag && pill('traffic', trafficTag.name, conversationTagCount(conversations, trafficTag), trafficTag.color)}
        {customTags.map((tag) => pill(`tag:${tag.id}`, tag.name, conversationTagCount(conversations, tag), tag.color))}
      </div>
      <button type="button" onClick={() => setCreateOpen(true)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-300 text-zinc-950 transition-colors hover:bg-amber-200" aria-label="Criar tag"><Plus className="h-3.5 w-3.5" /></button>
    </div>
    {createOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="conversation-tag-title">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Fechar criação de tag" onClick={() => setCreateOpen(false)} />
      <form onSubmit={(event) => void submit(event)} className="relative w-full max-w-sm rounded-2xl border border-zinc-700 bg-[#182126] p-5 shadow-2xl">
        <div className="flex items-center gap-2"><TagIcon className="h-4 w-4 text-amber-300" /><h2 id="conversation-tag-title" className="text-sm font-bold text-zinc-100">Nova tag</h2></div>
        <label className="mt-4 block text-xs font-semibold text-zinc-300">Nome<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-amber-300" /></label>
        <div className="mt-4"><p className="text-xs font-semibold text-zinc-300">Cor</p><div className="mt-2 flex flex-wrap gap-2">{COLORS.map((item) => <button key={item} type="button" aria-label={`Selecionar cor ${item}`} aria-pressed={color === item} onClick={() => setColor(item)} className={`h-7 w-7 rounded-full border-2 ${color === item ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item }} />)}</div></div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg px-3 py-2 text-xs font-bold text-zinc-400 hover:text-zinc-100">Cancelar</button><button type="submit" className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-200">Criar</button></div>
      </form>
    </div>}
  </>;
};
