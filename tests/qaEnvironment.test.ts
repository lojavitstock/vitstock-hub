import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isAllowedFrontendOrigin, isLocalHost, parseFrontendOrigins } from '../server/src/config';
import { currentQaGoogleScenario, qaGoogleFailure, qaGooglePeople, setQaGoogleScenario } from '../server/src/qa';

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
