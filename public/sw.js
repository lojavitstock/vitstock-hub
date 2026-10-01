self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conversationId = event.notification.data?.conversationId;
  if (typeof conversationId !== 'string' || !conversationId) return;

  const targetUrl = new URL(
    `/atendimento?conversation=${encodeURIComponent(conversationId)}`,
    self.location.origin,
  ).href;

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existingClient = clients.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    if (existingClient) {
      await existingClient.focus();
      existingClient.postMessage({ type: 'vitstock:open-conversation', conversationId });
      return;
    }

    await self.clients.openWindow(targetUrl);
  })());
});
