import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultCorporationConfig } from '../corporation-config.js';
import {
  applyBoosts,
  applyInputs,
  applySales,
  applyWarehouseUpgrade,
  BOOST_MATERIALS,
  cityBacklogged,
  clearBoostRates,
  compactPricing,
  planBoosts,
  planInputs,
  planSales,
  planWarehouseUpgrade,
} from '../corporation-market.js';
import { createCorporationSimulation } from './fixtures/corporation-sim.js';

const config = () => defaultCorporationConfig();
const warehouse = (overrides = {}) => ({ city: 'Sector-12', level: 1, size: 1e6, sizeUsed: 2e5, ...overrides });

test('with Market-TA.II every material and product sells at MP', () => {
  const plan = planSales({
    division: 'Tobacco',
    divisionInfo: { products: ['Tobacco 1'], awareness: 50, popularity: 20 },
    industry: { producedMaterials: ['Drugs'], advertisingFactor: 0.5 },
    cities: [{
      city: 'Sector-12', warehouse: warehouse(), office: { employeeProductionByJob: { Business: 4 } },
      materials: { Drugs: { name: 'Drugs', stored: 100, quality: 1.2, marketPrice: 50, productionAmount: 200, actualSellAmount: 150 } },
      products: { 'Tobacco 1': { name: 'Tobacco 1', developmentProgress: 100, effectiveRating: 2, productionCost: 100, productionAmount: 100, stored: 0, actualSellAmount: 100 } },
    }],
    ta2: true, materialData: { Drugs: { baseMarkup: 8 } },
  });
  assert.deepEqual(plan.materials.map(row => row.price), ['MP']);
  assert.equal(plan.products.length, 1);
  assert.equal(plan.products[0].price, 'MP');
  assert.equal(plan.products[0].all, true);
});

test('without TA.II materials use additive quality markup and products use a price bracket', () => {
  const plan = planSales({
    division: 'Tobacco',
    divisionInfo: { products: ['Tobacco 1'], awareness: 50, popularity: 20 },
    industry: { producedMaterials: ['Drugs'], advertisingFactor: 0.5 },
    cities: [{
      city: 'Sector-12', warehouse: warehouse(), office: { employeeProductionByJob: { Business: 4 } },
      materials: { Drugs: { name: 'Drugs', stored: 100, quality: 1.6, marketPrice: 50, productionAmount: 200, actualSellAmount: 150 } },
      products: { 'Tobacco 1': { name: 'Tobacco 1', developmentProgress: 100, effectiveRating: 2, productionCost: 100, productionAmount: 100, stored: 0, actualSellAmount: 0, desiredSellPrice: 'MP' } },
    }],
    ta2: false, materialData: { Drugs: { baseMarkup: 8 } }, pricing: {},
  });
  assert.equal(plan.materials[0].price, 'MP+0.2');
  assert.match(plan.products[0].price, /^MP\*[\d.]+$/);
  assert.ok(plan.pricing['Tobacco/Sector-12/Tobacco 1'].multiplier >= 1, 'the bracket state is persisted');
});

test('an in-development product is never offered for sale', () => {
  const plan = planSales({
    division: 'Tobacco',
    divisionInfo: { products: ['Tobacco 1'], awareness: 50, popularity: 20 },
    industry: { producedMaterials: [], advertisingFactor: 0.5 },
    cities: [{
      city: 'Sector-12', warehouse: warehouse(), office: null, materials: {},
      products: { 'Tobacco 1': { name: 'Tobacco 1', developmentProgress: 40 } },
    }],
    ta2: false,
  });
  assert.equal(plan.products.length, 0);
});

test('sales are applied only where a warehouse exists, and a throwing city is counted, not raised', () => {
  const simulation = createCorporationSimulation();
  simulation.api.sellMaterial = () => { throw new Error('no warehouse'); };
  const result = applySales(simulation.api, {
    division: 'Tobacco', ta2: false,
    materials: [{ city: 'Sector-12', name: 'Drugs', price: 'MP' }],
    products: [],
  }, {});
  assert.equal(result.sold, 0);
  assert.equal(result.failed, 1);

  simulation.api.sellMaterial = (division, city, name, amount, price) => {
    assert.equal(price, 'MP');
    return true;
  };
  const ok = applySales(simulation.api, { division: 'Tobacco', materials: [{ city: 'Nowhere', name: 'Drugs', price: 'MP' }], products: [] }, {});
  assert.equal(ok.sold, 0, 'a city the corporation does not own is skipped');
});

test('Smart Supply clears manual rates; without it the recipe is sized to production', () => {
  const industry = { producedMaterials: ['Drugs'], requiredMaterials: { Plants: 1 } };
  const items = { Plants: { stored: 0, marketPrice: 5 }, Drugs: { productionAmount: 200, stored: 0 } };
  const smart = planInputs({ division: 'Tobacco', city: 'Sector-12', industry, warehouse: warehouse(), smartSupply: true, items, budget: 1e9 });
  assert.equal(smart.mode, 'smart');
  assert.equal(smart.leftovers, true);
  assert.deepEqual(smart.orders, [{ name: 'Plants', rate: 0 }]);

  const rates = planInputs({ division: 'Tobacco', city: 'Sector-12', industry, warehouse: warehouse(), smartSupply: false, items, budget: 1e9 });
  assert.equal(rates.mode, 'rates');
  assert.equal(rates.cost, 11000);
  assert.ok(rates.orders[0].rate > 0);
});

test('inputs restart after a production collapse and pause when the warehouse is full', () => {
  const industry = { producedMaterials: ['Drugs'], requiredMaterials: { Plants: 1 } };
  const items = { Plants: { stored: 0, marketPrice: 5 }, Drugs: { productionAmount: 0, stored: 0 } };
  const restart = planInputs({ division: 'Tobacco', city: 'Sector-12', industry, warehouse: warehouse({ sizeUsed: 0 }), items, budget: 1e9 });
  assert.equal(restart.mode, 'rates');
  assert.match(restart.reason, /Restarting production/);
  assert.ok(restart.cost > 0);

  const full = planInputs({ division: 'Tobacco', city: 'Sector-12', industry, warehouse: warehouse({ sizeUsed: 9.9e5 }), items, budget: 1e9 });
  assert.equal(full.mode, 'skip');
  assert.match(full.reason, /Warehouse is full/);
  const noWarehouse = planInputs({ division: 'Tobacco', city: 'Sector-12', industry, warehouse: null, items, budget: 1e9 });
  assert.equal(noWarehouse.mode, 'skip');
});

test('input orders are written as buy rates and prefer exports with Smart Supply', () => {
  const simulation = createCorporationSimulation();
  const result = applyInputs(simulation.api, {
    division: 'Tobacco', city: 'Sector-12', mode: 'smart', leftovers: true, orders: [{ name: 'Plants', rate: 0 }],
  }, { smartSupplyOptions: ['leftovers', 'imports'] });
  assert.equal(result.state, 'purchased');
  assert.ok(simulation.calls().some(call => call.fn === 'setSmartSupplyOption' && call.args[1] === 'leftovers'));
});

test('boosts buy toward the factor-weighted target and stop on a backlog', () => {
  const items = Object.fromEntries(BOOST_MATERIALS.map(boost => [boost.name, { stored: 0, marketPrice: 100 }]));
  const plan = planBoosts({
    division: 'Tobacco', city: 'Sector-12',
    industry: { realEstateFactor: 0.72, hardwareFactor: 0.2, robotFactor: 0.3, aiCoreFactor: 0.3, requiredMaterials: { Plants: 1 } },
    warehouse: warehouse({ size: 1e6, sizeUsed: 0 }), items, materialData: {}, budget: 1e9, config: config(),
  });
  assert.equal(plan.ready, true);
  assert.ok(plan.cost > 0 && plan.cost <= 1e9);
  assert.ok(plan.orders.every(order => order.rate > 0));

  const backlogged = planBoosts({
    division: 'Tobacco', city: 'Sector-12', industry: { requiredMaterials: {} },
    warehouse: warehouse(), items, materialData: {}, budget: 1e9, config: config(), backlog: true,
  });
  assert.equal(backlogged.ready, false);
  assert.match(backlogged.reason, /backlog/);
});

test('applying boosts zeroes any rate it did not order', () => {
  const simulation = createCorporationSimulation();
  const result = applyBoosts(simulation.api, {
    division: 'Tobacco', city: 'Sector-12', ready: true, orders: [{ name: 'Hardware', rate: 1 }], cost: 100,
  }, { recipe: ['Plants'] });
  assert.equal(result.state, 'purchased');
  const hardware = simulation.calls().filter(call => call.fn === 'buyMaterial' && call.args[0] === 'Hardware');
  assert.deepEqual(hardware.map(call => call.args[1]), [1], 'the ordered rate is set once, not zeroed again');
  const robots = simulation.calls().filter(call => call.fn === 'buyMaterial' && call.args[0] === 'Robots');
  assert.deepEqual(robots.map(call => call.args[1]), [0], 'unused boost rates are cleared');
  const cleared = clearBoostRates(simulation.api, 'Tobacco', 'Sector-12', ['Plants']);
  assert.ok(cleared.includes('Robots'));
});

test('warehouse upgrades need pressure, no backlog and a legal level', () => {
  const plan = planWarehouseUpgrade({
    division: 'Tobacco', city: 'Sector-12', warehouse: warehouse({ sizeUsed: 8e5 }), quotedCost: 2e9,
    cash: 50e9, reserve: 5e9, budget: 10e9, config: config(),
  });
  assert.equal(plan.ready, true);
  assert.ok(plan.pressure > 0.7);

  const low = planWarehouseUpgrade({ division: 'Tobacco', city: 'Sector-12', warehouse: warehouse({ sizeUsed: 1e5 }), quotedCost: 2e9, cash: 50e9, reserve: 5e9, budget: 10e9, config: config() });
  assert.equal(low.ready, false);

  const backlog = planWarehouseUpgrade({ division: 'Tobacco', city: 'Sector-12', warehouse: warehouse({ sizeUsed: 8e5 }), quotedCost: 2e9, cash: 50e9, reserve: 5e9, budget: 10e9, config: config(), backlog: true });
  assert.equal(backlog.ready, false);
  assert.match(backlog.reason, /backlog/);

  const capped = planWarehouseUpgrade({ division: 'Tobacco', city: 'Sector-12', warehouse: warehouse({ level: 5, sizeUsed: 8e5 }), quotedCost: 2e9, cash: 50e9, reserve: 5e9, budget: 10e9, config: config() });
  assert.equal(capped.ready, false);
  assert.match(capped.reason, /level 5/);

  const poor = planWarehouseUpgrade({ division: 'Tobacco', city: 'Sector-12', warehouse: warehouse({ sizeUsed: 8e5 }), quotedCost: 2e9, cash: 6e9, reserve: 5e9, budget: 10e9, config: config() });
  assert.equal(poor.ready, false);
  assert.match(poor.reason, /not affordable/);
});

test('a warehouse upgrade is applied once and verified by level', () => {
  const simulation = createCorporationSimulation({ funds: 50e9 });
  const plan = planWarehouseUpgrade({
    division: 'Tobacco', city: 'Sector-12', warehouse: simulation.api.getWarehouse('Tobacco', 'Sector-12'),
    quotedCost: simulation.api.getUpgradeWarehouseCost('Tobacco', 'Sector-12', 1), cash: 50e9, reserve: 5e9, budget: 10e9, config: config(),
  });
  simulation.state.warehouse.sizeUsed = simulation.state.warehouse.size * 0.8;
  const fresh = planWarehouseUpgrade({
    division: 'Tobacco', city: 'Sector-12', warehouse: simulation.api.getWarehouse('Tobacco', 'Sector-12'),
    quotedCost: simulation.api.getUpgradeWarehouseCost('Tobacco', 'Sector-12', 1), cash: 50e9, reserve: 5e9, budget: 10e9, config: config(),
  });
  assert.equal(fresh.ready, true);
  const result = applyWarehouseUpgrade(simulation.api, fresh, { reserve: 5e9 });
  assert.equal(result.state, 'purchased');
  assert.equal(simulation.api.getWarehouse('Tobacco', 'Sector-12').level, 2);
  void plan;
});

test('a backlog is detected from stored output versus production', () => {
  const backlog = cityBacklogged(
    { Drugs: { stored: 5e4, productionAmount: 100, actualSellAmount: 20 } },
    {},
  );
  assert.equal(backlog, true);
  assert.equal(cityBacklogged({ Drugs: { stored: 0, productionAmount: 100, actualSellAmount: 100 } }, {}), false);
});

test('pricing state is compacted to a bounded size', () => {
  const state = {};
  for (let index = 0; index < 100; index++) state[`key${index}`] = { multiplier: 1 + index / 100 };
  const compact = compactPricing(state);
  assert.ok(Object.keys(compact).length <= 64);
  assert.equal(compactPricing({ none: { rating: NaN } }).none, undefined);
});
