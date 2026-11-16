import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../auto-destroy-world-daemon.js', import.meta.url), 'utf8');

test('the completion gate names its blocker instead of returning silently', () => {
  // The World Daemon does not exist until The Red Pill is installed, so "no daemon" must be
  // explained rather than looking like a dead script.
  assert.match(source, /function completionBlocker/);
  assert.match(source, /The Red Pill is not installed, so w0r1d_d43m0n does not exist yet/);
  assert.match(source, /getAugmentationRepReq\('The Red Pill'\)/);
  assert.match(source, /if \(blocker !== lastBlocker\)/);
});

test('an existing daemon reports the hacking requirement, not the pill', () => {
  assert.match(source, /const needs = ns\.getServerRequiredHackingLevel\(target\);/);
  assert.match(source, /required to hack the World Daemon/);
});
