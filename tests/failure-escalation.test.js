import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {failureEscalation, failureCleared, persistentFailures} from '../failure-escalation-policy.js';

test('a one-off failure stays quiet and a persistent one is announced once', () => {
  let state = null;
  state = failureEscalation(state, 1000); assert.equal(state.count, 1); assert.equal(state.announce, false);
  state = failureEscalation(state, 2000); assert.equal(state.count, 2); assert.equal(state.announce, false);
  state = failureEscalation(state, 3000); assert.equal(state.count, 3); assert.equal(state.announce, true);
  // Not repeated on every subsequent cycle.
  state = failureEscalation(state, 4000); assert.equal(state.announce, false);
  state = failureEscalation(state, 5000); assert.equal(state.announce, false);
});

test('a failure that persists is re-announced on the repeat interval', () => {
  let state = null;
  for (let i = 0; i < 3; i++) state = failureEscalation(state, 0);
  assert.equal(state.announce, true);
  state = failureEscalation(state, 300000); assert.equal(state.announce, false);
  state = failureEscalation(state, 700000); assert.equal(state.announce, true);
});

test('success clears the streak but keeps the announcement clock', () => {
  let state = null;
  for (let i = 0; i < 3; i++) state = failureEscalation(state, i);
  const cleared = failureCleared(state, 10);
  assert.equal(cleared.count, 0);
  assert.equal(cleared.announcedAt, state.announcedAt);
  assert.equal(failureCleared(null, 10), null);
});

test('only operations past the threshold are reported as persistent', () => {
  const state = new Map([['a', {count: 2}], ['b', {count: 7}], ['c', {count: 0}]]);
  assert.deepEqual(persistentFailures(state), [{label: 'b', count: 7}]);
  assert.deepEqual(persistentFailures({}), []);
});

test('the corporation manager escalates instead of printing forever', () => {
  const src = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8');
  assert.match(src, /const next = failureEscalation\(safeFailures\.get\(label\), Date\.now\(\)\);/);
  assert.match(src, /if \(next\.announce\) ns\.tprint\(`WARNING: corporation \$\{message\}/);
  assert.match(src, /if \(safeFailures\.has\(label\)\) safeFailures\.set\(label, failureCleared/);
  assert.match(src, /persistentFailures: persistentFailures\(safeFailures\)/);
});

test('casino UI drift is announced to the terminal, not just the tail window', () => {
  const src = readFileSync(new URL('../casino.js', import.meta.url), 'utf8');
  assert.match(src, /ns\.tprint\('WARNING: casino\.js stopped safely; the casino interface could not be driven: '/);
});
