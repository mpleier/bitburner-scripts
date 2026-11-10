import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../spending-policy.js', import.meta.url), 'utf8');

test('the spend ledger cannot leak across a node reset', () => {
  assert.match(src, /usage\?\.nodeReset!==reset\.lastNodeReset\|\|usage\?\.augReset!==reset\.lastAugReset/);
  assert.match(src, /usage=\{epoch:plan\.epoch,nodeReset:reset\.lastNodeReset,augReset:reset\.lastAugReset,spent:\{\}/);
});

test('an impossibly large recorded spend is clamped to the available cash', () => {
  assert.match(src, /const freeCash=Math\.max\(0,ns\.getPlayer\(\)\.money-Math\.max\(0,Number\(ns\.read\('reserve\.txt'\)\)\|\|0\)\);/);
  assert.match(src, /const spent=Math\.min\(spentRaw,freeCash\);/);
});
