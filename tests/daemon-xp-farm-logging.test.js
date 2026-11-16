import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const daemon = readFileSync(new URL('../daemon.js', import.meta.url), 'utf8');

test('the advanced-mode farm shortfall is announced once per target, not every cycle', () => {
  // The shortfall is a property of the target and its RAM allocation, so a per-cycle log buries everything else.
  assert.match(daemon, /const advancedKey = server\.name \+ ':advanced';/);
  assert.match(daemon, /if \(!xpBasicModeLogged\.has\(advancedKey\)\) \{/);
  assert.match(daemon, /xpBasicModeLogged\.add\(advancedKey\);/);
  // The once-per-boot basic-mode message keeps its own key so the two do not suppress each other.
  assert.match(daemon, /xpBasicModeLogged\.add\(server\.name\)/);
});

test('both advanced-mode admission checks still revert to basic farming', () => {
  const preCheck = daemon.indexOf('if (!loopRunning && threads <= effectiveHackThreads)');
  const postCheck = daemon.indexOf('if (threads <= effectiveHackThreads) {');
  assert.ok(preCheck > 0, 'pre-allocation admission check must exist');
  assert.ok(postCheck > preCheck, 'post-reduction check must run after the admission check');
  const reverts = (daemon.match(/scheduleHackExpCycle\(ns, server, percentOfFreeRamToConsume, verbose, false, allocatedServer, singleServer\)/g) || []).length;
  assert.ok(reverts >= 2, 'both checks must fall back to basic mode');
});
