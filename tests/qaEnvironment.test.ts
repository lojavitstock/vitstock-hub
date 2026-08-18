import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isAllowedFrontendOrigin, isLocalHost, parseFrontendOrigins } from '../server/src/config';
import { currentQaGoogleScenario, qaEvolutionResponse, qaGoogleFailure, qaGooglePeople, setQaGoogleScenario } from '../server/src/qa';
import { buildExistingConversationQuery } from '../server/src/conversationQueries';

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
  assert.deepEqual(query.values, ['company-a', '5521990000001@s.whatsapp.net']);
});
