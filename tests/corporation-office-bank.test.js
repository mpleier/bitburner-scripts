import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {growthBankForOffice} from '../corporation-policy.js';

test('the growth bank is raised only to the office increment, never to the whole free treasury', () => {
  // A $9b office in front of a $40b treasury used to release all $40b to every other growth plan in the pass.
  assert.equal(growthBankForOffice(1e9, 40e9, 9e9), 9e9);
  assert.equal(growthBankForOffice(0, 40e9, 9e9), 9e9);
});

test('an existing larger bank is preserved and the increment is capped by free cash', () => {
  assert.equal(growthBankForOffice(20e9, 40e9, 9e9), 20e9);
  assert.equal(growthBankForOffice(0, 5e9, 9e9), 5e9);
});

test('unusable quotes and treasuries leave the bank untouched', () => {
  assert.equal(growthBankForOffice(3e9, 40e9, 0), 3e9);
  assert.equal(growthBankForOffice(3e9, 40e9, NaN), 3e9);
  assert.equal(growthBankForOffice(3e9, NaN, 9e9), 3e9);
  assert.equal(growthBankForOffice(NaN, NaN, NaN), 0);
  assert.equal(growthBankForOffice(-5, 10, -1), 0);
});

test('runOffice routes both office branches through the scoped bank', () => {
  const src = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /growthBank=Math\.min\(free,Math\.max\(growthBank,free\)\)/);
  assert.doesNotMatch(src, /growthBank=Math\.min\(free,Math\.max\(growthBank,free\*\.5\)\)/);
  assert.equal((src.match(/growthBank=growthBankForOffice\(growthBank,free,officeIncrement\(\)\);/g) || []).length, 2);
  assert.match(src, /const officeIncrement=\(\)=>\{/);
});
