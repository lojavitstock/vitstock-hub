import { apiRequest } from './api';
import type { Product } from '../types';

export type ProductInput = {
  name: string;
  priceCents: number;
  imageBase64?: string;
  imageMimeType?: Product['imageMimeType'];
};

export async function fetchProducts(search = '', signal?: AbortSignal) {
  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return apiRequest<{ products: Product[] }>(`/api/products${query}`, { signal });
}

export async function createProduct(input: ProductInput) {
  return apiRequest<{ product: Product }>('/api/products', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateProduct(id: string, input: Partial<ProductInput>) {
  return apiRequest<{ product: Product }>(`/api/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function archiveProduct(id: string) {
  return apiRequest<{ archived: boolean; id: string }>(`/api/products/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}
