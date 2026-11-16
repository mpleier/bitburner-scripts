import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {factionJoinOutcome} from '../faction-policy.js';

test('a successful join is recorded as a join', () => {
  assert.equal(factionJoinOutcome(true, false), 'joined');
  assert.equal(factionJoinOutcome(true, true), 'joined');
});

test('a false response from an existing member is not a failure', () => {
  // ns.singularity.joinFaction returns false both for "already a member" and for a real rejection.
  assert.equal(factionJoinOutcome(false, true), 'already-member');
});

test('a false response without membership stays a failure', () => {
  assert.equal(factionJoinOutcome(false, false), 'failed');
  assert.equal(factionJoinOutcome(false, undefined), 'failed');
  assert.equal(factionJoinOutcome(0, 'yes'), 'failed');
  assert.equal(factionJoinOutcome(undefined, null), 'failed');
});

test('faction-manager reads membership back before reporting a join error', () => {
  const src = readFileSync(new URL('../faction-manager.js', import.meta.url), 'utf8');
  assert.match(src, /const outcome = factionJoinOutcome\(response, member\);/);
  assert.match(src, /member = \(await getPlayerInfo\(ns\)\)\.factions\.includes\(faction\.name\) === true;/);
  assert.match(src, /if \(!joinedFactions\.includes\(faction\.name\)\) joinedFactions\.push\(faction\.name\);/);
  assert.match(src, /if \(outcome !== 'failed'\) \{/);
  // The old assignment-in-condition form silently skipped bookkeeping for an existing membership.
  assert.doesNotMatch(src, /if \(response = await getNsDataThroughFile/);
});
