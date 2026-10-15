import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCandidates, solveFeedbackPassword, evalArithmetic, isStalledScout } from '../darknet-solvers.js';

function simulation(modelId, password, feedback, format = 'numeric') {
  const logs = [], guesses = [];
  return {
    details: { modelId, passwordLength: password.length, passwordFormat: format }, guesses,
    attempt: async guess => {
      guesses.push(guess);
      if (guess === password) return { success: true, code: 200 };
      logs.unshift(JSON.stringify({ code: 401, passwordAttempted: guess, ...feedback(guess, password) }));
      return { success: false, code: 401 };
    },
    readLogs: async () => ({ success: true, logs }),
  };
}

test('static decoders are integrated without evaluating injected game hints', () => {
  assert.deepEqual(modelCandidates({ modelId: '110100100', data: '01000001 00110001' }), ['A1']);
  assert.deepEqual(modelCandidates({ modelId: 'BellaCuore', data: 'XIV' }), ['14']);
  assert.deepEqual(modelCandidates({ modelId: 'OctantVoxel', data: '16,FF' }), ['255']);
  assert.deepEqual(modelCandidates({ modelId: 'Pr0verFl0', passwordLength: 4 }), ['AAAAAAAA']);
  assert.equal(evalArithmetic('(2+3)*4'), 20);
  assert.equal(evalArithmetic('(2+3'), null);
  assert.equal(evalArithmetic('2.3.4'), null);
  assert.equal(evalArithmetic('globalThis.process.exit()'), null);
});

test('number feedback uses logarithmic search', async () => {
  const f = simulation('AccountsManager_4.2', '48753', (guess, password) => ({ data: Number(guess) > Number(password) ? 'Lower' : 'Higher' }));
  const result = await solveFeedbackPassword(f.details, f.attempt, f.readLogs);
  assert.equal(result.password, '48753');
  assert.ok(f.guesses.length <= 18);
});

function mastermindFeedback(guess, password) {
  const exact = [...guess].filter((char, i) => char === password[i]).length;
  const remaining = [...password].filter((char, i) => char !== guess[i]);
  let misplaced = 0;
  for (const [i, char] of [...guess].entries()) {
    if (char === password[i]) continue;
    const at = remaining.indexOf(char);
    if (at >= 0) { remaining.splice(at, 1); misplaced++; }
  }
  return {data:`${exact},${misplaced}`};
}

test('DeepGreen uses native exact and misplaced counts', async () => {
  const f = simulation('DeepGreen', '506', mastermindFeedback);
  const result = await solveFeedbackPassword(f.details, f.attempt, f.readLogs);
  assert.equal(result.password, '506');
  assert.equal(new Set(f.guesses).size, f.guesses.length);
});

test('timing model advances the confirmed prefix from mismatch indices', async () => {
  const f = simulation('2G_cellular', 'A9', (guess, password) => ({ message: `Found a mismatch while checking each character (${[...password].findIndex((char, i) => char !== guess[i])})` }), 'alphanumeric');
  const result = await solveFeedbackPassword(f.details, f.attempt, f.readLogs);
  assert.equal(result.password, 'A9');
  assert.equal(new Set(f.guesses).size, f.guesses.length);
});

test('longer character searches resume after their bounded probe allowance', async () => {
  const f = simulation('DeepGreen', 'z9Y8x7W6', mastermindFeedback, 'alphanumeric');
  const state = {};
  const first = await solveFeedbackPassword(f.details, f.attempt, f.readLogs, state);
  assert.equal(first.success, false);
  assert.match(first.reason, /progress retained/);
  const second = await solveFeedbackPassword(f.details, f.attempt, f.readLogs, state);
  assert.equal(second.password, 'z9Y8x7W6');
  assert.equal(new Set(f.guesses).size, f.guesses.length);
});

test('modulo model reconstructs the password from coprime residues', async () => {
  const f = simulation('BigMo%od', '98765', (guess, password) => ({ data: String((Number(password) % Number(guess)) % (((Number(guess) - 1) % 32) + 1)) }));
  const result = await solveFeedbackPassword(f.details, f.attempt, f.readLogs);
  assert.equal(result.password, '98765');
});

test('scout recovery requires a stale heartbeat from the same PID', () => {
  const now = 4e6;
  assert.equal(isStalledScout({ pid: 42 }, { pid: 42, at: 1e6 }, now), true);
  assert.equal(isStalledScout({ pid: 42 }, { pid: 41, at: 1e6 }, now), false);
  assert.equal(isStalledScout({ pid: 42 }, { pid: 42, at: now }, now), false);
  assert.equal(isStalledScout({ pid: 42 }, {}, now), false);
});
