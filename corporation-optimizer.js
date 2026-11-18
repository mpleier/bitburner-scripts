/**
 * Corporation optimisation loop: products, research, staffing, warehouse upgrades, material
 * buying/selling and upgrade purchasing.
 *
 * Spec: docs/corp-automation-spec.md §4.3 (tick order), §6 (modules), §7 (objectives and
 * budgets), §9 (logging, telemetry, failure handling). This module is a library, not a new
 * running script: the corporation daemon calls `createCorporationOptimizer(...).tick()` once
 * per corporation cycle so no second copy of the 860 GB `ns.corporation` import is paid.
 *
 * Every tick:
 *   1. reads the live corporation state (one snapshot, cached within the tick),
 *   2. classifies recovery (cash floor or a negative-margin streak),
 *   3. builds the budget ladder from configuration,
 *   4. runs people -> research -> product -> market -> upgrades,
 *   5. executes only affordable, legal plans (or records them in dry-run mode),
 *   6. returns telemetry and persists optimiser state.
 *
 * Invariants (spec §5.3): `funds >= reserve` after any discretionary action, no mutation
 * without an immediate re-read, no product created without a free slot, no buy rate left
 * behind on failure, and repeated ticks never re-buy a completed action.
 */

import { corporationBudgetLadder, defaultCorporationConfig, CORPORATION_CONFIG_PATH, loadCorporationConfig } from './corporation-config.js';
import {
  applyProductPlan,
  applyResearchPlan,
  planProductCycle,
  planResearch,
  productTelemetry,
  RESEARCH_PRIORITY,
} from './corporation-product.js';
import {
  applyAdVert,
  applyOfficePlan,
  applyUpgrade,
  OFFICE_JOBS,
  officeTargetFor,
  planAdVert,
  planOffice,
  planUpgrade,
  UPGRADE_ORDER,
} from './corporation-people.js';
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
} from './corporation-market.js';
import {
  clearCorporationBuyRates,
  corporationDevelopmentCity,
  corporationResearchGoal,
  corporationResearchRate,
  treasuryPolicy,
} from './corporation-policy.js';

export { CORPORATION_CONFIG_PATH, loadCorporationConfig };

/** Optimiser state file version; a bump discards the state instead of migrating it. */
export const OPTIMIZER_STATE_VERSION = 2;
const MAX_DECISIONS = 128;
const MAX_FAILURES = 32;

const safe = (fn, fallback = undefined) => {
  try { return fn(); } catch { return fallback; }
};
const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** Fresh persistent optimiser state. Kept small so `tasks/` stays diffable (spec §9.2). */
export function defaultOptimizerState() {
  return {
    schemaVersion: OPTIMIZER_STATE_VERSION,
    cyclesManaged: 0,
    marginStreak: { negative: 0, positive: 0 },
    counters: {},
    metrics: {},
    history: {},
    pricing: {},
    markups: {},
    researchSamples: {},
    starvation: {},
    growthBank: 0,
    lastActionAt: 0,
    failures: {},
  };
}

/**
 * Accept a previously persisted state only when it belongs to this node/augmentation/corporation
 * (spec §9.2). Anything else is discarded, never migrated.
 */
export function restoreOptimizerState(raw, { nodeReset = null, augReset = null, corporation = null } = {}) {
  const fresh = defaultOptimizerState();
  if (!raw || typeof raw !== 'object') return fresh;
  if (raw.schemaVersion !== OPTIMIZER_STATE_VERSION) return fresh;
  if (nodeReset !== null && raw.nodeReset !== nodeReset) return fresh;
  if (augReset !== null && raw.augReset !== augReset) return fresh;
  if (corporation !== null && raw.corporation !== corporation) return fresh;
  return {
    ...fresh,
    ...Object.fromEntries(Object.entries(fresh).map(([key]) => [key, raw[key] ?? fresh[key]])),
    schemaVersion: OPTIMIZER_STATE_VERSION,
  };
}

/**
 * Read one authoritative snapshot of the corporation.
 * Returns null when there is no corporation (bootstrap owns that state).
 */
export function readCorporationSnapshot(api, { catalog = RESEARCH_PRIORITY } = {}) {
  if (safe(() => api.hasCorporation(), false) !== true) return null;
  const info = safe(() => api.getCorporation(), null);
  if (!info) return null;
  const constants = safe(() => api.getConstants(), {}) || {};
  const unlocks = {
    warehouse: safe(() => api.hasUnlock('Warehouse API') === true, false),
    office: safe(() => api.hasUnlock('Office API') === true, false),
    smartSupply: safe(() => api.hasUnlock('Smart Supply') === true, false),
  };
  const upgrades = {};
  for (const name of UPGRADE_ORDER) {
    upgrades[name] = {
      level: num(safe(() => api.getUpgradeLevel(name), 0)),
      cost: Number(safe(() => api.getUpgradeLevelCost(name), NaN)),
    };
  }
  const materialData = {};
  const boostNames = BOOST_MATERIALS.map(boost => boost.name);
  const divisions = [];
  for (const name of info.divisions || []) {
    const division = safe(() => api.getDivision(name), null);
    if (!division) continue;
    const industry = safe(() => api.getIndustryData(division.industry), null) || { name: division.industry, producedMaterials: [], requiredMaterials: {} };
    const owned = catalog.filter(research => safe(() => api.hasResearched(name, research) === true, false));
    const costs = {};
    for (const research of catalog) {
      if (owned.includes(research)) continue;
      costs[research] = Number(safe(() => api.getResearchCost(name, research), NaN));
    }
    const materialNames = [...new Set([...(industry.producedMaterials || []), ...Object.keys(industry.requiredMaterials || {}), ...boostNames])];
    for (const material of materialNames) {
      if (!Object.hasOwn(materialData, material)) materialData[material] = safe(() => api.getMaterialData(material), null);
    }
    const cities = (division.cities || []).map(city => {
      const office = safe(() => api.getOffice(name, city), null);
      const hasWarehouse = safe(() => api.hasWarehouse(name, city) === true, false);
      const warehouse = hasWarehouse ? safe(() => api.getWarehouse(name, city), null) : null;
      const materials = {}, products = {};
      if (warehouse) {
        for (const material of materialNames) materials[material] = safe(() => api.getMaterial(name, city, material), null);
        for (const product of division.products || []) products[product] = safe(() => api.getProduct(name, city, product), null);
      }
      return {
        city, office, hasWarehouse, warehouse, materials, products,
        backlog: warehouse ? cityBacklogged(materials, products) : false,
      };
    });
    const primary = cities.find(row => row.hasWarehouse) || cities[0] || null;
    const products = primary ? (division.products || []).map(product => primary.products[product]).filter(Boolean) : [];
    divisions.push({
      name, info: division, industry, cities, products, materialData,
      makesProducts: division.makesProducts === true,
      maxProducts: num(division.maxProducts),
      points: num(division.researchPoints),
      owned, costs,
      ta2: owned.includes('Market-TA.II'),
      autoTea: owned.includes('AutoBrew'),
      autoParty: owned.includes('AutoPartyManager'),
    });
  }
  return { info, constants, unlocks, upgrades, divisions, materialData, catalog };
}

/**
 * Create one optimiser. The tick is synchronous: it never awaits, so it can run inside a
 * corporation cycle without fighting `nextUpdate`.
 *
 * @param {object} options
 * @param {object} options.api            injected corporation API (ns.corporation or a mock)
 * @param {object} [options.config]       validated configuration (see corporation-config.js)
 * @param {number} [options.cycleSeconds] market cycle length from constants
 * @param {() => number} [options.clock]  clock injection for deterministic tests
 * @param {(level:string, message:string, data?:object) => void} [options.log]
 * @param {object} [options.state]        restored optimiser state
 * @param {(path:string, contents:string) => void} [options.write] state writer
 * @param {() => boolean} [options.isAllowed] controller guard (pause, maintenance, achievements)
 * @param {number} [options.reserveFloor] cash the structural phase has claimed this cycle
 * @param {string[]|Set<string>} [options.skipWarehouse] `Division/City` keys the structural phase
 *        already upgraded (or bought) this cycle; upgrading them again would be a duplicate purchase
 * @param {string[]|Set<string>} [options.skipOffice] `Division/City` keys whose office the structural
 *        phase already grew this cycle; growing it again would be a second increment (N1)
 */
export function createCorporationOptimizer({
  api,
  config = defaultCorporationConfig(),
  cycleSeconds = 10,
  clock = () => Date.now(),
  log = () => {},
  state = null,
  write = null,
  isAllowed = () => true,
  onDecision = null,
  identity = null,
  reserveFloor = 0,
  skipWarehouse = null,
  skipOffice = null,
} = {}) {
  let settings = config;
  let structuralReserve = Math.max(0, num(reserveFloor));
  const skipWarehouses = new Set(skipWarehouse instanceof Set ? skipWarehouse : Array.isArray(skipWarehouse) ? skipWarehouse : []);
  const skipOffices = new Set(skipOffice instanceof Set ? skipOffice : Array.isArray(skipOffice) ? skipOffice : []);

  /**
   * Per-cycle guards from the daemon. `reserveFloor` is cash a structural purchase has
   * already claimed (cities/industries); `skipWarehouse`/`skipOffice` name the objects the
   * structural phase touched this cycle, so one cycle never buys the same upgrade twice.
   */
  const setCycleGuards = ({ reserveFloor: floor = structuralReserve, skipWarehouse: skip = null, skipOffice: offices = null } = {}) => {
    structuralReserve = Math.max(0, num(floor));
    skipWarehouses.clear();
    for (const key of skip instanceof Set ? skip : Array.isArray(skip) ? skip : []) skipWarehouses.add(String(key));
    skipOffices.clear();
    for (const key of offices instanceof Set ? offices : Array.isArray(offices) ? offices : []) skipOffices.add(String(key));
    return { reserveFloor: structuralReserve, skipWarehouse: [...skipWarehouses], skipOffice: [...skipOffices] };
  };
  let optimizerState = restoreOptimizerState(state, identity || {});
  if (identity) {
    // Persisted with the state so the next restart can tell "same save" from "new reset" (spec §9.2).
    if (identity.nodeReset !== undefined) optimizerState.nodeReset = identity.nodeReset;
    if (identity.augReset !== undefined) optimizerState.augReset = identity.augReset;
  }
  const decisions = [];
  const findings = [];
  const failures = new Map(Object.entries(optimizerState.failures || {}));

  const logger = (level, message, data) => {
    try { log(level, message, data); } catch { /* logging never breaks a tick */ }
  };

  const configure = next => {
    if (next && typeof next === 'object') settings = next;
    return settings;
  };

  const getState = () => JSON.parse(JSON.stringify(optimizerState));

  const record = (kind, label, state, extra = {}) => {
    const row = { kind, label, state, at: extra.at ?? clock(), ...extra };
    decisions.push(row);
    if (onDecision) safe(() => onDecision(row));
    if (state === 'purchased') {
      if (row.routine && !settings.telemetry?.debug) logger('debug', `${label}`, row);
      else logger('action', `${label}${row.cost ? ` ($${Math.round(row.cost).toLocaleString()})` : ''}`, row);
    } else if (state === 'planned') logger('plan', `${label} — would run${row.cost ? ` for $${Math.round(row.cost).toLocaleString()}` : ''}`, row);
    else if (state === 'rejected' || state === 'partial') logger('warn', `${label}: ${row.reason || state}`, row);
    else if (settings.telemetry?.debug) logger('info', `${label}: ${row.reason || state}`, row);
    return row;
  };

  const noteFailure = (label, message, at) => {
    const previous = failures.get(label) || { count: 0, firstAt: at, announced: false };
    const next = {
      operation: label, message: String(message || 'unknown failure'), count: previous.count + 1,
      firstAt: previous.firstAt || at, lastAt: at, announced: previous.announced === true,
    };
    if (!next.announced && next.count >= 2) {
      next.announced = true;
      logger('error', `${label} failed ${next.count}x in a row: ${next.message}`);
    }
    failures.set(label, next);
  };

  const tick = () => {
    const at = clock();
    decisions.length = 0;
    findings.length = 0;
    if (settings.enabled === false) return finish({ at, state: 'DISABLED', reason: 'Corporation optimisation is disabled in configuration' });
    if (!safe(() => isAllowed(), true)) {
      safe(() => clearCorporationBuyRates(api));
      return finish({ at, state: 'SUSPENDED', reason: 'Automation is paused, in maintenance or achievement-locked' });
    }
    const snapshot = readCorporationSnapshot(api);
    if (!snapshot) return finish({ at, state: 'NO_CORP', reason: 'No corporation exists; bootstrap owns this state' });
    if (!snapshot.divisions.length) return finish({ at, state: 'BOOTSTRAP', reason: 'Corporation has no divisions yet', snapshot });
    if (!snapshot.unlocks.office) findings.push({ kind: 'blocked', label: 'Office API', reason: 'Office API is not owned; staffing, research and product work are skipped' });

    const info = snapshot.info;
    const revenue = num(info.revenue), expenses = num(info.expenses);
    const margin = revenue - expenses;
    const streak = optimizerState.marginStreak || { negative: 0, positive: 0 };
    optimizerState.marginStreak = {
      negative: margin <= 0 ? num(streak.negative) + 1 : 0,
      positive: margin > 0 ? num(streak.positive) + 1 : 0,
    };
    const developing = snapshot.divisions.some(division => division.makesProducts &&
      division.products.some(product => num(product.developmentProgress) < 100));
    const treasury = treasuryPolicy(info, cycleSeconds, { developmentSpeed: settings.product?.developmentSpeed !== false });
    const marginFreeze = margin <= 0 && optimizerState.marginStreak.negative >= Math.max(1, num(settings.budgets?.recoveryMarginCycles) || 10);
    const recovering = treasury.recovering === true || marginFreeze;
    const ladder = corporationBudgetLadder(info, settings, {
      growthBank: num(optimizerState.growthBank), cycleSeconds, recovering, developing, reserveFloor: structuralReserve,
    });
    const budgets = {
      growth: ladder.growth,
      // Product seeding and recipe inputs are operating capital, not discretionary growth:
      // a negligible growth bank must not starve them (spec §6.2, §6.5).
      product: Math.max(ladder.growth, ladder.free * num(settings.product?.investmentCashFraction ?? 0.02)),
      input: recovering ? 0 : ladder.free * num(settings.budgets?.inputCashFraction ?? 0.5),
      boost: ladder.boost,
      upkeep: ladder.upkeep,
      upgrade: recovering ? 0 : Math.max(0, ladder.funds * num(settings.people?.upgradeFraction ?? 0.2)),
      advert: recovering ? 0 : Math.max(0, ladder.free * num(settings.market?.advertSpendFraction ?? 0.5)),
    };
    const spent = { growth: 0, product: 0, input: 0, boost: 0, upkeep: 0, upgrade: 0, advert: 0 };
    let localReserve = ladder.reserve;
    const remaining = key => Math.max(0, budgets[key] - spent[key]);
    const dryRun = settings.dryRun === true;
    const allowed = () => safe(() => isAllowed(), true) && settings.dryRun !== true;

    /** Execute (or, in dry-run, only record) one planned mutation within its budget. */
    const run = ({ kind, label, cost = 0, budgetKey = 'growth', target = null, deferred = false, routine = false, apply }) => {
      const charge = Math.max(0, num(cost));
      if (charge > remaining(budgetKey)) {
        return record(kind, label, 'budget-wait', {
          cost: charge, target,
          reason: `Needs $${Math.round(charge).toLocaleString()} but only $${Math.round(remaining(budgetKey)).toLocaleString()} of the ${budgetKey} budget is free`,
        });
      }
      if (dryRun) {
        spent[budgetKey] += charge;
        if (deferred) localReserve += charge;
        return record(kind, label, 'planned', { cost: charge, target, budget: budgetKey, routine });
      }
      const result = safe(apply, { state: 'rejected', reason: 'apply threw' }) || {};
      const paid = Number.isFinite(Number(result.spent)) ? num(result.spent) : charge;
      spent[budgetKey] += paid;
      if (deferred) localReserve += paid;
      if (result.state === 'rejected' || result.state === 'partial') noteFailure(label, result.reason, at);
      return record(kind, label, result.state || 'no-op', { cost: paid, target, reason: result.reason, routine, ...(result.extra || {}) });
    };

    // ---- 7. People: hire, assign, upkeep, office size ----------------------------
    if (snapshot.unlocks.office) {
      for (const division of snapshot.divisions) {
        const developmentCity = division.makesProducts
          ? corporationDevelopmentCity(division.cities.filter(row => row.hasWarehouse && row.office).map(row => ({ ...row.office, city: row.city })))
          : null;
        const researchGoal = corporationResearchGoal({
          laboratory: division.owned.includes('Hi-Tech R&D Laboratory'),
          ta1: division.owned.includes('Market-TA.I'),
          ta2: division.ta2,
          points: division.points,
          laboratoryCost: division.costs['Hi-Tech R&D Laboratory'],
          ta1Cost: division.costs['Market-TA.I'],
          ta2Cost: division.costs['Market-TA.II'],
        }, division.makesProducts, null);
        for (const row of division.cities) {
          if (!row.office) continue;
          const officeDeveloping = division.makesProducts && row.city === developmentCity;
          // Staffing gates every other plan, so an understaffed or development office may draw a
          // bounded slice of free cash even while the growth bank is still empty (spec §6.1 note).
          const size = Math.max(0, num(row.office.size));
          const desiredTarget = officeTargetFor({ makesProducts: division.makesProducts, cash: ladder.funds, config: settings });
          const pendingCost = desiredTarget > size
            ? safe(() => api.getOfficeSizeUpgradeCost(division.name, row.city, desiredTarget - size), NaN)
            : NaN;
          const unblock = (size < 9 || officeDeveloping) && !recovering && Number.isFinite(pendingCost)
            ? Math.min(ladder.free * num(settings.budgets?.officeCashFraction ?? 0.1), pendingCost)
            : 0;
          const plan = planOffice({
            division: division.name, city: row.city, office: row.office,
            divisionInfo: { makesProducts: division.makesProducts, cities: division.cities.map(item => item.city) },
            products: division.products, developing: officeDeveloping, recovering,
            funds: ladder.funds, reserve: localReserve, budget: Math.max(remaining('growth'), unblock),
            upkeepBudget: remaining('upkeep'),
            config: settings, researchGoal,
            quoteSizeUpgrade: add => safe(() => api.getOfficeSizeUpgradeCost(division.name, row.city, add), NaN),
            teaCostPerEmployee: num(snapshot.constants.teaCostPerEmployee) || 500000,
            autoTea: division.autoTea, autoParty: division.autoParty,
          });
          const label = `Staff ${division.name}/${row.city}`;
          const officeKey = `${division.name}/${row.city}`;
          if (skipOffices.has(officeKey) && plan.sizeUpgrade) {
            // The structural phase grew this office in the same cycle: one increment per cycle (N1).
            record('people', `Grow office ${officeKey}`, 'blocked', { reason: 'the structural phase already grew this office this cycle' });
            plan.sizeUpgrade = null;
          }
          if (plan.starvation) {
            const key = `${division.name}/${row.city}`;
            optimizerState.starvation[key] = num(optimizerState.starvation[key]) + 1;
            if (optimizerState.starvation[key] >= Math.max(1, num(settings.people?.starvationTicks) || 3)) {
              findings.push({ kind: 'people.starvation', label: key, division: division.name, city: row.city,
                size: plan.size, employees: plan.employees, reason: 'Office has a size but no employees; hiring is failing' });
            }
          } else if (optimizerState.starvation[`${division.name}/${row.city}`]) {
            delete optimizerState.starvation[`${division.name}/${row.city}`];
          }
          const changing = !!plan.sizeUpgrade || plan.hires !== 0 || plan.starvation ||
            (plan.counts && !plan.aligned) || plan.upkeep.tea > 0 || plan.upkeep.party > 0;
          if (!changing) {
            record('people', label, 'no-op', { reason: plan.reason || 'Staffing matches its target' });
            continue;
          }
          if (dryRun) {
            if (plan.sizeUpgrade) { spent.growth += plan.sizeUpgrade.cost; localReserve += plan.sizeUpgrade.cost; }
            spent.upkeep += plan.upkeep.cost;
            record('people', label, 'planned', {
              cost: plan.sizeUpgrade?.cost || 0, target: plan.target,
              plan: {
                hires: Math.max(0, Math.min(size + (plan.sizeUpgrade?.add || 0), plan.target) - plan.employees),
                jobs: plan.counts, upkeep: plan.upkeep, sizeUpgrade: plan.sizeUpgrade,
              },
            });
            continue;
          }
          const result = safe(() => applyOfficePlan(api, plan, {
            allowed, reserve: localReserve,
          }), { state: 'rejected', reason: 'applyOfficePlan threw' });
          const paid = result.spent || {};
          spent.growth += num(paid.growth);
          spent.upkeep += num(paid.upkeep);
          localReserve += num(paid.growth) + num(paid.upkeep);
          if (result.state === 'rejected' || result.state === 'partial') noteFailure(label, result.reason || result.results?.find(item => item.state === 'rejected')?.reason, at);
          record('people', label, result.state || 'no-op', { cost: num(paid.growth) + num(paid.upkeep), target: plan.target, details: result.results?.slice(0, 12) });
        }
      }
    }

    // ---- 8a. Research -----------------------------------------------------------------
    for (const division of snapshot.divisions) {
      const pending = division.products.some(product => num(product.developmentProgress) < 100);
      const rate = corporationResearchRate(optimizerState.researchSamples[division.name], division.points, at);
      const plan = planResearch({
        division: division.name, points: division.points, owned: division.owned, costs: division.costs,
        config: settings, developing: pending, rate, cycleSeconds,
      });
      const label = plan.ready ? `Research ${division.name}/${plan.target}` : `Research ${division.name}`;
      if (!plan.ready) {
        record('research', label, plan.complete ? 'complete' : 'budget-wait', { reason: plan.reason, gap: plan.gap });
      } else if (dryRun) {
        record('research', label, 'planned', { cost: 0, target: plan.target, package: plan.package });
      } else {
        const result = safe(() => applyResearchPlan(api, plan, { allowed }), { state: 'rejected', reason: 'applyResearchPlan threw' });
        if (result.state === 'rejected' || result.state === 'partial') noteFailure(label, result.reason, at);
        record('research', label, result.state || 'no-op', { cost: 0, package: plan.package, purchased: result.purchased, reason: result.reason });
      }
      optimizerState.researchSamples[division.name] = {
        at, points: division.points, spent: plan.ready && !dryRun ? num(plan.cost) : 0,
      };
    }

    // ---- 8b. Products -----------------------------------------------------------------
    for (const division of snapshot.divisions.filter(item => item.makesProducts)) {
      const offices = division.cities.filter(row => row.hasWarehouse && row.office).map(row => ({ ...row.office, city: row.city }));
      const plan = planProductCycle({
        division: division.name, industry: division.industry, products: division.products,
        maxProducts: division.maxProducts, offices, researchPoints: division.points,
        funds: ladder.funds, reserve: localReserve,
        budget: remaining('product'),
        config: settings, state: optimizerState, now: at, cycleSeconds,
      });
      const label = `Product ${division.name}${plan.name ? `/${plan.name}` : ''}`;
      if (!['create', 'retire', 'discontinue'].includes(plan.action)) {
        record('product', label, plan.action === 'blocked' ? 'blocked' : plan.action === 'wait' ? 'budget-wait' : plan.action,
          { reason: plan.reason, science: plan.science, slots: plan.slots, researchGap: plan.researchGap });
        continue;
      }
      const decision = run({
        kind: 'product', label, cost: plan.action === 'create' ? plan.cost : 0, budgetKey: 'product',
        target: plan.name, apply: () => applyProductPlan(api, plan, { allowed, cycleSeconds }),
      });
      if (decision.state === 'purchased' || decision.state === 'planned') {
        const index = Number(String(plan.name).match(/(\d+)$/)?.[1]);
        if (Number.isInteger(index)) optimizerState.counters[division.name] = index;
        if (plan.action === 'create') {
          optimizerState.metrics[division.name] = {
            name: plan.name, city: plan.city, startedAt: at, research: division.points,
            employees: Math.max(0, ...offices.map(office => num(office.numEmployees))),
          };
        } else {
          delete optimizerState.metrics[division.name];
        }
      }
    }
    // Reconcile completed products with their development metrics (fixes G3).
    for (const division of snapshot.divisions) {
      const metric = optimizerState.metrics[division.name];
      if (!metric) continue;
      const product = division.products.find(item => item.name === metric.name);
      if (!product) { delete optimizerState.metrics[division.name]; continue; }
      if (num(product.developmentProgress) >= 100 && !metric.finishedAt) {
        metric.finishedAt = at;
        metric.developmentMs = Math.max(0, at - metric.startedAt);
        optimizerState.history[division.name] = { ...(optimizerState.history[division.name] || {}), [metric.name]: { ...metric } };
      }
    }

    // ---- 9. Market: sell, inputs, boosts, warehouse -------------------------------
    const salesBots = num(snapshot.upgrades['ABC SalesBots']?.level);
    for (const division of snapshot.divisions) {
      const market = planSales({
        division: division.name, divisionInfo: division.info, industry: division.industry,
        cities: division.cities.filter(row => row.hasWarehouse).map(row => ({
          city: row.city, office: row.office, materials: row.materials, products: row.products, warehouse: row.warehouse,
        })),
        ta2: division.ta2, materialData: snapshot.materialData, pricing: optimizerState.pricing,
        markup: num(optimizerState.markups[division.name]) || null, salesBots, cycleSeconds,
      });
      optimizerState.pricing = compactPricing({ ...optimizerState.pricing, ...market.pricing });
      for (const [key, observed] of Object.entries(market.markupCandidates || {})) {
        const divisionKey = division.name;
        optimizerState.markups[divisionKey] = num(observed) || num(optimizerState.markups[divisionKey]);
        void key;
      }
      if (market.materials.length || market.products.length) {
        const label = `Sell ${division.name}`;
        if (dryRun) {
          record('sell', label, 'planned', { cost: 0, routine: true, orders: market.materials.length + market.products.length });
        } else {
          const result = safe(() => applySales(api, { division: division.name, ...market }, { allowed }),
            { state: 'rejected', reason: 'applySales threw' });
          if (result.state === 'rejected') noteFailure(label, result.reason, at);
          record('sell', label, result.state || 'no-op', { cost: 0, routine: true, orders: result.sold, failed: result.failed, ta2: result.ta2 });
        }
      }

      const recipe = Object.keys(division.industry.requiredMaterials || {});
      for (const row of division.cities.filter(city => city.hasWarehouse)) {
        const inputs = planInputs({
          division: division.name, city: row.city, industry: division.industry, warehouse: row.warehouse,
          smartSupply: snapshot.unlocks.smartSupply, items: row.materials, products: Object.values(row.products),
          budget: remaining('input'), cycleSeconds,
        });
        if (!recovering && inputs.mode !== 'skip') {
          run({
            kind: 'buy', label: `Inputs ${division.name}/${row.city}`, cost: inputs.cost, budgetKey: 'input',
            deferred: true, routine: true,
            apply: () => applyInputs(api, inputs, { allowed, smartSupplyOptions: snapshot.constants.smartSupplyOptions }),
          });
        } else if (inputs.mode === 'skip') {
          record('buy', `Inputs ${division.name}/${row.city}`, 'blocked', { reason: inputs.reason });
        }
        if (snapshot.unlocks.smartSupply && !dryRun && !recovering && inputs.mode === 'smart') {
          // `allowed()` carries both the dry-run switch and the mid-tick pause guard; testing
          // `!dryRun` alone wrote to the game while automation was paused (B9).
          if (allowed()) safe(() => api.setSmartSupply(division.name, row.city, true));
        }

        const boosts = planBoosts({
          division: division.name, city: row.city, industry: division.industry, warehouse: row.warehouse,
          items: row.materials, materialData: snapshot.materialData, budget: remaining('boost'),
          config: settings, cycleSeconds, backlog: row.backlog,
        });
        if (!recovering && boosts.ready) {
          run({
            kind: 'boost', label: `Boosts ${division.name}/${row.city}`, cost: boosts.cost, budgetKey: 'boost',
            deferred: true, routine: true,
            apply: () => applyBoosts(api, boosts, { allowed, recipe }),
          });
        } else if (settings.telemetry?.debug) {
          record('boost', `Boosts ${division.name}/${row.city}`, 'no-op', { reason: boosts.reason });
        }

        const warehouse = planWarehouseUpgrade({
          division: division.name, city: row.city, warehouse: row.warehouse,
          quotedCost: safe(() => api.getUpgradeWarehouseCost(division.name, row.city, 1), NaN),
          cash: ladder.funds, reserve: localReserve, budget: remaining('growth'), config: settings, backlog: row.backlog,
        });
        const warehouseKey = `${division.name}/${row.city}`;
        if (skipWarehouses.has(warehouseKey)) {
          // The structural phase bought or upgraded this warehouse in this same cycle: a second
          // upgrade here would be a duplicate purchase (spec §5.3 invariant 6).
          record('warehouse', `Warehouse ${warehouseKey}`, 'blocked', { reason: 'the structural phase already touched this warehouse this cycle' });
        } else if (warehouse.ready && !recovering) {
          run({
            kind: 'warehouse', label: `Warehouse ${division.name}/${row.city}`, cost: warehouse.cost, budgetKey: 'growth',
            apply: () => applyWarehouseUpgrade(api, warehouse, { allowed, reserve: localReserve }),
          });
        } else if (settings.telemetry?.debug) {
          record('warehouse', `Warehouse ${division.name}/${row.city}`, 'no-op', { reason: warehouse.reason });
        }
      }
    }

    // ---- 10. Upgrades and AdVerts ---------------------------------------------------
    const storagePressure = snapshot.divisions.some(division => division.cities.some(row =>
      row.warehouse && num(row.warehouse.sizeUsed) / Math.max(1, num(row.warehouse.size)) > 0.8));
    const upgrade = planUpgrade({
      cash: ladder.funds, reserve: localReserve, config: settings, storagePressure,
      levelOf: name => snapshot.upgrades[name]?.level || 0,
      costOf: name => snapshot.upgrades[name]?.cost ?? NaN,
      profitPerCycle: ladder.profit,
    });
    if (upgrade.ready) {
      run({
        kind: 'upgrade', label: `Upgrade ${upgrade.ready.name}`, cost: upgrade.ready.cost, budgetKey: 'upgrade',
        target: upgrade.ready.level + 1,
        apply: () => applyUpgrade(api, upgrade.ready, { allowed, reserve: localReserve }),
      });
    } else {
      record('upgrade', 'Upgrade', 'budget-wait', { reason: 'No upgrade fits the current budget' });
    }

    for (const division of snapshot.divisions) {
      if (recovering) break;
      const cap = num(division.makesProducts ? settings.market?.maxAdVerts?.products : settings.market?.maxAdVerts?.materials) || 0;
      const count = num(division.info.numAdVerts);
      if (count >= cap) {
        record('advert', `AdVert ${division.name}`, 'blocked', { reason: `${count}/${cap} AdVerts already purchased` });
        continue;
      }
      const plan = planAdVert({
        division: division.name, divisionInfo: division.info, industry: division.industry,
        cost: safe(() => api.getHireAdVertCost(division.name), NaN),
        cash: ladder.funds, reserve: localReserve, budget: remaining('advert'), config: settings,
        wilsonLevel: num(snapshot.upgrades['Wilson Analytics']?.level),
        revenue: num(info.revenue),
      });
      if (!plan.ready) {
        record('advert', `AdVert ${division.name}`, 'budget-wait', { reason: plan.reason });
        continue;
      }
      run({
        kind: 'advert', label: `AdVert ${division.name}`, cost: plan.cost, budgetKey: 'advert',
        apply: () => applyAdVert(api, plan, { allowed, reserve: localReserve }),
      });
    }

    return finish({ at, state: recovering ? 'RECOVERY' : 'RUNNING', reason: recovering ? 'Cash floor or negative-margin streak' : null, snapshot, ladder, spent, budgets });
  };

  /** Assemble telemetry, persist state and return the tick result. */
  function finish({ at, state, reason = null, snapshot = null, ladder = null, spent = null, budgets = null }) {
    optimizerState.cyclesManaged = num(optimizerState.cyclesManaged) + (snapshot ? 1 : 0);
    if (ladder) optimizerState.growthBank = Math.max(0, ladder.growth - num(spent?.growth));
    if (decisions.some(row => row.state === 'purchased' || row.state === 'planned')) optimizerState.lastActionAt = at;
    optimizerState.failures = Object.fromEntries([...failures.entries()].slice(0, MAX_FAILURES));
    const info = snapshot?.info || null;
    const telemetry = {
      schemaVersion: OPTIMIZER_STATE_VERSION,
      at,
      pid: null,
      state,
      reason,
      dryRun: settings.dryRun === true,
      corporation: info?.name ?? null,
      funds: num(info?.funds),
      reserve: num(ladder?.reserve),
      revenue: num(info?.revenue),
      expenses: num(info?.expenses),
      profitPerCycle: (num(info?.revenue) - num(info?.expenses)) * cycleSeconds,
      cycleSeconds,
      lastActionAt: num(optimizerState.lastActionAt),
      valuation: num(info?.valuation),
      sharePrice: num(info?.sharePrice),
      public: info?.public === true,
      growthBank: num(optimizerState.growthBank),
      budgets: budgets ? { ...budgets, spent: spent || {} } : null,
      divisions: (snapshot?.divisions || []).map(division => ({
        name: division.name, industry: division.industry?.name || division.info.industry,
        cities: division.cities.map(row => row.city), researchPoints: division.points,
        products: division.products.map(product => ({
          name: product.name, progress: num(product.developmentProgress),
          rating: num(product.effectiveRating ?? product.rating), stored: num(product.stored),
        })),
        productSlots: division.makesProducts ? { used: division.products.length, max: division.maxProducts } : null,
        ta2: division.ta2,
      })),
      offices: (snapshot?.divisions || []).flatMap(division => division.cities
        .filter(row => row.office)
        .map(row => ({
          division: division.name, city: row.city,
          size: num(row.office.size), employees: num(row.office.numEmployees),
          energy: num(row.office.avgEnergy), morale: num(row.office.avgMorale),
          starvation: num(row.office.size) > 0 && num(row.office.numEmployees) === 0,
          jobs: row.office.employeeJobs || null,
        }))),
      decisions: decisions.slice(0, MAX_DECISIONS),
      findings: findings.slice(0, 32),
      persistentFailures: [...failures.values()].slice(0, MAX_FAILURES),
      cyclesManaged: optimizerState.cyclesManaged,
      statePersisted: null,
    };
    if (typeof write === 'function') {
      const path = telemetry.dryRun ? 'tasks/corporation-dry-run.json' : (settings.telemetry?.stateFile || 'tasks/corporation-optimizer.json');
      const payload = telemetry.dryRun
        ? { schemaVersion: OPTIMIZER_STATE_VERSION, nodeReset: optimizerState.nodeReset ?? null, augReset: optimizerState.augReset ?? null,
          corporation: info?.name ?? null, at, plans: decisions.filter(row => row.state === 'planned') }
        : { ...optimizerState, nodeReset: optimizerState.nodeReset ?? null, augReset: optimizerState.augReset ?? null,
          corporation: info?.name ?? null, at };
      const written = safe(() => { write(path, JSON.stringify(payload)); return path; }, null);
      telemetry.statePersisted = written;
      if (!written) logger('warn', `Could not persist optimiser state to ${path}`);
    }
    return { state, at, decisions: telemetry.decisions, findings: telemetry.findings, telemetry, snapshot };
  }

  return { tick, configure, getState, setCycleGuards };
}

/**
 * Dry-run over one snapshot without an optimiser instance: returns the full plan so a caller
 * can diff it against a real run (spec §9.5, acceptance 12).
 */
export function planOnly({ api, config = defaultCorporationConfig(), cycleSeconds = 10, state = null, clock = () => Date.now(), reserveFloor = 0, skipWarehouse = null } = {}) {
  const optimizer = createCorporationOptimizer({
    api, config: { ...config, dryRun: true }, cycleSeconds, state, clock, isAllowed: () => true, reserveFloor, skipWarehouse,
  });
  return optimizer.tick();
}

/** Zero every buy rate this loop may have set; safe to call on exit (spec §5.3 invariant 4). */
export function clearOptimizerBuyRates(api) {
  return safe(() => clearCorporationBuyRates(api), undefined);
}

export { BOOST_MATERIALS, OFFICE_JOBS, RESEARCH_PRIORITY, UPGRADE_ORDER, clearBoostRates, productTelemetry };
