import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {casinoAlreadyRan, casinoRetryPending} from '../casino-policy.js';

const AUG = 1794715192988;

test('a completed run in this augmentation generation is final', () => {
  assert.equal(casinoAlreadyRan({mode: 'complete', augReset: AUG}, AUG), true);
  // A record from an earlier generation says nothing about this one.
  assert.equal(casinoAlreadyRan({mode: 'complete', augReset: AUG - 1}, AUG), false);
  // Failed or in-flight runs are not completed, so the retry logic owns them.
  for (const mode of ['failed', 'running', 'waiting', undefined])
    assert.equal(casinoAlreadyRan({mode, augReset: AUG}, AUG), false);
  assert.equal(casinoAlreadyRan(null, AUG), false);
  assert.equal(casinoAlreadyRan({}, AUG), false);
});

test('completion and retry never both claim the same record', () => {
  const now = 1000;
  const failed = {mode: 'failed', augReset: AUG, retryAt: now + 60000};
  assert.equal(casinoRetryPending(failed, AUG, now), true);
  assert.equal(casinoAlreadyRan(failed, AUG), false);
});

test('autopilot consults the per-generation latch before replaying the casino phase', () => {
  const source = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ casinoRetryPending, casinoAlreadyRan, casinoHookArgs \} from '\.\/casino-policy\.js';/);
  assert.match(source, /casinoDone=casinoAlreadyRan\(casinoRecord,resetInfo\.lastAugReset\)/);
  assert.match(source, /!casinoRetry&&!casinoDone&&!ranCasino/);
});
