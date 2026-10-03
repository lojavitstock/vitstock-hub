import { apiRequest } from './api';

export type BlingProduct = {
  id: string;
  nome: string;
  codigo?: string;
  preco?: number;
  tipo: 'S' | 'P' | 'N';
  situacao: 'A' | 'I' | 'E';
  formato: 'S' | 'V' | 'E';
};

export type ProductBlingLink = {
  productId: string;
  blingProductId: string;
  blingName: string;
  blingCode: string | null;
  blingPriceCents: number | null;
  blingSituacao: 'A' | 'I';
  blingFormato: 'S' | 'V' | 'E';
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
};

export async function fetchBlingProducts(search = '', signal?: AbortSignal) {
  const params = new URLSearchParams({ page: '1', limit: '50' });
  if (search.trim()) params.set('nome', search.trim());
  return apiRequest<{ data: BlingProduct[] }>(`/api/integrations/bling/products?${params.toString()}`, { signal });
}

export async function fetchProductBlingLinks() {
  return apiRequest<{ links: ProductBlingLink[] }>('/api/products/bling-links');
}

export async function linkProductToBling(productId: string, blingProductId: string) {
  return apiRequest<{ link: ProductBlingLink }>(`/api/products/${encodeURIComponent(productId)}/bling-link`, {
    method: 'POST',
    body: JSON.stringify({ blingProductId }),
  });
}

export async function unlinkProductFromBling(productId: string) {
  return apiRequest<{ unlinked: boolean; productId: string }>(`/api/products/${encodeURIComponent(productId)}/bling-link`, { method: 'DELETE' });
}
