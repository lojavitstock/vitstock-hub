const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const REQUEST_TIMEOUT_MS = 20_000;

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  init?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: 'include',
      headers,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new Error('O servidor demorou mais que o esperado para responder. Tente novamente.');
    }
    const target = API_URL.includes('localhost') ? 'a API local em http://localhost:3001' : 'o servidor da aplicação';
    throw new Error(`Não foi possível conectar ${target}.`);
  } finally {
    window.clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', onAbort);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'Não foi possível concluir a solicitação');
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
