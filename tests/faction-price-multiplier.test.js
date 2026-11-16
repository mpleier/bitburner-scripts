import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {augmentationPriceMultiplier} from '../faction-policy.js';

test('Source-File 11 softens the augmentation price multiplier at each level', () => {
  assert.equal(augmentationPriceMultiplier(0), 1.9);
  assert.ok(Math.abs(augmentationPriceMultiplier(1) - 1.824) < 1e-9);
  assert.ok(Math.abs(augmentationPriceMultiplier(2) - 1.786) < 1e-9);
  assert.ok(Math.abs(augmentationPriceMultiplier(3) - 1.767) < 1e-9);
});

test('an out-of-range or missing level never produces NaN', () => {
  // Indexing the table directly returned undefined past level 3, which made every basket planner throw.
  assert.ok(Math.abs(augmentationPriceMultiplier(4) - augmentationPriceMultiplier(3)) < 1e-9);
  assert.ok(Math.abs(augmentationPriceMultiplier(-2) - augmentationPriceMultiplier(0)) < 1e-9);
  assert.equal(augmentationPriceMultiplier(undefined), 1.9);
  assert.equal(augmentationPriceMultiplier(NaN), 1.9);
  assert.equal(augmentationPriceMultiplier(Infinity), 1.9);
  assert.equal(augmentationPriceMultiplier(2.7), augmentationPriceMultiplier(2));
});

test('the multiplier is always usable as a planner input', () => {
  for (const level of [undefined, 0, 1, 2, 3, 7, -1, NaN]) {
    const mult = augmentationPriceMultiplier(level);
    assert.ok(Number.isFinite(mult) && mult >= 1, 'multiplier must be finite and >= 1');
  }
});

test('faction-manager uses the clamped helper instead of indexing the table inline', () => {
  const src = readFileSync(new URL('../faction-manager.js', import.meta.url), 'utf8');
  assert.match(src, /augCountMult = augmentationPriceMultiplier\(sf11Level\);/);
  assert.doesNotMatch(src, /augCountMult = 1\.9 \* \[1, 0\.96, 0\.94, 0\.93\]\[sf11Level\]/);
});
