import test from 'node:test';
import assert from 'node:assert/strict';
import {casinoWindfallFile, casinoWindfallState, recordCasinoWindfall} from '../casino-augmentation-windfall-policy.js';

function fixture(money = 10e9) {
  const files = new Map();
  const ns = {
    getResetInfo: () => ({lastNodeReset: 10, lastAugReset: 20}),
    getPlayer: () => ({money}),
    read: file => files.get(file) || '',
    write: (file, data) => { files.set(file, data); },
  };
  return {ns, files};
}

test('casino windfall is scoped to the current augmentation reset and remaining cash', async () => {
  const {ns, files} = fixture(4e9);
  const saved = await recordCasinoWindfall(ns, ns.getResetInfo(), 10.099e9);
  assert.equal(saved.amount, 1e10);
  assert.ok(files.has(casinoWindfallFile));
  assert.equal(casinoWindfallState(ns).amount, 4e9);
  assert.equal(casinoWindfallState(ns, {lastNodeReset: 10, lastAugReset: 21}), null);
  assert.equal(casinoWindfallState(ns, ns.getResetInfo(), Date.now() + 2 * 60 * 60 * 1000 + 1), null);
  ns.getPlayer = () => ({money: 0});
  assert.equal(casinoWindfallState(ns), null);
});
