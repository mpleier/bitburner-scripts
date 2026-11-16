import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manager = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8');

test('early investment rounds are released against the next city, not the whole six-city network', () => {
  // The old gate demanded all six cities (and their warehouses) before any capital was released, so the money that
  // could pay for the network was gated behind already having it: a $2.46b round against a $45.1b stage.
  assert.doesNotMatch(manager, /cities\?\.length===6/, 'the six-city precondition must be gone');
  assert.match(manager, /const agriReach=hasDivision\(agri\)\?safe\('Read agricultural reach'/);
  assert.match(manager, /const stageReady=offer\?\.round<=2\?Boolean\(agriReach&&agriWarehoused/);
  // One city package per round instead of every remaining city at once.
  assert.match(manager, /const nextCity=reach\.cities\.length<cities\.length\?officeCost\+warehouseCost\+20e6:0;/);
  assert.match(manager, /stageCapital=nextCity\+reach\.cities\.filter/);
});

test('the round still requires a selling, warehoused division and the round-two supply chain', () => {
  assert.match(manager, /agriReach\.cities\.every\(city=>safe\('Read agricultural warehouses',\(\)=>c\.hasWarehouse\(agri,city\)\)===true\)/);
  assert.match(manager, /offer\.round===1\|\|hasDivision\(chem\)\|\|hasDivision\(tobacco\)/);
});
