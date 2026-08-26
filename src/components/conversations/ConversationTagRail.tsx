import React, { useEffect, useRef, useState } from 'react';
import { LockKeyhole, Plus, Save, Tag as TagIcon, Trash2, X } from 'lucide-react';
import type { Conversation, Tag } from '../../types';
import { conversationTagCount, type ConversationFilter } from '../../utils/conversationTagFilters';

type Props = {
  conversations: Conversation[];
  tags: Tag[];
  activeFilter: ConversationFilter;
  onFilterChange: (filter: ConversationFilter) => void;
  onCreateTag: (name: string, color: string) => Promise<void>;
  onUpdateTag: (tagId: string, input: { name?: string; color?: string }) => Promise<void>;
  onDeleteTag: (tagId: string) => Promise<void>;
  needsResponse?: (conversation: Conversation) => boolean;
};

const COLORS = ['#EABB19', '#3B82F6', '#10B981', '#F97316', '#A78BFA', '#EC4899', '#14B8A6', '#64748B', '#EF4444', '#84CC16'];
const normalizeName = (value: string) => value.trim().toLocaleLowerCase();

export const ConversationTagRail: React.FC<Props> = ({
  conversations,
  tags,
  activeFilter,
  onFilterChange,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  needsResponse,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, moved: false, startX: 0, startScroll: 0 });
  const [managerOpen, setManagerOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState(COLORS[0]);
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!managerOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (deleteTarget) setDeleteTarget(null);
        else if (editingTagId) setEditingTagId(null);
        else setManagerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteTarget, editingTagId, managerOpen]);

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

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setManagerError('Informe um nome para a tag.');
      return;
    }
    if (tags.some((tag) => normalizeName(tag.name) === normalizeName(normalizedName))) {
      setManagerError('Já existe uma tag com esse nome.');
      return;
    }
    setManagerError(null);
    setSaving(true);
    try {
      await onCreateTag(normalizedName, color);
      setName('');
      setColor(COLORS[0]);
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : 'Não foi possível criar a tag.');
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (tag: Tag) => {
    setManagerError(null);
    setEditingTagId(tag.id);
    setEditingName(tag.name);
    setEditingColor(tag.color);
  };
  const cancelEditing = () => {
    setEditingTagId(null);
    setEditingName('');
    setEditingColor(COLORS[0]);
    setManagerError(null);
  };
  const submitEdit = async (event: React.FormEvent, tag: Tag) => {
    event.preventDefault();
    const nextName = editingName.trim();
    if (!nextName || (!tag.systemKey && tags.some((item) => item.id !== tag.id && normalizeName(item.name) === normalizeName(nextName)))) {
      setManagerError('Já existe uma tag com esse nome.');
      return;
    }
    if (tag.systemKey === 'traffic' && normalizeName(nextName) !== normalizeName(tag.name)) {
      setManagerError('A tag Tráfego não pode ser renomeada.');
      return;
    }
    setManagerError(null);
    setSaving(true);
    try {
      const input: { name?: string; color?: string } = {};
      if (!tag.systemKey && nextName !== tag.name) input.name = nextName;
      if (editingColor !== tag.color) input.color = editingColor;
      if (Object.keys(input).length > 0) await onUpdateTag(tag.id, input);
      cancelEditing();
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : 'Não foi possível atualizar a tag.');
    } finally {
      setSaving(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await onDeleteTag(deleteTarget.id);
      setDeleteTarget(null);
      if (editingTagId === deleteTarget.id) cancelEditing();
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : 'Não foi possível excluir a tag.');
    } finally {
      setSaving(false);
    }
  };

  const trafficTag = tags.find((tag) => tag.systemKey === 'traffic');
  const customTags = tags.filter((tag) => tag.systemKey !== 'traffic');
  const responsePredicate = needsResponse ?? ((conversation: Conversation) => conversation.needsResponse || (!conversation.lastMessageFromMe && conversation.status !== 'resolved'));
  const pill = (filter: ConversationFilter, label: string, count?: number, colorValue?: string) => (
    <button key={filter} type="button" onClick={() => select(filter)} aria-label={count === undefined ? label : `${label}: ${count}`} aria-pressed={activeFilter === filter} className={`inline-flex h-[30px] shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80 ${activeFilter === filter ? 'border-amber-300 bg-amber-300 text-[#17130a]' : 'border-transparent bg-[#1b252a] text-slate-300 hover:border-[#46545c] hover:bg-[#222e34] hover:text-white'}`}>
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
      <button type="button" onClick={() => { setManagerError(null); setManagerOpen(true); }} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-amber-300 text-zinc-950 transition-colors hover:bg-amber-200" aria-label="Gerenciar tags"><Plus className="h-3.5 w-3.5" /></button>
    </div>

    {managerOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="conversation-tag-title">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Fechar gerenciador de tags" onClick={() => setManagerOpen(false)} />
      <div className="relative flex max-h-[min(80vh,620px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-[#182126] shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-4">
          <div className="flex items-center gap-2"><TagIcon className="h-4 w-4 text-amber-300" /><h2 id="conversation-tag-title" className="text-sm font-bold text-zinc-100">Gerenciar tags</h2></div>
          <button type="button" onClick={() => setManagerOpen(false)} aria-label="Fechar gerenciador de tags" className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <form onSubmit={(event) => void submitCreate(event)}>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Nova tag</p>
            <label className="mt-3 block text-xs font-semibold text-zinc-300">Nome<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-amber-300" /></label>
            <div className="mt-3"><p className="text-xs font-semibold text-zinc-300">Cor</p><div className="mt-2 flex flex-wrap gap-2">{COLORS.map((item) => <button key={item} type="button" aria-label={`Selecionar cor ${item}`} aria-pressed={color === item} onClick={() => setColor(item)} className={`h-7 w-7 rounded-full border-2 ${color === item ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item }} />)}</div></div>
            <div className="mt-4 flex justify-end"><button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"><Plus className="h-3.5 w-3.5" />Criar</button></div>
          </form>

          {managerError && <p role="alert" className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">{managerError}</p>}
          <div className="mt-5 border-t border-zinc-700 pt-4">
            <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Tags da empresa</p><span className="text-[11px] text-zinc-500">{tags.length} no total</span></div>
            <div className="mt-2 space-y-2" role="list" aria-label="Tags da empresa">
              {tags.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-700 px-3 py-4 text-center text-xs text-zinc-500">Nenhuma tag cadastrada.</p> : tags.map((tag) => {
                const isTraffic = tag.systemKey === 'traffic';
                const isEditing = editingTagId === tag.id;
                return <div key={tag.id} role="listitem" data-testid={`conversation-tag-row-${tag.id}`} className="rounded-xl border border-zinc-700/80 bg-zinc-900/30 px-3 py-3">
                  {isEditing ? <form onSubmit={(event) => void submitEdit(event, tag)}>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: editingColor }} aria-hidden="true" />
                      <input aria-label={`Nome da tag ${tag.name}`} value={editingName} onChange={(event) => setEditingName(event.target.value)} readOnly={isTraffic} className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-amber-300 read-only:cursor-not-allowed read-only:opacity-70" />
                      {isTraffic && <LockKeyhole className="h-3.5 w-3.5 text-zinc-500" aria-label="Tag protegida" />}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">{COLORS.map((item) => <button key={item} type="button" aria-label={`Selecionar cor ${item} para ${tag.name}`} aria-pressed={editingColor === item} onClick={() => setEditingColor(item)} className={`h-6 w-6 rounded-full border-2 ${editingColor === item ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item }} />)}</div>
                    <div className="mt-3 flex items-center justify-between gap-2"><span className="text-[11px] text-zinc-500">{tag.usageCount ?? 0} conversa(s) usando</span><div className="flex gap-2"><button type="button" onClick={cancelEditing} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-zinc-400 hover:text-white">Cancelar</button><button type="submit" disabled={saving} aria-label={`Salvar tag ${tag.name}`} className="inline-flex items-center gap-1 rounded-lg bg-amber-300 px-2.5 py-1.5 text-xs font-bold text-zinc-950 disabled:opacity-60"><Save className="h-3.5 w-3.5" />Salvar</button></div></div>
                  </form> : <div className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">{tag.name}</span>
                    {isTraffic && <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-label="Tag Tráfego protegida" />}
                    <span data-testid="conversation-tag-usage" className="shrink-0 text-[11px] text-zinc-500">{tag.usageCount ?? 0}</span>
                    <button type="button" onClick={() => startEditing(tag)} aria-label={`Editar tag ${tag.name}`} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-400 hover:bg-white/5 hover:text-white">Editar</button>
                    {!isTraffic && <button type="button" onClick={() => setDeleteTarget(tag)} aria-label={`Excluir tag ${tag.name}`} className="rounded-lg p-1.5 text-zinc-500 hover:bg-red-400/10 hover:text-red-200"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>}
                </div>;
              })}
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t border-zinc-700 px-5 py-3"><button type="button" onClick={() => setManagerOpen(false)} className="rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-white/5">Fechar</button></div>
      </div>
    </div>}

    {deleteTarget && <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="conversation-tag-delete-title">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Cancelar exclusão" onClick={() => setDeleteTarget(null)} />
      <div className="relative w-full max-w-sm rounded-2xl border border-zinc-700 bg-[#182126] p-5 shadow-2xl">
        <h2 id="conversation-tag-delete-title" className="text-sm font-bold text-zinc-100">Excluir tag?</h2>
        <p className="mt-2 text-xs leading-5 text-zinc-300">A tag <strong>{deleteTarget.name}</strong> será removida de {deleteTarget.usageCount ?? 0} conversa(s). As conversas e mensagens serão preservadas.</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDeleteTarget(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-zinc-400 hover:text-white">Cancelar</button><button type="button" disabled={saving} onClick={() => void confirmDelete()} className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white hover:bg-red-400 disabled:opacity-60"><Trash2 className="h-3.5 w-3.5" />Excluir tag</button></div>
      </div>
    </div>}
  </>;
};
