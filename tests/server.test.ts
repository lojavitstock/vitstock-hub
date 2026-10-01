import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.OUTBOUND_TRACE = 'true';
const { createApp } = await import('../server/src/app.js');
const { db } = await import('../server/src/db.js');

test('reply schema rejection is traced before any Evolution provider request', async () => {
  const app = await createApp();
  app.addHook('onRequest', async (request) => {
    (request as any).user = {
      id: 'qa-user-id',
      companyId: 'qa-company-id',
      companyName: 'QA',
      name: 'QA Attendant',
      email: 'qa@example.test',
      role: 'attendant',
    };
  });

  const originalFetch = globalThis.fetch;
  let providerCallCount = 0;
  globalThis.fetch = async () => {
    providerCallCount += 1;
    return new Response('{}', { status: 200 });
  };

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/evolution/messages/send',
      headers: { 'content-type': 'application/json' },
      payload: {
        number: '5521999999999',
        remoteJid: '5521999999999@s.whatsapp.net',
        text: 'SUPER_SECRET_MESSAGE_BODY',
        replyTraceId: 'reply-01234567-89ab-4cde-8fab-0123456789ab',
        quotedMessage: {
          messageId: 'ABCSECRET123',
          content: 'SUPER_SECRET_MESSAGE_BODY',
          key: { id: 'ABCSECRET123', remoteJid: '5521999999999@s.whatsapp.net', fromMe: 'not-a-boolean' },
        },
      },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), { error: 'Mensagem inválida', code: 'invalid_message_payload' });
    assert.equal(providerCallCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test('reply business contract and real Evolution payload are equal with tracing off and on', async (t) => {
  const previousTraceFlag = process.env.OUTBOUND_TRACE;
  const destination = '5511999988776@s.whatsapp.net';
  const companyId = '00000000-0000-4000-8000-000000000001';
  const conversationId = '00000000-0000-4000-8000-000000000002';
  const contactId = '00000000-0000-4000-8000-000000000003';
  const userId = '00000000-0000-4000-8000-000000000004';
  let activeRun: { providerCalls: unknown[]; persistence: unknown[] } | undefined;
  let providerMode: 'success' | 'reject' = 'success';

  const normalizeSql = (query: unknown) => (typeof query === 'string' ? query : String((query as any)?.text || ''))
    .replace(/\s+/g, ' ')
    .trim();
  const capturePersistence = (scope: string, query: unknown, values?: unknown[]) => {
    if (!activeRun) return;
    const sql = normalizeSql(query);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql) || sql.includes('pg_advisory_xact_lock')) return;
    activeRun.persistence.push({
      scope,
      sql,
      values: (values || []).map((value) => value instanceof Date ? '[timestamp]' : value),
    });
  };
  const clientQuery = async (query: unknown, values?: unknown[]) => {
    const sql = normalizeSql(query);
    capturePersistence('client', query, values);
    if (sql.includes('SELECT c.id, c.contact_id, c.evolution_remote_jid')) {
      return { rows: [{ id: conversationId, contact_id: contactId, evolution_remote_jid: destination }] };
    }
    if (sql.startsWith('SELECT id FROM conversations')) return { rows: [{ id: conversationId }] };
    if (sql.startsWith('SELECT id, conversation_id, evolution_message_id, status FROM messages')) return { rows: [] };
    if (sql.startsWith('INSERT INTO messages')) return { rows: [{ id: '00000000-0000-4000-8000-000000000005' }] };
    return { rows: [] };
  };

  t.mock.method(db as any, 'connect', async () => ({ query: clientQuery, release() {} }));
  t.mock.method(db as any, 'query', async (query: unknown, values?: unknown[]) => {
    const sql = normalizeSql(query);
    capturePersistence('pool', query, values);
    if (sql.includes('WITH attempted AS')) {
      return { rows: [{ acquired: true, owner_user_id: userId, owner_name: 'QA Attendant', expires_at: '2030-01-01T00:00:00.000Z' }] };
    }
    return { rows: [] };
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const requestUrl = new URL(String(input));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    activeRun?.providerCalls.push({ method: init?.method, path: requestUrl.pathname, body });
    return providerMode === 'success'
      ? new Response(JSON.stringify({ key: { id: 'provider-message-id', remoteJid: destination, fromMe: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      : new Response(JSON.stringify({ code: 'BAD_REQUEST', message: 'rejected by mock' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      });
  };

  const app = await createApp();
  app.addHook('onRequest', async (request) => {
    (request as any).user = {
      id: userId,
      companyId,
      companyName: 'QA',
      name: 'QA Attendant',
      email: 'qa@example.test',
      role: 'attendant',
    };
  });

  const validPayload = {
    number: '5511999988776',
    remoteJid: destination,
    text: 'Resposta de teste',
    clientMessageId: 'client-message-fixed',
    replyTraceId: 'reply-test-123',
    quotedMessage: {
      messageId: 'source-message-id',
      providerKeySource: 'metadata',
      sourceMediaType: 'text',
      key: { id: 'source-message-id', remoteJid: destination, fromMe: false },
    },
  };
  const invalidPayload = {
    ...validPayload,
    quotedMessage: { ...validPayload.quotedMessage, key: { ...validPayload.quotedMessage.key, fromMe: 'not-a-boolean' } },
  };

  const runRequest = async (traceEnabled: boolean, mode: 'success' | 'reject', payload: unknown) => {
    process.env.OUTBOUND_TRACE = traceEnabled ? 'true' : 'false';
    providerMode = mode;
    activeRun = { providerCalls: [], persistence: [] };
    const response = await app.inject({
      method: 'POST',
      url: '/api/evolution/messages/send',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    const snapshot = {
      status: response.statusCode,
      body: JSON.parse(response.body),
      providerCalls: activeRun.providerCalls,
      persistence: activeRun.persistence,
    };
    activeRun = undefined;
    return snapshot;
  };

  try {
    const invalidOff = await runRequest(false, 'success', invalidPayload);
    const invalidOn = await runRequest(true, 'success', invalidPayload);
    assert.equal(invalidOff.status, 400);
    assert.deepEqual(invalidOn, invalidOff);
    assert.deepEqual(invalidOff.providerCalls, []);
    assert.deepEqual(invalidOff.persistence, []);

    const rejectedOff = await runRequest(false, 'reject', validPayload);
    const rejectedOn = await runRequest(true, 'reject', validPayload);
    assert.equal(rejectedOff.status, 400);
    assert.equal(rejectedOff.body.replyTraceId, 'reply-test-123');
    assert.deepEqual(rejectedOn, rejectedOff);
    assert.equal((rejectedOff.providerCalls as any[]).length, 1);
    assert.deepEqual(rejectedOn.providerCalls, rejectedOff.providerCalls);
    assert.deepEqual(rejectedOn.persistence, rejectedOff.persistence);

    const successOff = await runRequest(false, 'success', validPayload);
    const successOn = await runRequest(true, 'success', validPayload);
    assert.equal(successOff.status, 200);
    assert.deepEqual(successOn, successOff);
    assert.equal((successOff.providerCalls as any[]).length, 1);
    assert.deepEqual(successOn.providerCalls, successOff.providerCalls);
    assert.deepEqual(successOn.persistence, successOff.persistence);
    const sentProviderRequest = (successOff.providerCalls as any[])[0];
    assert.equal(sentProviderRequest.method, 'POST');
    assert.match(sentProviderRequest.path, /\/message\/sendText\//);
    assert.deepEqual(sentProviderRequest.body, {
      number: destination,
      text: '*QA Attendant:*\nResposta de teste',
      delay: 1200,
      linkPreview: true,
      quoted: { key: { id: 'source-message-id', remoteJid: destination, fromMe: false } },
    });
    assert.equal(JSON.stringify(successOff.providerCalls).includes('reply-test-123'), false);
    assert.equal(JSON.stringify(successOff.persistence).includes('reply-test-123'), false);

    const blankProviderKeyPayload = {
      ...validPayload,
      quotedMessage: {
        ...validPayload.quotedMessage,
        key: {
          ...validPayload.quotedMessage.key,
          remoteJid: '   ',
          remoteJidAlt: '',
          participant: '',
          participantAlt: '   ',
          addressingMode: '',
          senderPn: '',
          participantPn: '   ',
        },
      },
    };
    const blankKeyRun = await runRequest(false, 'success', blankProviderKeyPayload);
    assert.equal(blankKeyRun.status, 200);
    assert.equal((blankKeyRun.providerCalls as any[]).length, 1);
    const blankKeyProviderBody = (blankKeyRun.providerCalls as any[])[0].body;
    assert.deepEqual(blankKeyProviderBody.quoted, {
      key: { id: 'source-message-id', remoteJid: destination, fromMe: false },
    });
    assert.equal('participant' in blankKeyProviderBody.quoted.key, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousTraceFlag === undefined) delete process.env.OUTBOUND_TRACE;
    else process.env.OUTBOUND_TRACE = previousTraceFlag;
    await app.close();
  }
});

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

test('fora do QA o marcador e as fixtures de avatar não são expostos', async () => {
  const app = await createApp();
  const ready = await app.inject({ method: 'GET', url: '/api/qa/ready' });
  assert.equal(ready.statusCode, 404);

  const validAvatar = await app.inject({ method: 'GET', url: '/api/qa/avatar/valid.svg' });
  assert.equal(validAvatar.statusCode, 404);

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

test('webhook Evolution sem header é rejeitado antes do processamento', async () => {
  const app = await createApp();
  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/evolution',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ event: 'MESSAGES_UPSERT', data: { key: { id: 'qa-unauthorized' } } }),
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: 'Webhook não autorizado' });
  await app.close();
});
