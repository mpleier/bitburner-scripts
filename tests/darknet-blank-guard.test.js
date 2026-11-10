import test from 'node:test';
import assert from 'node:assert/strict';
import {candidatePasswordTurn} from '../darknet-solvers.js';

const details = {hostname: 'central_intelligence_agency', modelId: 'DeskMemo_3.1', passwordLength: 2, passwordFormat: 'numeric', passwordHint: 'The PIN is 85', data: ''};

test('an empty saved credential never reaches a hinted host', async () => {
  const attempts = [];
  const state = {};
  const result = await candidatePasswordTurn(details, '', ['85'], state, async password => {
    attempts.push(password);
    return password === '85' ? {success: true} : {success: false, code: 401};
  });
  assert.equal(result.success, true);
  assert.equal(result.password, '85');
  assert.deepEqual(attempts, ['85'], 'no empty attempt should be made');
});

test('an empty candidate is filtered unless the server documents no password', async () => {
  const attempts = [];
  const state = {};
  await candidatePasswordTurn(details, undefined, ['', '85'], state, async password => {
    attempts.push(password);
    return {success: false, code: 401};
  });
  assert.deepEqual(attempts, ['85']);
});

test('blank-password servers still accept the empty credential', async () => {
  const attempts = [];
  const blank = {hostname: 'zero', modelId: 'ZeroLogon', passwordLength: 0, passwordFormat: 'numeric', passwordHint: 'There is no password', data: ''};
  const result = await candidatePasswordTurn(blank, undefined, [''], {}, async password => {
    attempts.push(password);
    return {success: true};
  });
  assert.equal(result.success, true);
  assert.deepEqual(attempts, ['']);
});
