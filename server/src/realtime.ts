import type { ServerResponse } from 'node:http';

type RealtimeClient = {
  raw: ServerResponse;
  heartbeat: NodeJS.Timeout;
  cleanup: () => void;
};

const clientsByCompany = new Map<string, Set<RealtimeClient>>();
let eventSequence = 0;

function removeClient(companyId: string, client: RealtimeClient) {
  const clients = clientsByCompany.get(companyId);
  if (!clients) return;
  clients.delete(client);
  if (clients.size === 0) clientsByCompany.delete(companyId);
  clearInterval(client.heartbeat);
}

export function registerRealtimeClient(companyId: string, raw: ServerResponse) {
  const client: RealtimeClient = {
    raw,
    heartbeat: undefined as unknown as NodeJS.Timeout,
    cleanup: () => undefined,
  };

  client.cleanup = () => removeClient(companyId, client);
  client.heartbeat = setInterval(() => {
    if (raw.writableEnded || raw.destroyed) {
      client.cleanup();
      return;
    }
    try {
      raw.write(': heartbeat\n\n');
    } catch {
      client.cleanup();
    }
  }, 25_000);

  const clients = clientsByCompany.get(companyId) || new Set<RealtimeClient>();
  clients.add(client);
  clientsByCompany.set(companyId, clients);
  raw.on('close', client.cleanup);
  raw.on('error', client.cleanup);
  return client.cleanup;
}

export function publishRealtimeEvent(companyId: string, type: string, data: Record<string, unknown>) {
  const clients = clientsByCompany.get(companyId);
  if (!clients || clients.size === 0) return;

  const id = String(++eventSequence);
  const payload = `id: ${id}\nevent: evolution\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const client of Array.from(clients)) {
    if (client.raw.writableEnded || client.raw.destroyed) {
      client.cleanup();
      continue;
    }
    try {
      client.raw.write(payload);
    } catch {
      client.cleanup();
    }
  }
}
