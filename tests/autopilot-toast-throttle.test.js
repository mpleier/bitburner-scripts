import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const autopilot = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');

test('the install countdown announces each milestone once instead of every loop tick', () => {
  const start = autopilot.indexOf('if (installCountdown > Date.now()) {');
  const end = autopilot.indexOf('return reservedPurchase = totalCost;', start);
  assert.ok(start > 0 && end > start, 'the countdown branch must still exist');
  const branch = autopilot.slice(start, end);
  // The branch runs every `interval` (two seconds); one toast per visit buried every other notification.
  assert.equal((branch.match(/ns\.toast\(/g) || []).length, 1, 'the countdown must emit exactly one toast call');
  assert.match(branch, /const resetBucket = remainingMs > 60000 \? 'm' \+ Math\.ceil\(remainingMs \/ 60000\)/);
  assert.match(branch, /if \(resetBucket !== resetToastBucket\) \{/);
  // A new install window must be able to announce again.
  assert.match(autopilot, /resetToastBucket = null; \/\/ Countdown finished/);
  assert.match(autopilot, /let resetToastBucket=null;/);
});
