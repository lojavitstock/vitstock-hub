import { strict as assert } from 'node:assert';
import test from 'node:test';

// Load the application only after configuring the explicitly local QA runtime.
// This keeps the Production/default app free of QA-only routes.
process.env.NODE_ENV = 'test';
process.env.QA_MODE = 'true';
process.env.PORT = '3001';
process.env.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:55432/vitstock_qa';
process.env.SESSION_SECRET = 'qa-session-secret-012345678901234567890123456789';
process.env.WEBHOOK_SECRET = 'qa-webhook-secret-012345678901234567890123456789';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.ALLOWED_FRONTEND_ORIGINS = '';
process.env.EVOLUTION_API_URL = 'http://127.0.0.1:3999';
process.env.EVOLUTION_API_KEY = 'qa-evolution-key-123456';
process.env.EVOLUTION_INSTANCE_NAME = 'vitstock-qa';
process.env.GOOGLE_CLIENT_ID = 'qa-local-client-id-123456789';
process.env.GOOGLE_CLIENT_SECRET = 'qa-local-client-secret-123456789';

const { createApp } = await import('../server/src/app.js');

test('em QA o marcador e as fixtures de avatar são expostos', async () => {
  const app = await createApp();
  const ready = await app.inject({ method: 'GET', url: '/api/qa/ready' });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(JSON.parse(ready.body), {
    qaMode: true,
    database: 'local-only',
    evolution: 'mock-only',
    google: 'mock-only',
  });

  const validAvatar = await app.inject({ method: 'GET', url: '/api/qa/avatar/valid.svg' });
  assert.equal(validAvatar.statusCode, 200);
  assert.match(validAvatar.headers['content-type'] || '', /image\/svg\+xml/);

  const brokenAvatar = await app.inject({ method: 'GET', url: '/api/qa/avatar/broken.svg' });
  assert.equal(brokenAvatar.statusCode, 404);
  await app.close();
});
