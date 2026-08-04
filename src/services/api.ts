const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor local. Verifique se a API está em http://localhost:3001.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'Não foi possível concluir a solicitação');
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
