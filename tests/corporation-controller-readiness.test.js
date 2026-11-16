import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {corporationControllerReady} from '../automation-manifest.js';

// The controller costs ~860 GB of home RAM, so it must only run when there is something to manage or the
// money to create it. Autopilot and the preview both use this predicate.

test('no corporation and no create-funding keeps the controller off', () => {
  assert.equal(corporationControllerReady({hasCorporation: false, sourceFiles: {3: 1}, node: 5, money: 0.19e9, reserve: 0}), false);
});

test('an existing corporation always runs the controller', () => {
  assert.equal(corporationControllerReady({hasCorporation: true, sourceFiles: {3: 1}, node: 5, money: 0}), true);
  // The Source-File gate is checked first: nothing runs without corporation access.
  assert.equal(corporationControllerReady({hasCorporation: true, sourceFiles: {}, node: 5, money: 0}), false);
});

test('creation from the player wallet needs 150b plus the reserve', () => {
  const base = {hasCorporation: false, sourceFiles: {3: 1}, node: 5, allowed: true};
  assert.equal(corporationControllerReady({...base, money: 149e9, reserve: 0}), false);
  assert.equal(corporationControllerReady({...base, money: 150e9, reserve: 1e9}), false);
  assert.equal(corporationControllerReady({...base, money: 151e9, reserve: 1e9}), true);
  // A committed spending plan may authorise the startup from other funds.
  assert.equal(corporationControllerReady({...base, money: 0, planAllowance: 150e9}), true);
  assert.equal(corporationControllerReady({...base, money: 0, planAllowance: 149e9}), false);
});

test('BitNode 3 and the disable switches are respected', () => {
  assert.equal(corporationControllerReady({hasCorporation: false, sourceFiles: {}, node: 3, allowed: true}), true);
  assert.equal(corporationControllerReady({hasCorporation: true, node: 5, disabled: true}), false);
  assert.equal(corporationControllerReady({hasCorporation: true, node: 5, nodeDisabled: true}), false);
  assert.equal(corporationControllerReady({hasCorporation: false, sourceFiles: {3: 1}, node: 5, money: 1e12, allowed: false}), false);
  // Without Source-File 3 nothing can run.
  assert.equal(corporationControllerReady({hasCorporation: false, sourceFiles: {}, node: 5, money: 1e12}), false);
});

test('autopilot and the preview share the gate instead of disagreeing', () => {
  const autopilot = readFileSync(new URL('../autopilot.js', import.meta.url), 'utf8');
  const preview = readFileSync(new URL('../automation-preview-policy.js', import.meta.url), 'utf8');
  assert.match(autopilot, /corporationReady = corporationControllerReady\(\{hasCorporation/);
  // The preview is serialized into a temp worker, so it receives the predicate as an injected parameter.
  assert.match(preview, /const corporationReady=controllerReady\(\{hasCorporation:corporationHas/);
  assert.match(preview, /controllerReady=corporationControllerReady\)\{/);
  assert.doesNotMatch(preview, /const corporationReady=!options\['disable-corporation'\]&&!!sources\[3\]/);
  assert.doesNotMatch(autopilot, /const startupFunded = resetInfo\.currentNode === 3 \|\|/);
});

test('a liquidatable stock portfolio counts toward creation funding', () => {
  const base = {hasCorporation: false, sourceFiles: {3: 1}, node: 5, allowed: true, reserve: 0};
  assert.equal(corporationControllerReady({...base, money: 100e9, stocks: 0}), false);
  assert.equal(corporationControllerReady({...base, money: 100e9, stocks: 60e9}), true);
  assert.equal(corporationControllerReady({...base, money: 100e9, stocks: 40e9}), false);
  // The reserve still comes out of the combined liquid total.
  assert.equal(corporationControllerReady({...base, money: 100e9, stocks: 60e9, reserve: 20e9}), false);
  // A funded plan allowance keeps precedence, and a negative (short) portfolio never inflates funding.
  assert.equal(corporationControllerReady({...base, money: 0, stocks: 0, planAllowance: 200e9}), true);
  assert.equal(corporationControllerReady({...base, money: 150e9, stocks: -50e9}), true);
  assert.equal(corporationControllerReady({...base, money: 100e9, stocks: 'NaN'}), false);
});
