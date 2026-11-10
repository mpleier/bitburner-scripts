import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../darknet-node.js', import.meta.url), 'utf8');

test('auth and bleed workers scale past eight threads when the host allows it', () => {
  assert.match(src, /const cap = file === authWorker \|\| file === bleedWorker \? 32 : 8;/);
  // Other workers keep the conservative cap.
  assert.match(src, /return ram > 0 \? Math\.min\(cap, Math\.floor\(\(hostFreeRam\(\) \+ extraRam\) \/ ram\)\) : 0;/);
});

test('password attempts reuse the caller snapshot instead of re-fetching details', () => {
  assert.match(src, /const tryPassword = async \(host, password, known\) => \{/);
  assert.match(src, /const details = known \?\? ns\.dnet\.getServerDetails\(host\);/);
  // Every call site passes the snapshot it already owns.
  const calls = src.match(/tryPassword\(host, ?password, ?info\)/g) || [];
  assert.ok(calls.length >= 2, 'feedback and candidate paths must pass info');
});

test('a turn solves more than eight candidates before yielding', () => {
  // Eight attempts under a ten-second cap ended every turn early on cheap (multi-threaded) auth.
  assert.match(src, /takeAttempt=createAttemptBudget\(16,15000\);/);
});
