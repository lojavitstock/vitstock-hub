import { apiRequest } from './api';

const BLING_CATALOG_REQUEST_TIMEOUT_MS = 120_000;

export type BlingProduct = {
  id: string;
  nome: string;
  codigo?: string;
  preco?: number;
  tipo: 'S' | 'P' | 'N';
  situacao: 'A' | 'I' | 'E';
  formato: 'S' | 'V' | 'E';
  idProdutoPai?: string;
};

export type BlingCatalogPage = {
  data: BlingProduct[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  generationId: string;
  syncedAt: string;
  stale: boolean;
  refreshFailed: boolean;
  refreshing: boolean;
};

export type BlingProductDetail = BlingProduct & {
  unidade?: string;
  gtin?: string;
  idProdutoPai?: string;
};

export type BlingProductStock = {
  produto: { id: string };
  saldoFisicoTotal?: number;
  saldoVirtualTotal?: number;
};

export type BlingContactCandidate = { id: string; name: string; document: string | null; phone: string | null };
export type BlingContactLookup =
  | { status: 'not_found' }
  | { status: 'multiple'; matches: BlingContactCandidate[]; truncated: boolean }
  | {
    status: 'found';
    contact: {
      id: string;
      name: string;
      fantasy: string | null;
      document: string | null;
      zipCode: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
    };
    orders: Array<{ id: string | null; number: string | null; date: string | null; total: number | null }>;
    ordersTruncated: boolean;
    ordersError: string | null;
  };

export function lookupBlingContact(phone: string, contactId?: string, signal?: AbortSignal) {
  return apiRequest<BlingContactLookup>('/api/integrations/bling/contact-lookup', {
    method: 'POST',
    body: JSON.stringify({ phone, ...(contactId ? { contactId } : {}) }),
    signal,
  });
}

export type ProductBlingLink = {
  productId: string;
  blingProductId: string;
  blingParentProductId: string | null;
  blingName: string;
  blingCode: string | null;
  blingGtin: string | null;
  blingUnit: string | null;
  blingPriceCents: number;
  blingStatus: 'A' | 'I';
  blingFormat: 'S' | 'V' | 'E';
  stockPhysicalTotal: string | null;
  stockVirtualTotal: string | null;
  lastSyncedAt: string;
  stockSyncedAt: string | null;
  stockSyncAttemptedAt: string | null;
  stockSyncError: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function fetchBlingProducts(search = '', page = 1, signal?: AbortSignal, generationId?: string) {
  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (search.trim()) params.set('q', search.trim());
  if (generationId) params.set('generationId', generationId);
  return apiRequest<BlingCatalogPage>(`/api/integrations/bling/products?${params.toString()}`,
    { signal, timeoutMs: BLING_CATALOG_REQUEST_TIMEOUT_MS });
}

export async function refreshBlingProductCatalog() {
  return apiRequest<{ generationId: string; syncedAt: string; products: number; pages: number }>(
    '/api/integrations/bling/products/catalog-sync', { method: 'POST', timeoutMs: BLING_CATALOG_REQUEST_TIMEOUT_MS });
}

export async function fetchBlingProductDetail(id: string, signal?: AbortSignal) {
  return apiRequest<{ data: BlingProductDetail }>(`/api/integrations/bling/products/${encodeURIComponent(id)}`, { signal });
}

export async function fetchBlingProductStock(id: string, signal?: AbortSignal) {
  return apiRequest<{ data: BlingProductStock[] }>(`/api/integrations/bling/products/${encodeURIComponent(id)}/stock`, { signal });
}

export async function fetchBlingConnectionStatus() {
  return apiRequest<{ configured: boolean; connected: boolean; connectedAt: string | null }>('/api/integrations/bling/status');
}

export async function fetchProductBlingLinks() {
  return apiRequest<{ links: ProductBlingLink[] }>('/api/products/bling-links');
}

export async function linkProductToBling(productId: string, blingProductId: string) {
  return apiRequest<{ product: import('../types').Product }>(`/api/products/${encodeURIComponent(productId)}/bling-link`, {
    method: 'POST',
    body: JSON.stringify({ blingProductId }),
  });
}

export async function syncProductFromBling(productId: string) {
  return apiRequest<{ product: import('../types').Product }>(`/api/products/${encodeURIComponent(productId)}/bling-sync`, { method: 'POST' });
}

export async function importProductFromBling(input: {
  blingProductId: string;
  name: string;
  imageBase64: string;
  imageMimeType: import('../types').Product['imageMimeType'];
}) {
  return apiRequest<{ product: import('../types').Product }>('/api/products/bling-import', {
    method: 'POST', body: JSON.stringify(input),
  });
}
