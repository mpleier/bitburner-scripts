import test from 'node:test';
import assert from 'node:assert/strict';
import {gangCreationHost, planGangHost} from '../faction-policy.js';

const joined = ['Ishima', 'Tetrads', 'Slum Snakes', 'Bladeburners', 'Church of the Machine God'];

test('a pinned host that is not joined cannot block creation', () => {
  const pinned = {'gang-faction': 'Speakers for the Dead', 'gang-type': 'combat'};
  // planGangHost alone waits for that invitation forever, even with two eligible hosts joined.
  assert.equal(planGangHost(joined, pinned).host, null);
  const plan = gangCreationHost(joined, pinned);
  assert.equal(plan.fallbackFrom, 'Speakers for the Dead');
  assert.ok(['Tetrads', 'Slum Snakes'].includes(plan.host));
});

test('a joined pinned host keeps its host and reports no fallback', () => {
  const plan = gangCreationHost(joined, {'gang-faction': 'Slum Snakes'});
  assert.equal(plan.host, 'Slum Snakes');
  assert.equal(plan.fallbackFrom, undefined);
});

test('no pin, no fallback, and the plain plan is returned unchanged', () => {
  const plan = gangCreationHost(joined, {'gang-type': 'combat'});
  assert.equal(plan.fallbackFrom, undefined);
  assert.equal(plan.error, null);
  assert.ok(joined.includes(plan.host));
});

test('the fallback stays inside the configured gang type', () => {
  // A hacking pin with no hacking host joined and no combat host allowed: nothing to fall back to.
  const plan = gangCreationHost(joined, {'gang-faction': 'NiteSec', 'gang-type': 'hacking'});
  assert.equal(plan.host, null);
  assert.equal(plan.fallbackFrom, undefined);
});

test('plan errors pass through untouched', () => {
  const plan = gangCreationHost(joined, {'gang-faction': 'Not A Faction'});
  assert.match(plan.error, /gang-capable faction/);
  assert.equal(plan.host, null);
});
