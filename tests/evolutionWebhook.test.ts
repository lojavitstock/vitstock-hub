import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  buildEvolutionWebhookContract,
  createEvolutionWebhookMonitor,
  evolutionWebhookHealthLogMessage,
  evolutionWebhookSetPayload,
  matchesWebhookSecret,
  reconcileEvolutionWebhook,
} from '../server/src/evolutionWebhook';

const secret = 'test-webhook-secret-012345678901234567890123456789';
const contract = buildEvolutionWebhookContract({
  publicBackendUrl: 'https://api.example.test',
  instanceName: 'vitstock-test',
  webhookSecret: secret,
})!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function correctWebhook() {
  return {
    enabled: true,
    url: contract.url,
    events: ['MESSAGES_UPSERT'],
    webhookByEvents: false,
    webhookBase64: false,
    headers: { 'x-webhook-secret': secret },
  };
}

function captureLogs() {
  const logs: Array<{ level: 'info' | 'warn'; details: Record<string, unknown>; message: string }> = [];
  return {
    logs,
    logger: (level: 'info' | 'warn', details: Record<string, unknown>, message: string) => {
      logs.push({ level, details, message });
    },
  };
}

function messages(logs: Array<{ message: string }>) {
  return logs.map((entry) => entry.message);
}

test('webhook correto é saudável e não gera POST', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const result = await reconcileEvolutionWebhook({
    contract,
    request: async (path, init) => {
      calls.push({ path, init });
      return jsonResponse(correctWebhook());
    },
  });

  assert.equal(result.healthy, true);
  assert.equal(result.repaired, false);
  assert.equal(result.reason, 'ok');
  assert.deepEqual(calls.map((call) => call.path), ['/webhook/find/vitstock-test']);
});

test('webhook ausente gera um único POST com o payload real da Evolution 2.3.7', async () => {
  let setPayload: unknown;
  const result = await reconcileEvolutionWebhook({
    contract,
    request: async (path, init) => {
      if (path.includes('/find/')) return jsonResponse(null);
      setPayload = JSON.parse(String(init?.body));
      return jsonResponse({ ok: true }, 201);
    },
  });

  assert.equal(result.healthy, true);
  assert.equal(result.repaired, true);
  assert.equal(result.reason, 'missing');
  assert.deepEqual(setPayload, evolutionWebhookSetPayload(contract));
});

test('cada drift estrutural reparável gera POST', async () => {
  const cases = [
    { reason: 'wrong_url', value: { ...correctWebhook(), url: 'https://wrong.example.test/webhooks/evolution' } },
    { reason: 'missing_event', value: { ...correctWebhook(), events: [] } },
    { reason: 'wrong_by_events', value: { ...correctWebhook(), webhookByEvents: true } },
    { reason: 'wrong_base64', value: { ...correctWebhook(), webhookBase64: true } },
    { reason: 'missing_secret_header', value: { ...correctWebhook(), headers: {} } },
  ] as const;

  for (const item of cases) {
    let posts = 0;
    const result = await reconcileEvolutionWebhook({
      contract,
      request: async (path) => {
        if (path.includes('/find/')) return jsonResponse(item.value);
        posts += 1;
        return jsonResponse({}, 201);
      },
    });
    assert.equal(result.repaired, true, item.reason);
    assert.equal(posts, 1, item.reason);
    assert.equal(result.detectedReason, item.reason, item.reason);
  }
});

test('header mascarado não é comparado nem regravado em loop', async () => {
  let posts = 0;
  const result = await reconcileEvolutionWebhook({
    contract,
    request: async (path) => {
      if (path.includes('/find/')) return jsonResponse({ ...correctWebhook(), headers: { 'x-webhook-secret': '********' } });
      posts += 1;
      return jsonResponse({}, 201);
    },
  });

  assert.equal(result.state, 'unknown');
  assert.equal(result.reason, 'header_unverifiable');
  assert.equal(result.repaired, false);
  assert.equal(posts, 0);
});

test('header omitido na resposta do provider permanece desconhecido sem regravar', async () => {
  let posts = 0;
  const result = await reconcileEvolutionWebhook({
    contract,
    request: async (path) => {
      if (path.includes('/find/')) {
        const { headers: _headers, ...withoutHeaders } = correctWebhook();
        return jsonResponse(withoutHeaders);
      }
      posts += 1;
      return jsonResponse({}, 201);
    },
  });

  assert.equal(result.state, 'unknown');
  assert.equal(result.reason, 'header_unverifiable');
  assert.equal(result.repaired, false);
  assert.equal(posts, 0);
});

test('GET 500 deixa o estado indisponível sem tentar repair', async () => {
  let posts = 0;
  const result = await reconcileEvolutionWebhook({
    contract,
    request: async (path) => {
      if (path.includes('/find/')) return jsonResponse({ error: 'unavailable' }, 500);
      posts += 1;
      return jsonResponse({}, 201);
    },
  });

  assert.equal(result.healthy, false);
  assert.equal(result.state, 'unknown');
  assert.equal(result.reason, 'provider_unavailable');
  assert.equal(posts, 0);
});

test('falha no POST não derruba a reconciliação nem vaza payload', async () => {
  const result = await reconcileEvolutionWebhook({
    contract,
    request: async (path) => path.includes('/find/')
      ? jsonResponse(null)
      : jsonResponse({ error: 'failed' }, 503),
  });

  assert.equal(result.healthy, false);
  assert.equal(result.reason, 'repair_failed');
  assert.equal(result.detectedReason, 'missing');
});

test('duas reconciliações concorrentes compartilham o mesmo GET e POST', async () => {
  let gets = 0;
  let posts = 0;
  const monitor = createEvolutionWebhookMonitor({
    contract,
    request: async (path, init) => {
      if (path.includes('/find/')) {
        gets += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse(null);
      }
      posts += 1;
      assert.equal(init?.method, 'POST');
      return jsonResponse({}, 201);
    },
  });

  const [first, second] = await Promise.all([monitor.ensure(), monitor.ensure()]);
  assert.equal(gets, 1);
  assert.equal(posts, 1);
  assert.equal(first.repaired, true);
  assert.equal(second.repaired, true);
});

test('secret correto continua autorizado pela mesma comparação usada na rota', () => {
  assert.equal(matchesWebhookSecret(secret, secret), true);
  assert.equal(matchesWebhookSecret('wrong-secret', secret), false);
  assert.equal(matchesWebhookSecret(undefined, secret), false);
});

test('estado healthy gera somente o log healthy', async () => {
  const captured = captureLogs();
  const monitor = createEvolutionWebhookMonitor({
    contract,
    request: async () => jsonResponse(correctWebhook()),
    logger: captured.logger,
  });

  const result = await monitor.ensure();

  assert.equal(result.state, 'healthy');
  assert.ok(messages(captured.logs).includes('[EVOLUTION_WEBHOOK] healthy'));
  assert.equal(messages(captured.logs).includes('[EVOLUTION_WEBHOOK] unhealthy'), false);
  assert.equal(messages(captured.logs).includes('[EVOLUTION_WEBHOOK] check_inconclusive'), false);
});

test('header unverifiable gera check_inconclusive com reason estruturado', async () => {
  const captured = captureLogs();
  const monitor = createEvolutionWebhookMonitor({
    contract,
    request: async () => jsonResponse({ ...correctWebhook(), headers: { 'x-webhook-secret': '********' } }),
    logger: captured.logger,
  });

  const result = await monitor.ensure();
  const log = captured.logs.find((entry) => entry.message === '[EVOLUTION_WEBHOOK] check_inconclusive');

  assert.equal(result.state, 'unknown');
  assert.equal(result.reason, 'header_unverifiable');
  assert.ok(log);
  assert.equal(log.details.reason, 'header_unverifiable');
  assert.equal(messages(captured.logs).includes('[EVOLUTION_WEBHOOK] unhealthy'), false);
});

test('not_configured gera check_inconclusive sem unhealthy', async () => {
  const captured = captureLogs();
  const monitor = createEvolutionWebhookMonitor({
    contract: undefined,
    request: async () => {
      throw new Error('request should not be called');
    },
    logger: captured.logger,
  });

  const result = await monitor.ensure();

  assert.equal(result.state, 'unknown');
  assert.equal(result.reason, 'not_configured');
  assert.ok(messages(captured.logs).includes('[EVOLUTION_WEBHOOK] check_inconclusive'));
  assert.equal(messages(captured.logs).includes('[EVOLUTION_WEBHOOK] unhealthy'), false);
});

test('estado unhealthy genérico mantém o log unhealthy', () => {
  assert.equal(
    evolutionWebhookHealthLogMessage({ state: 'unhealthy', reason: 'multiple_drift' }),
    '[EVOLUTION_WEBHOOK] unhealthy',
  );
});

test('falha operacional existente permanece como check_failed', async () => {
  const captured = captureLogs();
  const monitor = createEvolutionWebhookMonitor({
    contract,
    request: async () => jsonResponse({ error: 'unavailable' }, 500),
    logger: captured.logger,
  });

  const result = await monitor.ensure();

  assert.equal(result.reason, 'provider_unavailable');
  assert.ok(messages(captured.logs).includes('[EVOLUTION_WEBHOOK] check_failed'));
  assert.equal(messages(captured.logs).includes('[EVOLUTION_WEBHOOK] unhealthy'), false);
});
