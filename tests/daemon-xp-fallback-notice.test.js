import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../daemon.js', import.meta.url), 'utf8');

test('the grow/weaken XP fallback is announced with its thread arithmetic', () => {
  // Source: calculateHackingExpGain is (3 + 0.3 * baseDifficulty) * mults for every op, while grow and
  // weaken take 3.2x and 4x the hack time, so the fallback silently costs ~3.2x XP per thread.
  assert.match(src, /const xpBasicModeLogged = new Set\(\);/);
  assert.match(src, /if\(!xpBasicModeLogged\.has\(server\.name\)\)\{xpBasicModeLogged\.add\(server\.name\);log\(ns,`INFO: Basic XP farm on \$\{server\.name\}: \$\{threads\} threads cannot exceed the \$\{effectiveHackThreads\} threads needed to steal its money/);
  // The fallback must still reschedule with the parameter the function actually declares.
  const fallback = src.indexOf('cannot exceed the ${effectiveHackThreads} threads');
  const call = src.indexOf('return await scheduleHackExpCycle(ns, server, percentOfFreeRamToConsume, verbose, false, allocatedServer, singleServer);', fallback);
  assert.ok(fallback > 0 && call > fallback, 'fallback must delegate to the basic scheduling path');
});
