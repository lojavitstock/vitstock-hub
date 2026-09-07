import { timingSafeEqual } from 'node:crypto';

export const EVOLUTION_WEBHOOK_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;

export type EvolutionWebhookReason =
  | 'ok'
  | 'not_configured'
  | 'missing'
  | 'disabled'
  | 'wrong_url'
  | 'missing_event'
  | 'wrong_by_events'
  | 'wrong_base64'
  | 'missing_secret_header'
  | 'wrong_secret_header'
  | 'multiple_drift'
  | 'header_unverifiable'
  | 'provider_unavailable'
  | 'unauthorized'
  | 'invalid_response'
  | 'repair_failed'
  | 'not_checked';

export type EvolutionWebhookContract = Readonly<{
  instanceName: string;
  enabled: true;
  url: string;
  events: readonly ['MESSAGES_UPSERT'];
  webhookByEvents: false;
  webhookBase64: false;
  headers: Readonly<{ 'x-webhook-secret': string }>;
}>;

export type EvolutionWebhookReconcileResult = {
  healthy: boolean;
  repaired: boolean;
  state: 'healthy' | 'unhealthy' | 'unknown';
  reason: EvolutionWebhookReason;
  driftDetected: boolean;
  detectedReason?: EvolutionWebhookReason;
  providerStatus?: number;
};

export type EvolutionWebhookStatus = EvolutionWebhookReconcileResult & {
  lastCheckedAt?: string;
  lastRepairAt?: string;
};

type EvolutionWebhookRecord = {
  enabled: boolean;
  url: string;
  events: string[];
  webhookByEvents?: boolean;
  webhookBase64?: boolean;
  headers?: Record<string, unknown> | null;
};

type EvolutionWebhookRequest = (path: string, init?: RequestInit) => Promise<Response>;

type ReconcileOptions = {
  contract?: EvolutionWebhookContract;
  request: EvolutionWebhookRequest;
};

type MonitorOptions = ReconcileOptions & {
  now?: () => number;
  logger?: (level: 'info' | 'warn', details: Record<string, unknown>, message: string) => void;
};

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMaskedHeaderValue(value: string) {
  return /^(?:\*+|x+|redacted|masked|\[redacted\])$/i.test(value.trim());
}

function readSecretHeader(headers: unknown):
  | { kind: 'missing' }
  | { kind: 'unverifiable' }
  | { kind: 'value'; value: string } {
  if (headers === undefined) return { kind: 'unverifiable' };
  if (headers === null) return { kind: 'missing' };
  if (!isRecord(headers)) return { kind: 'unverifiable' };
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === 'x-webhook-secret');
  if (!key) return { kind: 'missing' };
  const value = headers[key];
  if (typeof value !== 'string' || isMaskedHeaderValue(value)) return { kind: 'unverifiable' };
  return { kind: 'value', value };
}

function responseResult(
  result: Omit<EvolutionWebhookReconcileResult, 'driftDetected'> & { driftDetected?: boolean },
): EvolutionWebhookReconcileResult {
  return { driftDetected: false, ...result };
}

export function buildEvolutionWebhookContract(input: {
  publicBackendUrl?: string;
  instanceName: string;
  webhookSecret: string;
}): EvolutionWebhookContract | undefined {
  const publicBackendUrl = input.publicBackendUrl?.trim();
  if (!publicBackendUrl) return undefined;
  const baseUrl = normalizeUrl(publicBackendUrl);
  return {
    instanceName: input.instanceName,
    enabled: true,
    url: `${baseUrl}/webhooks/evolution`,
    events: ['MESSAGES_UPSERT'],
    webhookByEvents: false,
    webhookBase64: false,
    headers: { 'x-webhook-secret': input.webhookSecret },
  };
}

export function evolutionWebhookSetPayload(contract: EvolutionWebhookContract) {
  return {
    webhook: {
      enabled: contract.enabled,
      url: contract.url,
      headers: { ...contract.headers },
      byEvents: contract.webhookByEvents,
      base64: contract.webhookBase64,
      events: [...contract.events],
    },
  };
}

export function matchesWebhookSecret(value: string | undefined, expected: string) {
  if (!value || !expected) return false;
  const actual = Buffer.from(value);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export function normalizeEvolutionWebhookResponse(value: unknown):
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: EvolutionWebhookRecord } {
  if (value === null) return { kind: 'missing' };
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.url !== 'string' || !Array.isArray(value.events)) {
    return { kind: 'invalid' };
  }
  if (value.events.some((event) => typeof event !== 'string')) return { kind: 'invalid' };
  const byEvents = value.webhookByEvents ?? value.byEvents;
  const base64 = value.webhookBase64 ?? value.base64;
  const headers = value.headers === null
    ? null
    : value.headers === undefined
      ? undefined
    : isRecord(value.headers)
      ? value.headers
      : undefined;
  return {
    kind: 'value',
    value: {
      enabled: value.enabled,
      url: value.url,
      events: value.events,
      webhookByEvents: typeof byEvents === 'boolean' ? byEvents : undefined,
      webhookBase64: typeof base64 === 'boolean' ? base64 : undefined,
      headers,
    },
  };
}

type EvolutionWebhookComparison =
  | { healthy: true; reason: 'ok' }
  | { healthy: false; reason: EvolutionWebhookReason; detectedReason: EvolutionWebhookReason };

function compareEvolutionWebhook(contract: EvolutionWebhookContract, observed: EvolutionWebhookRecord): EvolutionWebhookComparison {
  const reasons: EvolutionWebhookReason[] = [];
  if (observed.enabled !== contract.enabled) reasons.push('disabled');
  if (normalizeUrl(observed.url) !== normalizeUrl(contract.url)) reasons.push('wrong_url');
  if (!observed.events.includes('MESSAGES_UPSERT')) reasons.push('missing_event');
  if (observed.webhookByEvents !== contract.webhookByEvents) reasons.push('wrong_by_events');
  if (observed.webhookBase64 !== contract.webhookBase64) reasons.push('wrong_base64');

  const header = readSecretHeader(observed.headers);
  if (header.kind === 'missing') reasons.push('missing_secret_header');
  else if (header.kind === 'unverifiable') reasons.push('header_unverifiable');
  else if (header.value !== contract.headers['x-webhook-secret']) reasons.push('wrong_secret_header');

  if (reasons.length === 0) return { healthy: true, reason: 'ok' };
  if (reasons.includes('header_unverifiable')) {
    return { healthy: false, reason: 'header_unverifiable', detectedReason: 'header_unverifiable' };
  }
  return {
    healthy: false,
    reason: reasons.length === 1 ? reasons[0]! : 'multiple_drift',
    detectedReason: reasons.length === 1 ? reasons[0]! : 'multiple_drift',
  };
}

export async function reconcileEvolutionWebhook(options: ReconcileOptions): Promise<EvolutionWebhookReconcileResult> {
  if (!options.contract) {
    return responseResult({ healthy: false, repaired: false, state: 'unknown', reason: 'not_configured' });
  }

  let response: Response;
  try {
    response = await options.request(`/webhook/find/${encodeURIComponent(options.contract.instanceName)}`);
  } catch {
    return responseResult({ healthy: false, repaired: false, state: 'unknown', reason: 'provider_unavailable' });
  }

  if (!response.ok) {
    return responseResult({
      healthy: false,
      repaired: false,
      state: response.status === 401 || response.status === 403 ? 'unhealthy' : 'unknown',
      reason: response.status === 401 || response.status === 403 ? 'unauthorized' : 'provider_unavailable',
      providerStatus: response.status,
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch {
    return responseResult({ healthy: false, repaired: false, state: 'unknown', reason: 'invalid_response' });
  }

  const normalized = normalizeEvolutionWebhookResponse(rawBody);
  if (normalized.kind === 'invalid') {
    return responseResult({ healthy: false, repaired: false, state: 'unknown', reason: 'invalid_response' });
  }
  if (normalized.kind === 'value') {
    const comparison = compareEvolutionWebhook(options.contract, normalized.value);
    if (!comparison.healthy && comparison.reason === 'header_unverifiable') {
      return responseResult({ healthy: false, repaired: false, state: 'unknown', reason: 'header_unverifiable' });
    }
    if (comparison.healthy) return responseResult({ healthy: true, repaired: false, state: 'healthy', reason: 'ok' });
    const detectedReason = comparison.detectedReason || comparison.reason;
    let repairResponse: Response;
    try {
      repairResponse = await options.request(
        `/webhook/set/${encodeURIComponent(options.contract.instanceName)}`,
        { method: 'POST', body: JSON.stringify(evolutionWebhookSetPayload(options.contract)) },
      );
    } catch {
      return { healthy: false, repaired: false, state: 'unhealthy', reason: 'repair_failed', driftDetected: true, detectedReason };
    }
    if (!repairResponse.ok) {
      return {
        healthy: false,
        repaired: false,
        state: 'unhealthy',
        reason: 'repair_failed',
        driftDetected: true,
        detectedReason,
        providerStatus: repairResponse.status,
      };
    }
    return { healthy: true, repaired: true, state: 'healthy', reason: detectedReason, driftDetected: true, detectedReason };
  }

  let repairResponse: Response;
  try {
    repairResponse = await options.request(
      `/webhook/set/${encodeURIComponent(options.contract.instanceName)}`,
      { method: 'POST', body: JSON.stringify(evolutionWebhookSetPayload(options.contract)) },
    );
  } catch {
    return { healthy: false, repaired: false, state: 'unhealthy', reason: 'repair_failed', driftDetected: true, detectedReason: 'missing' };
  }
  if (!repairResponse.ok) {
    return {
      healthy: false,
      repaired: false,
      state: 'unhealthy',
      reason: 'repair_failed',
      driftDetected: true,
      detectedReason: 'missing',
      providerStatus: repairResponse.status,
    };
  }
  return { healthy: true, repaired: true, state: 'healthy', reason: 'missing', driftDetected: true, detectedReason: 'missing' };
}

export function createEvolutionWebhookMonitor(options: MonitorOptions) {
  const now = options.now || Date.now;
  let inFlight: Promise<EvolutionWebhookStatus> | undefined;
  let lastCheckedAtMs = 0;
  let lastLogKey = '';
  let status: EvolutionWebhookStatus = {
    healthy: false,
    repaired: false,
    state: 'unknown',
    reason: 'not_checked',
    driftDetected: false,
  };

  const logResult = (result: EvolutionWebhookStatus) => {
    const logKey = `${result.state}:${result.reason}:${result.repaired}`;
    if (result.driftDetected) {
      options.logger?.('info', { reason: result.detectedReason || result.reason }, '[EVOLUTION_WEBHOOK] drift_detected');
    }
    if (result.repaired) {
      options.logger?.('info', { reason: result.detectedReason || result.reason }, '[EVOLUTION_WEBHOOK] repaired');
    } else if (logKey !== lastLogKey) {
      if (result.healthy) options.logger?.('info', { reason: result.reason }, '[EVOLUTION_WEBHOOK] healthy');
      else if (result.reason === 'provider_unavailable' || result.reason === 'unauthorized' || result.reason === 'invalid_response' || result.reason === 'repair_failed') {
        options.logger?.('warn', { reason: result.reason, providerStatus: result.providerStatus }, '[EVOLUTION_WEBHOOK] check_failed');
      } else {
        options.logger?.('warn', { reason: result.reason }, '[EVOLUTION_WEBHOOK] unhealthy');
      }
    }
    lastLogKey = logKey;
  };

  const ensure = () => {
    if (inFlight) return inFlight;
    inFlight = reconcileEvolutionWebhook({ contract: options.contract, request: options.request }).then((result) => {
      const checkedAt = new Date(now()).toISOString();
      lastCheckedAtMs = now();
      status = {
        ...result,
        lastCheckedAt: checkedAt,
        ...(result.repaired ? { lastRepairAt: checkedAt } : status.lastRepairAt ? { lastRepairAt: status.lastRepairAt } : {}),
      };
      logResult(status);
      return status;
    }).finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  return {
    ensure,
    snapshot: () => ({ ...status }),
    shouldCheck: () => lastCheckedAtMs === 0 || now() - lastCheckedAtMs >= EVOLUTION_WEBHOOK_RECONCILE_INTERVAL_MS,
  };
}
