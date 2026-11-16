import test from 'node:test';
import assert from 'node:assert/strict';
import {boostPurchaseBudget} from '../corporation-policy.js';

test('the development-speed inventory allowance is funded by earnings, not by the treasury', () => {
  // Live shape of the previous run: $2.5b free cash, expenses $33.1k/s, revenue $30.5k/s (losing money).
  const losing = {funds: 2.5e9, revenue: 30500, expenses: 33100};
  assert.equal(boostPurchaseBudget(losing, 0, 0, 10, {developmentSpeed: true}), 0,
    'a loss-making corp must not spend 2% of its cash per cycle on inventory');
  // Same treasury, now profitable: the discretionary allowance is restored (2% of free cash, capped at $250m).
  assert.equal(boostPurchaseBudget({...losing, revenue: 50000}, 0, 0, 10, {developmentSpeed: true}), 50e6);
  // A brand-new division with no history keeps its bootstrap allowance.
  assert.ok(boostPurchaseBudget({funds: 1e9, revenue: 0, expenses: 0}, 0, 0, 10, {developmentSpeed: true}) > 0);
  // Without development speed the allowance stays strictly profit-scaled.
  assert.equal(boostPurchaseBudget(losing, 0, 0, 10, {}), 0);
});
