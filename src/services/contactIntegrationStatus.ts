import { apiRequest } from './api';
import { checkBlingContactExistence, type BlingContactExistence } from './blingApi';

export type GoogleContactStatusResponse = {
  connected: boolean;
  saved: boolean;
  name: string | null;
  resourceName: string | null;
  email: string;
  cpf: string;
  address: string;
  addresses?: string[];
  otherPhone: string;
  otherPhones?: string[];
  emails?: string[];
  birthday?: string;
  nickname?: string;
  company?: string;
  jobTitle?: string;
  occupation?: string;
  relations?: string;
  events?: string;
  customFields?: string;
  website?: string;
  notes?: string;
};

const STATUS_CACHE_TTL_MS = 60_000;
const googleCache = new Map<string, { expiresAt: number; promise: Promise<GoogleContactStatusResponse> }>();
const blingCache = new Map<string, { expiresAt: number; promise: Promise<BlingContactExistence> }>();

function cacheKey(companyId: string, phone: string) {
  return `${companyId}:${phone.trim()}`;
}

export function fetchGoogleContactStatus(companyId: string, phone: string) {
  const key = cacheKey(companyId, phone);
  const cached = googleCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = apiRequest<GoogleContactStatusResponse>('/api/google/contact-status', {
    method: 'POST', body: JSON.stringify({ phone }),
  });
  googleCache.set(key, { expiresAt: Date.now() + STATUS_CACHE_TTL_MS, promise });
  void promise.catch(() => { if (googleCache.get(key)?.promise === promise) googleCache.delete(key); });
  return promise;
}

export function fetchBlingContactExistence(companyId: string, phone: string) {
  const key = cacheKey(companyId, phone);
  const cached = blingCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = checkBlingContactExistence(phone);
  blingCache.set(key, { expiresAt: Date.now() + STATUS_CACHE_TTL_MS, promise });
  void promise.catch(() => { if (blingCache.get(key)?.promise === promise) blingCache.delete(key); });
  return promise;
}

export function invalidateContactIntegrationStatus(companyId: string, phone?: string) {
  if (phone !== undefined) {
    const key = cacheKey(companyId, phone);
    googleCache.delete(key);
    blingCache.delete(key);
    return;
  }
  for (const key of googleCache.keys()) if (key.startsWith(`${companyId}:`)) googleCache.delete(key);
  for (const key of blingCache.keys()) if (key.startsWith(`${companyId}:`)) blingCache.delete(key);
}
