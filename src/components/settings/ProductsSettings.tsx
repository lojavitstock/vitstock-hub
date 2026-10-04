import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Link2, Loader2, MoreVertical, Package, PencilLine, Plus, RefreshCw, Search, Save, Unlink } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useSearchParams } from 'react-router-dom';
import type { Product } from '../../types';
import type { BlingProduct } from '../../services/blingApi';
import { fetchBlingConnectionStatus, fetchBlingProducts, importProductFromBling, linkProductToBling, syncProductFromBling, unlinkProductFromBling } from '../../services/blingApi';
import { archiveProduct, createProduct, fetchProducts, updateProduct, type ProductInput } from '../../services/productsApi';
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
  const blingImageInputRef = useRef<HTMLInputElement>(null);
  const saveInFlightRef = useRef(false);
  const archiveInFlightRef = useRef(false);
  const blingMutationInFlightRef = useRef(new Set<string>());
  const importInFlightRef = useRef(false);
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
  const [blingLinkTarget, setBlingLinkTarget] = useState<Product | null>(null);
  const [blingDialogMode, setBlingDialogMode] = useState<'link' | 'relink'>('link');
  const [blingSearch, setBlingSearch] = useState('');
  const [blingProducts, setBlingProducts] = useState<BlingProduct[]>([]);
  const [blingPage, setBlingPage] = useState(1);
  const [blingHasMore, setBlingHasMore] = useState(false);
  const [blingLoading, setBlingLoading] = useState(false);
  const [blingLinking, setBlingLinking] = useState(false);
  const [blingError, setBlingError] = useState('');
  const [blingConnected, setBlingConnected] = useState<boolean | null>(null);
  const [blingSyncingId, setBlingSyncingId] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [blingImportProduct, setBlingImportProduct] = useState<BlingProduct | null>(null);
  const [blingImportImage, setBlingImportImage] = useState<SelectedImage | null>(null);
  const [blingImportPreviewUrl, setBlingImportPreviewUrl] = useState<string | null>(null);
  const [blingImporting, setBlingImporting] = useState(false);

  useEffect(() => {
    if (searchParams.get('action') !== 'new') return;
    if (isAdmin) setShowForm(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('action');
    setSearchParams(nextParams, { replace: true });
  }, [isAdmin, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isAdmin) return;
    void fetchBlingConnectionStatus()
      .then((status) => setBlingConnected(status.connected))
      .catch(() => setBlingConnected(false));
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

  useEffect(() => () => {
    if (blingImportPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(blingImportPreviewUrl);
  }, [blingImportPreviewUrl]);

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
    const linkedEditing = editingProduct?.source === 'bling';
    const priceCents = parseBrlPriceCents(priceInput);
    if (!linkedEditing && !name.trim()) { setError('Informe o nome do produto.'); return; }
    if (!linkedEditing && priceCents === null) { setError('Informe um valor válido em reais.'); return; }
    if (linkedEditing && !selectedImage) { setError('Selecione uma nova imagem para atualizar o produto vinculado.'); return; }
    if (!editingProduct && !selectedImage) { setError('Selecione uma imagem para o produto.'); return; }
    if (readingImage) return;

    const wasEditing = Boolean(editingProduct);
    const productId = editingProduct?.id;
    setSaving(true);
    saveInFlightRef.current = true;
    try {
      const input = linkedEditing
        ? { imageBase64: selectedImage!.base64, imageMimeType: selectedImage!.mimeType }
        : {
          name: name.trim(),
          priceCents: priceCents!,
          ...(selectedImage ? { imageBase64: selectedImage.base64, imageMimeType: selectedImage.mimeType } : {}),
        };
      let savedProduct: Product;
      try {
        const result = wasEditing
          ? await updateProduct(productId!, input)
          : await createProduct(input as ProductInput);
        savedProduct = result.product;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o produto.');
        return;
      }

      applySavedProduct(savedProduct);
      resetForm();
      const successMessage = linkedEditing ? 'Imagem do produto atualizada.' : wasEditing ? 'Produto atualizado.' : 'Produto cadastrado.';
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

  const resetBlingCatalog = () => {
    setBlingSearch('');
    setBlingProducts([]);
    setBlingPage(1);
    setBlingHasMore(false);
    setBlingError('');
  };

  const openBlingLink = (product: Product, mode: 'link' | 'relink') => {
    setOpenMenuId(null);
    setBlingLinkTarget(product);
    setBlingDialogMode(mode);
    resetBlingCatalog();
  };

  const openImportDialog = () => {
    resetBlingCatalog();
    setBlingImportProduct(null);
    setBlingImportImage(null);
    setBlingImportPreviewUrl(null);
    if (blingImageInputRef.current) blingImageInputRef.current.value = '';
    setShowImportDialog(true);
  };

  const changeBlingSearch = (value: string) => {
    setBlingSearch(value);
    setBlingPage(1);
    setBlingProducts([]);
    setBlingHasMore(false);
  };

  useEffect(() => {
    if (!blingLinkTarget && !showImportDialog) return;
    if (blingConnected === false) {
      setBlingError('O Bling não está conectado. Conecte-o em Configurações → Integrações para usar esta ação.');
      return;
    }
    const controller = new AbortController();
    setBlingLoading(true);
    setBlingError('');
    const timer = window.setTimeout(() => {
      void fetchBlingProducts(blingSearch, blingPage, controller.signal)
        .then((result) => {
          const items = result.data || [];
          setBlingProducts((current) => blingPage === 1
            ? items
            : [...current, ...items.filter((item) => !current.some((existing) => existing.id === item.id))]);
          setBlingHasMore(items.length === result.limit);
          setBlingConnected(true);
        })
        .catch((reason) => {
          if (reason?.name !== 'AbortError') {
            const message = reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo Bling.';
            setBlingError(message);
            if (/não conectado|não está conectado/i.test(message)) setBlingConnected(false);
          }
        })
        .finally(() => setBlingLoading(false));
    }, blingSearch.trim() ? 180 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [blingLinkTarget, showImportDialog, blingSearch, blingPage, blingConnected]);

  const selectBlingProduct = async (blingProduct: BlingProduct) => {
    if (showImportDialog) {
      setBlingImportProduct(blingProduct);
      return;
    }
    if (!blingLinkTarget || blingLinking) return;
    setBlingLinking(true);
    setBlingError('');
    try {
      const result = await linkProductToBling(blingLinkTarget.id, blingProduct.id);
      applySavedProduct(result.product);
      setBlingConnected(true);
      setFeedback(blingDialogMode === 'relink'
        ? `Produto Bling alterado para “${result.product.name}”.`
        : `Produto vinculado ao Bling: “${result.product.name}”.`);
      setBlingLinkTarget(null);
      try { await loadProducts(search); } catch { /* estado local já atualizado */ }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível vincular o produto Bling.';
      setBlingError(message);
      if (/não conectado|não está conectado/i.test(message)) setBlingConnected(false);
    } finally {
      setBlingLinking(false);
    }
  };

  const chooseBlingImportImage = async (file?: File) => {
    if (!file) return;
    setBlingError('');
    if (!allowedImageTypes.has(file.type)) { setBlingError('Use uma imagem JPEG, PNG ou WebP.'); return; }
    if (file.size < 1 || file.size > maxImageBytes) { setBlingError('A imagem deve ter entre 1 byte e 1 MB.'); return; }
    setReadingImage(true);
    try {
      const base64 = await fileAsBase64(file);
      setBlingImportPreviewUrl(URL.createObjectURL(file));
      setBlingImportImage({ base64, mimeType: file.type as Product['imageMimeType'] });
    } catch (reason) {
      setBlingError(reason instanceof Error ? reason.message : 'Não foi possível carregar a imagem.');
    } finally {
      setReadingImage(false);
    }
  };

  const confirmBlingImport = async () => {
    if (!blingImportProduct || !blingImportImage || importInFlightRef.current || readingImage) {
      if (!blingImportProduct) setBlingError('Selecione um produto do Bling.');
      else if (!blingImportImage) setBlingError('Selecione uma imagem local para continuar.');
      return;
    }
    importInFlightRef.current = true;
    setBlingImporting(true);
    setBlingError('');
    try {
      const result = await importProductFromBling({
        blingProductId: blingImportProduct.id,
        imageBase64: blingImportImage.base64,
        imageMimeType: blingImportImage.mimeType,
      });
      applySavedProduct(result.product);
      setBlingConnected(true);
      setShowImportDialog(false);
      setFeedback(`Produto Bling importado: “${result.product.name}”.`);
      try { await loadProducts(search); } catch { /* estado local já atualizado */ }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível importar o produto Bling.';
      setBlingError(message);
      if (/não conectado|não está conectado/i.test(message)) setBlingConnected(false);
    } finally {
      importInFlightRef.current = false;
      setBlingImporting(false);
    }
  };

  const syncBlingProduct = async (product: Product) => {
    if (blingMutationInFlightRef.current.has(product.id)) return;
    blingMutationInFlightRef.current.add(product.id);
    setBlingSyncingId(product.id);
    setError('');
    setFeedback('');
    try {
      const result = await syncProductFromBling(product.id);
      applySavedProduct(result.product);
      setBlingConnected(true);
      setFeedback(`Produto sincronizado do Bling: “${result.product.name}”.`);
      setOpenMenuId(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível sincronizar o produto Bling.';
      setError(message);
      if (/não conectado|não está conectado/i.test(message)) setBlingConnected(false);
    } finally {
      blingMutationInFlightRef.current.delete(product.id);
      setBlingSyncingId(null);
    }
  };

  const removeBlingLink = async (product: Product) => {
    if (blingMutationInFlightRef.current.has(product.id)
      || !window.confirm(`Desvincular “${product.name}” do Bling? O nome, preço, imagem e histórico existentes serão preservados.`)) return;
    blingMutationInFlightRef.current.add(product.id);
    setError('');
    try {
      const result = await unlinkProductFromBling(product.id);
      applySavedProduct(result.product);
      setFeedback('Produto desvinculado; nome e preço voltaram a ser locais.');
      setOpenMenuId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível remover o vínculo Bling.');
    } finally {
      blingMutationInFlightRef.current.delete(product.id);
    }
  };

  return (
    <section className="max-w-5xl space-y-5" aria-labelledby="products-settings-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="products-settings-title" className="text-lg font-extrabold text-zinc-100">Produtos</h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-400">Cadastre produtos para reutilizar imagens e valores nos atendimentos.</p>
        </div>
        {isAdmin && <div className="flex flex-wrap gap-2">
          <button type="button" onClick={openImportDialog} className="rounded-lg border border-sky-500/30 px-3 py-2.5 text-sm font-bold text-sky-300 hover:bg-sky-500/10">Importar do Bling</button>
          <button type="button" onClick={openNewProduct} className="btn-primary text-sm"><Plus className="h-4 w-4" /> Adicionar produto</button>
        </div>}
      </div>

      {isAdmin && blingConnected === false && <p role="status" className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">Bling desconectado. Os produtos vinculados continuam disponíveis com os dados em cache; para importar, vincular ou sincronizar, conecte-o em Configurações → Integrações.</p>}

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
                {product.source === 'bling' && product.bling && <div className="mt-2 space-y-1.5 text-xs text-sky-200">
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 font-bold"><Link2 className="h-3 w-3" /> Bling</span>
                  <p>SKU: {product.bling.code || 'não informado'}{product.bling.gtin ? ` · GTIN ${product.bling.gtin}` : ''}</p>
                  <p>Físico: {product.bling.stockPhysicalTotal ?? 'não informado'} · Virtual: {product.bling.stockVirtualTotal ?? 'não informado'}</p>
                  <p className="text-zinc-500">Sincronizado: {new Date(product.bling.syncedAt).toLocaleString('pt-BR')}</p>
                </div>}
                {isAdmin && <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-800 pt-3">
                  <button type="button" onClick={() => openEditor(product)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/20 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-400/10"><PencilLine className="h-3.5 w-3.5" /> {product.source === 'bling' ? 'Editar imagem' : 'Editar'}</button>
                  <div className="relative">
                    <button type="button" aria-label={`Ações de ${product.name}`} aria-expanded={openMenuId === product.id} onClick={() => setOpenMenuId((current) => current === product.id ? null : product.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"><MoreVertical className="h-4 w-4" /></button>
                     {openMenuId === product.id && <div className="absolute right-0 top-full z-10 mt-1 min-w-48 rounded-lg border border-zinc-700 bg-[#20292f] p-1 shadow-xl">
                       {product.source === 'bling'
                         ? <>
                           <button type="button" disabled={blingSyncingId === product.id} onClick={() => void syncBlingProduct(product)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> {blingSyncingId === product.id ? 'Sincronizando...' : 'Atualizar do Bling'}</button>
                           <button type="button" onClick={() => openBlingLink(product, 'relink')} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-sky-300 hover:bg-sky-500/10"><Link2 className="h-3.5 w-3.5" /> Alterar produto Bling</button>
                           <button type="button" onClick={() => void removeBlingLink(product)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-zinc-300 hover:bg-white/5"><Unlink className="h-3.5 w-3.5" /> Desvincular do Bling</button>
                         </>
                         : <button type="button" onClick={() => openBlingLink(product, 'link')} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-sky-300 hover:bg-sky-500/10"><Link2 className="h-3.5 w-3.5" /> Vincular ao Bling</button>}
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

      {showForm && <ProductDialog title={editingProduct?.source === 'bling' ? 'Editar imagem do produto' : editingProduct ? 'Editar produto' : 'Adicionar produto'} onClose={resetForm}>
        <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
          <div>
            <span className="mb-1.5 block text-sm font-bold text-zinc-300">Imagem *</span>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Imagem do produto" className="sr-only" onChange={(event) => { void chooseImage(event.currentTarget.files?.[0]); }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void chooseImage(event.dataTransfer.files[0]); }} className="flex min-h-44 w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-zinc-700 bg-zinc-900 p-3 text-center hover:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400">
              {(previewUrl || editingProduct?.imageUrl) ? <img src={previewUrl || editingProduct?.imageUrl} alt="Pré-visualização da imagem do produto" className="max-h-64 w-full object-contain" /> : <><ImagePlus className="h-8 w-8 text-zinc-500" /><span className="mt-2 text-sm font-semibold text-zinc-300">Escolher ou soltar uma imagem</span><span className="mt-1 text-xs text-zinc-500">JPEG, PNG ou WebP · até 1 MB</span></>}
            </button>
          </div>
          <label className="block text-sm font-bold text-zinc-300">Nome{editingProduct?.source === 'bling' ? '' : ' *'}
            <input required={editingProduct?.source !== 'bling'} readOnly={editingProduct?.source === 'bling'} autoFocus data-dialog-autofocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none read-only:cursor-not-allowed read-only:opacity-70 focus:border-amber-400" placeholder="V-Floc 500ml" />
            {editingProduct?.source === 'bling' && <span className="mt-1 block text-xs font-normal text-sky-300">Gerenciado pelo Bling</span>}
          </label>
          <label className="block text-sm font-bold text-zinc-300">Valor{editingProduct?.source === 'bling' ? '' : ' *'}
            <input required={editingProduct?.source !== 'bling'} readOnly={editingProduct?.source === 'bling'} inputMode="numeric" value={formatBrlPriceInput(priceInput)} onChange={(event) => setPriceInput(event.currentTarget.value.replace(/\D/g, '').slice(0, 10))} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-base text-zinc-100 outline-none read-only:cursor-not-allowed read-only:opacity-70 focus:border-amber-400" placeholder="R$ 0,00" aria-describedby="product-price-hint" />
            {editingProduct?.source === 'bling' ? <span id="product-price-hint" className="mt-1 block text-xs font-normal text-sky-300">Gerenciado pelo Bling</span> : <span id="product-price-hint" className="mt-1 block text-xs font-normal text-zinc-500">Digite os centavos por último. Ex.: 3990 = R$ 39,90.</span>}
          </label>
          {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={resetForm} disabled={saving} className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-white/5 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={saving || readingImage} className="btn-primary justify-center text-sm disabled:cursor-wait disabled:opacity-60">{saving || readingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Salvando...' : editingProduct?.source === 'bling' ? 'Salvar imagem' : 'Salvar produto'}</button>
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

      {blingLinkTarget && <ProductDialog title={blingDialogMode === 'relink' ? `Alterar produto Bling de “${blingLinkTarget.name}”` : `Vincular “${blingLinkTarget.name}” ao Bling`} onClose={() => { if (!blingLinking) setBlingLinkTarget(null); }}>
        <p className="text-sm leading-6 text-zinc-300">{blingDialogMode === 'relink'
          ? 'Escolha outro produto Bling. Nome, preço e estoque locais passarão a refletir o novo produto; imagem e histórico de mensagens serão preservados.'
          : 'Escolha um produto Bling. Nome, preço e estoque serão sincronizados do Bling. A imagem local e snapshots históricos serão preservados.'}</p>
        <label className="relative mt-4 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
          <input value={blingSearch} onChange={(event) => changeBlingSearch(event.target.value)} placeholder="Buscar no catálogo Bling..." aria-label="Buscar produto no Bling" data-dialog-autofocus className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-3 pl-10 pr-3 text-sm text-zinc-100 outline-none focus:border-amber-400" />
        </label>
        {blingError && <p role="alert" className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{blingError}</p>}
        {blingLoading ? <div className="flex items-center justify-center gap-2 p-8 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin text-amber-400" /> Consultando Bling...</div>
          : blingProducts.length > 0 ? <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">{blingProducts.map((blingProduct) => <button key={blingProduct.id} type="button" disabled={blingLinking} onClick={() => void selectBlingProduct(blingProduct)} className="flex w-full items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-left hover:border-sky-400/50 disabled:opacity-50"><span className="min-w-0"><span className="block truncate text-sm font-bold text-zinc-100">{blingProduct.nome}</span><span className="mt-1 block text-xs text-zinc-500">ID {blingProduct.id}{blingProduct.codigo ? ` · ${blingProduct.codigo}` : ' · SKU não informado'} · {blingProduct.situacao === 'E' ? 'Encerrado (E)' : blingProduct.situacao === 'I' ? 'Inativo (I)' : 'Ativo (A)'} · Formato {blingProduct.formato}</span></span><span className="shrink-0 text-xs font-bold text-amber-300">{blingProduct.preco === undefined ? 'Preço não informado' : formatBrlPrice(Math.round(blingProduct.preco * 100))}</span></button>)}</div>
          : <p className="mt-5 rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">Nenhum produto Bling encontrado.</p>}
        {blingHasMore && <button type="button" disabled={blingLoading} onClick={() => setBlingPage((page) => page + 1)} className="mt-3 w-full rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-bold text-sky-300 disabled:opacity-50">{blingLoading ? 'Carregando...' : 'Carregar mais'}</button>}
        <div className="mt-5 flex justify-end border-t border-zinc-800 pt-4"><button type="button" disabled={blingLinking} onClick={() => setBlingLinkTarget(null)} className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-white/5">Cancelar</button></div>
      </ProductDialog>}

      {showImportDialog && <ProductDialog title="Importar produto do Bling" onClose={() => { if (!blingImporting) setShowImportDialog(false); }}>
        <p className="text-sm leading-6 text-zinc-300">Os dados de nome, preço, SKU e estoque vêm do Bling. Escolha uma imagem local obrigatória; imagens do Bling não são importadas.</p>
        {blingImportProduct ? <div className="mt-4 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-sm text-zinc-200">
          <div className="font-bold">{blingImportProduct.nome}</div>
          <div className="mt-1 text-xs text-zinc-400">ID {blingImportProduct.id} · {blingImportProduct.codigo || 'SKU não informado'} · {blingImportProduct.situacao === 'E' ? 'Encerrado (E)' : blingImportProduct.situacao === 'I' ? 'Inativo (I)' : 'Ativo (A)'} · Formato {blingImportProduct.formato}</div>
          <button type="button" onClick={() => setBlingImportProduct(null)} className="mt-2 text-xs font-bold text-sky-300">Escolher outro produto</button>
        </div> : <>
          <label className="relative mt-4 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
            <input value={blingSearch} onChange={(event) => changeBlingSearch(event.target.value)} placeholder="Buscar no catálogo Bling..." aria-label="Buscar produto no Bling para importar" data-dialog-autofocus className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-3 pl-10 pr-3 text-sm text-zinc-100 outline-none focus:border-amber-400" />
          </label>
          {blingLoading ? <div className="flex items-center justify-center gap-2 p-8 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin text-amber-400" /> Consultando Bling...</div>
            : blingProducts.length > 0 ? <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">{blingProducts.map((blingProduct) => <button key={blingProduct.id} type="button" onClick={() => void selectBlingProduct(blingProduct)} className="flex w-full items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-left hover:border-sky-400/50"><span className="min-w-0"><span className="block truncate text-sm font-bold text-zinc-100">{blingProduct.nome}</span><span className="mt-1 block text-xs text-zinc-500">ID {blingProduct.id} · {blingProduct.codigo || 'SKU não informado'} · {blingProduct.situacao === 'E' ? 'Encerrado (E)' : blingProduct.situacao === 'I' ? 'Inativo (I)' : 'Ativo (A)'} · Formato {blingProduct.formato}</span></span><span className="shrink-0 text-xs font-bold text-amber-300">{blingProduct.preco === undefined ? 'Preço não informado' : formatBrlPrice(Math.round(blingProduct.preco * 100))}</span></button>)}</div>
              : <p className="mt-4 rounded-lg border border-dashed border-zinc-800 p-5 text-center text-sm text-zinc-500">Nenhum produto Bling encontrado.</p>}
          {blingHasMore && <button type="button" disabled={blingLoading} onClick={() => setBlingPage((page) => page + 1)} className="mt-2 w-full rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-bold text-sky-300 disabled:opacity-50">Carregar mais</button>}
        </>}
        <div className="mt-4">
          <span className="mb-1.5 block text-sm font-bold text-zinc-300">Imagem local *</span>
          <input ref={blingImageInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Imagem local para importação" className="sr-only" onChange={(event) => { void chooseBlingImportImage(event.currentTarget.files?.[0]); }} />
          <button type="button" onClick={() => blingImageInputRef.current?.click()} className="flex min-h-28 w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-zinc-700 bg-zinc-900 p-3 text-center">
            {blingImportPreviewUrl ? <img src={blingImportPreviewUrl} alt="Prévia da imagem local" className="max-h-36 object-contain" /> : <><ImagePlus className="h-7 w-7 text-zinc-500" /><span className="mt-2 text-sm text-zinc-300">Selecionar imagem JPEG, PNG ou WebP · até 1 MB</span></>}
          </button>
        </div>
        {blingError && <p role="alert" className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{blingError}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 border-t border-zinc-800 pt-4 sm:flex-row sm:justify-end">
          <button type="button" disabled={blingImporting} onClick={() => setShowImportDialog(false)} className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-bold text-zinc-300">Cancelar</button>
          <button type="button" disabled={blingImporting || readingImage || !blingImportProduct || !blingImportImage} onClick={() => void confirmBlingImport()} className="btn-primary justify-center text-sm disabled:opacity-50">{blingImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{blingImporting ? 'Importando...' : 'Importar produto'}</button>
        </div>
      </ProductDialog>}
    </section>
  );
};
