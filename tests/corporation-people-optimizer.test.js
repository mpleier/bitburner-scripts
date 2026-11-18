import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultCorporationConfig } from '../corporation-config.js';
import {
  applyAdVert,
  applyOfficePlan,
  applyUpgrade,
  OFFICE_JOBS,
  officeTargetFor,
  planAdVert,
  planOffice,
  planUpgrade,
} from '../corporation-people.js';
import { createCorporationSimulation } from './fixtures/corporation-sim.js';

const config = () => defaultCorporationConfig();
const office = (overrides = {}) => ({
  city: 'Sector-12', size: 9, numEmployees: 9, maxEnergy: 100, maxMorale: 100, avgEnergy: 100, avgMorale: 100,
  totalExperience: 0,
  employeeJobs: { Operations: 4, Engineer: 2, Business: 1, Management: 1, 'Research & Development': 1 },
  employeeProductionByJob: { Operations: 5, Engineer: 9, Business: 4, Management: 6, 'Research & Development': 4 },
  ...overrides,
});
const tobacco = { makesProducts: true, cities: ['Sector-12'] };
const agriculture = { makesProducts: false, cities: ['Sector-12'] };

test('office targets follow the configured cash tiers', () => {
  const settings = config();
  assert.equal(officeTargetFor({ makesProducts: false, cash: 1e8, config: settings }), 3);
  assert.equal(officeTargetFor({ makesProducts: false, cash: 2e9, config: settings }), 9);
  assert.equal(officeTargetFor({ makesProducts: false, cash: 2e11, config: settings }), 20);
  assert.equal(officeTargetFor({ makesProducts: false, cash: 1e14, config: settings }), 60);
  assert.equal(officeTargetFor({ makesProducts: true, cash: 5e11, config: settings }), 30);
  assert.equal(officeTargetFor({ makesProducts: true, cash: 5e12, config: settings }), 60);
  assert.equal(officeTargetFor({ makesProducts: true, cash: 1e16, config: settings }), 120);
});

test('an understaffed product office is sized and staffed before anything else', () => {
  const plan = planOffice({
    division: 'Tobacco', city: 'Sector-12', office: office(), divisionInfo: tobacco,
    developing: true, funds: 50e9, reserve: 5e9, budget: 4e9, upkeepBudget: 1e9,
    config: config(), quoteSizeUpgrade: add => 300e6 * add,
  });
  assert.equal(plan.target, 30);
  assert.deepEqual(plan.sizeUpgrade, { add: 3, cost: 900e6 }, 'the full increment is unaffordable, so the smallest rung is quoted');
  assert.equal(plan.counts.length, 6);
  assert.equal(plan.counts.reduce((sum, count) => sum + count, 0), 9, 'job counts cover exactly the current employees');
});

test('a material office in its only city keeps the nine-employee expansion gate', () => {
  const plan = planOffice({
    division: 'Agri', city: 'Sector-12', office: office({ size: 5, numEmployees: 3 }), divisionInfo: agriculture,
    funds: 1e9, reserve: 0, budget: 2e9, upkeepBudget: 0, config: config(), quoteSizeUpgrade: () => 200e6,
  });
  assert.ok(plan.target >= 9);
  assert.equal(plan.sizeUpgrade.add, 9 - 5);
});

test('a productive office buys tea and a party from the upkeep budget, and never during recovery', () => {
  const plan = planOffice({
    division: 'Tobacco', city: 'Sector-12',
    office: office({ size: 30, numEmployees: 30, avgEnergy: 80, avgMorale: 70 }),
    divisionInfo: tobacco, developing: false, funds: 50e9, reserve: 5e9, budget: 1e9, upkeepBudget: 1e9,
    config: config(), quoteSizeUpgrade: () => NaN,
  });
  assert.equal(plan.upkeep.tea, 30 * 500000);
  assert.ok(plan.upkeep.party > 0);
  assert.ok(plan.upkeep.cost > plan.upkeep.tea);

  const recovering = planOffice({
    division: 'Tobacco', city: 'Sector-12',
    office: office({ size: 30, numEmployees: 30, avgEnergy: 80, avgMorale: 70 }),
    divisionInfo: tobacco, developing: false, recovering: true, funds: 50e9, reserve: 5e9,
    budget: 1e9, upkeepBudget: 0, config: config(), quoteSizeUpgrade: () => NaN,
  });
  assert.deepEqual(recovering.upkeep, { tea: 0, party: 0, cost: 0 });
});

test('an empty office reports starvation instead of inventing productivity', () => {
  const plan = planOffice({
    division: 'Tobacco', city: 'Sector-12', office: office({ size: 9, numEmployees: 0 }),
    divisionInfo: tobacco, funds: 1e9, reserve: 0, budget: 1e8, upkeepBudget: 1e6,
    config: config(), quoteSizeUpgrade: () => 100e6,
  });
  assert.equal(plan.starvation, true);
  assert.equal(plan.counts, null);
  assert.equal(plan.upkeep.tea, 0);
});

test('applying an office plan upgrades, hires, assigns every role and pays upkeep', () => {
  const simulation = createCorporationSimulation({ funds: 20e9, officeSize: 9, employees: 9 });
  const plan = planOffice({
    division: 'Tobacco', city: 'Sector-12', office: simulation.api.getOffice('Tobacco', 'Sector-12'),
    divisionInfo: tobacco, developing: true, funds: 20e9, reserve: 1e9, budget: 5e9, upkeepBudget: 1e9,
    config: config(), quoteSizeUpgrade: add => simulation.api.getOfficeSizeUpgradeCost('Tobacco', 'Sector-12', add),
    autoTea: false, autoParty: false,
  });
  simulation.state.office.avgEnergy = 80;
  simulation.state.office.avgMorale = 80;
  plan.upkeep = { tea: 0, party: 0, cost: 0 };
  const result = applyOfficePlan(simulation.api, plan, { reserve: 1e9 });
  assert.ok(['purchased', 'partial'].includes(result.state));
  assert.ok(result.spent.growth > 0);
  assert.ok(simulation.state.office.size > 9);
  assert.equal(simulation.state.office.numEmployees, Math.min(simulation.state.office.size, plan.target));
  const jobs = simulation.state.office.employeeJobs;
  const assigned = OFFICE_JOBS.reduce((sum, job) => sum + (jobs[job] || 0), 0);
  assert.equal(assigned, simulation.state.office.numEmployees);
  assert.ok(OFFICE_JOBS.every(job => (jobs[job] || 0) >= 1), 'every role keeps at least one employee');
});

test('applying an office plan is a no-op when the office cannot be read', () => {
  const simulation = createCorporationSimulation();
  const result = applyOfficePlan(simulation.api, null, {});
  assert.equal(result.state, 'blocked');
  assert.equal(simulation.callCount('hireEmployee'), 0);
});

test('upgrades are ranked by return and limited to cash the corporation earns back', () => {
  const costs = { 'Smart Factories': 2e9, 'ABC SalesBots': 1e9, 'Speech Processor Implants': 500e6 };
  const levelOf = name => (name === 'Smart Factories' ? 4 : 0);
  const plan = planUpgrade({
    cash: 50e9, reserve: 5e9, config: config(), levelOf, costOf: name => costs[name] ?? NaN,
    order: ['Smart Factories', 'ABC SalesBots', 'Speech Processor Implants'], profitPerCycle: 1e9,
  });
  assert.ok(plan.ready, 'a profitable corporation buys an upgrade');
  assert.equal(plan.ready.name, 'Speech Processor Implants', 'the highest return per dollar wins');

  const lossMaking = planUpgrade({
    cash: 50e9, reserve: 5e9, config: config(), levelOf, costOf: name => costs[name] ?? NaN,
    order: ['Smart Factories', 'ABC SalesBots', 'Speech Processor Implants'], profitPerCycle: 0,
  });
  assert.equal(lossMaking.ready, null, 'a loss-making corporation must not buy upgrades');
  assert.ok(lossMaking.ranked.every(row => row.state === 'budget-wait'));
});

test('Smart Storage leads the order only under storage pressure', () => {
  const costs = { 'Smart Storage': 1e9, 'Smart Factories': 1e9 };
  const base = { cash: 50e9, reserve: 0, config: config(), levelOf: () => 0, costOf: name => costs[name], order: ['Smart Factories'], profitPerCycle: 1e12 };
  assert.equal(planUpgrade(base).ready.name, 'Smart Factories');
  assert.equal(planUpgrade({ ...base, storagePressure: true }).ready.name, 'Smart Storage');
});

test('applying an upgrade re-reads the level and verifies the increase', () => {
  const simulation = createCorporationSimulation({ funds: 10e9 });
  const plan = { name: 'Smart Factories', level: 0, cost: 2e9, score: 1 };
  const result = applyUpgrade(simulation.api, plan, { reserve: 1e9 });
  assert.equal(result.state, 'purchased');
  assert.equal(simulation.api.getUpgradeLevel('Smart Factories'), 1);
  const stale = applyUpgrade(simulation.api, plan, { reserve: 1e9 });
  assert.equal(stale.state, 'blocked');
  assert.match(stale.reason, /level changed/);
});

test('an AdVert is only bought when its payback fits the horizon', () => {
  const settings = config();
  const division = { name: 'Tobacco', awareness: 50, popularity: 20, numAdVerts: 0, makesProducts: true };
  const industry = { advertisingFactor: 0.5 };
  const noRevenue = planAdVert({
    division: 'Tobacco', divisionInfo: division, industry, cost: 1e9, cash: 50e9, reserve: 0, budget: 20e9,
    config: settings, revenue: 0,
  });
  assert.equal(noRevenue.ready, false);
  assert.match(noRevenue.reason, /No revenue/);

  const slow = planAdVert({
    division: 'Tobacco', divisionInfo: division, industry, cost: 1e9, cash: 50e9, reserve: 0, budget: 20e9,
    config: settings, revenue: 1000,
  });
  assert.equal(slow.ready, false);
  assert.match(slow.reason, /payback/);

  const fast = planAdVert({
    division: 'Tobacco', divisionInfo: division, industry, cost: 1e9, cash: 50e9, reserve: 0, budget: 20e9,
    config: settings, revenue: 1e7,
  });
  assert.equal(fast.ready, true);
  assert.ok(fast.paybackSeconds <= 21600);
});

test('a material division stops advertising at its cap and costs are re-checked on apply', () => {
  const settings = config();
  const capped = planAdVert({
    division: 'Agri', divisionInfo: { name: 'Agri', awareness: 50, popularity: 20, numAdVerts: 8, makesProducts: false },
    industry: { advertisingFactor: 0.5 }, cost: 1e9, cash: 50e9, reserve: 0, budget: 20e9, config: settings, revenue: 1e7,
  });
  assert.equal(capped.ready, false);
  assert.match(capped.reason, /limit/);

  const simulation = createCorporationSimulation({ funds: 5e9 });
  const plan = { division: 'Tobacco', ready: true, cost: 1e9 };
  const result = applyAdVert(simulation.api, plan, { reserve: 0 });
  assert.equal(result.state, 'purchased');
  assert.equal(simulation.api.getDivision('Tobacco').numAdVerts, 1);
});
