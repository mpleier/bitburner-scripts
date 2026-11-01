import test from 'node:test';
import assert from 'node:assert/strict';
import {main} from '../achievement-puzzles.js';

test('overlapping time-puzzle hooks restore the original timer instead of leaving one installed', async () => {
  const nativeTimer = globalThis.setTimeout;
  const exits = [];
  const ns = () => ({disableLog: () => {}, atExit: callback => exits.push(callback), sleep: async () => {}});
  try {
    await main({...ns(), args: ['time']});
    const firstHook = globalThis.setTimeout;
    assert.notEqual(firstHook, nativeTimer);
    await main({...ns(), args: ['time']});
    const secondHook = globalThis.setTimeout;
    assert.notEqual(secondHook, firstHook);
    // First instance exits while the second hook is installed: it must not restore (or clobber) it.
    exits[0]();
    assert.equal(globalThis.setTimeout, secondHook);
    // Second instance exits: restore the native timer, not the first puzzle hook.
    exits[1]();
    assert.equal(globalThis.setTimeout, nativeTimer);
  } finally {
    globalThis.setTimeout = nativeTimer;
  }
});

test('overlapping prototype hooks restore the native toExponential', async () => {
  const native = Number.prototype.toExponential;
  const exits = [];
  const ns = () => ({disableLog: () => {}, atExit: callback => exits.push(callback), sleep: async () => {}});
  try {
    await main({...ns(), args: ['prototype']});
    await main({...ns(), args: ['prototype']});
    assert.equal(Number(55).toExponential(), '5.50e+1');
    exits[0]();
    exits[1]();
    assert.equal(Number.prototype.toExponential, native);
    assert.equal(Number(1).toExponential(), '1e+0');
  } finally {
    Number.prototype.toExponential = native;
  }
});
