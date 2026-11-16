import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {materialExportWorthwhile} from '../corporation-policy.js';

test('only a source that is ahead of the target is worth exporting', () => {
  // Imported quality averages with what the target stores (Division.ts:761-769), so equal-quality material dilutes.
  assert.equal(materialExportWorthwhile(50, 1), true);
  assert.equal(materialExportWorthwhile(1, 50), false);
  assert.equal(materialExportWorthwhile(1.02, 1), false, 'a 2% edge is inside the margin');
  assert.equal(materialExportWorthwhile(1.06, 1), true, 'a 6% edge clears the 5% margin');
  assert.equal(materialExportWorthwhile(10, 10), false);
});

test('an empty or unreadable target accepts any positive quality', () => {
  assert.equal(materialExportWorthwhile(1, 0), true);
  assert.equal(materialExportWorthwhile(1, undefined), true);
  assert.equal(materialExportWorthwhile(1, NaN), true);
});

test('an unreadable source quality fails open instead of disabling the chain', () => {
  // A failed read is not evidence that the material is worse; blocking here would silently stop all exports.
  assert.equal(materialExportWorthwhile(undefined, 1), true);
  assert.equal(materialExportWorthwhile(NaN, 1), true);
  assert.equal(materialExportWorthwhile(0, 1), true);
  assert.equal(materialExportWorthwhile(-5, 1), true);
});

test('the margin is configurable and cannot go negative', () => {
  assert.equal(materialExportWorthwhile(1.01, 1, 0), true);
  assert.equal(materialExportWorthwhile(1.01, 1, -5), true);
  assert.equal(materialExportWorthwhile(1.5, 1, 0.6), false);
});

test('the manager holds a route that would dilute the target', () => {
  const src = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8');
  const route = src.indexOf("const material = safe('Read existing export routes'");
  const gate = src.indexOf('if (!materialExportWorthwhile(material?.quality, targetMaterial?.quality))', route);
  const create = src.indexOf('c.exportMaterial(sourceDiv, city, targetDiv, city, sourceMat, EXPORT_FORMULA)', route);
  assert.ok(route > 0 && gate > route && create > gate, 'the quality gate must run before the route is created');
  assert.match(src, /const exportQualityNoted = new Set\(\);/);
});
