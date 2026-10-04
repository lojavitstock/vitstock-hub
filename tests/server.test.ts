import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.OUTBOUND_TRACE = 'true';
const { createApp } = await import('../server/src/app.js');
const { db } = await import('../server/src/db.js');

test('product send: trusted snapshots, tenant boundaries, exact JIDs and atomic idempotent outbox', async (t) => {
  const { InMemoryProductStorage } = await import('../server/src/productStorage.js');
  const { default: Fastify } = await import('../server/node_modules/fastify/fastify.js');
  const { registerEvolutionRoutes } = await import('../server/src/evolution.js');
  const companyId = '10000000-0000-4000-8000-000000000001';
  const productId = '10000000-0000-4000-8000-000000000002';
  const conversationId = '10000000-0000-4000-8000-000000000003';
  const contactId = '10000000-0000-4000-8000-000000000004';
  const userId = '10000000-0000-4000-8000-000000000005';
  const localId = '10000000-0000-4000-8000-000000000006';
  const key = `products/${companyId}/${productId}/image.png`;
  let userCompany = companyId;
  let destination = '5521999000001@s.whatsapp.net';
  let productAvailable = true;
  let destinationAvailable = true;
  let imageAvailable = true;
  let referenceFailure = false;
  let providerFailure = false;
  let collision = false;
  let productName = 'Produto QA';
  let price = 2800;
  let stored: any = null;
  let references: unknown[][] = [];
  let calls: any[] = [];
  let commits = 0;
  let rollbacks = 0;
  let activityUpdates = 0;
  let mutex = Promise.resolve();
  const sqlText = (query: unknown) => (typeof query === 'string' ? query : String((query as any)?.text || '')).replace(/\s+/g, ' ').trim();
  const productRow = () => ({ id: productId, name: productName, price_cents: price, currency: 'BRL', image_object_key: key, image_mime_type: 'image/png' });
  const conversationRows = () => destinationAvailable && userCompany === companyId
    ? [{ id: conversationId, contact_id: contactId, evolution_remote_jid: destination }] : [];
  t.mock.method(InMemoryProductStorage.prototype, 'exists', async () => imageAvailable);
  t.mock.method(InMemoryProductStorage.prototype, 'buildUrl', (objectKey: string) => `https://media.qa.test/${objectKey}`);
  t.mock.method(db as any, 'connect', async () => {
    let unlock: (() => void) | undefined;
    let previous: any;
    let previousRefs: unknown[][] = [];
    return {
      release() { unlock?.(); },
      async query(query: unknown, values: any[] = []) {
        const sql = sqlText(query);
        if (sql.includes('pg_advisory_xact_lock') && String(values[0]).startsWith('vitstock:outbound:')) {
          const current = mutex;
          mutex = new Promise<void>((resolve) => { unlock = resolve; });
          await current;
          previous = stored && structuredClone(stored);
          previousRefs = [...references];
        }
        if (sql === 'COMMIT') { commits++; unlock?.(); unlock = undefined; }
        if (sql === 'ROLLBACK') { rollbacks++; stored = previous; references = previousRefs; unlock?.(); unlock = undefined; }
        if (sql.startsWith('SELECT name, price_cents')) return { rows: productAvailable ? [productRow()] : [] };
        if (sql.includes('SELECT c.id, c.contact_id, c.evolution_remote_jid')) return { rows: conversationRows() };
        if (sql.startsWith('SELECT id FROM conversations')) return { rows: [{ id: conversationId }] };
        if (sql.startsWith('UPDATE conversations')) activityUpdates++;
        if (sql.startsWith('SELECT id, conversation_id, evolution_message_id, status')) return { rows: stored ? [stored] : [] };
        if (sql.startsWith('INSERT INTO messages')) {
          stored = { id: localId, conversation_id: conversationId, evolution_message_id: null, status: 'pending', metadata: JSON.parse(values[5]), content: values[3], company_id: companyId, sender_name: 'Operador QA' };
          return { rows: [{ id: localId }] };
        }
        if (sql.startsWith('INSERT INTO message_product_refs')) {
          if (referenceFailure) throw new Error('Reference persistence failed');
          references.push(values);
        }
        if (sql.startsWith('UPDATE messages SET status')) stored.status = 'pending';
        if (sql.startsWith('SELECT company_id, sender_name, metadata')) return { rows: [stored] };
        if (sql.startsWith('SELECT id FROM messages WHERE evolution_message_id')) return { rows: [{ id: '10000000-0000-4000-8000-000000000007' }] };
        if (sql.startsWith('UPDATE message_product_refs')) references = references.map((ref) => [ref[0], values[1], ...ref.slice(2)]);
        if (sql.startsWith('UPDATE messages SET sender_name')) stored = { ...stored, id: values[0], metadata: JSON.parse(values[2]), status: values[3] };
        return { rows: [] };
      },
    };
  });
  t.mock.method(db as any, 'query', async (query: unknown, values: any[] = []) => {
    const sql = sqlText(query);
    if (sql.includes('FROM products WHERE company_id')) {
      assert.equal(values[0], userCompany);
      return { rows: productAvailable && userCompany === companyId && values[1] === productId ? [productRow()] : [] };
    }
    if (sql.includes('WITH attempted AS')) return { rows: [{ acquired: true, owner_user_id: userId, owner_name: 'Operador QA', expires_at: '2030-01-01T00:00:00.000Z' }] };
    if (sql.startsWith('UPDATE messages')) {
      if (collision && values[1] === 'sent') { collision = false; throw Object.assign(new Error('Provider webhook collision'), { code: '23505' }); }
      stored.status = values[1]; stored.evolution_message_id = values[2];
    }
    return { rows: [] };
  });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.ok(commits > 0, 'message and reference must commit before transport');
    assert.equal(references.length, 1);
    calls.push(JSON.parse(String(init.body)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify(providerFailure ? { error: 'Mock rejected media' } : { key: { id: 'qa-product-provider', remoteJid: destination, fromMe: true } }), { status: providerFailure ? 400 : 200 });
  });
  const app = Fastify();
  app.decorateRequest('user', null);
  await registerEvolutionRoutes(app, new InMemoryProductStorage('http://localhost:3001'));
  app.addHook('onRequest', async (request) => {
    (request as any).user = { id: userId, companyId: userCompany, companyName: 'QA', name: 'Operador QA', role: 'attendant', email: 'qa@example.test' };
  });
  const reset = () => {
    userCompany = companyId; productAvailable = destinationAvailable = imageAvailable = true;
    referenceFailure = providerFailure = collision = false;
    productName = 'Produto QA'; price = 2800; stored = null; references = []; calls = []; commits = rollbacks = activityUpdates = 0;
  };
  const send = (extra = {}) => app.inject({ method: 'POST', url: '/api/evolution/messages/send-product', payload: { productId, remoteJid: destination, clientMessageId: 'product-client-fixed', ...extra } });
  try {
    for (const jid of ['5521999000001@s.whatsapp.net', '903600000000@lid', '120363000001@g.us']) {
      await t.test(`transport preserves ${jid.split('@')[1]} and snapshots use local UUID`, async () => {
        reset(); destination = jid;
        const result = await send();
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(calls[0].number, jid);
        assert.equal(calls[0].media, `https://media.qa.test/${key}`);
        assert.equal(calls[0].mimetype, 'image/png');
        assert.equal(calls[0].caption, 'Produto QA\nR$ 28,00');
        assert.deepEqual(references[0], [companyId, localId, productId, 'Produto QA', 2800, 'BRL', key]);
        assert.equal(stored.metadata.productSnapshot.name, 'Produto QA');
        assert.equal(stored.metadata.quotedMessage, undefined);
        assert.equal(stored.status, 'sent');
      });
    }
    for (const field of ['companyId', 'imageObjectKey', 'imageUrl', 'priceCents', 'name', 'number', 'bucket']) {
      await t.test(`rejects client authority override: ${field}`, async () => {
        reset(); assert.equal((await send({ [field]: 'untrusted' })).statusCode, 400); assert.equal(calls.length, 0);
      });
    }
    await t.test('missing/archived and cross-tenant products and destinations fail closed', async () => {
      reset(); productAvailable = false; assert.equal((await send()).statusCode, 404);
      reset(); assert.equal((await send({ productId: '10000000-0000-4000-8000-000000000099' })).statusCode, 404);
      reset(); userCompany = '20000000-0000-4000-8000-000000000001'; assert.equal((await send()).statusCode, 404);
      reset(); destinationAvailable = false; assert.equal((await send()).statusCode, 404);
      assert.equal(calls.length, 0);
    });
    await t.test('reference persistence failure rolls back and never contacts provider', async () => {
      reset(); referenceFailure = true; assert.equal((await send()).statusCode, 500);
      assert.equal(rollbacks, 1); assert.equal(stored, null); assert.equal(references.length, 0); assert.equal(calls.length, 0);
    });
    await t.test('missing product image is rejected before persistence or transport', async () => {
      reset(); imageAvailable = false; assert.equal((await send()).statusCode, 422);
      assert.equal(stored, null); assert.equal(references.length, 0); assert.equal(calls.length, 0);
    });
    await t.test('provider failure persists failed snapshot; retry keeps original name/price/key and reference', async () => {
      reset(); providerFailure = true; assert.equal((await send()).statusCode, 400);
      assert.equal(stored.status, 'failed'); assert.equal(references.length, 1);
      productName = 'Edited later'; price = 9999; providerFailure = false;
      assert.equal((await send()).statusCode, 200);
      assert.equal(calls[1].caption, 'Produto QA\nR$ 28,00'); assert.equal(references.length, 1);
    });
    await t.test('concurrent double submit and accepted retries dispatch once', async () => {
      reset(); const results = await Promise.all([send(), send()]);
      assert.ok(results.every((result) => result.statusCode === 200));
      const acceptedActivity = activityUpdates;
      assert.equal((await send()).statusCode, 200); assert.equal(calls.length, 1); assert.equal(references.length, 1);
      assert.equal(activityUpdates, acceptedActivity, 'accepted retry must not renew conversation activity');
      assert.equal((await send({ remoteJid: '120363999999@g.us' })).statusCode, 409);
    });
    await t.test('webhook collision moves reference to surviving local UUID before removing pending row', async () => {
      reset(); collision = true; const response = await send();
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().message.id, '10000000-0000-4000-8000-000000000007');
      assert.equal(references[0][1], response.json().message.id); assert.equal(references.length, 1);
    });
  } finally { await app.close(); }
});

test('Bling product selection catalog fixes active criterion, honors search/pagination and fails closed on provider violations', async () => {
  const { default: Fastify } = await import('../server/node_modules/fastify/fastify.js');
  const { registerBlingRoutes } = await import('../server/src/bling.js');
  const calls: Array<{ resource: string; query: URLSearchParams }> = [];
  let providerValue: unknown = { data: [
    { id: '301', nome: 'Produto QA A', codigo: 'SKU-301', tipo: 'P', situacao: 'A', formato: 'S' },
    { id: '302', nome: 'Produto QA B', codigo: 'SKU-302', tipo: 'P', situacao: 'A', formato: 'S' },
  ] };
  const app = Fastify({ logger: false });
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    (request as any).user = { id: 'qa-admin', companyId: 'qa-company', companyName: 'QA', name: 'QA Admin', role: 'admin', email: 'qa@example.test' };
  });
  await registerBlingRoutes(app, {
    store: {}, credentials: { clientId: 'qa', clientSecret: 'not-used', redirectUri: 'https://api.example.test/callback' },
    client: { read: async (_company: string, resource: string, query: URLSearchParams) => {
      calls.push({ resource, query: new URLSearchParams(query) });
      return providerValue;
    } },
  } as any);
  try {
    const response = await app.inject({ method: 'GET', url: '/api/integrations/bling/products?page=3&limit=2&nome=Produto%20QA' });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().data.map((item: { situacao: string }) => item.situacao), ['A', 'A']);
    assert.equal(response.json().page, 3);
    assert.equal(response.json().limit, 2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.resource, 'products');
    assert.equal(calls[0]!.query.get('criterio'), '2');
    assert.equal(calls[0]!.query.get('pagina'), '3');
    assert.equal(calls[0]!.query.get('limite'), '2');
    assert.equal(calls[0]!.query.get('nome'), 'Produto QA');

    const override = await app.inject({ method: 'GET', url: '/api/integrations/bling/products?criterio=5' });
    assert.equal(override.statusCode, 400);
    assert.equal(calls.length, 1, 'a rejected client criterion must not call Bling');

    providerValue = { data: [
      { id: '301', nome: 'Produto QA A', tipo: 'P', situacao: 'A', formato: 'S' },
      { id: '201', nome: 'Produto inativo', tipo: 'P', situacao: 'I', formato: 'S' },
    ] };
    const providerViolation = await app.inject({ method: 'GET', url: '/api/integrations/bling/products?page=2&limit=2' });
    assert.equal(providerViolation.statusCode, 502);
    assert.equal(calls[1]!.query.get('criterio'), '2');
    assert.match(providerViolation.json().error, /não ativo/i);
  } finally { await app.close(); }
});

test('Bling import removes only the uploaded image when its product transaction rolls back', async (t) => {
  const { registerProductRoutes } = await import('../server/src/products.js');
  const { default: Fastify } = await import('../server/node_modules/fastify/fastify.js');
  const companyId = '10000000-0000-4000-8000-000000000011';
  const productId = '10000000-0000-4000-8000-000000000012';
  const uploaded: string[] = [];
  const removed: string[] = [];
  const providerReads: Array<{ resource: string; id?: string }> = [];
  let connectCalls = 0;
  let duplicateReads = 0;
  let productInserted = false;
  let rolledBack = false;
  const storage = {
    async put(_companyId: string, key: string) { uploaded.push(key); },
    async remove(_companyId: string, key: string) { removed.push(key); },
    async get() { return null; },
    async exists() { return false; },
    buildUrl(key: string) { return `https://media.qa.test/${key}`; },
  };
  const sqlText = (query: unknown) => (typeof query === 'string' ? query : String((query as any)?.text || '')).replace(/\s+/g, ' ').trim();

  t.mock.method(db as any, 'query', async (query: unknown) => {
    duplicateReads++;
    assert.match(sqlText(query), /FROM product_bling_links/);
    return { rows: [] };
  });
  t.mock.method(db as any, 'connect', async () => {
    connectCalls++;
    return ({
    release() {},
    async query(query: unknown, values: unknown[] = []) {
      const sql = sqlText(query);
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.startsWith('INSERT INTO products')) {
        assert.equal(values[0], productId);
        productInserted = true;
        return { rows: [] };
      }
      if (sql.startsWith('SELECT id FROM products')) return { rows: productInserted ? [{ id: productId }] : [] };
      if (sql.startsWith('SELECT bling_product_id FROM product_bling_links')) return { rows: [] };
      if (sql.startsWith('INSERT INTO product_bling_links')) throw new Error('Simulated database constraint failure');
      if (sql === 'ROLLBACK') { rolledBack = true; productInserted = false; return { rows: [] }; }
      return { rows: [] };
    },
    });
  });

  const bling = {
    client: {
      read: async (_company: string, resource: string, _query: URLSearchParams, id?: string) => {
        providerReads.push({ resource, id });
        if (resource === 'product') {
          const situacao = id === '201' ? 'I' : id === '202' ? 'E' : 'A';
          return { data: { id, nome: 'Produto importado QA', codigo: 'SKU-101', preco: 28, tipo: 'P', situacao, formato: 'S' } };
        }
        return { data: [{ produto: { id: id || '101' }, saldoFisicoTotal: 8, saldoVirtualTotal: 5,
          depositos: [{ id: '7', saldoFisico: 8, saldoVirtual: 5 }] }] };
      },
    },
  };
  const app = Fastify();
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    (request as any).user = { id: productId, companyId, companyName: 'QA', name: 'QA Admin', role: 'admin', email: 'qa@example.test' };
  });
  await registerProductRoutes(app, storage as any, bling as any);
  try {
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    for (const [blingProductId, situacao] of [['201', 'I'], ['202', 'E']]) {
      const readsBefore = providerReads.length;
      const rejected = await app.inject({ method: 'POST', url: '/api/products/bling-import', payload: {
        blingProductId, imageBase64: png, imageMimeType: 'image/png',
      } });
      assert.equal(rejected.statusCode, 409, rejected.body);
      assert.match(rejected.json().error, /somente produtos ativos/i);
      assert.deepEqual(providerReads.slice(readsBefore), [{ resource: 'product', id: blingProductId }], `${situacao} must be rejected before stock lookup`);
      assert.equal(uploaded.length, 0, `${situacao} must not upload an image`);
      assert.equal(removed.length, 0);
      assert.equal(connectCalls, 0, `${situacao} must not open a product transaction`);
      assert.equal(duplicateReads, 0, `${situacao} must not read or alter product links`);
      assert.equal(productInserted, false);
    }

    const result = await app.inject({ method: 'POST', url: '/api/products/bling-import', payload: {
      blingProductId: '101', imageBase64: png, imageMimeType: 'image/png',
    } });
    assert.equal(result.statusCode, 500, result.body);
    assert.equal(rolledBack, true);
    assert.equal(productInserted, false);
    assert.equal(uploaded.length, 1);
    assert.deepEqual(removed, uploaded, 'rollback must remove exactly the object uploaded by this request');
  } finally { await app.close(); }
});

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
