import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');

test('every casino pass is capped, even when it keeps reporting fresh rounds', () => {
  // A process this instance did not launch gets a short grace period; its own launch is bounded by
  // --casino-max-minutes plus a backstop window, so there is only one ceiling in play.
  assert.match(src, /const casinoOuterCeilingMs=\(\)=>\{/);
  assert.match(src, /if\(!casinoLaunchedHere\)return 5\*60\*1000;/);
  assert.match(src, /return Number\.isFinite\(capMinutes\)&&capMinutes>0\?\(capMinutes\+5\)\*60\*1000:Infinity;/);
  assert.match(src, /Date\.now\(\) - casinoWatchStart < casinoOuterCeilingMs\(\)\) return true;/);
  assert.match(src, /casinoWatchPid=null, casinoWatchStart=0, casinoLaunchedHere=false/);
  // Seeing a different process restarts the session clock and the earnings baseline together.
  assert.match(src, /if \(casinoProcess && casinoWatchPid !== casinoProcess\.pid\) \{ casinoWatchPid = casinoProcess\.pid; casinoWatchStart = Date\.now\(\); casinoEarnBaseline = null; casinoEarnAt = 0; casinoSampleAt = 0; casinoMoneyHigh = 0; \}/);
  assert.match(src, /if \(pid\) casinoLaunchedHere = true;/);
  // Ending or killing the pass clears the ownership flag so the next one is measured from scratch.
  assert.match(src, /casinoWatchdogSince=0;casinoWatchPid=null;casinoWatchStart=0;casinoLaunchedHere=false;/);
});

test('a live casino that stops earning is stopped instead of waiting out the ceiling', () => {
  // Fresh round timestamps are not progress: income is sampled at most once a minute.
  assert.match(src, /if \(Date\.now\(\) - casinoSampleAt >= 60000\) \{/);
  assert.match(src, /const earningsStalled = Date\.now\(\) - casinoEarnAt >= 10 \* 60 \* 1000;/);
  // The stall branch must kill and clear state, and it must be reachable before the stay-alive branch.
  const stalled = src.indexOf('} else if (earningsStalled) {');
  const alive = src.indexOf('Date.now() - casinoWatchdogSince < 10 * 60 * 1000 &&');
  assert.ok(stalled > 0 && alive > stalled, 'earnings stall check must precede the keep-waiting branch');
  assert.match(src, /reason:'casino earnings stalled'/);
  assert.match(src, /casinoEarnBaseline=null;casinoEarnAt=0;casinoSampleAt=0;/);
});

test('the in-run watchdog cap is configurable and reports progress while it waits', () => {
  // A casino that keeps earning legitimately holds the fleet; the log used to stay silent for the whole stretch,
  // which made a healthy run indistinguishable from a dead one.
  assert.match(src, /\['casino-max-minutes', 30\]/);
  assert.match(src, /const capMinutes = Number\(options\['casino-max-minutes'\]\);/);
  assert.match(src, /const capMs = Number\.isFinite\(capMinutes\) && capMinutes > 0 \? capMinutes \* 60 \* 1000 : Infinity;/);
  assert.match(src, /const startedAt = Date\.now\(\), hardDeadline = startedAt \+ capMs;/);
  assert.match(src, /Casino still running after \$\{elapsed\} minute/);
  assert.match(src, /'casino exceeded the '\+capMinutes\+'-minute cap'/);
  assert.match(src, /WARNING: casino\.js ran for over \$\{capMinutes\} minutes; stopped it and restored automation\./);
});

test('seed-phase crime income counts as casino progress, not a stall', () => {
  // The seed phase earns money through crimes before blackjack pays anything into sinceInstall.casino,
  // so a flat casino-income curve alone must not look like a stall.
  assert.match(src, /const cashMore = money > casinoMoneyHigh \* 1\.001;/);
  assert.match(src, /if \(earnedMore \|\| cashMore\) casinoEarnAt = Date\.now\(\);/);
  assert.match(src, /let casinoEarnBaseline=null,casinoEarnAt=0,casinoSampleAt=0,casinoMoneyHigh=0;/);
});
