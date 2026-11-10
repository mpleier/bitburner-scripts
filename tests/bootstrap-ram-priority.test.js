import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spendingPlan, bootstrapRamTarget, BOOTSTRAP_RAM_CEILING} from '../spending-policy.js';

const nsFor = ({daemon = false, home = 128} = {}) => ({
  ps: () => (daemon ? [{pid: 1, filename: '/daemon.js'}] : [{pid: 2, filename: '/autopilot.js'}]),
  getServerMaxRam: () => home,
});

test('bootstrap RAM target tracks the next doubling until the ceiling', () => {
  assert.equal(bootstrapRamTarget(nsFor({home: 128})), 256);
  assert.equal(bootstrapRamTarget(nsFor({home: 256})), BOOTSTRAP_RAM_CEILING);
  assert.equal(bootstrapRamTarget(nsFor({home: 8})), 64);
  assert.equal(bootstrapRamTarget(nsFor({home: 512})), 0, 'at the ceiling the daemon manages RAM');
  assert.equal(bootstrapRamTarget(nsFor({daemon: true, home: 128})), 0, 'a running daemon owns RAM purchases');
});

test('bootstrap RAM outranks other categories in the spending plan', () => {
  // With a bootstrap target above current home, home takes half the free cash and the others shrink.
  const plan = spendingPlan({money: 100e9, reserve: 0, homeRam: 128, node: 5, ownerPid: 1, reset: 1, signals: {bootstrapRam: 256}});
  assert.ok(plan.allowances.home >= 0.45 * 100e9, 'home allowance should approach half of free cash, got ' + plan.allowances.home);
  assert.ok(plan.reasons.includes('Bootstrap priority: home RAM to 256 GB before discretionary spending'));
  const plain = spendingPlan({money: 100e9, reserve: 0, homeRam: 128, node: 5, ownerPid: 1, reset: 1, signals: {}});
  assert.ok(plan.allowances.home > plain.allowances.home);
});

test('autopilot wires the bootstrap target into the plan and its own guard', () => {
  const src = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');
  assert.match(src, /const target=Math\.max\(recoveryTarget\?\?128,bootstrapRamTarget\(ns\)\);if\(maximum>=target\)return;/);
  assert.match(src, /signals:\{bottleneck:'ram',essentialHomeRam:\{target\},bootstrapRam:target\}/);
  assert.match(src, /import \{ spendingPlan,adaptiveBudgetSignals,claimSpending,bootstrapRamTarget \} from '\.\/spending-policy\.js';/);
});
