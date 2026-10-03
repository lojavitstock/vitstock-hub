import React, { useEffect, useState } from 'react';
import { Package, ShoppingBag } from 'lucide-react';
import type { ProductMessageSnapshot } from '../../types';
import { formatBrlPrice, productStorageImageUrl } from '../../utils/productLibrary';

export const ProductMessageCard: React.FC<{ snapshot: ProductMessageSnapshot }> = ({ snapshot }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = productStorageImageUrl(snapshot.imageObjectKey, import.meta.env?.VITE_API_URL || 'http://localhost:3001');

  useEffect(() => setImageFailed(false), [snapshot.imageObjectKey]);

  return (
    <article aria-label={`Produto ${snapshot.name}`} className="my-1 w-[min(18rem,72vw)] overflow-hidden rounded-xl border border-amber-400/20 bg-[#151c20] shadow-lg">
      <div className="flex aspect-[4/3] items-center justify-center bg-zinc-900 p-3">
        {!imageFailed ? <img src={imageUrl} alt={`Imagem do produto ${snapshot.name}`} onError={() => setImageFailed(true)} className="h-full w-full object-contain" /> : <Package className="h-10 w-10 text-zinc-600" aria-hidden="true" />}
      </div>
      <div className="p-3">
        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-300"><ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" /> Produto</p>
        <p className="break-words text-sm font-bold text-zinc-100">{snapshot.name}</p>
        <p className="mt-1 text-sm font-extrabold text-amber-300">{formatBrlPrice(snapshot.priceCents)}</p>
        <p className="mt-2 text-[10px] text-zinc-500">Informação interna do Vitstock Hub</p>
      </div>
    </article>
  );
};
