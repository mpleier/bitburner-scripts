import test from 'node:test';
import assert from 'node:assert/strict';
import {solveAdvancedPassword} from '../darknet-advanced.js';

// Altitude mimics the game: a single Gaussian hill centred on the password.
const password = 50000;
const altitudeAt = x => Math.round(10000 * Math.exp(-((x - password) ** 2) / (1001 ** 2)));

test('the hill sweep probes in batches and still finds the peak', async () => {
  const details = {modelId: 'KingOfTheHill', passwordLength: 5, passwordFormat: 'numeric', passwordHint: '', data: ''};
  const probe = async raw => {
    const guess = String(Math.round(Number(raw)));
    if (Number(guess) === password) return {success: true, password: guess};
    return {feedback: {data: String(altitudeAt(Number(guess)))}};
  };
  let batches = 0;
  const probeMany = async list => { batches++; return list.map(value => ({feedback: {data: String(altitudeAt(Number(value)))}})); };
  const state = {};
  let result = null;
  for (let turn = 0; turn < 200 && !result?.success; turn++) {
    result = await solveAdvancedPassword(details, probe, async () => ({success: true, logs: []}), state, null, null, probeMany);
  }
  assert.equal(result?.success, true, JSON.stringify(result));
  assert.ok(batches > 1, 'the sweep is batched rather than one probe per position');
});

test('the hill still converges without a batch delegate', async () => {
  const details = {modelId: 'KingOfTheHill', passwordLength: 5, passwordFormat: 'numeric', passwordHint: '', data: ''};
  const probe = async raw => {
    const guess = String(Math.round(Number(raw)));
    if (Number(guess) === password) return {success: true, password: guess};
    return {feedback: {data: String(altitudeAt(Number(guess)))}};
  };
  const state = {};
  let result = null;
  for (let turn = 0; turn < 400 && !result?.success; turn++) {
    result = await solveAdvancedPassword(details, probe, async () => ({success: true, logs: []}), state);
  }
  assert.equal(result?.success, true, JSON.stringify(result));
});
