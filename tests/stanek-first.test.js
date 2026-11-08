import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureStanekFirst, stanekFirstState, stanekGiftName} from '../stanek-first-policy.js';

function fixture(owned = [], installed = [], node = 14, sf13 = 1) {
  let accepted = 0;
  const ns = {
    getResetInfo: () => ({currentNode: node, ownedSF: {13: sf13}}),
    singularity: {
      getOwnedAugmentations: all => all ? owned : installed,
    },
    stanek: {acceptGift: () => { accepted++; return true; }},
  };
  return {ns, accepted: () => accepted};
}

test('Stanek is accepted before other augmentations and blocked when they already exist', () => {
  const ready = fixture([], []);
  assert.equal(stanekFirstState(ready.ns).canAccept, true);
  assert.equal(ensureStanekFirst(ready.ns).accepted, true);
  assert.equal(ready.accepted(), 1);

  const blocked = fixture(['The W1ngs of Icarus'], []);
  assert.equal(stanekFirstState(blocked.ns).canAccept, false);
  assert.equal(ensureStanekFirst(blocked.ns).accepted, undefined);
  assert.equal(blocked.accepted(), 0);

  const installed = fixture([stanekGiftName], [stanekGiftName]);
  assert.equal(stanekFirstState(installed.ns).installed, true);
  assert.equal(installed.accepted(), 0);
  assert.equal(fixture([], [], 8).ns && stanekFirstState(fixture([], [], 8).ns).canAccept, false);
});
