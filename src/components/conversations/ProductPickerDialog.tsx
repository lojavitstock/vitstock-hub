import React, { useRef, useState } from 'react';
import { ArrowLeft, Loader2, Package, Plus, Search } from 'lucide-react';
import type { Product } from '../../types';
import { useProductSearch } from '../../hooks/useProductSearch';
import { useAuth } from '../../auth/AuthContext';
import { formatBrlPrice } from '../../utils/productLibrary';
import { ProductDialog } from '../products/ProductDialog';

type ProductPickerDialogProps = {
  onClose: () => void; initialProduct?: Product | null; onCreateProduct: () => void;
  canSend: boolean; onSend: (productId: string, clientMessageId: string) => Promise<void>;
};

export const ProductPickerDialog: React.FC<ProductPickerDialogProps> = ({ onClose, initialProduct, onCreateProduct, canSend, onSend }) => {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const { products, loading, error } = useProductSearch(search);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(initialProduct || null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const inFlight = useRef(false);
  const submission = useRef<{ productId: string; clientMessageId: string } | null>(null);
  const close = () => { if (!inFlight.current) onClose(); };
  const submit = async () => {
    if (!selectedProduct || !canSend || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setSendError('');
    if (submission.current?.productId !== selectedProduct.id) {
      submission.current = { productId: selectedProduct.id, clientMessageId: crypto.randomUUID() };
    }
    try {
      await onSend(submission.current.productId, submission.current.clientMessageId);
      onClose();
    } catch (failure) {
      setSendError(failure instanceof Error ? failure.message : 'Não foi possível enviar o produto.');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  if (selectedProduct) {
    return <ProductDialog title="Pré-visualizar produto" onClose={close}>
      <div className="space-y-4">
        <div className="flex aspect-square max-h-[42vh] items-center justify-center overflow-hidden rounded-xl bg-zinc-900 p-4 sm:aspect-[4/3]">
          <img src={selectedProduct.imageUrl} alt={`Imagem do produto ${selectedProduct.name}`} className="h-full w-full object-contain" />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-zinc-100">{selectedProduct.name}</h3>
          <p className="mt-1 text-lg font-extrabold text-amber-300">{formatBrlPrice(selectedProduct.priceCents)}</p>
        </div>
        {sendError && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{sendError}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 pt-4 sm:flex-row sm:justify-between">
          <button type="button" disabled={sending} onClick={() => { setSelectedProduct(null); setSendError(''); submission.current = null; }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-white/5"><ArrowLeft className="h-4 w-4" /> Voltar</button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" disabled={sending} onClick={close} className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-white/5">Fechar prévia</button>
            <button type="button" disabled={!canSend || sending} onClick={() => void submit()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-extrabold text-zinc-950 disabled:opacity-50">{sending ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</> : 'Enviar'}</button>
          </div>
        </div>
      </div>
    </ProductDialog>;
  }

  return <ProductDialog title="Produtos" onClose={onClose}>
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="relative block min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
          <input autoFocus data-dialog-autofocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto..." aria-label="Buscar produto para pré-visualizar" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-3 pl-10 pr-3 text-sm text-zinc-100 outline-none focus:border-amber-400" />
        </label>
        {user?.role === 'admin' && <button type="button" onClick={onCreateProduct} aria-label="Adicionar produto" title="Adicionar produto; volte ao Atendimento para continuar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-400 text-zinc-950 hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 focus:ring-offset-zinc-900"><Plus className="h-5 w-5" aria-hidden="true" /></button>}
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {loading ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin text-amber-400" /> Buscando produtos...</div>
        : products.length ? <div role="listbox" aria-label="Produtos disponíveis" className="max-h-[55dvh] space-y-2 overflow-y-auto">
          {products.map((product) => <button key={product.id} type="button" role="option" aria-selected="false" onClick={() => setSelectedProduct(product)} className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5 text-left transition-colors hover:border-amber-400/40 hover:bg-amber-400/5 focus:outline-none focus:ring-2 focus:ring-amber-400">
            <img src={product.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-black/30 object-contain p-1" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-zinc-100">{product.name}</span><span className="mt-1 block text-xs font-bold text-amber-300">{formatBrlPrice(product.priceCents)}</span></span>
          </button>)}
        </div> : <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center">
          <Package className="mx-auto h-7 w-7 text-zinc-600" aria-hidden="true" />
          <p className="mt-3 text-sm text-zinc-300">{search.trim() ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.'}</p>
          <p className="mt-1 text-xs text-zinc-500">Os produtos ativos da sua empresa aparecerão aqui.</p>
        </div>}
      <div className="flex justify-end border-t border-zinc-800 pt-3"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-bold text-zinc-400 hover:bg-white/5 hover:text-zinc-100">Cancelar</button></div>
    </div>
  </ProductDialog>;
};
