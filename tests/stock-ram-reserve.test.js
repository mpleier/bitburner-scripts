import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {homeRamCashReserve} from '../spending-policy.js';

const fakeNs = ({daemon = false, homeRam = 128, cost = 13e9} = {}) => ({
  ps: () => (daemon ? [{pid: 1, filename: '/daemon.js'}] : [{pid: 2, filename: '/autopilot.js'}]),
  getServerMaxRam: () => homeRam,
  singularity: {getUpgradeHomeRamCost: () => cost},
});

test('a RAM-starved node keeps the next home upgrade affordable', () => {
  assert.equal(homeRamCashReserve(fakeNs({cost: 13e9})), Math.ceil(13e9 * 1.05));
});

test('the reserve yields once the daemon owns RAM management or home is large', () => {
  assert.equal(homeRamCashReserve(fakeNs({daemon: true})), 0);
  assert.equal(homeRamCashReserve(fakeNs({homeRam: 4096})), 0);
  assert.equal(homeRamCashReserve({ps: () => { throw new Error('no access'); }}), 0);
});

test('stockmaster honours the home RAM reserve', () => {
  const src = readFileSync(new URL('../stockmaster.js', import.meta.url), 'utf8');
  assert.match(src, /import \{augmentationCashReserve,homeRamCashReserve\} from '\.\/spending-policy\.js';/);
  const matches = src.match(/augmentationCashReserve\(ns\),homeRamCashReserve\(ns\)\)/g) || [];
  assert.equal(matches.length, 2, 'both reserve computations must include the RAM reserve');
});
