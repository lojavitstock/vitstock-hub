const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:3001';
const REQUEST_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MESSAGE = 'O servidor demorou mais que o esperado para responder. Tente novamente.';

function callerAbortError(signal?: AbortSignal | null): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('A solicitação foi cancelada.');
  error.name = 'AbortError';
  return error;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const callerSignal = init?.signal;
  if (callerSignal?.aborted) throw callerAbortError(callerSignal);

  let response: Response;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort(callerAbortError(callerSignal));
  callerSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    try {
      response = await fetch(`${API_URL}${path}`, {
        ...init,
        signal: controller.signal,
        credentials: 'include',
        headers,
      });
    } catch (error) {
      if (callerSignal?.aborted) throw callerAbortError(callerSignal);
      if (timedOut) throw new Error(REQUEST_TIMEOUT_MESSAGE);
      if ((error as { name?: string })?.name === 'AbortError') throw error;
      const target = API_URL.includes('localhost') ? 'a API local em http://localhost:3001' : 'o servidor da aplicação';
      throw new Error(`Não foi possível conectar ${target}.`);
    }

    if (!response.ok) {
      let body: { error?: string } | null = null;
      try {
        body = await response.json() as { error?: string };
      } catch (error) {
        if (callerSignal?.aborted) throw callerAbortError(callerSignal);
        if (timedOut) throw new Error(REQUEST_TIMEOUT_MESSAGE);
        if ((error as { name?: string })?.name === 'AbortError') throw error;
      }
      throw new Error(body?.error || 'Não foi possível concluir a solicitação');
    }

    if (response.status === 204) return undefined as T;
    try {
      return await response.json() as T;
    } catch (error) {
      if (callerSignal?.aborted) throw callerAbortError(callerSignal);
      if (timedOut) throw new Error(REQUEST_TIMEOUT_MESSAGE);
      throw error;
    }
  } finally {
    window.clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', onAbort);
  }
}
