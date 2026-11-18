import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultCorporationConfig } from '../corporation-config.js';
import {
  applyProductPlan,
  applyResearchPlan,
  nextProductName,
  planProductCycle,
  planResearch,
  productSlots,
  researchParentOf,
  researchPointsForScience,
  weakestProduct,
} from '../corporation-product.js';
import { createCorporationSimulation } from './fixtures/corporation-sim.js';

const config = () => defaultCorporationConfig();
const tobacco = { name: 'Tobacco', scienceFactor: 0.642, producedMaterials: ['Drugs'], requiredMaterials: { Plants: 1 } };
const office = (city = 'Sector-12', employees = 30) => ({
  city, size: employees, numEmployees: employees, avgEnergy: 100, avgMorale: 100, maxEnergy: 100, maxMorale: 100,
  employeeProductionByJob: { Operations: 5, Engineer: 12, Business: 3, Management: 5, 'Research & Development': 5 },
  employeeJobs: { Operations: 5, Engineer: 12, Business: 3, Management: 5, 'Research & Development': 5 },
});
const pointsFor = scienceFloor => researchPointsForScience(scienceFloor, tobacco.scienceFactor) + 10;

test('product slots follow the division cap and the configured cap', () => {
  assert.deepEqual(productSlots({ products: [], maxProducts: 3 }, config()), { used: 0, max: 3, full: false, empty: true });
  assert.equal(productSlots({ products: ['a', 'b', 'c'], maxProducts: 3 }, config()).full, true);
  const capped = config();
  capped.product.maxProductsPerDivision = 2;
  assert.equal(productSlots({ products: ['a', 'b'], maxProducts: 3 }, capped).full, true);
  assert.equal(productSlots({ products: [], maxProducts: 0 }, config()).max, 0);
});

test('product names advance monotonically and never reuse an index', () => {
  assert.equal(nextProductName('Tobacco', [], 0), 'Tobacco 1');
  assert.equal(nextProductName('Tobacco', ['Tobacco 1', 'Tobacco 3'], 0), 'Tobacco 4');
  assert.equal(nextProductName('Tobacco', ['Tobacco 1'], 7), 'Tobacco 8');
  assert.equal(nextProductName('Tobacco', ['Tobacco X'], 0), 'Tobacco 1');
});

test('a division without products or below the science floor does not start development', () => {
  const noProducts = planProductCycle({ division: 'Agri', industry: { name: 'Agriculture', scienceFactor: 0.2 }, products: [], maxProducts: 0, config: config() });
  assert.equal(noProducts.action, 'blocked');
  assert.match(noProducts.reason, /makes no products/);

  const cold = planProductCycle({
    division: 'Tobacco', industry: tobacco, products: [], maxProducts: 3, offices: [office()],
    researchPoints: 100, funds: 50e9, reserve: 1e9, budget: 10e9, config: config(),
  });
  assert.equal(cold.action, 'blocked');
  assert.match(cold.reason, /below the 1\.15 floor/);
  assert.ok(cold.researchGap > 1000, 'the plan publishes the research points still needed');
});

test('the optimiser starts a product once science, slots and budget allow it', () => {
  const plan = planProductCycle({
    division: 'Tobacco', industry: tobacco, products: [], maxProducts: 3, offices: [office()],
    researchPoints: pointsFor(1.15), funds: 50e9, reserve: 1e9, budget: 10e9, config: config(),
  });
  assert.equal(plan.action, 'create');
  assert.equal(plan.name, 'Tobacco 1');
  assert.equal(plan.city, 'Sector-12');
  assert.ok(plan.investment >= 10e6);
  assert.equal(plan.cost, 2 * plan.investment);
});

test('full product slots block creation and retirement is opt-in with evidence', () => {
  const products = [
    { name: 'Tobacco 1', developmentProgress: 100, effectiveRating: 2.2, designInvestment: 5e8 },
    { name: 'Tobacco 2', developmentProgress: 100, effectiveRating: 1.6, designInvestment: 5e8 },
    { name: 'Tobacco 3', developmentProgress: 100, effectiveRating: 1.9, designInvestment: 5e8 },
  ];
  const blocked = planProductCycle({
    division: 'Tobacco', industry: tobacco, products, maxProducts: 3, offices: [office()],
    researchPoints: pointsFor(1.25), funds: 50e9, reserve: 1e9, budget: 10e9, config: config(),
  });
  assert.equal(blocked.action, 'blocked');
  assert.match(blocked.reason, /slots are full/);
  assert.deepEqual(blocked.slots, { used: 3, max: 3, full: true, empty: false });
  assert.equal(weakestProduct(products).name, 'Tobacco 2');

  const retiring = config();
  retiring.product.allowProductRetirement = true;
  const now = 1e12;
  const plan = planProductCycle({
    division: 'Tobacco', industry: tobacco, products, maxProducts: 3, offices: [office()],
    researchPoints: pointsFor(1.4), funds: 500e9, reserve: 1e9, budget: 100e9, config: retiring, now,
    state: { metrics: { Tobacco: { name: 'Tobacco 2', startedAt: now - 10_000_000, developmentMs: 1000, research: 100, employees: 10 } } },
  });
  assert.equal(plan.action, 'retire');
  assert.equal(plan.name, 'Tobacco 2');
});

test('a hopeless in-development product is discontinued instead of burning cash', () => {
  const plan = planProductCycle({
    division: 'Tobacco', industry: tobacco,
    products: [{ name: 'Tobacco 1', developmentProgress: 40 }], maxProducts: 3, offices: [office()],
    researchPoints: 50, funds: 50e9, reserve: 1e9, budget: 10e9, config: config(),
  });
  assert.equal(plan.action, 'discontinue');
  assert.match(plan.reason, /abandon floor/);
});

test('a healthy in-development product reports development instead of a new design', () => {
  const plan = planProductCycle({
    division: 'Tobacco', industry: tobacco,
    products: [{ name: 'Tobacco 1', developmentProgress: 55 }], maxProducts: 3, offices: [office()],
    researchPoints: pointsFor(1.3), funds: 50e9, reserve: 1e9, budget: 10e9, config: config(),
  });
  assert.equal(plan.action, 'develop');
  assert.equal(plan.progress, 55);
});

test('applying a create plan re-reads the division and refuses a full slot list', () => {
  const simulation = createCorporationSimulation();
  for (const name of ['Tobacco 1', 'Tobacco 2', 'Tobacco 3']) {
    simulation.state.products.push({ name, developmentProgress: 100, rating: 1, effectiveRating: 1, designInvestment: 1e8, stored: 0, productionAmount: 0, actualSellAmount: 0 });
  }
  const result = applyProductPlan(simulation.api, {
    action: 'create', division: 'Tobacco', city: 'Sector-12', name: 'Tobacco 4',
    investment: 20e6, cost: 40e6, scienceTarget: 1.15, reserve: 0, budget: 1e9, minimumInvestment: 10e6,
  }, {});
  assert.equal(result.state, 'blocked');
  assert.match(result.reason, /slots are full/);
  assert.equal(simulation.callCount('makeProduct'), 0);
});

test('applying a create plan starts the product and reports the charge', () => {
  const simulation = createCorporationSimulation({ funds: 5e9 });
  simulation.state.researchPoints = pointsFor(1.2);
  const result = applyProductPlan(simulation.api, {
    action: 'create', division: 'Tobacco', city: 'Sector-12', name: 'Tobacco 1',
    investment: 100e6, cost: 200e6, scienceTarget: 1.15, reserve: 0, budget: 1e9, minimumInvestment: 10e6,
  }, {});
  assert.equal(result.state, 'purchased');
  assert.ok(result.investment >= 10e6, 'the applier re-quotes the investment before spending');
  assert.equal(result.spent, 2 * result.investment);
  assert.deepEqual(simulation.state.products.map(product => product.name), ['Tobacco 1']);
});

test('research buys the TA package together and never spends more than 20% of the pool', () => {
  const costs = {
    'Hi-Tech R&D Laboratory': 200, 'Market-TA.I': 400, 'Market-TA.II': 800,
    'Self-Correcting Assemblers': 1500, Drones: 2000,
  };
  const owned = ['Hi-Tech R&D Laboratory'];
  const small = planResearch({ division: 'Tobacco', points: 2000, owned, costs, config: config() });
  assert.equal(small.ready, false);
  assert.match(small.reason, /cannot fund/);

  const ready = planResearch({ division: 'Tobacco', points: 6000, owned, costs, config: config() });
  assert.equal(ready.ready, true);
  assert.equal(ready.target, 'Market-TA.II');
  assert.deepEqual(ready.package, ['Market-TA.I', 'Market-TA.II']);
  assert.equal(ready.cost, 1200);
  assert.ok(ready.retained >= 4800);
});

test('completed research is reported complete and buys nothing', () => {
  const owned = ['Hi-Tech R&D Laboratory', 'Market-TA.I', 'Market-TA.II'];
  const plan = planResearch({ division: 'Tobacco', points: 9000, owned, costs: {}, config: config(), priority: owned });
  assert.equal(plan.complete, true);
  assert.equal(plan.ready, false);
  const simulation = createCorporationSimulation();
  const applied = applyResearchPlan(simulation.api, plan, {});
  assert.equal(applied.state, 'no-op');
  assert.equal(simulation.callCount('research'), 0);
});

test('research keeps the pool while a product is in development faster than it can be replaced', () => {
  const costs = { 'Hi-Tech R&D Laboratory': 200, 'Market-TA.I': 400, 'Market-TA.II': 800 };
  const plan = planResearch({
    division: 'Tobacco', points: 9000, owned: ['Hi-Tech R&D Laboratory'], costs, config: config(),
    developing: true, rate: 10, cycleSeconds: 10,
  });
  assert.equal(plan.ready, false);
  assert.match(plan.reason, /in-development product/);
});

test('research prerequisites are bought in order and reported once', () => {
  const costs = { 'Hi-Tech R&D Laboratory': 200, 'Market-TA.I': 400, 'Market-TA.II': 800 };
  const plan = planResearch({
    division: 'Tobacco', points: 1200, owned: [], costs, config: config(),
    priority: ['Hi-Tech R&D Laboratory'],
  });
  assert.equal(plan.target, 'Hi-Tech R&D Laboratory');
  assert.deepEqual(plan.package, ['Hi-Tech R&D Laboratory']);
  assert.equal(researchParentOf('Market-TA.II'), 'Market-TA.I');
  assert.equal(researchParentOf('Hi-Tech R&D Laboratory'), null);
});

test('research is applied through native calls and verifies ownership', () => {
  const simulation = createCorporationSimulation();
  simulation.state.researchPoints = 9000;
  const plan = planResearch({
    division: 'Tobacco', points: 9000, owned: ['Hi-Tech R&D Laboratory'],
    costs: { 'Hi-Tech R&D Laboratory': 200, 'Market-TA.I': 400, 'Market-TA.II': 800 },
    config: config(), priority: ['Hi-Tech R&D Laboratory', 'Market-TA.I', 'Market-TA.II'],
  });
  const result = applyResearchPlan(simulation.api, plan, {});
  assert.equal(result.state, 'purchased');
  assert.deepEqual(result.purchased, ['Market-TA.I', 'Market-TA.II']);
  assert.equal(simulation.state.ta2, true);
  const second = applyResearchPlan(simulation.api, plan, {});
  assert.equal(second.state, 'rejected');
  assert.deepEqual(second.purchased, []);
});
