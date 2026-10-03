import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Link2, Loader2, MoreVertical, Package, PencilLine, Plus, RefreshCw, Search, Save, Unlink } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useSearchParams } from 'react-router-dom';
import type { Product } from '../../types';
import type { BlingProduct, ProductBlingLink } from '../../services/blingApi';
import { fetchBlingProducts, fetchProductBlingLinks, linkProductToBling, unlinkProductFromBling } from '../../services/blingApi';
import { archiveProduct, createProduct, fetchProducts, updateProduct } from '../../services/productsApi';
import { formatBrlPrice, formatBrlPriceInput, parseBrlPriceCents } from '../../utils/productLibrary';
import { ProductDialog } from '../products/ProductDialog';

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxImageBytes = 1_000_000;

type SelectedImage = { base64: string; mimeType: Product['imageMimeType'] };

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const separator = result.indexOf(',');
      if (separator < 0) reject(new Error('Não foi possível preparar a imagem.'));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export const ProductsSettings: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveInFlightRef = useRef(false);
  const archiveInFlightRef = useRef(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [readingImage, setReadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [blingLinks, setBlingLinks] = useState<Record<string, ProductBlingLink>>({});
  const [blingLinkTarget, setBlingLinkTarget] = useState<Product | null>(null);
  const [blingSearch, setBlingSearch] = useState('');
  const [blingProducts, setBlingProducts] = useState<BlingProduct[]>([]);
  const [blingLoading, setBlingLoading] = useState(false);
  const [blingLinking, setBlingLinking] = useState(false);
  const [blingError, setBlingError] = useState('');

  useEffect(() => {
    if (searchParams.get('action') !== 'new') return;
    if (isAdmin) setShowForm(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('action');
    setSearchParams(nextParams, { replace: true });
  }, [isAdmin, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isAdmin) return;
    void fetchProductBlingLinks()
      .then((result) => setBlingLinks(Object.fromEntries((result.links || []).map((link) => [link.productId, link]))))
      .catch(() => undefined);
  }, [isAdmin]);

  const loadProducts = useCallback(async (query: string, signal?: AbortSignal) => {
    const result = await fetchProducts(query, signal);
    setProducts(result.products || []);
  }, []);

  const applySavedProduct = (product: Product) => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    setProducts((current) => {
      const next = current.filter((item) => item.id !== product.id);
      if (normalizedSearch && !product.name.toLocaleLowerCase().includes(normalizedSearch)) return next;
      return [...next, product].sort((left, right) => (
        left.name.toLocaleLowerCase().localeCompare(right.name.toLocaleLowerCase())
        || left.id.localeCompare(right.id)
      ));
    });
  };

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void fetchProducts(search, controller.signal)
        .then((result) => { if (current) setProducts(result.products || []); })
        .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os produtos.'); })
        .finally(() => { if (current) setLoading(false); });
    }, search.trim() ? 180 : 0);
    return () => {
      current = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  useEffect(() => () => {
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const resetForm = () => {
    setShowForm(false);
    setEditingProduct(null);
    setName('');
    setPriceInput('');
    setSelectedImage(null);
    setPreviewUrl(null);
    setReadingImage(false);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openNewProduct = () => {
    setError('');
    setFeedback('');
    setEditingProduct(null);
    setName('');
    setPriceInput('');
    setSelectedImage(null);
    setPreviewUrl(null);
    setShowForm(true);
  };

  const openEditor = (product: Product) => {
    setError('');
    setFeedback('');
    setEditingProduct(product);
    setName(product.name);
    setPriceInput(String(product.priceCents));
    setSelectedImage(null);
    setPreviewUrl(null);
    setShowForm(true);
    setOpenMenuId(null);
  };

  const chooseImage = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!allowedImageTypes.has(file.type)) {
      setError('Use uma imagem JPEG, PNG ou WebP.');
      return;
    }
    if (file.size < 1 || file.size > maxImageBytes) {
      setError('A imagem deve ter entre 1 byte e 1 MB.');
      return;
    }
    setReadingImage(true);
    try {
      const base64 = await fileAsBase64(file);
      const nextPreview = URL.createObjectURL(file);
      setPreviewUrl(nextPreview);
      setSelectedImage({ base64, mimeType: file.type as Product['imageMimeType'] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a imagem.');
    } finally {
      setReadingImage(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saveInFlightRef.current) return;
    setError('');
    setFeedback('');
    const priceCents = parseBrlPriceCents(priceInput);
    if (!name.trim()) { setError('Informe o nome do produto.'); return; }
    if (priceCents === null) { setError('Informe um valor válido em reais.'); return; }
    if (!editingProduct && !selectedImage) { setError('Selecione uma imagem para o produto.'); return; }
    if (readingImage) return;

    const wasEditing = Boolean(editingProduct);
    const productId = editingProduct?.id;
    setSaving(true);
    saveInFlightRef.current = true;
    try {
      const input = {
        name: name.trim(),
        priceCents,
        ...(selectedImage ? { imageBase64: selectedImage.base64, imageMimeType: selectedImage.mimeType } : {}),
      };
      let savedProduct: Product;
      try {
        const result = wasEditing
          ? await updateProduct(productId!, input)
          : await createProduct(input as typeof input & { imageBase64: string; imageMimeType: Product['imageMimeType'] });
        savedProduct = result.product;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o produto.');
        return;
      }

      applySavedProduct(savedProduct);
      resetForm();
      const successMessage = wasEditing ? 'Produto atualizado.' : 'Produto cadastrado.';
      setFeedback(successMessage);
      try {
        await loadProducts(search);
      } catch {
        setError(`${successMessage.replace(/\.$/, '')}, mas não foi possível atualizar a lista. Recarregue a página para sincronizar.`);
      }
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget || archiveInFlightRef.current) return;
    const productId = archiveTarget.id;
    setArchiving(true);
    archiveInFlightRef.current = true;
    setError('');
    setFeedback('');
    try {
      try {
        await archiveProduct(productId);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Não foi possível arquivar o produto.');
        setArchiveTarget(null);
        return;
      }

      setProducts((current) => current.filter((product) => product.id !== productId));
      setFeedback('Produto arquivado.');
      setArchiveTarget(null);
      try {
        await loadProducts(search);
      } catch {
        setError('Produto arquivado, mas não foi possível atualizar a lista. Recarregue a página para sincronizar.');
      }
    } finally {
      archiveInFlightRef.current = false;
      setArchiving(false);
    }
  };

  const openBlingLink = (product: Product) => {
    setOpenMenuId(null);
    setBlingLinkTarget(product);
    setBlingSearch('');
    setBlingProducts([]);
    setBlingError('');
  };

  useEffect(() => {
    if (!blingLinkTarget) return;
    const controller = new AbortController();
    setBlingLoading(true);
    setBlingError('');
    const timer = window.setTimeout(() => {
      void fetchBlingProducts(blingSearch, controller.signal)
        .then((result) => setBlingProducts(result.data || []))
        .catch((reason) => {
          if (reason?.name !== 'AbortError') setBlingError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo Bling.');
        })
        .finally(() => setBlingLoading(false));
    }, blingSearch.trim() ? 180 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [blingLinkTarget, blingSearch]);

  const selectBlingProduct = async (blingProduct: BlingProduct) => {
    if (!blingLinkTarget || blingLinking) return;
    setBlingLinking(true);
    setBlingError('');
    try {
      const result = await linkProductToBling(blingLinkTarget.id, blingProduct.id);
      setBlingLinks((current) => ({ ...current, [blingLinkTarget.id]: result.link }));
      setFeedback(`Vínculo Bling salvo para “${blingLinkTarget.name}”.`);
      setBlingLinkTarget(null);
    } catch (reason) {
      setBlingError(reason instanceof Error ? reason.message : 'Não foi possível vincular o produto Bling.');
    } finally {
      setBlingLinking(false);
    }
  };

  const removeBlingLink = async (product: Product) => {
    if (blingLinking || !window.confirm(`Remover o vínculo Bling de “${product.name}”? O produto local será preservado.`)) return;
    setBlingLinking(true);
    setError('');
    try {
      await unlinkProductFromBling(product.id);
      setBlingLinks((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
      setFeedback('Vínculo Bling removido.');
      setOpenMenuId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível remover o vínculo Bling.');
    } finally {
      setBlingLinking(false);
    }
  };

  return (
    <section className="max-w-5xl space-y-5" aria-labelledby="products-settings-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="products-settings-title" className="text-lg font-extrabold text-zinc-100">Produtos</h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-400">Cadastre produtos para reutilizar imagens e valores nos atendimentos.</p>
        </div>
        {isAdmin && <button type="button" onClick={openNewProduct} className="btn-primary text-sm"><Plus className="h-4 w-4" /> Adicionar produto</button>}
      </div>

      {!isAdmin && <p className="rounded-lg border border-zinc-800 bg-[#0C0C0E] p-3 text-xs text-zinc-400">Somente administradores podem cadastrar, editar ou arquivar produtos.</p>}
      {feedback && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{feedback}</p>}
      {error && !showForm && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto..." aria-label="Buscar produto" className="w-full rounded-lg border border-zinc-800 bg-[#0C0C0E] py-3 pl-10 pr-3 text-sm text-zinc-100 outline-none focus:border-amber-400" />
      </label>

      {loading ? <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-[#0C0C0E] p-10 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin text-amber-400" /> Carregando produtos...</div>
        : products.length > 0 ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <article key={product.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0C0C0E]">
              <div className="flex aspect-[4/3] items-center justify-center bg-zinc-900 p-4">
                <img src={product.imageUrl} alt={`Imagem do produto ${product.name}`} className="h-full w-full object-contain" />
              </div>
              <div className="p-4">
                <h3 className="truncate text-sm font-bold text-zinc-100" title={product.name}>{product.name}</h3>
                <p className="mt-1 text-base font-extrabold text-amber-300">{formatBrlPrice(product.priceCents)}</p>
                {blingLinks[product.id] && <p className="mt-2 flex items-center gap-1.5 text-xs text-sky-300" title={`Produto Bling ${blingLinks[product.id]!.blingProductId}`}><Link2 className="h-3.5 w-3.5" /> Bling #{blingLinks[product.id]!.blingProductId}</p>}
                {isAdmin && <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-800 pt-3">
                  <button type="button" onClick={() => openEditor(product)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/20 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-400/10"><PencilLine className="h-3.5 w-3.5" /> Editar</button>
                  <div className="relative">
                    <button type="button" aria-label={`Ações de ${product.name}`} aria-expanded={openMenuId === product.id} onClick={() => setOpenMenuId((current) => current === product.id ? null : product.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"><MoreVertical className="h-4 w-4" /></button>
                     {openMenuId === product.id && <div className="absolute right-0 top-full z-10 mt-1 min-w-48 rounded-lg border border-zinc-700 bg-[#20292f] p-1 shadow-xl">
                       <button type="button" onClick={() => openBlingLink(product)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-sky-300 hover:bg-sky-500/10"><RefreshCw className="h-3.5 w-3.5" /> {blingLinks[product.id] ? 'Atualizar vínculo Bling' : 'Vincular ao Bling'}</button>
                       {blingLinks[product.id] && <button type="button" onClick={() => void removeBlingLink(product)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-zinc-300 hover:bg-white/5"><Unlink className="h-3.5 w-3.5" /> Remover vínculo</button>}
                       <button type="button" onClick={() => { setArchiveTarget(product); setOpenMenuId(null); }} className="w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-red-300 hover:bg-red-500/10">Arquivar</button>
                     </div>}
                  </div>
                </div>}
              </div>
            </article>
          ))}
        </div> : <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center sm:p-10">
          <Package className="mx-auto h-8 w-8 text-zinc-600" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-zinc-300">{search.trim() ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.'}</p>
          {!search.trim() && isAdmin && <button type="button" onClick={openNewProduct} className="btn-primary mt-5 text-sm"><Plus className="h-4 w-4" /> Adicionar primeiro produto</button>}
        </div>}

      {showForm && <ProductDialog title={editingProduct ? 'Editar produto' : 'Adicionar produto'} onClose={resetForm}>
        <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
          <div>
            <span className="mb-1.5 block text-sm font-bold text-zinc-300">Imagem *</span>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Imagem do produto" className="sr-only" onChange={(event) => { void chooseImage(event.currentTarget.files?.[0]); }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void chooseImage(event.dataTransfer.files[0]); }} className="flex min-h-44 w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-zinc-700 bg-zinc-900 p-3 text-center hover:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400">
              {(previewUrl || editingProduct?.imageUrl) ? <img src={previewUrl || editingProduct?.imageUrl} alt="Pré-visualização da imagem do produto" className="max-h-64 w-full object-contain" /> : <><ImagePlus className="h-8 w-8 text-zinc-500" /><span className="mt-2 text-sm font-semibold text-zinc-300">Escolher ou soltar uma imagem</span><span className="mt-1 text-xs text-zinc-500">JPEG, PNG ou WebP · até 1 MB</span></>}
            </button>
          </div>
          <label className="block text-sm font-bold text-zinc-300">Nome *
            <input required autoFocus data-dialog-autofocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" placeholder="V-Floc 500ml" />
          </label>
          <label className="block text-sm font-bold text-zinc-300">Valor *
            <input required inputMode="numeric" value={formatBrlPriceInput(priceInput)} onChange={(event) => setPriceInput(event.currentTarget.value.replace(/\D/g, '').slice(0, 10))} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none focus:border-amber-400" placeholder="R$ 0,00" aria-describedby="product-price-hint" />
            <span id="product-price-hint" className="mt-1 block text-xs font-normal text-zinc-500">Digite os centavos por último. Ex.: 3990 = R$ 39,90.</span>
          </label>
          {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={resetForm} disabled={saving} className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-white/5 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={saving || readingImage} className="btn-primary justify-center text-sm disabled:cursor-wait disabled:opacity-60">{saving || readingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Salvando...' : 'Salvar produto'}</button>
          </div>
        </form>
      </ProductDialog>}

      {archiveTarget && <ProductDialog title="Arquivar produto?" onClose={() => { if (!archiving) setArchiveTarget(null); }}>
        <p className="text-sm leading-6 text-zinc-300">“{archiveTarget.name}” deixará de aparecer na busca e no seletor de produtos. O cadastro e a imagem serão preservados.</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={archiving} onClick={() => setArchiveTarget(null)} className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-white/5 disabled:opacity-50">Cancelar</button>
          <button type="button" disabled={archiving} onClick={() => void confirmArchive()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-red-400 disabled:opacity-50">{archiving && <Loader2 className="h-4 w-4 animate-spin" />} Arquivar</button>
        </div>
      </ProductDialog>}

      {blingLinkTarget && <ProductDialog title={`Vincular “${blingLinkTarget.name}” ao Bling`} onClose={() => { if (!blingLinking) setBlingLinkTarget(null); }}>
        <p className="text-sm leading-6 text-zinc-300">Escolha um produto do Bling. O vínculo atualiza apenas a referência externa e os dados de leitura; nome, valor, imagem local e snapshots de mensagens permanecem inalterados.</p>
        <label className="relative mt-4 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
          <input value={blingSearch} onChange={(event) => setBlingSearch(event.target.value)} placeholder="Buscar no catálogo Bling..." aria-label="Buscar produto no Bling" data-dialog-autofocus className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-3 pl-10 pr-3 text-sm text-zinc-100 outline-none focus:border-amber-400" />
        </label>
        {blingError && <p role="alert" className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{blingError}</p>}
        {blingLoading ? <div className="flex items-center justify-center gap-2 p-8 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin text-amber-400" /> Consultando Bling...</div>
          : blingProducts.length > 0 ? <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">{blingProducts.map((blingProduct) => <button key={blingProduct.id} type="button" disabled={blingLinking} onClick={() => void selectBlingProduct(blingProduct)} className="flex w-full items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-left hover:border-sky-400/50 disabled:opacity-50"><span className="min-w-0"><span className="block truncate text-sm font-bold text-zinc-100">{blingProduct.nome}</span><span className="mt-1 block text-xs text-zinc-500">ID {blingProduct.id}{blingProduct.codigo ? ` · ${blingProduct.codigo}` : ''}</span></span><span className="shrink-0 text-xs font-bold text-amber-300">{blingProduct.preco === undefined ? 'Sem preço' : formatBrlPrice(Math.round(blingProduct.preco * 100))}</span></button>)}</div>
          : <p className="mt-5 rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">Nenhum produto Bling encontrado.</p>}
        <div className="mt-5 flex justify-end border-t border-zinc-800 pt-4"><button type="button" disabled={blingLinking} onClick={() => setBlingLinkTarget(null)} className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-white/5">Cancelar</button></div>
      </ProductDialog>}
    </section>
  );
};
