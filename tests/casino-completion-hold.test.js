import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the final ten-billion casino pass yields to a committed Bladeburner finish', () => {
  const src = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');
  // A pending final pass is dropped outright rather than taking the player away from Black Ops.
  assert.match(src, /if\(finalEarn&&committedRoute\(routePlan\)==='bladeburner'\)\{/);
  assert.match(src, /Casino hold: dropped the pending final 10b pass because Bladeburner completion is the priority\./);
  // The reset loop that arms a new final pass is gated on the committed route and funded basket.
  assert.match(src, /const completionCasinoHold=committedRoute\(routePlan\)==='bladeburner'&&player\.money>=totalCost;/);
  assert.match(src, /&&!completionCasinoHold\)\{/);
});
