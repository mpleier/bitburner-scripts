import test from 'node:test';
import assert from 'node:assert/strict';
import {solveFeedbackPassword} from '../darknet-solvers.js';

const password = '48753';
const residueFor = divisor => (Number(password) % Number(divisor)) % (((Number(divisor) - 1) % 32) + 1);

function harness() {
  const logs = [];
  const attempts = [];
  const record = guess => {
    const number = Number(guess);
    const data = String((Number(password) % number) % (((number - 1) % 32) + 1));
    logs.push(JSON.stringify({code: 401, passwordAttempted: guess, data}));
  };
  const authenticate = async raw => {
    const guess = String(raw);
    attempts.push(guess);
    if (guess === password) return {success: true, password};
    record(guess);
    return {success: false, code: 401};
  };
  const authenticateMany = async list => {
    for (const guess of list) { attempts.push(guess); record(guess); }
    return {success: false, code: 401, tried: list.length};
  };
  const readLogs = async () => ({success: true, logs: [...logs]});
  return {attempts, authenticate, authenticateMany, readLogs};
}

test('modular feedback resolves a divisor batch from one scrape', async () => {
  const h = harness();
  const batches = [];
  const result = await solveFeedbackPassword(
    {modelId: 'BigMo%od', passwordLength: 5, passwordFormat: 'numeric', data: ''},
    h.authenticate, h.readLogs, {}, null, null, list => { batches.push(list.length); return h.authenticateMany(list); });
  assert.equal(result.success, true);
  assert.equal(result.password, password);
  assert.deepEqual(batches, [8], 'one batch covers eight divisors');
});

test('modular feedback still converges without a batch delegate', async () => {
  const h = harness();
  const result = await solveFeedbackPassword(
    {modelId: 'BigMo%od', passwordLength: 5, passwordFormat: 'numeric', data: ''},
    h.authenticate, h.readLogs, {});
  assert.equal(result.success, true);
  assert.equal(result.password, password);
  assert.ok(h.attempts.length >= 6, 'sequential fallback probes each divisor');
});
