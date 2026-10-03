import { useEffect, useState } from 'react';
import type { Product } from '../types';
import { fetchProducts } from '../services/productsApi';

export function useProductSearch(search: string | null) {
  const [result, setResult] = useState<{ query: string | null; products: Product[]; loading: boolean; error: string }>({ query: null, products: [], loading: false, error: '' });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useEffect(() => {
    if (search === null) return;
    let current = true;
    const controller = new AbortController();
    setResult({ query: search, products: [], loading: true, error: '' });
    const timer = window.setTimeout(() => {
      void fetchProducts(search, controller.signal)
        .then((response) => { if (current) setResult({ query: search, products: response.products || [], loading: false, error: '' }); })
        .catch((reason) => { if (current) setResult({ query: search, products: [], loading: false, error: reason instanceof Error ? reason.message : 'Não foi possível buscar produtos.' }); });
    }, search.trim() ? 180 : 0);
    return () => {
      current = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, revision]);

  return search === null ? { products: [], loading: false, error: '' }
    : result.query === search ? result : { products: [], loading: true, error: '' };
}
