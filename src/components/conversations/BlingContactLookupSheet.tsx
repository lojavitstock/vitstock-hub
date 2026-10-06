import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RefreshCw, Search, ShoppingBag, X } from 'lucide-react';
import { lookupBlingContact, type BlingContactLookup } from '../../services/blingApi';
import { formatPhoneForDisplay } from '../../utils/phone';

type Props = { phone: string; onClose: () => void };
type LookupState = { status: 'loading'; selectedId?: string }
  | { status: 'error'; message: string }
  | Exclude<BlingContactLookup, { status: 'found' }>
  | Extract<BlingContactLookup, { status: 'found' }>;

function displayValue(value: string | null | undefined) {
  return value?.trim() || 'Não informado';
}

function formatOrderDate(value: string | null) {
  if (!value) return 'Data não informada';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatOrderTotal(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export const BlingContactLookupSheet: React.FC<Props> = ({ phone, onClose }) => {
  const [state, setState] = useState<LookupState>({ status: 'loading' });
  const requestController = useRef<AbortController | null>(null);

  const lookup = useCallback(async (contactId?: string) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setState({ status: 'loading', ...(contactId ? { selectedId: contactId } : {}) });
    try {
      const result = await lookupBlingContact(phone, contactId, controller.signal);
      if (!controller.signal.aborted) setState(result);
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Não foi possível consultar o Bling.' });
    }
  }, [phone]);

  useEffect(() => {
    void lookup();
    return () => requestController.current?.abort();
  }, [lookup]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-[80] flex justify-end bg-black/30"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="flex h-full w-[380px] max-w-[92vw] flex-col border-l border-[#344047] bg-[#182126] shadow-2xl animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bling-contact-lookup-title"
      >
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#344047] bg-[#20292f] px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300"><Search className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h3 id="bling-contact-lookup-title" className="truncate text-sm font-extrabold text-slate-100">Cadastro no Bling</h3>
              <p className="truncate text-[11px] font-mono text-slate-400">{formatPhoneForDisplay(phone)}</p>
            </div>
          </div>
          <button type="button" aria-label="Fechar cadastro do Bling" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
          {state.status === 'loading' && (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center text-sm text-slate-300">
              <RefreshCw className="h-5 w-5 animate-spin text-amber-300" />
              <span>{state.selectedId ? 'Carregando cadastro e pedidos...' : 'Buscando cadastro pelo telefone...'}</span>
            </div>
          )}

          {state.status === 'error' && (
            <div className="rounded-xl border border-rose-400/25 bg-rose-400/5 p-4 text-center">
              <AlertCircle className="mx-auto mb-2 h-5 w-5 text-rose-300" />
              <p className="text-sm font-bold text-slate-100">Não foi possível concluir a consulta</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">{state.message}</p>
              <button type="button" onClick={() => void lookup()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#46535a] px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/5"><RefreshCw className="h-3.5 w-3.5" /> Tentar novamente</button>
            </div>
          )}

          {state.status === 'not_found' && (
            <div className="rounded-xl border border-[#344047] bg-[#20292f] p-5 text-center">
              <Search className="mx-auto mb-3 h-5 w-5 text-slate-400" />
              <p className="text-sm font-bold text-slate-100">Cadastro não encontrado</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">O Bling não retornou um contato com o mesmo telefone desta conversa.</p>
              <button type="button" onClick={() => void lookup()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#46535a] px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/5"><RefreshCw className="h-3.5 w-3.5" /> Consultar novamente</button>
            </div>
          )}

          {state.status === 'multiple' && (
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-extrabold text-slate-100">{state.matches.length > 1 ? 'Mais de um cadastro encontrado' : 'Busca com resultados incompletos'}</h4>
                <p className="mt-1 text-xs text-slate-400">Confira os dados e selecione o contato correto.</p>
              </div>
              {state.truncated && <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-[11px] leading-relaxed text-amber-200">A busca atingiu o limite de resultados consultados. Os cadastros listados podem não incluir todos os contatos.</p>}
              {state.matches.map((match) => (
                <button key={match.id} type="button" onClick={() => void lookup(match.id)} className="w-full rounded-xl border border-[#344047] bg-[#20292f] p-3 text-left transition hover:border-amber-300/50 hover:bg-[#253138]">
                  <span className="block text-sm font-bold text-slate-100">{match.name}</span>
                  <span className="mt-1 block text-xs text-slate-400">CPF/CNPJ: {displayValue(match.document)}</span>
                  <span className="mt-1 block text-xs font-mono text-amber-200">Fone: {displayValue(match.phone)}</span>
                  <span className="mt-2 block text-[11px] font-bold text-amber-300">Ver este cadastro</span>
                </button>
              ))}
              <button type="button" onClick={() => void lookup()} className="inline-flex items-center gap-2 rounded-lg border border-[#46535a] px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/5"><RefreshCw className="h-3.5 w-3.5" /> Refazer busca</button>
            </div>
          )}

          {state.status === 'found' && (
            <div className="space-y-5">
              <section className="rounded-xl border border-[#344047] bg-[#20292f] p-4">
                <div className="mb-3 flex items-center gap-2 border-b border-[#344047] pb-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300"><Search className="h-4 w-4" /></span>
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-100">Dados do contato</h4>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Encontrado no Bling</p>
                  </div>
                </div>
                <dl className="space-y-3">
                  <Field label="Nome" value={state.contact.name} />
                  <Field label="Fantasia" value={state.contact.fantasy} />
                  <Field label="CPF ou CNPJ" value={state.contact.document} />
                  <Field label="CEP" value={state.contact.zipCode} />
                  <Field label="Endereço" value={state.contact.address} />
                  <Field label="Fone" value={state.contact.phone} />
                  <Field label="E-mail" value={state.contact.email} />
                </dl>
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-amber-300" />
                  <h4 className="text-sm font-extrabold text-slate-100">Últimos pedidos</h4>
                </div>
                {state.ordersError ? (
                  <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-relaxed text-amber-100">{state.ordersError}</p>
                ) : state.orders.length === 0 ? (
                  <p className="rounded-lg border border-[#344047] bg-[#20292f] p-4 text-center text-xs text-slate-400">Nenhum pedido encontrado para este contato.</p>
                ) : (
                  <div className="space-y-2">
                    {state.orders.map((order, index) => (
                      <div key={order.id || `${order.number || 'pedido'}-${order.date || index}`} className="rounded-lg border border-[#344047] bg-[#20292f] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-extrabold text-slate-100">Pedido {order.number || order.id || '—'}</span>
                          <span className="text-[11px] text-slate-400">{formatOrderDate(order.date)}</span>
                        </div>
                        {order.total !== null && <p className="mt-1.5 text-xs font-bold text-emerald-300">{formatOrderTotal(order.total)}</p>}
                      </div>
                    ))}
                  </div>
                )}
                {state.ordersTruncated && <p className="mt-2 text-[11px] leading-relaxed text-amber-200">A consulta atingiu o limite de 500 pedidos. Podem existir pedidos adicionais.</p>}
              </section>

              <button type="button" onClick={() => void lookup()} className="inline-flex items-center gap-2 rounded-lg border border-[#46535a] px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/5"><RefreshCw className="h-3.5 w-3.5" /> Atualizar cadastro</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

const Field: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
  <div>
    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</dt>
    <dd className="mt-0.5 break-words text-xs leading-relaxed text-slate-200">{displayValue(value)}</dd>
  </div>
);
