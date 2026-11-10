import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the Red Pill reset hold only applies while completion is committed to the World Daemon', () => {
  const src = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');
  assert.match(src, /const wdCompletion=committedRoute\(routePlan\)==='hacking';/);
  assert.match(src, /if\(wdCompletion&&\(pill\?\.holdResets&&!wdUpgradePaysBack/);
});

test('a committed Bladeburner completion route does not hold augmentation resets', () => {
  // The hold is only meaningful when leftover hacking progress belongs to the finish line.
  const hold = (route, holdResets, paysBack) => route === 'hacking' && (holdResets && !paysBack);
  assert.equal(hold('hacking', true, false), true);
  assert.equal(hold('bladeburner', true, false), false);
  assert.equal(hold('hacking', false, false), false);
  assert.equal(hold('hacking', true, true), false);
});
