import test from 'node:test';
import assert from 'node:assert/strict';
import {sleeveMemoryPriorityFile, readSleeveMemoryPriority, writeSleeveMemoryPriority, clearSleeveMemoryPriority} from '../sleeve-memory-priority-policy.js';

function fixture() {
  const files = new Map();
  return {
    files,
    ns: {
      getResetInfo: () => ({lastNodeReset: 3, lastAugReset: 4}),
      read: file => files.get(file) || '',
      write: (file, data) => { files.set(file, data); },
      rm: file => { files.delete(file); },
    },
  };
}

test('sleeve memory priority is reset-scoped and expires', async () => {
  const {ns, files} = fixture();
  await writeSleeveMemoryPriority(ns, ns.getResetInfo(), [2, 100]);
  assert.ok(files.has(sleeveMemoryPriorityFile));
  assert.deepEqual(readSleeveMemoryPriority(ns).memories, [2, 100]);
  assert.equal(readSleeveMemoryPriority(ns, {lastNodeReset: 3, lastAugReset: 5}), null);
  assert.equal(readSleeveMemoryPriority(ns, ns.getResetInfo(), Date.now() + 3 * 60 * 1000), null);
  await clearSleeveMemoryPriority(ns);
  assert.equal(files.has(sleeveMemoryPriorityFile), false);
});
