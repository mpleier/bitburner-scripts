import test from 'node:test';
import assert from 'node:assert/strict';
import { nilFeedbackFromLogs, solveNilPassword } from '../darknet-solvers.js';

const details = { modelId: 'NIL', passwordLength: 5, passwordFormat: 'numeric' };
function fixture(password, initialLogs = []) {
  const guesses = [], logs = [...initialLogs];
  const authenticate = async guess => {
    guesses.push(guess);
    if (guess === password) return { success: true, code: 200 };
    logs.unshift(JSON.stringify({ code: 401, passwordAttempted: guess,
      data: [...guess].map((char, index) => char === password[index] ? 'yes' : "yesn't").join(',') }));
    // Ordinary authenticate responses omit the model's detailed feedback.
    return { success: false, code: 401 };
  };
  return { guesses, logs, authenticate, readLogs: async () => ({ success: true, logs }) };
}

test('NIL uses the dark:sys sample to lock the final 5 and changes wrong positions', async () => {
  const sample = JSON.stringify({ passwordAttempted: '12345', code: 401, data: "yesn't,yesn't,yesn't,yesn't,yes" });
  const f = fixture('98765', ['heartbeat check (alive)', sample, sample]);
  const result = await solveNilPassword(details, f.authenticate, f.readLogs);
  assert.equal(result.success, true);
  assert.equal(result.password, '98765');
  assert.ok(f.guesses.length <= 11);
  assert.equal(new Set(f.guesses).size, f.guesses.length);
  assert.ok(f.guesses.every(guess => guess.endsWith('5')));
  assert.ok(!f.guesses.includes('12345'));
});

test('NIL handles leading zeros and feeds Heartbleed back into guesses', async () => {
  const f = fixture('00005');
  const result = await solveNilPassword(details, f.authenticate, f.readLogs);
  assert.equal(result.password, '00005');
  assert.deepEqual(f.guesses, ['00000', '00001', '00002', '00003', '00004', '00005']);
});

test('NIL never mistakes stale or malformed logs for feedback to the current guess', async () => {
  const guesses = [];
  const readLogs = async () => ({ success: true, logs: [
    'There are tens if not hundreds of [REDACTED] out there',
    JSON.stringify({ code: 401, passwordAttempted: '12345', data: 'yes' }),
    JSON.stringify({ code: 408, passwordAttempted: '00000', data: 'yes,yes,yes,yes,yes' }),
  ] });
  const result = await solveNilPassword(details, async guess => {
    guesses.push(guess); return { success: false, code: 401 };
  }, readLogs);
  assert.equal(result.success, false);
  assert.match(result.reason, /matching.*not found/);
  assert.deepEqual(guesses, ['00000']);
  assert.deepEqual(nilFeedbackFromLogs(['not JSON'], 5), []);
});

test('NIL pauses on transient failures without discarding confirmed progress', async () => {
  const f = fixture('98765');
  const state = {};
  let calls = 0;
  const authenticate = async guess => ++calls === 3 ? { success: false, code: 408 } : f.authenticate(guess);
  const paused = await solveNilPassword(details, authenticate, f.readLogs, state);
  assert.equal(paused.code, 408);
  const resumed = await solveNilPassword(details, f.authenticate, f.readLogs, state);
  assert.equal(resumed.password, '98765');
  assert.equal(new Set(f.guesses).size, f.guesses.length);
});

test('NIL waits for Heartbleed access instead of repeatedly guessing 12345', async () => {
  const f = fixture('98765');
  const result = await solveNilPassword(details, f.authenticate, async () => ({ success: false, code: 451, logs: [] }));
  assert.equal(result.code, 451);
  assert.equal(f.guesses.length, 0);
});
