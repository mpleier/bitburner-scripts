import test from 'node:test';
import assert from 'node:assert/strict';
import {isScriptPaused, pauseFile, pauseScopeFile, setScriptPaused} from '../automation-control.js';

const reset = {lastNodeReset: 100, lastAugReset: 200};
function fakeNs(files = new Map(), current = reset) {
  return {
    files,
    read: file => files.get(file) || '',
    write: async (file, value) => { files.set(file, value); },
    rm: file => { files.delete(file); },
    getResetInfo: () => current,
    print: () => {},
  };
}

test('a pause applies to the run that asked for it', async () => {
  const ns = fakeNs();
  await setScriptPaused(ns, 'casino.js', true);
  assert.equal(ns.files.get(pauseFile('casino.js')), 'true');
  assert.equal(isScriptPaused(ns, 'casino.js'), true);
  assert.ok(ns.files.has(pauseScopeFile('casino.js')), 'the scope record is written alongside the flag');
});

test('a pause from an earlier run does not survive the reset', async () => {
  const ns = fakeNs();
  await setScriptPaused(ns, 'casino.js', true);
  const later = fakeNs(ns.files, {lastNodeReset: 100, lastAugReset: 999});
  assert.equal(isScriptPaused(later, 'casino.js'), false);
  assert.equal(later.files.has(pauseFile('casino.js')), false, 'the stale flag is cleared');
  assert.equal(later.files.has(pauseScopeFile('casino.js')), false, 'the stale scope is cleared too');
});

test('a plain flag is authoritative until someone clears it', async () => {
  // Remote control and the supervisors treat a bare 'true' as paused; only scoped flags can age out.
  const ns = fakeNs(new Map([[pauseFile('casino.js'), 'true']]));
  assert.equal(isScriptPaused(ns, 'casino.js'), true);
});

test('resuming removes both files, and a flag without reset metadata is trusted as-is', async () => {
  const ns = fakeNs();
  await setScriptPaused(ns, 'gangs.js', true);
  await setScriptPaused(ns, 'gangs.js', false);
  assert.equal(ns.files.has(pauseFile('gangs.js')), false);
  assert.equal(ns.files.has(pauseScopeFile('gangs.js')), false);

  const blind = {read: f => (f === pauseFile('sleeve.js') ? 'true' : ''), write: async () => {}, rm: () => {}, print: () => {}};
  assert.equal(isScriptPaused(blind, 'sleeve.js'), true, 'without getResetInfo the flag cannot be aged out');
});
