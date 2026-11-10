import test from 'node:test';
import assert from 'node:assert/strict';
import {solveAdvancedPassword} from '../darknet-advanced.js';

const password = '48753';
const rmsFeedback = guess => {
  const squares = [...guess].reduce((sum, char, index) => sum + (Number(char) - Number(password[index])) ** 2, 0);
  return {feedback: {data: `RMS Deviation:${Math.sqrt(squares / password.length).toFixed(9)}`}};
};

test('sorted-echo recovers every digit from one batched probe round', async () => {
  const details = {modelId: 'PHP 5.4', passwordLength: 5, passwordFormat: 'numeric', passwordHint: 'The password is shuffled 00123', data: '00123'};
  let batched = 0;
  const probe = async raw => {
    const guess = String(raw).padStart(5, '0');
    if (guess === password) return {success: true, password};
    return rmsFeedback(guess);
  };
  const probeMany = async list => { batched++; return list.map(rmsFeedback); };
  const result = await solveAdvancedPassword(details, probe, async () => ({success: true, logs: []}), {}, null, null, probeMany);
  assert.equal(result.success, true);
  assert.equal(result.password, password);
  assert.equal(batched, 1, 'all positions are probed in a single batch');
});

test('without a batch delegate the sequential digit walk still solves', async () => {
  const details = {modelId: 'PHP 5.4', passwordLength: 5, passwordFormat: 'numeric', passwordHint: '', data: '00123'};
  const probe = async raw => {
    const guess = String(raw).padStart(5, '0');
    if (guess === password) return {success: true, password};
    return rmsFeedback(guess);
  };
  const result = await solveAdvancedPassword(details, probe, async () => ({success: true, logs: []}), {});
  assert.equal(result.success, true);
  assert.equal(result.password, password);
});
