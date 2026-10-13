import test from 'node:test';
import assert from 'node:assert/strict';
import { optimalBoostTargets, nextSaleMultiplier, chooseRetirement, officeJobCounts, upgradeReturn } from '../automation-policy.js';

test('boost optimization stays within warehouse space and ignores zero-factor materials', () => {
  const materials = [{ name: 'Land', factor: 0.72, size: 0.005 }, { name: 'Hardware', factor: 0.2, size: 0.06 }, { name: 'Unused', factor: 0, size: 0.1 }];
  const targets = optimalBoostTargets(materials, 1000);
  assert.ok(materials.reduce((sum, item) => sum + targets[item.name] * item.size, 0) <= 1000);
  assert.equal(targets.Unused, 0);
  assert.ok(targets.Land > targets.Hardware);
  assert.deepEqual(optimalBoostTargets(materials, 0), { Land: 0, Hardware: 0, Unused: 0 });
});

test('prices fall with backlog, rise with cleared production, and stay bounded', () => {
  assert.ok(nextSaleMultiplier({ productionAmount: 100, actualSellAmount: 40, stored: 3000 }, 10) < 10);
  assert.ok(nextSaleMultiplier({ productionAmount: 100, actualSellAmount: 100, stored: 0 }, 10) > 10);
  assert.equal(nextSaleMultiplier({ productionAmount: 0 }, 10), 10);
  assert.equal(nextSaleMultiplier({ productionAmount: 10, actualSellAmount: 0 }, 1), 1);
});

test('retirement chooses weak completed manager products and protects custom products', () => {
  const products = [
    { name: 'Custom Brand', developmentProgress: 100, effectiveRating: 1 },
    { name: 'Apex Dining 1', developmentProgress: 100, effectiveRating: 10 },
    { name: 'Apex Dining 2', developmentProgress: 70, effectiveRating: 0 },
    { name: 'Apex Dining 3', developmentProgress: 100, effectiveRating: 100 },
  ];
  assert.equal(chooseRetirement(products).name, 'Apex Dining 1');
  assert.equal(chooseRetirement(products.slice(0, 1)), null);
});

test('office staffing assigns every employee exactly once', () => {
  for (const productDivision of [false, true]) for (let employees = 1; employees <= 120; employees++) {
    const counts = officeJobCounts(employees, productDivision);
    assert.equal(counts.reduce((sum, count) => sum + count, 0), employees);
    assert.ok(counts.every(count => Number.isInteger(count) && count >= 0));
  }
});

test('marginal upgrade ranking responds to price and storage pressure', () => {
  assert.ok(upgradeReturn('Smart Factories', 1, 10, false) > upgradeReturn('Smart Factories', 1, 100, false));
  assert.ok(upgradeReturn('Smart Storage', 1, 10, true) > upgradeReturn('Smart Storage', 1, 10, false));
});
