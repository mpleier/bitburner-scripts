import test from 'node:test';
import assert from 'node:assert/strict';
import { packetCandidates, solveAdvancedPassword } from '../darknet-advanced.js';

test('packet captures expose explicit and windowed candidates', () => {
  const words = packetCandidates('noise host:AB12 Logging in with passcode: ZX99 ...', 4, 'host');
  assert.ok(words.includes('AB12'));
  assert.ok(words.includes('ZX99'));
});

test('OpenWeb recovers after an empty packet capture instead of aborting', async () => {
  const captures = ['----', 'host:AB12'];
  const guesses = [];
  const probe = async guess => {
    guesses.push(guess);
    if (guess === 'AB12') return { success: true, password: guess };
    return { feedback: { data: captures.shift() || '----' } };
  };
  const result = await solveAdvancedPassword({ modelId: 'OpenWebAccessPoint', passwordLength: 4, hostname: 'host' },
    probe, async () => ({ success: true, logs: [] }), {});
  assert.equal(result.password, 'AB12');
  assert.ok(guesses.length >= 3);
});
