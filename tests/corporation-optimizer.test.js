import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultCorporationConfig } from '../corporation-config.js';
import {
  createCorporationOptimizer,
  defaultOptimizerState,
  OPTIMIZER_STATE_VERSION,
  planOnly,
  readCorporationSnapshot,
  RESEARCH_PRIORITY,
  restoreOptimizerState,
} from '../corporation-optimizer.js';
import { createCorporationSimulation, runSimulation } from './fixtures/corporation-sim.js';

const config = (overrides = {}) => Object.assign(defaultCorporationConfig(), overrides);

function optimizerFor(simulation, settings = config(), extra = {}) {
  const lines = [];
  const optimizer = createCorporationOptimizer({
    api: simulation.api, config: settings, cycleSeconds: 10, clock: () => simulation.state.at,
    log: (level, message) => lines.push({ level, message }), ...extra,
  });
  return { optimizer, lines };
}

test('no corporation is a clean no-op owned by the bootstrap module', () => {
  const calls = [];
  const api = { hasCorporation: () => false, getCorporation: () => { calls.push('getCorporation'); return null; } };
  const { optimizer } = optimizerFor({ api, state: { at: 0 } });
  const result = optimizer.tick();
  assert.equal(result.state, 'NO_CORP');
  assert.deepEqual(calls, []);
  assert.equal(result.telemetry.dryRun, false);
});

test('a disabled configuration does nothing at all', () => {
  const simulation = createCorporationSimulation();
  const { optimizer } = optimizerFor(simulation, config({ enabled: false }));
  const result = optimizer.tick();
  assert.equal(result.state, 'DISABLED');
  assert.equal(simulation.calls().length, 0);
});

test('a paused controller suspends the tick and clears every buy rate', () => {
  const simulation = createCorporationSimulation();
  simulation.state.materials.Hardware.buyAmount = 5;
  const { optimizer } = optimizerFor(simulation, config(), { isAllowed: () => false });
  const result = optimizer.tick();
  assert.equal(result.state, 'SUSPENDED');
  assert.equal(simulation.state.materials.Hardware.buyAmount, 0);
  assert.equal(simulation.callCount('makeProduct'), 0);
});

test('dry run plans the same actions without mutating anything', () => {
  const drySim = createCorporationSimulation();
  const realSim = createCorporationSimulation();
  const dry = planOnly({ api: drySim.api, config: config() });
  const { optimizer } = optimizerFor(realSim, config());
  const real = optimizer.tick();

  assert.deepEqual(dry.decisions.map(row => row.label), real.decisions.map(row => row.label));
  assert.ok(dry.decisions.some(row => row.state === 'planned'));
  assert.equal(drySim.calls().filter(call => !['buyMaterial'].includes(call.fn)).length, 0,
    'a dry run performs no mutating call');
  assert.ok(realSim.calls().length > 0);
  assert.equal(dry.telemetry.dryRun, true);
  assert.ok(dry.telemetry.decisions.every(row => row.state !== 'purchased'));
});

test('a dry run writes the intended plan to the dry-run file', () => {
  const simulation = createCorporationSimulation();
  const writes = [];
  const { optimizer } = optimizerFor(simulation, config({ dryRun: true }), { write: (path, contents) => writes.push({ path, contents }) });
  optimizer.tick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'tasks/corporation-dry-run.json');
  const payload = JSON.parse(writes[0].contents);
  assert.equal(payload.schemaVersion, OPTIMIZER_STATE_VERSION);
  assert.ok(Array.isArray(payload.plans));
});

test('empty funds produce no purchases and never a negative balance', () => {
  const simulation = createCorporationSimulation({ funds: 0 });
  const { optimizer } = optimizerFor(simulation, config());
  const result = optimizer.tick();
  assert.equal(simulation.state.funds, 0);
  assert.equal(result.telemetry.state, 'RECOVERY');
  const purchases = result.decisions.filter(row => row.state === 'purchased' && Number(row.cost) > 0);
  assert.deepEqual(purchases, []);
  assert.ok(result.decisions.length > 0, 'the tick still reports why it did nothing');
});

test('a negative-margin streak freezes discretionary spending', () => {
  const simulation = createCorporationSimulation({ funds: 50e9 });
  simulation.state.revenue = 100;
  simulation.state.expenses = 5000;
  const { optimizer } = optimizerFor(simulation, config());
  let result;
  for (let tick = 0; tick < 12; tick++) result = optimizer.tick();
  assert.equal(result.telemetry.state, 'RECOVERY');
  const discretionary = result.decisions.filter(row =>
    ['upgrade', 'advert', 'product'].includes(row.kind) && row.state === 'purchased');
  assert.deepEqual(discretionary, []);
  assert.ok(result.decisions.some(row => row.kind === 'sell'), 'selling continues during recovery');
});

test('an office with no employees is reported, not silently idle', () => {
  const simulation = createCorporationSimulation({ officeSize: 9, employees: 0 });
  let hireAttempts = 0;
  simulation.api.hireEmployee = () => { hireAttempts++; return false; };
  const { optimizer } = optimizerFor(simulation, config());
  let result;
  for (let tick = 0; tick < 3; tick++) result = optimizer.tick();
  assert.ok(result.findings.some(finding => finding.kind === 'people.starvation'));
  assert.equal(simulation.callCount('setJobAssignment'), 0, 'no jobs are invented for an empty office');
  assert.ok(hireAttempts >= 3, 'hiring is retried every tick');
  assert.equal(simulation.state.office.size, 9, 'an empty office is not grown before it is staffed');
});

test('full product slots stop makeProduct and report the candidate', () => {
  const simulation = createCorporationSimulation();
  simulation.state.researchPoints = 6000;
  for (const name of ['Tobacco 1', 'Tobacco 2', 'Tobacco 3']) {
    simulation.state.products.push({
      name, developmentProgress: 100, rating: 1.5, effectiveRating: 1.5, designInvestment: 1e8,
      stored: 0, productionAmount: 0, actualSellAmount: 0, desiredSellPrice: 'MP',
    });
  }
  const { optimizer } = optimizerFor(simulation, config());
  const result = optimizer.tick();
  assert.equal(simulation.callCount('makeProduct'), 0);
  const product = result.decisions.find(row => row.kind === 'product');
  assert.equal(product.state, 'blocked');
  assert.match(product.reason, /slots are full/);
  assert.deepEqual(product.slots, { used: 3, max: 3, full: true, empty: false });
});

test('completed research is reported once and never re-bought', () => {
  const simulation = createCorporationSimulation();
  simulation.state.researchPoints = 1e6;
  for (const name of [...RESEARCH_PRIORITY, 'Automatic Drug Administration']) simulation.state.research.add(name);
  simulation.state.ta1 = true;
  simulation.state.ta2 = true;
  const { optimizer } = optimizerFor(simulation, config());
  const first = optimizer.tick();
  const second = optimizer.tick();
  assert.equal(simulation.callCount('research'), 0);
  for (const result of [first, second]) {
    const research = result.decisions.find(row => row.kind === 'research');
    assert.equal(research.state, 'complete');
  }
});

test('a tick survives an API that throws on every mutation and reports persistent failures', () => {
  const simulation = createCorporationSimulation();
  const mutations = ['upgradeOfficeSize', 'hireEmployee', 'setJobAssignment', 'buyTea', 'throwParty',
    'levelUpgrade', 'hireAdVert', 'buyMaterial', 'sellMaterial', 'sellProduct', 'setMaterialMarketTA2',
    'setProductMarketTA2', 'makeProduct', 'discontinueProduct', 'research', 'upgradeWarehouse', 'setSmartSupply'];
  for (const name of mutations) simulation.api[name] = () => { throw new Error(`${name} exploded`); };
  const { optimizer } = optimizerFor(simulation, config());
  let result;
  assert.doesNotThrow(() => { for (let tick = 0; tick < 4; tick++) result = optimizer.tick(); });
  assert.ok(result.telemetry.persistentFailures.length > 0);
  const failure = result.telemetry.persistentFailures[0];
  assert.ok(failure.operation && failure.message && failure.count >= 2);
  assert.equal(simulation.state.funds, 50e9, 'a failed mutation never charges the corporation');
});

test('a second tick on a settled corporation performs no duplicate purchase', () => {
  const simulation = createCorporationSimulation();
  const settings = config();
  const { optimizer } = optimizerFor(simulation, settings);
  for (let tick = 0; tick < 40; tick++) { optimizer.tick(); simulation.advance(); }
  const researchBefore = simulation.callCount('research');
  const productsBefore = simulation.callCount('makeProduct');
  const officeBefore = simulation.callCount('upgradeOfficeSize');
  optimizer.tick();
  assert.equal(simulation.callCount('research'), researchBefore);
  assert.equal(simulation.callCount('makeProduct'), productsBefore);
  assert.equal(simulation.callCount('upgradeOfficeSize'), officeBefore);
});

test('telemetry carries the documented key set and stays bounded', () => {
  const simulation = createCorporationSimulation();
  const { optimizer } = optimizerFor(simulation, config());
  const result = optimizer.tick();
  for (const key of ['schemaVersion', 'at', 'state', 'dryRun', 'corporation', 'funds', 'reserve', 'revenue',
    'expenses', 'profitPerCycle', 'valuation', 'growthBank', 'divisions', 'offices', 'decisions', 'findings',
    'persistentFailures', 'cyclesManaged']) {
    assert.ok(Object.hasOwn(result.telemetry, key), `telemetry is missing ${key}`);
  }
  assert.equal(result.telemetry.corporation, 'Apex Holdings');
  assert.ok(result.telemetry.reserve > 0);
  assert.ok(result.telemetry.decisions.length <= 128);
  assert.ok(result.telemetry.divisions[0].productSlots.max === 3);
});

test('the tick logs actions, and debug logging is opt-in', () => {
  const simulation = createCorporationSimulation();
  const settings = config();
  settings.telemetry = { ...settings.telemetry, debug: true };
  const { optimizer, lines } = optimizerFor(simulation, settings);
  optimizer.tick();
  assert.ok(lines.some(line => line.level === 'action'));
  assert.ok(lines.some(line => line.level === 'info'));
});

test('state is persisted, restored only for the same node and corporation, and bounded', () => {
  const simulation = createCorporationSimulation();
  const writes = [];
  const { optimizer } = optimizerFor(simulation, config(), { write: (path, contents) => writes.push({ path, contents }) });
  optimizer.tick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'tasks/corporation-optimizer.json');
  const saved = JSON.parse(writes[0].contents);
  assert.equal(saved.schemaVersion, OPTIMIZER_STATE_VERSION);
  assert.equal(saved.corporation, 'Apex Holdings');

  const restored = restoreOptimizerState(saved, { nodeReset: saved.nodeReset, augReset: saved.augReset, corporation: 'Apex Holdings' });
  assert.equal(restored.schemaVersion, OPTIMIZER_STATE_VERSION);
  assert.ok(restored.cyclesManaged >= 1);

  const discarded = restoreOptimizerState(saved, { corporation: 'Other Corp' });
  assert.equal(discarded.cyclesManaged, 0);
  const oldVersion = restoreOptimizerState({ ...saved, schemaVersion: 1 }, {});
  assert.equal(oldVersion.cyclesManaged, 0);

  // A reset-scoped round trip survives a restart with the same identity and is dropped otherwise.
  const scopedWrites = [];
  const scoped = createCorporationOptimizer({
    api: simulation.api, config: config(), clock: () => simulation.state.at,
    identity: { nodeReset: 7, augReset: 11, corporation: 'Apex Holdings' },
    write: (path, contents) => scopedWrites.push({ path, contents }),
  });
  scoped.tick();
  const persisted = JSON.parse(scopedWrites.at(-1).contents);
  assert.equal(persisted.nodeReset, 7);
  assert.equal(persisted.augReset, 11);
  assert.equal(restoreOptimizerState(persisted, { nodeReset: 7, augReset: 11, corporation: 'Apex Holdings' }).cyclesManaged, 1);
  assert.equal(restoreOptimizerState(persisted, { nodeReset: 8, augReset: 11, corporation: 'Apex Holdings' }).cyclesManaged, 0);
});

test('the snapshot reports unlocks, research ownership and city detail', () => {
  const simulation = createCorporationSimulation();
  const snapshot = readCorporationSnapshot(simulation.api);
  assert.equal(snapshot.info.name, 'Apex Holdings');
  assert.equal(snapshot.unlocks.office, true);
  assert.equal(snapshot.unlocks.smartSupply, false);
  assert.equal(snapshot.divisions.length, 1);
  const division = snapshot.divisions[0];
  assert.equal(division.makesProducts, true);
  assert.equal(division.maxProducts, 3);
  assert.deepEqual(division.owned, []);
  assert.ok(Number.isFinite(division.costs['Hi-Tech R&D Laboratory']));
  assert.equal(division.cities[0].city, 'Sector-12');
  assert.ok(division.cities[0].office.numEmployees > 0);
  assert.ok(division.cities[0].warehouse.level >= 1);
  assert.ok(Number.isFinite(division.cities[0].materials.Plants.marketPrice));
});

test('a material-only corporation with no product cap never calls makeProduct', () => {
  const simulation = createCorporationSimulation();
  simulation.api.getDivision = () => ({
    name: 'Agri', industry: 'Agriculture', awareness: 10, popularity: 5, productionMult: 1, researchPoints: 9000,
    lastCycleRevenue: 1000, lastCycleExpenses: 500, thisCycleRevenue: 1000, thisCycleExpenses: 500,
    numAdVerts: 0, cities: ['Sector-12'], products: [], makesProducts: false, maxProducts: 0,
  });
  simulation.api.getIndustryData = () => ({
    name: 'Agriculture', makesProducts: false, producedMaterials: ['Plants'], requiredMaterials: {},
    scienceFactor: 0.2, advertisingFactor: 0.5,
  });
  const { optimizer } = optimizerFor(simulation, config());
  const result = optimizer.tick();
  assert.equal(simulation.callCount('makeProduct'), 0);
  assert.ok(result.decisions.every(row => row.kind !== 'product'));
});

test('default optimiser state is empty and a full run leaves it consistent', () => {
  const fresh = defaultOptimizerState();
  assert.equal(fresh.cyclesManaged, 0);
  assert.deepEqual(fresh.metrics, {});
  const simulation = createCorporationSimulation();
  const { optimizer } = optimizerFor(simulation, config());
  runSimulation({ steps: 20, simulation, optimizer });
  const state = optimizer.getState();
  assert.equal(state.cyclesManaged, 20);
  assert.ok(state.growthBank >= 0);
  assert.ok(Object.keys(state.failures).length <= 32);
});
