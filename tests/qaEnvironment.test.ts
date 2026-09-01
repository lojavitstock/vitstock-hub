import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isAllowedFrontendOrigin, isLocalHost, parseFrontendOrigins, validateQaRuntimeSafety } from '../server/src/config';
import { currentQaGoogleScenario, qaEvolutionResponse, qaGoogleFailure, qaGooglePeople, setQaGoogleScenario } from '../server/src/qa';
import { buildExistingConversationQuery } from '../server/src/conversationQueries';
import { buildGoogleContactUpdatePayload, buildGooglePhonePlan, googleContactErrorResponse, googleIntegrationState, googleSyncErrorResponse, resolveGoogleCallbackUrl } from '../server/src/google-contacts';
import { classifyGooglePhoneMatch, googlePhoneKey, isProvisionalWhatsapp } from '../server/src/googleContactReconciliation';
import { GOOGLE_INTEGRATION_SETTINGS_PATH, googleSidebarIndicator } from '../src/utils/googleSidebarStatus';
import { PREVIEW_API_URL, PREVIEW_FRONTEND_URL, validatePreviewEnv } from '../scripts/e2e-preview-env.mjs';

test('QA host guard accepts only local database/provider targets', () => {
  assert.equal(isLocalHost('postgresql://vitstock@127.0.0.1:55432/vitstock_qa'), true);
  assert.equal(isLocalHost('http://localhost:3999'), true);
  assert.equal(isLocalHost('https://api.railway.app'), false);
  assert.equal(isLocalHost('https://localhost.example.test'), false);
});

test('QA CORS origins remain exact and reject wildcard-like values', () => {
  const allowed = new Set(parseFrontendOrigins(' http://localhost:3000/, http://127.0.0.1:3000 '));
  assert.equal(isAllowedFrontendOrigin('http://localhost:3000', allowed), true);
  assert.equal(isAllowedFrontendOrigin('http://127.0.0.1:3000/', allowed), true);
  assert.equal(isAllowedFrontendOrigin('http://localhost:3000.evil.test', allowed), false);
  assert.equal(isAllowedFrontendOrigin('*.localhost', allowed), false);
});

test('Google QA scenarios expose deterministic people and failures', () => {
  setQaGoogleScenario('success');
  assert.equal(currentQaGoogleScenario(), 'success');
  assert.equal(qaGoogleFailure(), null);
  assert.equal(qaGooglePeople().length, 2);
  assert.equal(qaGooglePeople()[0]?.resourceName, 'people/qa-ana');

  setQaGoogleScenario('conflict');
  assert.equal(qaGoogleFailure()?.status, 412);
  setQaGoogleScenario('rate-limit');
  assert.equal(qaGoogleFailure()?.status, 429);
  setQaGoogleScenario('timeout');
  assert.equal(qaGoogleFailure()?.status, 504);
  setQaGoogleScenario('sync-token-expired');
  assert.equal(qaGoogleFailure(), null);
  setQaGoogleScenario('partial');
  assert.equal(qaGoogleFailure(), null);
  setQaGoogleScenario('external-delete');
  assert.equal(qaGoogleFailure(), null);
  assert.equal(qaGooglePeople().some((person) => person.resourceName === 'people/qa-ana'), false);
  setQaGoogleScenario('success');
});

test('Google sync exposes actionable errors instead of generic internal failures', () => {
  assert.equal(googleSyncErrorResponse({ code: '42703' }).code, 'GOOGLE_SCHEMA_OUTDATED');
  assert.equal(googleSyncErrorResponse({ status: 401 }).status, 401);
  const reconnect = googleSyncErrorResponse({ status: 400, providerCode: 'invalid_grant' });
  assert.equal(reconnect.status, 401);
  assert.equal(reconnect.code, 'GOOGLE_AUTH_REQUIRED');
  assert.match(reconnect.error, /conexão com o Google precisa ser renovada/i);
  assert.equal(reconnect.retryable, false);
  assert.equal(googleSyncErrorResponse({ status: 429 }).retryable, true);
  assert.equal(googleSyncErrorResponse(new Error('The operation was aborted due to timeout')).status, 504);
});

test('QA runtime guard accepts only the isolated database, provider and fake Google credentials', () => {
  assert.doesNotThrow(() => validateQaRuntimeSafety({
    DATABASE_URL: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa',
    EVOLUTION_API_URL: 'http://127.0.0.1:3999',
    GOOGLE_CLIENT_ID: 'qa-local-google-client-id-not-real',
    GOOGLE_CLIENT_SECRET: 'qa-local-google-client-secret-not-real',
  }));
  assert.throws(() => validateQaRuntimeSafety({
    DATABASE_URL: 'postgresql://user@railway.example/railway',
    EVOLUTION_API_URL: 'https://evolution.example',
    GOOGLE_CLIENT_ID: 'real-client-id',
    GOOGLE_CLIENT_SECRET: 'real-client-secret',
  }), /QA_MODE exige/);
});

test('Google sync preserves the local canonical phone when a resource phone is occupied', () => {
  const plan = buildGooglePhonePlan({
    requestedPhone: '5521990000001',
    otherPhones: ['5521990000002'],
    existingPhone: '5521990000003',
    preserveExistingPhone: true,
  });
  assert.equal(plan.primaryPhone, '5521990000003');
  assert.equal(plan.secondaryPhone, '5521990000001');
  assert.deepEqual(plan.phones, ['5521990000003', '5521990000001', '5521990000002']);
});

test('Google phone plans deduplicate formatted variants before persistence', () => {
  const plan = buildGooglePhonePlan({
    requestedPhone: '+55 (21) 99999-0001',
    otherPhones: ['5521999990001', '(21) 99999-0002'],
    existingPhone: '(21) 99999-0001',
    preserveExistingPhone: true,
  });
  assert.deepEqual(plan.phones, ['(21) 99999-0001', '(21) 99999-0002']);
  assert.equal(plan.secondaryPhone, '(21) 99999-0002');
});

test('Google callback URL uses the configured environment URI', () => {
  assert.equal(
    resolveGoogleCallbackUrl('https://vitstock-hub-git-preview-vitstocks-projects.vercel.app', 'https://vitstock-hub-api-preview.up.railway.app/api/google/callback'),
    'https://vitstock-hub-api-preview.up.railway.app/api/google/callback',
  );
  assert.equal(
    resolveGoogleCallbackUrl('https://vitstock-hub.vercel.app', 'https://vitstock-hub-api-production.up.railway.app/api/google/callback'),
    'https://vitstock-hub-api-production.up.railway.app/api/google/callback',
  );
  assert.equal(resolveGoogleCallbackUrl('http://localhost:3000'), 'http://localhost:3001/api/google/callback');
  assert.throws(
    () => resolveGoogleCallbackUrl('https://vitstock-hub.vercel.app'),
    /GOOGLE_REDIRECT_URI é obrigatório fora do ambiente local/,
  );
});

test('Preview E2E guard accepts only the authorized remote environment', () => {
  const valid = validatePreviewEnv({
    VERCEL_AUTOMATION_BYPASS_SECRET: 'preview-bypass-secret',
    E2E_EMAIL: 'qa@example.test',
    E2E_PASSWORD: 'qa-password',
    PLAYWRIGHT_BASE_URL: PREVIEW_FRONTEND_URL,
  });
  assert.equal(valid.apiURL, PREVIEW_API_URL);
  assert.equal(valid.baseURL, `${PREVIEW_FRONTEND_URL}/`);
  assert.throws(
    () => validatePreviewEnv({ E2E_EMAIL: 'qa@example.test', E2E_PASSWORD: 'qa-password', PLAYWRIGHT_BASE_URL: PREVIEW_FRONTEND_URL }),
    /VERCEL_AUTOMATION_BYPASS_SECRET/,
  );
  assert.throws(
    () => validatePreviewEnv({ VERCEL_AUTOMATION_BYPASS_SECRET: 'secret', E2E_EMAIL: 'qa@example.test', E2E_PASSWORD: 'qa-password', PLAYWRIGHT_BASE_URL: 'https://vitstock-hub.vercel.app' }),
    /PLAYWRIGHT_BASE_URL/,
  );
});

test('Google contact update payload preserves resource identity and metadata etag', () => {
  const payload = buildGoogleContactUpdatePayload(
    { resourceName: 'people/qa-contact', etag: 'etag-current', metadata: { sources: [{ type: 'CONTACT', etag: 'etag-current' }] } },
    { names: [{ givenName: 'Contato QA' }] },
  );
  assert.equal(payload.resourceName, 'people/qa-contact');
  assert.equal(payload.etag, 'etag-current');
  assert.deepEqual(payload.metadata, { sources: [{ type: 'CONTACT', etag: 'etag-current' }] });
});

test('Google contact edit maps provider and local conflicts to actionable responses', () => {
  assert.equal(googleContactErrorResponse({ status: 400, providerReason: 'failedPrecondition' }).status, 409);
  assert.equal(googleContactErrorResponse({ status: 400, providerReason: 'failedPrecondition' }).code, 'GOOGLE_CONTACT_CONFLICT');
  assert.equal(googleContactErrorResponse({ status: 400 }).status, 400);
  assert.equal(googleContactErrorResponse({ status: 403 }).status, 403);
  assert.equal(googleContactErrorResponse({ status: 404 }).status, 404);
  assert.equal(googleContactErrorResponse({ code: '23505', constraint: 'contacts_company_id_phone_key' }).status, 409);
  assert.equal(googleContactErrorResponse({ code: '23505', constraint: 'contacts_company_id_phone_key' }).code, 'CONTACT_PHONE_CONFLICT');
});

test('Google identity reconciliation only reuses one provisional WhatsApp contact', () => {
  const candidate = {
    id: 'whatsapp-contact',
    source: 'hub',
    manualOverride: {},
    hasWhatsappIdentity: true,
    hasWhatsappPhone: true,
    googleResourceName: null,
  };
  assert.equal(classifyGooglePhoneMatch({ candidates: [candidate], googlePersonCount: 1, resourceName: 'people/one' }), 'safe_reconcile');
  assert.equal(classifyGooglePhoneMatch({ candidates: [{ ...candidate, source: 'manual' }], googlePersonCount: 1, resourceName: 'people/one' }), 'ambiguous');
  assert.equal(classifyGooglePhoneMatch({ candidates: [candidate, { ...candidate, id: 'manual-contact', source: 'manual' }], googlePersonCount: 1, resourceName: 'people/one' }), 'ambiguous');
  assert.equal(classifyGooglePhoneMatch({ candidates: [candidate], googlePersonCount: 2, resourceName: 'people/one' }), 'ambiguous');
  assert.equal(classifyGooglePhoneMatch({ candidates: [{ ...candidate, googleResourceName: 'people/one' }], googlePersonCount: 1, resourceName: 'people/one' }), 'linked');
});

test('Google identity reconciliation consolidates a linked Google row into the WhatsApp principal', () => {
  const linked = {
    id: 'google-contact',
    source: 'google',
    manualOverride: {},
    hasWhatsappIdentity: false,
    hasWhatsappPhone: false,
    googleResourceName: 'people/one',
    conversationCount: 0,
  };
  const provisional = {
    id: 'whatsapp-contact',
    source: 'hub',
    manualOverride: {},
    hasWhatsappIdentity: true,
    hasWhatsappPhone: true,
    googleResourceName: null,
    conversationCount: 2,
  };
  assert.equal(classifyGooglePhoneMatch({ candidates: [linked, provisional], googlePersonCount: 1, resourceName: 'people/one' }), 'safe_reconcile_linked');
  assert.equal(classifyGooglePhoneMatch({ candidates: [linked, provisional, { ...provisional, id: 'manual' }], googlePersonCount: 1, resourceName: 'people/one' }), 'ambiguous');
  assert.equal(classifyGooglePhoneMatch({ candidates: [linked, { ...provisional, manualOverride: { name: 'manual' } }], googlePersonCount: 1, resourceName: 'people/one' }), 'ambiguous');
  assert.equal(classifyGooglePhoneMatch({ candidates: [linked, provisional], googlePersonCount: 2, resourceName: 'people/one' }), 'ambiguous');
  assert.equal(classifyGooglePhoneMatch({ candidates: [linked], googlePersonCount: 1, resourceName: 'people/one' }), 'linked');
});

test('Google identity reconciliation uses exact canonical phone keys', () => {
  assert.equal(googlePhoneKey('+5521999999999'), googlePhoneKey('21999999999'));
  assert.notEqual(googlePhoneKey('2199999999'), googlePhoneKey('21999999999'));
});

test('legacy WhatsApp sources remain eligible only with explicit evidence and conversation history', () => {
  assert.equal(isProvisionalWhatsapp({ id: 'legacy', source: 'whatsapp', manualOverride: {}, hasWhatsappIdentity: true, hasWhatsappPhone: false, googleResourceName: null }), true);
  assert.equal(isProvisionalWhatsapp({ id: 'legacy-system', source: 'system', manualOverride: {}, hasWhatsappIdentity: true, hasWhatsappPhone: true, conversationCount: 1, googleResourceName: null }), true);
  assert.equal(isProvisionalWhatsapp({ id: 'legacy-system-without-history', source: 'system', manualOverride: {}, hasWhatsappIdentity: true, hasWhatsappPhone: true, conversationCount: 0, googleResourceName: null }), false);
  assert.equal(isProvisionalWhatsapp({ id: 'legacy-system-no-whatsapp', source: 'system', manualOverride: {}, hasWhatsappIdentity: false, hasWhatsappPhone: false, conversationCount: 1, googleResourceName: null }), false);
  assert.equal(isProvisionalWhatsapp({ id: 'manual', source: 'whatsapp', manualOverride: { name: 'manual' }, hasWhatsappIdentity: true, hasWhatsappPhone: true, googleResourceName: null }), false);
});

test('Google identity reconciliation accepts one explicit legacy WhatsApp principal', () => {
  const linked = {
    id: 'google-contact-legacy-case',
    source: 'google',
    manualOverride: {},
    hasWhatsappIdentity: false,
    hasWhatsappPhone: false,
    googleResourceName: 'people/legacy-case',
    conversationCount: 0,
  };
  const legacy = {
    id: 'legacy-whatsapp-contact',
    source: 'system',
    manualOverride: {},
    hasWhatsappIdentity: true,
    hasWhatsappPhone: true,
    googleResourceName: null,
    conversationCount: 1,
  };
  assert.equal(classifyGooglePhoneMatch({ candidates: [linked, legacy], googlePersonCount: 1, resourceName: linked.googleResourceName }), 'safe_reconcile_linked');
});

test('a linked Hub row is never implicitly archived as a Google duplicate', () => {
  const linkedHub = {
    id: 'hub-linked',
    source: 'hub',
    manualOverride: {},
    hasWhatsappIdentity: true,
    hasWhatsappPhone: true,
    googleResourceName: 'people/one',
  };
  const provisional = {
    id: 'hub-provisional',
    source: 'hub',
    manualOverride: {},
    hasWhatsappIdentity: true,
    hasWhatsappPhone: true,
    googleResourceName: null,
  };
  assert.equal(classifyGooglePhoneMatch({ candidates: [linkedHub, provisional], googlePersonCount: 1, resourceName: 'people/one' }), 'ambiguous');
});

test('Google integration state is tenant-local and maps persisted sync outcomes', () => {
  assert.equal(googleIntegrationState(null), 'not_connected');
  assert.equal(googleIntegrationState({ sync_status: 'never' }), 'connected');
  assert.equal(googleIntegrationState({ sync_status: 'success' }), 'connected');
  assert.equal(googleIntegrationState({ sync_status: 'syncing' }), 'syncing');
  assert.equal(googleIntegrationState({ sync_status: 'auth_required' }), 'reconnect_required');
  assert.equal(googleIntegrationState({ sync_status: 'error' }), 'error');
  assert.equal(googleIntegrationState({ sync_status: 'unknown' }), 'connected');
});

test('Google sidebar indicator exposes every connection state and one settings target', () => {
  assert.equal(GOOGLE_INTEGRATION_SETTINGS_PATH, '/configuracoes?tab=integracoes');
  assert.equal(googleSidebarIndicator('connected').tone, 'connected');
  assert.equal(googleSidebarIndicator('syncing').icon, 'sync');
  assert.equal(googleSidebarIndicator('reconnect_required').tone, 'error');
  assert.equal(googleSidebarIndicator('error').tone, 'error');
  assert.equal(googleSidebarIndicator('not_connected').tone, 'idle');
});

test('Evolution QA adapter is fail-closed while covering app read routes', async () => {
  const history = await qaEvolutionResponse('/chat/findMessages/qa-instance', { method: 'POST' });
  assert.equal(history.status, 200);
  assert.deepEqual(await history.json(), { messages: { records: [] } });

  const read = await qaEvolutionResponse('/chat/markMessageAsRead/qa-instance', { method: 'POST' });
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { status: 'read' });

  assert.throws(
    () => qaEvolutionResponse('/chat/unmodeled-route/qa-instance', { method: 'POST' }),
    /QA_MODE bloqueou chamada Evolution não simulada/,
  );
});

test('outbound conversation lookup types and binds only its referenced parameters', () => {
  const query = buildExistingConversationQuery({ companyId: 'company-a', remoteJid: '5521990000001@s.whatsapp.net' });
  assert.match(query.text, /company_id = \$1::uuid/);
  assert.match(query.text, /evolution_remote_jid = \$2::text/);
  assert.deepEqual(query.values, ['company-a', '5521990000001@s.whatsapp.net', []]);
});
