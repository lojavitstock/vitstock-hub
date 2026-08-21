import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createApp } from '../server/src/app.js';

test('Fastify app responde /health endpoint', async () => {
  const app = await createApp();
  const response = await app.inject({
    method: 'GET',
    url: '/health',
  });

  assert.ok([200, 503].includes(response.statusCode), `Status retornado: ${response.statusCode}`);
  const payload = JSON.parse(response.body);
  assert.ok(payload.status === 'ok' || payload.status === 'degraded');
  await app.close();
});

test('QA app expõe marcador seguro e fixtures de avatar somente no QA', async () => {
  const app = await createApp();
  const ready = await app.inject({ method: 'GET', url: '/api/qa/ready' });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(JSON.parse(ready.body), { qaMode: true, database: 'local-only', evolution: 'mock-only', google: 'mock-only' });

  const validAvatar = await app.inject({ method: 'GET', url: '/api/qa/avatar/valid.svg' });
  assert.equal(validAvatar.statusCode, 200);
  assert.match(validAvatar.headers['content-type'] || '', /image\/svg\+xml/);

  const brokenAvatar = await app.inject({ method: 'GET', url: '/api/qa/avatar/broken.svg' });
  assert.equal(brokenAvatar.statusCode, 404);

  const missingAvatar = await app.inject({ method: 'GET', url: '/api/qa/avatar/missing.svg' });
  assert.equal(missingAvatar.statusCode, 404);
  await app.close();
});

test('Fastify app bloqueia requisição mutativa com origem não autorizada (CORS Hook)', async () => {
  const app = await createApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: {
      origin: 'https://site-malicioso.com',
      'content-type': 'application/json',
    },
    payload: JSON.stringify({ email: 'test@vitstock.com', password: '123' }),
  });

  assert.equal(response.statusCode, 403);
  const payload = JSON.parse(response.body);
  assert.match(payload.error, /Origem não autorizada/i);
  await app.close();
});

test('Fastify app retorna 401 em /api/auth/me quando cliente não possui cookie de sessão', async () => {
  const app = await createApp();
  const response = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
  });

  assert.equal(response.statusCode, 401);
  const payload = JSON.parse(response.body);
  assert.match(payload.error, /Não autenticado/i);
  await app.close();
});

test('Fastify app bloqueia endpoint mutativo não autenticado com 401 ou 403', async () => {
  const app = await createApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/google/sync',
  });

  assert.ok([401, 403].includes(response.statusCode), `Status retornado: ${response.statusCode}`);
  await app.close();
});
