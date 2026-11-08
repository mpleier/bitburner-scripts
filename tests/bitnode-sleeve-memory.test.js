import test from 'node:test';
import assert from 'node:assert/strict';
import {sleeveMemoryReady} from '../auto-destroy-world-daemon.js';

function fixture(node, memories = [100]) {
  return {
    getResetInfo: () => ({currentNode: node}),
    sleeve: {
      getNumSleeves: () => memories.length,
      getSleeve: i => ({memory: memories[i]}),
    },
  };
}

test('BN10 completion waits for every sleeve to reach 100 memory', () => {
  assert.equal(sleeveMemoryReady(fixture(10, [100, 100])), true);
  assert.equal(sleeveMemoryReady(fixture(10, [100, 99])), false);
  assert.equal(sleeveMemoryReady(fixture(10, [100, NaN])), false);
  assert.equal(sleeveMemoryReady(fixture(10, [])), false);
  assert.equal(sleeveMemoryReady(fixture(11, [1])), true);
  assert.equal(sleeveMemoryReady({getResetInfo: () => ({currentNode: 10}), sleeve: {getNumSleeves: () => { throw Error('unavailable'); }}}), false);
});
