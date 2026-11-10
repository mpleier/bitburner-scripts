import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('transition and planner launchers are exempt from the idle RAM hold', () => {
  const src = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');
  // An augmentation install (ascend.js) and the faction summary it depends on must be able to run
  // while the daemon keeps a large RAM hold, otherwise a queued priority augmentation never installs.
  assert.match(src, /const critical=completionManager\|\|\['bootstrap-start\.js','reliability-manager\.js','casino\.js','faction-manager\.js','ascend\.js'\]/);
  assert.match(src, /const headroom=critical\?Math\.min\(16,homeRamReserve\(ns\)\):homeRamReserve\(ns\);/);
});
