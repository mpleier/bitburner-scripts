import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');

test('every casino pass is capped, even when it keeps reporting fresh rounds', () => {
  // A process this instance did not launch gets a short grace period; its own launch gets the hour.
  assert.match(src, /Date\.now\(\) - casinoWatchStart < \(casinoLaunchedHere \? 60 : 5\) \* 60 \* 1000\) return true;/);
  assert.match(src, /casinoWatchPid=null, casinoWatchStart=0, casinoLaunchedHere=false/);
  assert.match(src, /if \(casinoProcess && casinoWatchPid !== casinoProcess\.pid\) \{ casinoWatchPid = casinoProcess\.pid; casinoWatchStart = Date\.now\(\); \}/);
  assert.match(src, /if \(pid\) casinoLaunchedHere = true;/);
  // Ending or killing the pass clears the ownership flag so the next one is measured from scratch.
  assert.match(src, /casinoWatchdogSince=0;casinoWatchPid=null;casinoWatchStart=0;casinoLaunchedHere=false;/);
});
