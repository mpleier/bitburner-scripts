import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {corporationGrowthStallNotice} from '../corporation-policy.js';

const now = 10_000_000;

test('a stalled growth budget is reported on a bounded cadence instead of silently', () => {
  // Inside the grace window nothing is said: a young corp buying its first upgrades looks identical to a stall.
  assert.equal(corporationGrowthStallNotice({lastPurchaseAt: now - 60_000, now}), null);
  // After the grace window the cheapest blocked plan and the gap are named.
  const notice = corporationGrowthStallNotice({
    lastPurchaseAt: now - 900_000, now, budget: 1.53e9,
    blocked: [{label: 'Buy Export', cost: 2e10}, {label: 'Expand Agri to Aevum', cost: 9.02e9}],
  });
  assert.match(notice, /bought nothing for 15 min/);
  assert.match(notice, /cheapest pending plan is Expand Agri to Aevum at \$9\.02b/);
  assert.match(notice, /growth budget of \$1\.53b/);
  // Repeat suppression: one warning per repeat window.
  assert.equal(corporationGrowthStallNotice({lastPurchaseAt: now - 900_000, now, lastAlertAt: now - 60_000, blocked: [{label: 'x', cost: 1e9}], budget: 1e8}), null);
  assert.ok(corporationGrowthStallNotice({lastPurchaseAt: now - 900_000, now, lastAlertAt: now - 400_000, blocked: [{label: 'x', cost: 1e9}], budget: 1e8}));
  // Nothing blocked still has to be reported: silence there means the planner produced no plan at all.
  assert.match(corporationGrowthStallNotice({lastPurchaseAt: now - 900_000, now, blocked: [], budget: 0}), /no pending plan/);
  assert.equal(corporationGrowthStallNotice({now: NaN}), null);
});

test('the manager tracks real purchases and reports the stall', () => {
  const manager = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8');
  assert.match(manager, /if\(boughtThisCycle\)lastCorpPurchaseAt=Date.now\(\);/);
  assert.match(manager, /blocked:growthDecisions\.filter\(d=>d\.state==='budget-wait'\),budget:growthBank/);
  assert.match(manager, /ns\.print\('WARNING: '\+stallNotice\)/);
});
