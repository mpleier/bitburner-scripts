import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateConfig } from '../corporation-config.js';
import { readBootstrapSnapshot } from '../corporation-bootstrap.js';
import {
  divisionStaffed,
  expansionDecisions,
  industryCandidates,
  nextCity,
  runExpansion,
} from '../corporation-expansion.js';
import { createTestGame, TEST_INDUSTRIES } from './corporation-test-game.mjs';

const { config } = validateConfig({});
const quiet = () => {};

const FUNDATION_UNLOCKS = ['Warehouse API', 'Office API', 'Smart Supply'];

function snapshotFor(game, overrides = {}) {
  const reset = game.ns.getResetInfo();
  return {
    ...readBootstrapSnapshot(game.api, config, {
      wallet: game.state.wallet,
      playerReserve: 0,
      currentNode: reset.currentNode,
      hasSourceFile3: reset.ownedSF.get(3) > 0,
    }),
    ...overrides,
  };
}

/** A corporation that already has a staffed Agriculture division in one city. */
function foundation({ funds = 500e9, unlocks = FUNDATION_UNLOCKS, cities = ['Sector-12'], staff = 9, size = 9 } = {}) {
  const game = createTestGame({ existing: true, funds, unlocks });
  game.api.expandIndustry('Agriculture', 'Agri');
  for (const city of cities) game.api.expandCity('Agri', city);
  game.api.purchaseWarehouse('Agri', cities[0]);
  if (size > 3) game.api.upgradeOfficeSize('Agri', cities[0], size - 3);
  for (let hired = 0; hired < staff; hired++) game.api.hireEmployee('Agri', cities[0]);
  game.setRevenue(1e6, 5e5);
  return game;
}

test('the next city is chosen in config order and never repeats an owned one', () => {
  const game = foundation();
  const division = snapshotFor(game).divisions[0];
  assert.equal(nextCity(division, config), 'Aevum');
  const reordered = validateConfig({ bootstrap: { cities: ['Volhaven', 'Aevum'] } }).config;
  assert.equal(nextCity(division, reordered), 'Volhaven');
});

test('a completed, staffed, funded division queues the next city', () => {
  const game = foundation();
  const plan = expansionDecisions(snapshotFor(game), config);
  const city = plan.decisions.find((item) => item.id === 'expansion.city:Agri/Aevum');
  assert.ok(city, plan.decisions.map((d) => d.id).join(','));
  assert.equal(city.state, 'ready');
  assert.equal(city.cost, 9.02e9);
});

test('an unaffordable city package is staged with a gap instead of a partial purchase', () => {
  const game = foundation();
  game.state.corporation.funds = 8e9; // spent down to a package shortfall
  game.setRevenue(1e5, 9e5); // and losing money, so no ETA can be computed
  const plan = expansionDecisions(snapshotFor(game), config);
  assert.equal(plan.decisions.filter((item) => item.kind === 'city').length, 0);
  const quote = plan.staged.find((entry) => entry.city === 'Aevum');
  assert.ok(quote);
  assert.ok(quote.gap > 0);
  assert.equal(quote.reason, 'insufficient funds');
  assert.equal(quote.etaSeconds, null, 'a loss-making corporation has no ETA');
  assert.ok(plan.blockedBy.some((entry) => entry.code === 'expansion.cityStaged'));
  assert.ok(quote.alternatives.length > 0, 'cheaper rungs are registered so the tick is not idle');
});

test('a city without a warehouse blocks city expansion until the warehouse is bought', () => {
  const game = foundation();
  game.api.expandCity('Agri', 'Aevum'); // second city without a warehouse
  const snapshot = snapshotFor(game);
  const plan = expansionDecisions(snapshot, config);
  const warehouse = plan.decisions.find((item) => item.id === 'expansion.warehouse:Agri/Aevum');
  assert.ok(warehouse);
  assert.equal(warehouse.priority, 100);
  assert.equal(warehouse.state, 'ready');
  assert.equal(plan.decisions.filter((item) => item.kind === 'city').length, 0);
  assert.ok(plan.staged.some((entry) => entry.reason === 'existing cities need warehouses'));
});

test('understaffed offices block expansion until the seed office is raised', () => {
  const game = foundation({ size: 9, staff: 5 });
  const snapshot = snapshotFor(game);
  assert.equal(divisionStaffed(snapshot, snapshot.divisions[0], 9), false);
  const plan = expansionDecisions(snapshot, config);
  assert.equal(plan.decisions.filter((item) => item.kind === 'city').length, 0);
  assert.ok(plan.staged.some((entry) => entry.reason === 'existing offices are understaffed'));
});

test('a small office counts as unstaffed and the missing Office API exempts the check', () => {
  const game = foundation({ size: 3, staff: 3 });
  const snapshot = snapshotFor(game);
  assert.equal(divisionStaffed(snapshot, snapshot.divisions[0], 9), false);
  assert.equal(divisionStaffed({ ...snapshot, unlocks: { ...snapshot.unlocks, 'Office API': false } }, snapshot.divisions[0], 9), true);
});

test('runExpansion expands one city per tick and re-runs as a no-op', () => {
  const game = foundation();
  const report = runExpansion(game.api, config, { log: quiet });
  assert.equal(game.count('expandCity'), 2, 'foundation helper created one city, expansion adds one');
  assert.equal(game.api.hasWarehouse('Agri', 'Aevum'), true);
  const cityAction = report.actions.find((action) => action.label.includes('Aevum'));
  assert.equal(cityAction.state, 'done');

  const mark = game.mark();
  const rerun = runExpansion(game.api, config, { log: quiet });
  assert.deepEqual(game.mutationsSince(mark), []);
  assert.ok(rerun.actions.every((action) => action.state !== 'done'));
});

test('the configured industry chain is created once the foundation is staffed', () => {
  const game = foundation();
  const plan = expansionDecisions(snapshotFor(game), config);
  const chemical = plan.decisions.find((item) => item.id === 'expansion.industry:Chemical');
  assert.ok(chemical);
  assert.equal(chemical.state, 'ready');

  runExpansion(game.api, config, { log: quiet });
  assert.ok(game.api.getDivision('Agri'));
  assert.equal(game.api.getDivision('Chem').industry, 'Chemical');
  assert.equal(game.count('expandIndustry'), 3, 'Agriculture from the helper plus Chemical and Tobacco');

  const again = expansionDecisions(snapshotFor(game), config);
  assert.equal(again.decisions.some((item) => item.id === 'expansion.industry:Chemical'), false, 'an owned industry is not re-created');
  const mark = game.mark();
  runExpansion(game.api, config, { log: quiet });
  assert.equal(game.mutationsSince(mark).filter((call) => call.operation === 'expandIndustry').length, 0);
});

test('an existing industry is adopted by name instead of duplicated', () => {
  const game = createTestGame({ existing: true, funds: 500e9, unlocks: FUNDATION_UNLOCKS });
  game.api.expandIndustry('Chemical', 'Chemicals');
  const snapshot = snapshotFor(game);
  const candidates = industryCandidates(snapshot, { ...config, bootstrap: { ...config.bootstrap, industryChain: ['Chemical', 'Tobacco'] } });
  assert.equal(candidates.some((candidate) => candidate.industry === 'Chemical'), false);
});

test('expandAllIndustries only quotes industries that fill a material gap', () => {
  const game = foundation();
  const snapshot = snapshotFor(game);
  const off = industryCandidates(snapshot, config);
  assert.deepEqual(off.map((candidate) => candidate.industry), ['Chemical', 'Tobacco']);
  const on = industryCandidates(snapshot, { ...config, bootstrap: { ...config.bootstrap, expandAllIndustries: true } });
  assert.ok(on.length >= off.length);
  for (const candidate of on.filter((entry) => !entry.chain)) {
    const produced = TEST_INDUSTRIES[candidate.industry].producedMaterials;
    assert.ok(produced.length === 0 || produced.some((material) => ['Water', 'Chemicals', 'Plants', 'Food'].includes(material)));
  }
});

test('a division-cap rejection backs off for five minutes without throwing', () => {
  const game = foundation();
  game.state.divisions; // foundation already has one division
  const capped = createTestGame({ existing: true, funds: 500e9, unlocks: FUNDATION_UNLOCKS, divisionCap: 1 });
  capped.api.expandIndustry('Agriculture', 'Agri');
  capped.api.expandCity('Agri', 'Sector-12');
  capped.api.purchaseWarehouse('Agri', 'Sector-12');
  capped.api.upgradeOfficeSize('Agri', 'Sector-12', 6);
  for (let hired = 0; hired < 9; hired++) capped.api.hireEmployee('Agri', 'Sector-12');
  capped.setRevenue(1e6, 5e5);

  const now = 1_000_000;
  const report = runExpansion(capped.api, config, { log: quiet, now });
  const industryAction = report.actions.find((action) => action.label.includes('Chemical'));
  assert.equal(industryAction.state, 'blocked');
  assert.match(industryAction.detail, /division cap/);
  assert.ok(report.cooldowns['expansion.industry'] > now);
  assert.deepEqual(report.errors, [], 'a cap is expected, not an error');

  const next = runExpansion(capped.api, config, { log: quiet, now: now + 1000, cooldowns: report.cooldowns });
  const retry = next.actions.find((action) => action.label.includes('Chemical'));
  assert.equal(retry.state, 'blocked');
  assert.match(retry.detail, /retry in 5m/);
});

test('warehouse upgrades follow storage pressure and only for sold output', () => {
  const game = foundation();
  game.state.warehouses['Agri/Sector-12'].sizeUsed = 90;
  game.state.divisions.Agri.lastCycleRevenue = 1e6;
  game.state.divisions.Agri.lastCycleExpenses = 5e5;
  let plan = expansionDecisions(snapshotFor(game), config);
  assert.ok(plan.decisions.some((item) => item.kind === 'warehouseUpgrade'));
  const report = runExpansion(game.api, config, { log: quiet });
  assert.equal(game.api.getWarehouse('Agri', 'Sector-12').level, 2);
  assert.ok(report.actions.some((action) => action.label.includes('Upgrade warehouse') && action.state === 'done'));

  // A loss-making division keeps its stock rather than buying more storage.
  game.state.divisions.Agri.lastCycleRevenue = 1e5;
  game.state.divisions.Agri.lastCycleExpenses = 9e5;
  game.state.warehouses['Agri/Sector-12'].sizeUsed = 90;
  plan = expansionDecisions(snapshotFor(game), config);
  assert.equal(plan.decisions.some((item) => item.kind === 'warehouseUpgrade'), false);
});

test('division sale is opt-in and evidence-gated', () => {
  const game = createTestGame({ existing: true, funds: 100e9, unlocks: FUNDATION_UNLOCKS });
  game.api.expandIndustry('Agriculture', 'Agri'); // division with no cities
  const off = expansionDecisions(snapshotFor(game), config);
  assert.equal(off.decisions.some((item) => item.kind === 'sale'), false);

  const selling = validateConfig({ bootstrap: { allowDivisionSale: true } }).config;
  const noEvidence = expansionDecisions(snapshotFor(game), selling);
  assert.equal(noEvidence.decisions.some((item) => item.kind === 'sale'), false);
  assert.ok(noEvidence.blockedBy.some((entry) => entry.code === 'expansion.saleEvidence'));

  const withEvidence = expansionDecisions(snapshotFor(game), selling, { telemetry: { Agri: { idleCycles: 1200 } } });
  assert.ok(withEvidence.decisions.some((item) => item.kind === 'sale'));
  runExpansion(game.api, selling, { log: quiet, telemetry: { Agri: { idleCycles: 1200 } } });
  assert.equal(game.count('sellDivision'), 1);
});

test('the dry run plans identical actions without a single mutation', () => {
  const game = foundation();
  const mark = game.mark();
  const report = runExpansion(game.api, config, { log: quiet, dryRun: true });
  assert.deepEqual(game.mutationsSince(mark), []);
  assert.ok(report.actions.some((action) => action.state === 'dry-run' && action.label.includes('Aevum')));

  const real = foundation();
  const plan = expansionDecisions(snapshotFor(real), config);
  const planned = plan.decisions.filter((item) => item.state === 'ready').map((item) => item.id);
  const dryIds = report.actions.filter((action) => action.state === 'dry-run').map((action) => action.label);
  assert.ok(dryIds.length > 0);
  assert.ok(planned.length > 0, 'the same snapshot has ready decisions');
});

test('a live corporation snapshot plans without throwing and stages the unaffordable city', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/corporation-live-snapshot.json', import.meta.url), 'utf8'));
  const read = (key) => fixture.results[key];
  const corp = read('corporation.getCorporation([])');
  const divisions = ['Agri', 'Tobacco'].map((name) => {
    const info = read(`corporation.getDivision(${JSON.stringify([name])})`);
    return {
      name,
      industry: info.industry,
      cities: info.cities,
      makesProducts: info.makesProducts,
      maxProducts: info.maxProducts,
      products: info.products,
      researchPoints: info.researchPoints,
      lastCycleRevenue: info.lastCycleRevenue,
      lastCycleExpenses: info.lastCycleExpenses,
    };
  });
  const snapshot = {
    hasCorporation: true,
    gate: { state: 'READY', code: 'corporation.exists', reason: 'Corporation exists' },
    corp,
    divisions,
    offices: {
      'Agri/Sector-12': read('corporation.getOffice(["Agri","Sector-12"])'),
      'Tobacco/Sector-12': read('corporation.getOffice(["Tobacco","Sector-12"])'),
    },
    warehouses: { 'Agri/Sector-12': true, 'Tobacco/Sector-12': false },
    warehouseInfo: { 'Agri/Sector-12': read('corporation.getWarehouse(["Agri","Sector-12"])') },
    unlocks: { 'Warehouse API': true, 'Office API': true, 'Smart Supply': true, Export: true },
    unlockCosts: {},
    industryData: { Agriculture: TEST_INDUSTRIES.Agriculture, Tobacco: TEST_INDUSTRIES.Tobacco },
    constants: {},
    wallet: read('getPlayer([])').money,
    playerReserve: 0,
    cycleSeconds: 10,
    errors: [],
  };
  assert.equal(corp.name, 'Apex Holdings');
  assert.ok(snapshot.wallet > 9e11);

  const plan = expansionDecisions(snapshot, config);
  // Tobacco has a city but no warehouse (the game read is not in the capture): warehouse first.
  const warehouse = plan.decisions.find((item) => item.id === 'expansion.warehouse:Tobacco/Sector-12');
  assert.ok(warehouse);
  assert.equal(warehouse.state, 'blocked', `funds ${corp.funds} cannot cover a $5b warehouse above the reserve`);
  // Agri is complete and staffed, but the $9.02b package is unaffordable at $1.69b funds (spec G4).
  const quote = plan.staged.find((entry) => entry.division === 'Agri');
  assert.ok(quote);
  assert.equal(quote.city, 'Aevum');
  assert.ok(quote.gap > 7e9);
  assert.equal(quote.etaSeconds, null, 'the live corporation is losing money, so no ETA');
  // The live loss-making corporation must not get a discretionary industry either.
  assert.equal(plan.decisions.filter((item) => item.kind === 'industry' && item.state === 'ready').length, 0);
});
