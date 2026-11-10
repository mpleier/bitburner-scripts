import test from 'node:test';
import assert from 'node:assert/strict';
import {candidatePasswordTurn} from '../darknet-solvers.js';

const details = {hostname: 'dictionary-host', modelId: 'dictionary', passwordLength: 5, passwordFormat: 'alphabetic', passwordHint: '', data: ''};

test('a batched candidate turn solves from one delegated launch', async () => {
  const batches = [];
  const single = [];
  const state = {};
  const candidates = ['alpha', 'bravo', 'charl', 'delta', 'echoo'];
  const result = await candidatePasswordTurn(details, undefined, candidates, state,
    async password => { single.push(password); return {success: false, code: 401}; },
    undefined, Date.now(), 8, 600000,
    async passwords => { batches.push([...passwords]); return passwords.includes('charl') ? {success: true, password: 'charl'} : {success: false, code: 401}; });
  assert.equal(result.success, true);
  assert.equal(result.password, 'charl');
  assert.equal(batches.length, 1, 'one worker launch should cover the batch');
  assert.deepEqual(batches[0], candidates);
  assert.deepEqual(single, [], 'no per-candidate attempt once batching is available');
});

test('a failed batch advances past the tried candidates and leaves the rest to single attempts', async () => {
  const state = {};
  const candidates = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee', 'fffff', 'ggggg', 'hhhhh', 'iiiii'];
  const batched = [];
  const result = await candidatePasswordTurn(details, undefined, candidates, state,
    async password => ({success: password === 'iiiii', code: password === 'iiiii' ? 200 : 401}),
    undefined, Date.now(), 16, 600000,
    async passwords => { batched.push([...passwords]); return {success: false, code: 401}; });
  assert.equal(batched[0].length, 8, 'a batch is capped at eight candidates');
  assert.equal(result.success, true);
  assert.equal(result.password, 'iiiii', 'the ninth candidate is still tried individually');
});

test('without a batch delegate the turn tries candidates one by one', async () => {
  const attempts = [];
  const result = await candidatePasswordTurn(details, undefined, ['aaaaa', 'bbbbb'], {},
    async password => { attempts.push(password); return {success: false, code: 401}; });
  assert.equal(result.success, false);
  assert.deepEqual(attempts, ['aaaaa', 'bbbbb']);
});
