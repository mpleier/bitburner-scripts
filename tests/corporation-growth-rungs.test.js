import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

test('a profitable division gets affordable growth rungs instead of only a $9b expansion', () => {
  assert.match(source, /const registerAffordableRungs=\(\)=>\{/);
  // Only divisions that actually earn may consume growth capital.
  assert.match(source, /if\(!\(Number\(info\.lastCycleRevenue\)>Number\(info\.lastCycleExpenses\)\)\)continue;/);
  // Office and warehouse improvements are real growth plans, so the bank and reserve apply to them.
  assert.match(source, /const officeLabel='Grow office '\+division\+'\/'\+city;/);
  assert.match(source, /capitalPurchase\(officeLabel,officeCost,\(\)=>c\.upgradeOfficeSize\(division,city,3\),1\/officeCost,0,officeCost,\{kind:'development',division,city\}\)/);
  assert.match(source, /const warehouseLabel='Grow warehouse '\+division\+'\/'\+city;/);
  assert.match(source, /capitalPurchase\(warehouseLabel,warehouseCost,\(\)=>c\.upgradeWarehouse\(division,city\),1\/warehouseCost,0,0,\{kind:'storage',division,city\}\)/);
  // The count is only claimed when the plan actually landed in the growth queue.
  assert.match(source, /if\(growthPlans\.has\(officeLabel\)\)registered\+\+;/);
  // Both are bounded by what the corporation can actually spend right now.
  assert.match(source, /const spendable=Math\.max\(0,Number\.isFinite\(growthBank\)\?growthBank:funds\(\)-reserve\);/);
  assert.match(source, /if\(officeCost<=spendable\)\{/);
  assert.match(source, /if\(warehouseCost<=spendable\)\{/);
  // A second owner of the same improvement would overspend, so the duplicate is skipped.
  assert.match(source, /const claimed=kind=>\[\.\.\.growthPlans\.values\(\)\]\.some\(p=>p\.market&&p\.market\.division===division&&p\.market\.city===city&&p\.market\.kind===kind\);/);
  // Storage only grows once it is more than half full; a 2.6%-full warehouse was bought before this guard.
  assert.match(source, /const pressure=warehouse&&Number\(warehouse\.size\)>0\?Number\(warehouse\.sizeUsed\|\|0\)\/Number\(warehouse\.size\):0;/);
  assert.match(source, /const warehouseCost=pressure>0\.5\?Number\(safe\('Quote rung warehouse'/);
  // Registration failures must not abort the corporation cycle.
  assert.match(source, /safe\('Register affordable growth rungs',registerAffordableRungs\);/);
});

test('corporate hash funding is bounded by the hash balance, not by the player wallet', () => {
  const source = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8');
  // A 221k-hash bank was capped at 40 hashes by wallet*5%/250k, so an $8.5b expansion gap could never be funded.
  assert.doesNotMatch(source, /wallet\*\.05\/250000/);
  assert.match(source, /maxHashes:Math\.min\(limit,Math\.max\(0,ns\.hacknet\.numHashes\(\)\)\)/);
});

test('corporation decisions do not gate on the player wallet', () => {
  const source = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8');
  // Hash production is a corporation input: a staged funding milestone lifts the 5% cash ration.
  assert.match(source, /let growthRemaining = growthPriority && hashMilestone/);
  assert.match(source, /Math\.max\(0, ns\.getPlayer\(\)\.money - Math\.min\(playerReserve, 1e9\) - normalRemaining\)/);
  // Dividends follow corporation policy only; the wallet is not read in the rate expression.
  assert.match(source, /Math\.min\(DIVIDEND_MAX, Math\.max\(0, dividendRateFor\(funds\(\)\)\)\);/);
  assert.doesNotMatch(source, /wallet < playerReserve \+ 1e9/);
  // Creating the corporation still costs the player money: that gate must survive.
  assert.match(source, /if\(ns\.getPlayer\(\)\.money<cost\+hold\)/);
});
