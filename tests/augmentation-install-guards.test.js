import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const autopilot = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');

test('NeuroFlux levels alone only trigger a reset at a doubled basket', () => {
  // A reset wipes levels, gang, corporation and cash. NeuroFlux costs money only and adds ~1.5% each,
  // so a small NF-only basket must wait; it still rides along when a real augmentation is queued.
  assert.match(autopilot, /const nfOnlyBasket = pendingAugCount === 0 && pendingNfCount > 0;/);
  assert.match(autopilot, /const nfOnlyNeeded = augsNeededInclNf \* 2;/);
  assert.match(autopilot, /pendingAugCount >= augsNeeded \|\| \(!nfOnlyBasket && pendingAugInclNfCount >= augsNeededInclNf\) \|\|/);
  assert.match(autopilot, /\(nfOnlyBasket && pendingNfCount >= nfOnlyNeeded\)/);
  assert.match(autopilot, /a reset for NeuroFlux alone needs \$\{nfOnlyNeeded\}/);
});
