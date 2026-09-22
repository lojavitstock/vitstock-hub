import React, { useEffect, useMemo, useState } from 'react';
import { Forward, LoaderCircle, Search, UserRound, X } from 'lucide-react';
import { Conversation, Message } from '../../types';
import { EvolutionApiService } from '../../services/evolutionApi';
import { ContactPhoto } from './ContactPhoto';
import { displayablePhoneDigits, formatPhoneForDisplay } from '../../utils/phone';

type ForwardMessageDialogProps = {
  message: Message;
  conversations: Conversation[];
  currentConversationId: string;
  onCancel: () => void;
  onSuccess: () => void;
};

const normalizeSearch = (value: string) => value
  .toLocaleLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const isProviderConversation = (value: string) => /@(s\.whatsapp\.net|c\.us|lid|g\.us)$/i.test(value.trim());

const isHumanName = (value: string) => Boolean(value.trim())
  && !/^participante(?: …\d+)?$/i.test(value.trim())
  && !/^\+?[\d\s().-]+$/.test(value.trim());

const createClientMessageId = () => `forward-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const ForwardMessageDialog: React.FC<ForwardMessageDialogProps> = ({
  message,
  conversations,
  currentConversationId,
  onCancel,
  onSuccess,
}) => {
  const [search, setSearch] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientMessageId] = useState(createClientMessageId);
  const sourcePreview = message.metadata?.location
    ? 'Localização compartilhada'
    : message.mediaType === 'image'
      ? `Imagem${message.content.trim() && message.content.trim() !== '[Imagem]' ? ` — ${message.content.trim()}` : ''}`
      : message.content.trim();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || sending) return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [onCancel, sending]);

  const destinationOptions = useMemo(() => {
    const query = normalizeSearch(search.trim());
    const queryDigits = search.replace(/\D/g, '');
    return conversations
      .filter((conversation) => conversation.id !== currentConversationId && isProviderConversation(conversation.id))
      .map((conversation) => {
        const phoneDigits = displayablePhoneDigits(conversation.contact.phone);
        const name = conversation.contact.name.trim();
        const phone = phoneDigits ? formatPhoneForDisplay(conversation.contact.phone) : '';
        const matches = !query
          || (isHumanName(name) && normalizeSearch(name).includes(query))
          || Boolean(queryDigits && phoneDigits.includes(queryDigits));
        return { conversation, phone, matches };
      })
      .filter((option) => option.matches);
  }, [conversations, currentConversationId, search]);

  const confirmForward = async () => {
    if (!selectedConversation || sending || !message.id.trim()) return;
    setSending(true);
    setError(null);
    try {
      await EvolutionApiService.forwardTextMessage({
        sourceMessageId: message.id.trim(),
        destinationRemoteJid: selectedConversation.id,
        clientMessageId,
      });
      onSuccess();
    } catch (forwardError) {
      setError(forwardError instanceof Error ? forwardError.message : 'Não foi possível encaminhar a mensagem.');
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-labelledby="forward-message-title">
      <button type="button" className="absolute inset-0" aria-label="Fechar encaminhamento" onClick={() => { if (!sending) onCancel(); }} />
      <div className="relative flex max-h-[min(720px,calc(100vh-2rem))] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#20292f] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="forward-message-title" className="flex items-center gap-2 text-base font-extrabold text-slate-100"><Forward className="h-4 w-4 text-amber-300" /> Encaminhar mensagem</h2>
            <p className="mt-1 max-w-sm truncate text-xs text-slate-400">{sourcePreview}</p>
          </div>
          <button type="button" disabled={sending} onClick={onCancel} aria-label="Fechar encaminhamento" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>

        <div className="border-b border-white/10 px-5 py-4">
          <label className="relative block">
            <span className="sr-only">Buscar conversa de destino</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou telefone"
              aria-label="Buscar conversa de destino"
              className="h-10 w-full rounded-xl border border-slate-700 bg-[#2a343a] pl-10 pr-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-amber-400/70"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {destinationOptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-5 py-10 text-center text-slate-500">
              <UserRound className="mb-2 h-7 w-7" />
              <p className="text-sm font-semibold text-slate-300">Nenhuma conversa encontrada</p>
              <p className="mt-1 text-xs">Escolha uma conversa existente no Atendimento.</p>
            </div>
          ) : (
            <div role="listbox" aria-label="Conversas de destino" className="space-y-1">
              {destinationOptions.map(({ conversation, phone }) => {
                const isSelected = selectedConversation?.id === conversation.id;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { setSelectedConversation(conversation); setError(null); }}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${isSelected ? 'border-amber-300/70 bg-amber-300/10' : 'border-transparent hover:border-white/10 hover:bg-white/5'}`}
                  >
                    <ContactPhoto name={conversation.contact.name} avatar={conversation.isGroup ? (conversation.groupAvatar || conversation.contact.avatar) : conversation.contact.avatar} size="small" lazy />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-slate-100">{conversation.contact.name}</span>
                      {phone && <span className="mt-0.5 block truncate font-mono text-xs text-slate-400">{phone}</span>}
                    </span>
                    {isSelected && <span className="rounded-full bg-amber-300 px-2 py-1 text-[10px] font-extrabold text-zinc-950">Selecionada</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedConversation && (
          <div className="mx-5 mb-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
            Destino: <span className="font-extrabold">{selectedConversation.contact.name}</span>
          </div>
        )}
        {error && <p role="alert" className="mx-5 mb-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button type="button" disabled={sending} onClick={onCancel} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50">Cancelar</button>
          <button type="button" disabled={!selectedConversation || sending} onClick={() => void confirmForward()} className="inline-flex items-center gap-2 rounded-lg bg-amber-300 px-3 py-2 text-sm font-extrabold text-zinc-950 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50">
            {sending && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {sending ? 'Encaminhando...' : 'Encaminhar'}
          </button>
        </div>
      </div>
    </div>
  );
};

