import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../bootstrap-start.js', import.meta.url), 'utf8');

test('home RAM upgrades run even when an activity holds the player', () => {
  const guardIndex = src.indexOf("if(status.state!=='protected-activity'){");
  const purchaseIndex = src.indexOf('ns.singularity.upgradeHomeRam()');
  assert.ok(guardIndex > 0 && purchaseIndex > 0);
  assert.ok(purchaseIndex < guardIndex, 'the RAM purchase must not sit behind the protected-activity guard');
  assert.match(src, /const reset=ns\.getResetInfo\(\);\s*\n\s*\/\/ Home RAM upgrades must continue even while an activity holds the player/);
});

test('the upgrade path keeps its safety checks', () => {
  assert.match(src, /isScriptPaused\(ns,'Tasks\/ram-manager\.js'\)/);
  assert.match(src, /restrictHomePCUpgrade/);
  assert.match(src, /claimSpending\(ns,'home',cost\)/);
  assert.match(src, /ns\.getServerMoneyAvailable\('home'\)>=cost\+reserve/);
});
