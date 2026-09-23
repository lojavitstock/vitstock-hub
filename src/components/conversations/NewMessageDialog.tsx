import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, MessageSquare, Search, UserRound, X } from 'lucide-react';
import { Conversation } from '../../types';
import { EvolutionApiService, type NewMessageDestination, type NewMessageDestinationOption } from '../../services/evolutionApi';
import { apiRequest } from '../../services/api';
import { formatPhoneForDisplay } from '../../utils/phone';
import { isPhoneSearchQuery, normalizeManualPhone, recentPrivateConversations } from '../../utils/newMessage';
import { ContactPhoto } from './ContactPhoto';

type ContactPhone = { phone?: string; label?: string | null; is_primary?: boolean; new_outbound_eligible?: boolean };

type ContactSearchResult = {
  id: string;
  name: string;
  phone?: string | null;
  avatar_url?: string | null;
  google_saved?: boolean;
  whatsapp_linked?: boolean;
  phones?: ContactPhone[];
};

type DestinationIntent = {
  conversationId?: string;
  contactId?: string;
  phone?: string;
};

type NewMessageDialogProps = {
  open: boolean;
  conversations: Conversation[];
  isMock: boolean;
  onClose: () => void;
  onResolved: (destination: NewMessageDestination) => void;
};

const normalizeSearch = (value: string) => value
  .toLocaleLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const phoneDigits = (value: string) => value.replace(/\D/g, '');

const destinationOptionLabel = (option: NewMessageDestinationOption) => (
  option.kind === 'existing'
    ? option.label || 'WhatsApp conhecido'
    : option.label || 'Novo destino pelo número'
);

export const NewMessageDialog: React.FC<NewMessageDialogProps> = ({
  open,
  conversations,
  isMock,
  onClose,
  onResolved,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<ContactSearchResult[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [checkingManual, setCheckingManual] = useState(false);
  const [manualDestination, setManualDestination] = useState<NewMessageDestination | null>(null);
  const [manualResolutionError, setManualResolutionError] = useState('');
  const [error, setError] = useState('');
  const [multipleSelection, setMultipleSelection] = useState<{
    contactId: string;
    name: string;
    options: NewMessageDestinationOption[];
  } | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setContacts([]);
      setError('');
      setManualDestination(null);
      setManualResolutionError('');
      setCheckingManual(false);
      setMultipleSelection(null);
      return undefined;
    }

    const query = search.trim();
    const queryIsNumeric = isPhoneSearchQuery(query);
    if (isMock || query.length < 2) {
      setContacts([]);
      setLoadingContacts(false);
      return undefined;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      setLoadingContacts(true);
      void apiRequest<{ contacts?: ContactSearchResult[] }>(`/api/contacts?q=${encodeURIComponent(query)}&limit=20&sort=last_interaction`)
        .then((result) => {
          if (!disposed) setContacts(Array.isArray(result.contacts) ? result.contacts : []);
        })
        .catch((requestError) => {
          if (!disposed) {
            setContacts([]);
            setError(requestError instanceof Error ? requestError.message : 'Não foi possível buscar contatos.');
          }
        })
        .finally(() => {
          if (!disposed) setLoadingContacts(false);
        });
    }, 250);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [isMock, open, search]);

  useEffect(() => {
    setManualDestination(null);
    setManualResolutionError('');
    if (!open || isMock || !isPhoneSearchQuery(search.trim()) || phoneDigits(search).length < 8) {
      setCheckingManual(false);
      return undefined;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      setCheckingManual(true);
      void EvolutionApiService.resolveNewMessageDestination({ phone: search.trim() })
        .then((destination) => {
          if (!disposed) {
            if (destination.kind === 'multiple') {
              setManualResolutionError('Não foi possível determinar uma única conversa para este número.');
            } else {
              setManualDestination(destination);
            }
          }
        })
        .catch((requestError) => {
          if (!disposed) setManualResolutionError(requestError instanceof Error
            ? requestError.message
            : 'Número incompleto ou inválido para iniciar uma conversa.');
        })
        .finally(() => {
          if (!disposed) setCheckingManual(false);
        });
    }, 300);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [isMock, open, search]);

  const recents = useMemo(() => {
    return recentPrivateConversations(conversations);
  }, [conversations]);

  const query = search.trim();
  const normalizedQuery = normalizeSearch(query);
  const queryDigits = phoneDigits(query);
  const queryIsNumeric = isPhoneSearchQuery(query);
  const localConversationMatches = useMemo(() => {
    if (!query) return [];
    return conversations
      .filter((conversation) => !conversation.isGroup && !conversation.isPending)
      .filter((conversation) => {
        const nameMatches = normalizeSearch(conversation.contact.name).includes(normalizedQuery);
        const phoneMatches = queryDigits.length > 0 && phoneDigits(conversation.contact.phone).includes(queryDigits);
        return nameMatches || phoneMatches;
      })
      .slice(0, 12);
  }, [conversations, normalizedQuery, query, queryDigits]);

  const resolve = async (intent: DestinationIntent, localConversation?: Conversation) => {
    if (resolving) return;
    setResolving(true);
    setError('');
    try {
      if (isMock) {
        if (localConversation) {
          onResolved({
            kind: 'existing',
            remoteJid: localConversation.id,
            contactId: localConversation.contact.id,
            name: localConversation.contact.name,
            phone: localConversation.contact.phone,
            avatar: localConversation.contact.avatar || null,
          });
        } else {
          const digits = normalizeManualPhone(intent.phone || '');
          if (!digits) {
            setError('Número incompleto ou inválido para iniciar uma conversa.');
            return;
          }
          onResolved({
            kind: 'new_phone',
            remoteJid: `${digits}@s.whatsapp.net`,
            contactId: undefined,
            name: `+${digits}`,
            phone: `+${digits}`,
            avatar: null,
          });
        }
        return;
      }

      const destination = await EvolutionApiService.resolveNewMessageDestination(intent);
      if (destination.kind === 'multiple') {
        setMultipleSelection(destination);
        return;
      }
      onResolved(destination);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível preparar a conversa.');
    } finally {
      setResolving(false);
    }
  };

  if (!open) return null;

  const renderConversation = (conversation: Conversation) => (
    <button
      key={conversation.id}
      type="button"
      onClick={() => void resolve({ conversationId: conversation.id }, conversation)}
      disabled={resolving}
      className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-white/10 hover:bg-white/5 disabled:cursor-wait disabled:opacity-60"
    >
      <ContactPhoto name={conversation.contact.name} avatar={conversation.contact.avatar} size="small" lazy />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-slate-100">{conversation.contact.name}</span>
        {conversation.contact.phone && <span className="mt-0.5 block truncate font-mono text-xs text-slate-400">{formatPhoneForDisplay(conversation.contact.phone)}</span>}
      </span>
      {resolving && <LoaderCircle className="h-4 w-4 animate-spin text-amber-300" />}
    </button>
  );

  const renderContact = (contact: ContactSearchResult) => {
    const phone = contact.phones?.find((item) => item.phone && item.new_outbound_eligible)?.phone || '';
    return (
      <button
        key={contact.id}
        type="button"
        onClick={() => void resolve({ contactId: contact.id })}
        disabled={resolving}
        className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-white/10 hover:bg-white/5 disabled:cursor-wait disabled:opacity-60"
      >
        <ContactPhoto name={contact.name} avatar={contact.avatar_url || ''} size="small" lazy />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-slate-100">{contact.name}</span>
          {phone
            ? <span className="mt-0.5 block truncate font-mono text-xs text-slate-400">{formatPhoneForDisplay(phone)}</span>
            : <span className="mt-0.5 block truncate text-xs text-slate-500">Número incompleto; vínculo existente ainda pode ser resolvido</span>}
        </span>
        {resolving && <LoaderCircle className="h-4 w-4 animate-spin text-amber-300" />}
      </button>
    );
  };

  const renderMultipleSelection = () => (
    <div className="space-y-2">
      <button type="button" onClick={() => setMultipleSelection(null)} className="mb-2 text-xs font-bold text-amber-300 hover:text-amber-200">← Voltar para resultados</button>
      {multipleSelection?.options.map((option) => (
        <button
          key={`${option.kind}-${option.kind === 'existing' ? option.conversationId : option.phone}`}
          type="button"
          disabled={resolving}
          onClick={() => void resolve(
            option.kind === 'existing'
              ? { conversationId: option.conversationId }
              : { contactId: multipleSelection.contactId, phone: option.phone },
          )}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 px-3 py-3 text-left transition-colors hover:border-amber-300/60 hover:bg-amber-300/10 disabled:opacity-60"
        >
          <span>
            <span className="block text-sm font-bold text-slate-100">{destinationOptionLabel(option)}</span>
            {option.phone && <span className="mt-1 block font-mono text-xs text-slate-400">{formatPhoneForDisplay(option.phone)}</span>}
          </span>
          <MessageSquare className="h-4 w-4 text-amber-300" />
        </button>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-message-title"
        className="relative flex max-h-[min(720px,calc(100vh-2rem))] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#20292f] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === 'Escape' && !resolving) onClose(); }}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="new-message-title" className="flex items-center gap-2 text-base font-extrabold text-slate-100"><MessageSquare className="h-4 w-4 text-amber-300" /> Nova mensagem</h2>
            <p className="mt-1 text-xs text-slate-400">Escolha uma conversa ou prepare um novo destino.</p>
          </div>
          <button type="button" disabled={resolving} onClick={onClose} aria-label="Fechar nova mensagem" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>

        <div className="border-b border-white/10 px-5 py-4">
          <label className="relative block">
            <span className="sr-only">Buscar nome ou digitar número</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              autoFocus
              value={search}
              onChange={(event) => { setSearch(event.target.value); setError(''); setMultipleSelection(null); }}
              placeholder="Buscar nome ou digitar número"
              aria-label="Buscar nome ou digitar número"
              className="h-10 w-full rounded-xl border border-slate-700 bg-[#2a343a] pl-10 pr-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-amber-400/70"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {multipleSelection ? renderMultipleSelection() : (
            <>
              {!query && recents.length > 0 && <section><h3 className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Recentes</h3>{recents.map(renderConversation)}</section>}
              {query && localConversationMatches.length > 0 && <section><h3 className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Conversas existentes</h3>{localConversationMatches.map(renderConversation)}</section>}
              {query && <section className="mt-3"><h3 className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Contatos</h3>{loadingContacts ? <div className="flex justify-center py-5"><LoaderCircle className="h-5 w-5 animate-spin text-amber-300" /></div> : contacts.filter((contact) => Boolean(contact.phone || contact.phones?.some((item) => item.phone))).length > 0 ? contacts.filter((contact) => Boolean(contact.phone || contact.phones?.some((item) => item.phone))).map(renderContact) : <p className="px-3 py-4 text-xs text-slate-500">Nenhum contato encontrado.</p>}</section>}
              {queryIsNumeric && queryDigits.length >= 8 && <section className="mt-3"><h3 className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Novo destino</h3>{checkingManual ? <div className="flex justify-center py-4"><LoaderCircle className="h-5 w-5 animate-spin text-amber-300" /></div> : manualDestination ? <button type="button" disabled={resolving} onClick={() => {
                if (isMock) void resolve({ phone: normalizeManualPhone(query) });
                else onResolved(manualDestination);
              }} className="flex w-full items-center gap-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-3 text-left transition-colors hover:border-amber-300/70 disabled:opacity-60"><UserRound className="h-5 w-5 text-amber-300" /><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-100">{manualDestination.kind === 'existing' ? 'Abrir conversa existente' : 'Conversar com'}</span><span className="mt-1 block font-mono text-xs text-amber-200">{formatPhoneForDisplay(manualDestination.kind === 'new_phone' ? manualDestination.phone : query)}</span></span>{resolving && <LoaderCircle className="h-4 w-4 animate-spin text-amber-300" />}</button> : isMock && normalizeManualPhone(query) ? <button type="button" disabled={resolving} onClick={() => void resolve({ phone: normalizeManualPhone(query) })} className="flex w-full items-center gap-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-3 text-left transition-colors hover:border-amber-300/70 disabled:opacity-60"><UserRound className="h-5 w-5 text-amber-300" /><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-100">Conversar com</span><span className="mt-1 block font-mono text-xs text-amber-200">{formatPhoneForDisplay(normalizeManualPhone(query))}</span></span></button> : manualResolutionError || (isMock ? 'Número incompleto ou inválido para iniciar uma conversa.' : '') ? <p role="alert" className="px-3 py-2 text-xs font-semibold text-red-200">{manualResolutionError || 'Número incompleto ou inválido para iniciar uma conversa.'}</p> : null}</section>}
              {!query && recents.length === 0 && <div className="flex flex-col items-center justify-center px-5 py-10 text-center text-slate-500"><UserRound className="mb-2 h-7 w-7" /><p className="text-sm font-semibold text-slate-300">Nenhuma conversa recente</p><p className="mt-1 text-xs">Busque um contato ou digite um número.</p></div>}
              {query && localConversationMatches.length === 0 && !queryIsNumeric && !loadingContacts && contacts.length === 0 && <div className="flex flex-col items-center justify-center px-5 py-6 text-center text-slate-500"><UserRound className="mb-2 h-7 w-7" /><p className="text-sm font-semibold text-slate-300">Nenhum destino encontrado</p></div>}
            </>
          )}
        </div>

        {error && <p role="alert" className="mx-5 mb-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200">{error}</p>}
        <div className="flex justify-end border-t border-white/10 px-5 py-4"><button type="button" disabled={resolving} onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-50">Cancelar</button></div>
      </div>
    </div>
  );
};
