import test from 'node:test';
import assert from 'node:assert/strict';
import {solveAdvancedPassword} from '../darknet-advanced.js';

const password = '858'; // 2 * 3 * 11 * 13
const divides = value => Number(password) % Number(value) === 0;

test('divisibility batches settle eight primes per round and factor the password', async () => {
  const details = {modelId: 'Factori-Os', passwordLength: 3, passwordFormat: 'numeric', passwordHint: '', data: ''};
  const probe = async raw => {
    const guess = String(Number(raw));
    if (guess === password) return {success: true, password};
    return {feedback: {data: divides(guess) ? 'true' : 'false'}};
  };
  let batches = 0;
  const probeMany = async list => { batches++; return list.map(value => ({feedback: {data: divides(value) ? 'true' : 'false'}})); };
  const state = {};
  let result = null;
  for (let turn = 0; turn < 8 && !result?.success; turn++) {
    result = await solveAdvancedPassword(details, probe, async () => ({success: true, logs: []}), state, null, null, probeMany);
  }
  assert.equal(result?.success, true);
  assert.equal(result.password, password);
  assert.ok(batches > 1, 'the whole prime list is swept in batches, not one probe at a time');
});

test('without a batch delegate the sequential divisibility walk is unchanged', async () => {
  const details = {modelId: 'Factori-Os', passwordLength: 3, passwordFormat: 'numeric', passwordHint: '', data: ''};
  const attempts = [];
  const probe = async raw => {
    const guess = String(Number(raw));
    attempts.push(guess);
    if (guess === password) return {success: true, password};
    return {feedback: {data: divides(guess) ? 'true' : 'false'}};
  };
  const state = {};
  let result = null;
  for (let turn = 0; turn < 20 && !result?.success; turn++) {
    result = await solveAdvancedPassword(details, probe, async () => ({success: true, logs: []}), state);
  }
  assert.equal(result?.success, true);
  assert.equal(result.password, password);
  assert.ok(attempts.length >= 10);
});
