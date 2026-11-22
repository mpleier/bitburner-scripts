import test from 'node:test';
import assert from 'node:assert';
import {readFile} from 'node:fs/promises';

const source = () => readFile(new URL('../autopilot.js', import.meta.url), 'utf8');

// Gangs are reset by Bitnode completion, so autopilot must re-create them even while
// bootstrapOnly is still active; otherwise the gang income (and the casino gate that
// depends on it) stays missing for the whole bootstrap window.
test('gang startup runs before the bootstrapOnly early return', async () => {
  const s = await source();
  const gang = s.indexOf('if (2 in unlockedSFs && achievementActionAllowed(ns,"gang"))');
  const bootstrapReturn = s.indexOf('if(bootstrapOnly)return;');
  assert.ok(gang > 0, 'gang startup block not found');
  assert.ok(bootstrapReturn > 0, 'bootstrapOnly return not found');
  assert.ok(gang < bootstrapReturn, 'gang startup must run before the bootstrapOnly early return');
});

test('work-for-factions launches during bootstrap when rushing a gang', async () => {
  const s = await source();
  assert.match(s, /rushGang \? \(bootstrapOnly \|\| !findScript\('casino\.js'\)\) : !findScript\('casino\.js'\)/);
});

test('gang status reads validate the reset epochs', async () => {
  const s = await source();
  // Any consumer of tasks/gang-status.json must reject a file from another generation.
  const readers = [...s.matchAll(/ns\.read\('tasks\/gang-status\.json'\)/g)].length;
  const epochChecks = [...s.matchAll(/saved\.nodeReset === resetInfo\.lastNodeReset/g)].length;
  assert.ok(readers > 0, 'expected at least one gang-status reader');
  assert.ok(epochChecks >= readers, 'every gang-status reader must validate nodeReset');
});
