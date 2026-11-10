import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');

test('a stalled Stanek charge cannot reserve all home RAM forever', () => {
  // The reservation only applies while the pass is recent and its status file is fresh.
  assert.match(src, /if \(!stanekFirstSeenAt\) stanekFirstSeenAt = Number\.isFinite\(resetInfo\?\.lastAugReset\)/);
  assert.match(src, /Date\.now\(\) - stanekStatus\.at > 10 \* 60 \* 1000/);
  assert.match(src, /Date\.now\(\) - stanekFirstSeenAt > 30 \* 60 \* 1000/);
  assert.match(src, /ns\.kill\(stanekProcess\.pid\)/);
  assert.match(src, /Stanek charging made no progress or exceeded thirty minutes; stopped it so the hacking daemon can start\./);
  // A healthy pass still holds the reservation.
  assert.match(src, /\} else \{\s*\n\s*daemonArgs\.push\("--reserved-ram", 1E100\);/);
});
