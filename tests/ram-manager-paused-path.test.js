import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../Tasks/ram-manager.js', import.meta.url), 'utf8');

test('the paused-marker lookup never builds an invalid path', () => {
  // A leading slash in the candidate names used to produce 'remote-control/paused//Tasks/...',
  // whose read threw and aborted the entire home RAM purchase.
  assert.ok(!/paused\/'\+name\+'\.txt'/.test(src), 'raw name concatenation must be gone');
  assert.match(src, /String\(name\)\.replace\(\/\^\\\/\+\/,''\)/);
  assert.match(src, /try\{return ns\.read\('remote-control\/paused\/'\+String\(name\)/);
});
