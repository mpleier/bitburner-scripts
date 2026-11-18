/**
 * Corporation bootstrap (spec §6.1): take `NO_CORP` to a staffed first division.
 *
 * Design: decisions are pure functions of a snapshot; effects run through an
 * injected `api` object so tests can drive a fake game. Every effect re-reads the
 * authoritative value and re-checks affordability immediately before mutating,
 * so a re-run is a no-op (spec §9.4).
 *
 * RAM: this module is a library. The entrypoint pays once for the `ns.corporation`
 * functions used here; imports themselves are free.
 */

import { UNLOCK_ORDER, CITY_NAMES } from './corporation-config.js';

/** Self-funding cost charged to the player wallet (spec §3.1). */
export const SELF_FUND_COST = 150e9;
/** Fallbacks when `getConstants()` cannot be read; both match the live game. */
export const DEFAULT_OFFICE_COST = 4e9;
export const DEFAULT_WAREHOUSE_COST = 5e9;
export const DEFAULT_WAREHOUSE_SIZE = 100;
/** How long a rejected division expansion waits before it is quoted again (spec edge 19). */
export const DIVISION_RETRY_MS = 5 * 60000;
/** Market cycle length used when `constants.secondsPerMarketCycle` is unavailable. */
export const DEFAULT_CYCLE_SECONDS = 10;

const CORE_UNLOCKS = UNLOCK_ORDER;

const finite = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const text = (error) => String(error?.message || error).slice(0, 240);

function push(errors, operation, error) {
  errors.push({ operation, message: text(error), at: Date.now() });
}

/**
 * Evaluate whether the corporation API is usable at all (spec §3.1, edges 1-3).
 * Returns `{state:'UNAVAILABLE'|'NO_CORP'|'READY', code, reason}`.
 */
export function corporationGate({
  apiAvailable = true,
  hasCorporation = false,
  canCreateSeed = null,
  canCreateSelf = null,
  disableCorporation = false,
  currentNode = 3,
  hasSourceFile3 = false,
} = {}) {
  if (!apiAvailable) {
    return { state: 'UNAVAILABLE', code: 'corporation.apiUnavailable', reason: 'Corporation API unavailable: requires BitNode 3 or Source-File 3' };
  }
  if (disableCorporation === true) {
    return { state: 'UNAVAILABLE', code: 'corporation.disabledByBitNode', reason: 'Corporation disabled by BitNode options' };
  }
  if (hasCorporation) return { state: 'READY', code: 'corporation.exists', reason: 'Corporation exists' };
  if (!(currentNode === 3 || hasSourceFile3)) {
    return { state: 'UNAVAILABLE', code: 'corporation.apiUnavailable', reason: 'Corporation API unavailable: requires BitNode 3 or Source-File 3' };
  }
  if (canCreateSeed === 'NoSf3OrDisabled' || canCreateSeed === 'DisabledBySoftCap') {
    return { state: 'UNAVAILABLE', code: `corporation.${canCreateSeed}`, reason: `Corporation creation refused: ${canCreateSeed}` };
  }
  if (canCreateSeed === 'CorporationExists') {
    return { state: 'READY', code: 'corporation.exists', reason: 'Creation reports an existing corporation; re-reading' };
  }
  if (canCreateSeed === null && canCreateSelf === null) {
    return { state: 'UNAVAILABLE', code: 'corporation.apiUnavailable', reason: 'canCreateCorporation is unavailable' };
  }
  return { state: 'NO_CORP', code: 'corporation.none', reason: 'No corporation yet', canCreateSeed, canCreateSelf };
}

/** Operating reserve from the `budgets` config block; mirrors `treasuryPolicy` defaults. */
export function operatingReserve(info, config, cycleSeconds = DEFAULT_CYCLE_SECONDS) {
  const budgets = config?.budgets || {};
  const floor = finite(budgets.reserveFloor, 1e6);
  const cap = Math.max(floor, finite(budgets.reserveCap, 5e9));
  const cash = Math.max(0, finite(info?.funds));
  const expenses = Math.max(0, finite(info?.expenses));
  const cashFraction = finite(budgets.reserveCashFraction, 0.1);
  const expenseCycles = finite(budgets.reserveExpenseCycles, 2);
  return Math.min(cap, Math.max(floor, cash * cashFraction, expenses * Math.max(1, cycleSeconds) * expenseCycles));
}

/** Office + warehouse + setup margin for one new city (spec §6.1). */
export function cityPackageCost(snapshot, config) {
  const constants = snapshot?.constants || {};
  const office = finite(constants.officeInitialCost, DEFAULT_OFFICE_COST);
  const warehouse = finite(constants.warehouseInitialCost, DEFAULT_WAREHOUSE_COST);
  const setup = finite(config?.bootstrap?.setupReserve, 20e6);
  return { office, warehouse, setup, total: office + warehouse + setup };
}

/**
 * Read every value the bootstrap needs, tolerating any individual API failure.
 * `context` supplies wallet/reserve/gate values that live outside `ns.corporation`.
 */
export function readBootstrapSnapshot(api, config, context = {}) {
  const errors = [];
  const safe = (operation, fn, fallback) => {
    try {
      const value = fn();
      return value === undefined ? fallback : value;
    } catch (error) {
      push(errors, operation, error);
      return fallback;
    }
  };
  const available = !!api && typeof api.hasCorporation === 'function';
  const hasCorporation = available ? safe('hasCorporation', () => api.hasCorporation() === true, false) === true : false;
  const constants = available ? safe('getConstants', () => api.getConstants(), {}) || {} : {};
  const corp = available && hasCorporation ? safe('getCorporation', () => api.getCorporation(), null) : null;
  const chain = config?.bootstrap?.industryChain || [];
  const divisions = [];
  const offices = {};
  const warehouses = {};
  const warehouseInfo = {};
  for (const name of Array.isArray(corp?.divisions) ? corp.divisions : []) {
    const info = safe(`getDivision(${name})`, () => api.getDivision(name), null);
    if (!info) continue;
    divisions.push({
      name,
      industry: info.industry,
      cities: Array.isArray(info.cities) ? [...info.cities] : [],
      makesProducts: info.makesProducts === true,
      maxProducts: finite(info.maxProducts),
      products: Array.isArray(info.products) ? [...info.products] : [],
      researchPoints: finite(info.researchPoints),
      lastCycleRevenue: finite(info.lastCycleRevenue),
      lastCycleExpenses: finite(info.lastCycleExpenses),
    });
    for (const city of Array.isArray(info.cities) ? info.cities : []) {
      const key = `${name}/${city}`;
      const office = safe(`getOffice(${name}, ${city})`, () => api.getOffice(name, city), null);
      if (office) offices[key] = { city, size: finite(office.size), numEmployees: finite(office.numEmployees), avgEnergy: finite(office.avgEnergy), avgMorale: finite(office.avgMorale) };
      const hasWarehouse = safe(`hasWarehouse(${name}, ${city})`, () => api.hasWarehouse(name, city), null);
      warehouses[key] = hasWarehouse === true;
      if (hasWarehouse === true) {
        const warehouse = safe(`getWarehouse(${name}, ${city})`, () => api.getWarehouse(name, city), null);
        if (warehouse) warehouseInfo[key] = { level: finite(warehouse.level), size: finite(warehouse.size), sizeUsed: finite(warehouse.sizeUsed), smartSupplyEnabled: warehouse.smartSupplyEnabled === true };
      }
    }
  }
  const unlocks = {};
  const unlockCosts = {};
  if (available) {
    for (const unlock of [...CORE_UNLOCKS, 'Export', 'Market Research - Demand', 'Market Data - Competition']) {
      const owned = safe(`hasUnlock(${unlock})`, () => api.hasUnlock(unlock), null);
      unlocks[unlock] = owned === true;
      if (owned !== true) unlockCosts[unlock] = safe(`getUnlockCost(${unlock})`, () => api.getUnlockCost(unlock), null);
    }
  }
  const industryData = {};
  if (available) {
    const needed = new Set([...chain, ...divisions.map((d) => d.industry)]);
    for (const industry of needed) {
      if (typeof industry !== 'string') continue;
      const data = safe(`getIndustryData(${industry})`, () => api.getIndustryData(industry), null);
      if (data) industryData[industry] = { startingCost: finite(data.startingCost), requiredMaterials: data.requiredMaterials || {}, producedMaterials: data.producedMaterials || [], makesProducts: data.makesProducts === true };
    }
  }
  const canCreateSeed = available ? safe('canCreateCorporation(false)', () => api.canCreateCorporation(false), null) : null;
  const canCreateSelf = available ? safe('canCreateCorporation(true)', () => api.canCreateCorporation(true), null) : null;
  const gate =
    context.gate ||
    corporationGate({
      apiAvailable: available,
      hasCorporation,
      canCreateSeed,
      canCreateSelf,
      disableCorporation: context.disableCorporation === true,
      currentNode: finite(context.currentNode, 3),
      hasSourceFile3: context.hasSourceFile3 === true,
    });
  return {
    at: Date.now(),
    apiAvailable: available,
    hasCorporation,
    canCreateSeed,
    canCreateSelf,
    gate,
    corp,
    constants,
    divisions,
    offices,
    warehouses,
    warehouseInfo,
    unlocks,
    unlockCosts,
    industryData,
    wallet: finite(context.wallet ?? safe('getPlayer.money', () => api.getPlayer?.().money, 0)),
    playerReserve: finite(context.playerReserve),
    cycleSeconds: Math.max(1, finite(constants.secondsPerMarketCycle, DEFAULT_CYCLE_SECONDS)),
    errors,
  };
}

/** Division that owns `industry`, else null (adopts a hand-made division, spec G5). */
export function divisionForIndustry(snapshot, industry) {
  return snapshot.divisions.find((division) => division.industry === industry) || null;
}

/** Stable division name for an industry from the configured chain, e.g. "Agriculture" → "Agri". */
export function divisionNameForIndustry(industry, existing = []) {
  const match = existing.find((name) => name.toLowerCase() === String(industry).toLowerCase());
  if (match) return match;
  const short = { Agriculture: 'Agri', Chemical: 'Chem', Tobacco: 'Tobacco', Restaurant: 'Dining', Software: 'Software', 'Computer Hardware': 'Hardware', Pharmaceutical: 'Pharma', Robotics: 'Robotics', Mining: 'Mining', Refinery: 'Refinery', 'Water Utilities': 'Water', Fishing: 'Fishing', Healthcare: 'Healthcare', 'Real Estate': 'RealEstate' };
  return short[industry] || String(industry).replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'Corp';
}

/**
 * Creation plan: seed money first when configured and eligible, otherwise
 * self-funding with the $150b wallet + player reserve guard (spec §6.1, edge 2).
 */
export function creationPlan(snapshot, config) {
  const name = config?.corporation?.name || 'Apex Holdings';
  const wallet = finite(snapshot?.wallet);
  const hold = Math.max(0, finite(snapshot?.playerReserve));
  const seedEligible = snapshot?.canCreateSeed === 'Success';
  const selfEligible = snapshot?.canCreateSelf === 'Success';
  const selfGap = Math.max(0, SELF_FUND_COST + hold - wallet);
  const reasons = [];
  if (config?.corporation?.seedFirst !== false && seedEligible) {
    return { action: 'create', mode: 'seed', label: `Create corporation ${name} with seed money`, cost: 0, blockedBy: null, gap: 0, name };
  }
  if (config?.corporation?.seedFirst !== false && !seedEligible) reasons.push(`seed: ${String(snapshot?.canCreateSeed)}`);
  if (config?.corporation?.selfFund !== false && selfEligible && selfGap <= 0) {
    return { action: 'create', mode: 'self', label: `Create corporation ${name} with ${SELF_FUND_COST / 1e9}b self-funding`, cost: SELF_FUND_COST, blockedBy: null, gap: 0, name };
  }
  if (config?.corporation?.selfFund !== false) {
    reasons.push(selfEligible ? `self-fund: wallet gap $${Math.round(selfGap)}` : `self-fund: ${String(snapshot?.canCreateSelf)}`);
  }
  const blockedBy = selfEligible && selfGap > 0 ? 'funds' : 'eligibility';
  return { action: 'wait', mode: null, label: `Wait for corporation creation (${reasons.join('; ')})`, cost: 0, blockedBy, gap: selfGap, name, reasons };
}

const decision = (fields) => ({ state: 'ready', cost: 0, detail: '', ...fields });

/**
 * Ordered bootstrap decisions for the current snapshot.
 * Returns `{state, terminal, reason, reserve, decisions, blockedBy, progress}`.
 */
export function bootstrapDecisions(snapshot, config, options = {}) {
  const gate = snapshot.gate || corporationGate({ apiAvailable: snapshot.apiAvailable, hasCorporation: snapshot.hasCorporation, canCreateSeed: snapshot.canCreateSeed, canCreateSelf: snapshot.canCreateSelf });
  const base = { state: gate.state, terminal: false, reason: gate.reason, decisions: [], blockedBy: [], reserve: 0, free: 0, funds: 0, progress: null };
  if (gate.state === 'UNAVAILABLE') {
    return { ...base, terminal: true, blockedBy: [{ code: gate.code, detail: gate.reason, gap: 0 }] };
  }
  if (!snapshot.hasCorporation) {
    const creation = creationPlan(snapshot, config);
    if (creation.action === 'create') {
      return {
        ...base,
        decisions: [decision({ id: 'bootstrap.create', kind: 'create', label: creation.label, priority: 100, cost: creation.cost, mode: creation.mode, division: creation.name })],
      };
    }
    return { ...base, blockedBy: [{ code: `bootstrap.${creation.blockedBy}`, detail: creation.label, gap: creation.gap }] };
  }

  const corp = snapshot.corp || {};
  const funds = finite(corp.funds);
  const reserve = finite(options.reserve, operatingReserve({ funds, expenses: finite(corp.expenses) }, config, snapshot.cycleSeconds));
  const free = Math.max(0, funds - reserve);
  const decisions = [];
  const blockedBy = [];
  const chain = config?.bootstrap?.industryChain || [];
  const initialOfficeSize = Math.max(1, finite(config?.bootstrap?.initialOfficeSize, 9));
  const setupReserve = finite(config?.bootstrap?.setupReserve, 20e6);
  const constants = snapshot.constants || {};
  const packageCost = cityPackageCost(snapshot, config);

  // 1. Unlocks, in order (spec §3.4). The budget is consumed in order so one tick can buy the
  // whole set when it is affordable; the executor re-checks live funds before each purchase.
  let remaining = free;
  for (const [index, unlock] of CORE_UNLOCKS.entries()) {
    if (snapshot.unlocks[unlock] === true) continue;
    const cost = finite(snapshot.unlockCosts[unlock], NaN);
    const affordable = Number.isFinite(cost) && cost > 0 && cost <= remaining;
    if (affordable) remaining -= cost;
    decisions.push(
      decision({
        id: `bootstrap.unlock:${unlock}`,
        kind: 'unlock',
        unlock,
        label: `Buy ${unlock}`,
        priority: 90 - index,
        cost: affordable ? cost : 0,
        state: affordable ? 'ready' : 'blocked',
        detail: !Number.isFinite(cost) || cost <= 0 ? 'cost unavailable' : affordable ? '' : `needs $${Math.round(cost)} (free $${Math.round(remaining)})`,
      }),
    );
    if (!affordable) blockedBy.push({ code: 'bootstrap.unlockFunds', detail: `${unlock} costs $${Math.round(Number.isFinite(cost) ? cost : 0)}`, gap: Math.max(0, (Number.isFinite(cost) ? cost : 0) - remaining) });
  }

  // 2. First division from the configured industry chain (edge 5).
  const firstIndustry = chain[0];
  const firstDivision = firstIndustry ? divisionForIndustry(snapshot, firstIndustry) : null;
  if (!snapshot.divisions.length && firstIndustry) {
    const data = snapshot.industryData[firstIndustry] || {};
    const start = finite(data.startingCost, NaN);
    const affordable = Number.isFinite(start) && start > 0 && free > start + setupReserve;
    const name = divisionNameForIndustry(firstIndustry);
    decisions.push(
      decision({
        id: `bootstrap.industry:${firstIndustry}`,
        kind: 'industry',
        industry: firstIndustry,
        division: name,
        label: `Create ${firstIndustry} division ${name}`,
        priority: 80,
        cost: affordable ? start : 0,
        state: affordable ? 'ready' : 'blocked',
        detail: affordable ? '' : `needs $${Math.round(Number.isFinite(start) ? start : 0)} + $${Math.round(setupReserve)} setup (free $${Math.round(free)})`,
      }),
    );
    if (!affordable) blockedBy.push({ code: 'bootstrap.industryFunds', detail: `${firstIndustry} division unaffordable`, gap: Math.max(0, (Number.isFinite(start) ? start : 0) + setupReserve - free) });
  } else if (!snapshot.divisions.length) {
    blockedBy.push({ code: 'bootstrap.noIndustryChain', detail: 'bootstrap.industryChain is empty' });
  }

  // 3. Warehouses for cities that already exist (never sell/buy stock without one, edge 13).
  const warehouseCost = finite(constants.warehouseInitialCost, DEFAULT_WAREHOUSE_COST);
  for (const division of snapshot.divisions) {
    if (snapshot.unlocks['Warehouse API'] !== true) break;
    for (const city of division.cities) {
      if (snapshot.warehouses[`${division.name}/${city}`]) continue;
      const affordable = warehouseCost <= free;
      decisions.push(
        decision({
          id: `bootstrap.warehouse:${division.name}/${city}`,
          kind: 'warehouse',
          division: division.name,
          city,
          label: `Purchase warehouse ${division.name}/${city}`,
          priority: 95,
          cost: affordable ? warehouseCost : 0,
          state: affordable ? 'ready' : 'blocked',
          detail: affordable ? '' : `needs $${Math.round(warehouseCost)} (free $${Math.round(free)})`,
        }),
      );
      if (!affordable) blockedBy.push({ code: 'bootstrap.warehouseFunds', detail: `${division.name}/${city} warehouse unaffordable`, gap: Math.max(0, warehouseCost - free) });
    }
  }

  // 4. First city for a division that has none (edge 6).
  for (const division of snapshot.divisions) {
    if (division.cities.length) continue;
    const city = (config?.bootstrap?.cities || CITY_NAMES)[0];
    if (!city) continue;
    const affordable = snapshot.unlocks['Warehouse API'] === true && free > packageCost.total;
    decisions.push(
      decision({
        id: `bootstrap.city:${division.name}/${city}`,
        kind: 'city',
        division: division.name,
        city,
        label: `Expand ${division.name} to ${city} ($${(packageCost.total / 1e9).toFixed(2)}b package)`,
        priority: 85,
        cost: affordable ? packageCost.total : 0,
        state: affordable ? 'ready' : 'blocked',
        detail: affordable ? '' : snapshot.unlocks['Warehouse API'] !== true ? 'Warehouse API required' : `needs $${Math.round(packageCost.total)} (free $${Math.round(free)})`,
      }),
    );
    if (!affordable) blockedBy.push({ code: 'bootstrap.cityFunds', detail: `${division.name}/${city} package unaffordable`, gap: Math.max(0, packageCost.total - free) });
  }

  // 5. Grow the seed office to `initialOfficeSize`, then staff it (edges 8, 9).
  const officeApi = snapshot.unlocks['Office API'] === true;
  if (officeApi) {
    for (const division of snapshot.divisions) {
      for (const city of division.cities) {
        const key = `${division.name}/${city}`;
        if (!snapshot.warehouses[key]) continue;
        const office = snapshot.offices[key];
        if (!office) continue;
        const target = Math.min(initialOfficeSize, Math.max(office.size, 1));
        if (office.size < initialOfficeSize) {
          const add = Math.min(3, initialOfficeSize - office.size);
          // The increment price is quoted on execution (getOfficeSizeUpgradeCost) so the snapshot
          // does not pay one read per office per tick.
          decisions.push(
            decision({
              id: `bootstrap.office:${key}`,
              kind: 'office',
              division: division.name,
              city,
              add,
              target: initialOfficeSize,
              label: `Grow office ${key} to ${office.size + add} seats`,
              priority: 75,
              detail: 'cost quoted on execution',
            }),
          );
        }
        const wanted = Math.min(office.size, target);
        if (office.numEmployees < wanted) {
          decisions.push(
            decision({
              id: `bootstrap.hire:${key}`,
              kind: 'hire',
              division: division.name,
              city,
              target: wanted,
              label: `Hire ${wanted - office.numEmployees} employees at ${key}`,
              priority: 70,
            }),
          );
        }
        if (snapshot.unlocks['Warehouse API'] === true) {
          decisions.push(
            decision({
              id: `bootstrap.materials:${key}`,
              kind: 'materials',
              division: division.name,
              city,
              label: `Seed input materials ${key}`,
              priority: 60,
            }),
          );
        }
      }
    }
  }

  return {
    state: 'BOOTSTRAP',
    terminal: false,
    reason: 'Corporation exists',
    reserve,
    free,
    funds,
    decisions,
    blockedBy,
    progress: bootstrapProgress(snapshot, config, { initialOfficeSize }),
  };
}

/** Structural completion checks; the controller uses this to leave `BOOTSTRAP` (spec §5.2). */
export function bootstrapProgress(snapshot, config, options = {}) {
  const chain = config?.bootstrap?.industryChain || [];
  const initialOfficeSize = Math.max(1, finite(options.initialOfficeSize, config?.bootstrap?.initialOfficeSize ?? 9));
  const core = chain[0] ? divisionForIndustry(snapshot, chain[0]) : null;
  const coreCities = core ? core.cities : [];
  const coreWarehoused = coreCities.filter((city) => snapshot.warehouses[`${core.name}/${city}`] === true);
  const coreStaffed = coreCities.map((city) => snapshot.offices[`${core.name}/${city}`] || { size: 0, numEmployees: 0 });
  const checks = [
    { name: 'corporation', ok: snapshot.hasCorporation === true, detail: snapshot.corp?.name || 'none' },
    { name: 'unlocks', ok: snapshot.unlocks['Warehouse API'] === true && snapshot.unlocks['Office API'] === true, detail: CORE_UNLOCKS.filter((u) => snapshot.unlocks[u] === true).join(', ') || 'none' },
    { name: 'coreDivision', ok: !!core, detail: core ? `${core.name} (${core.industry})` : 'missing' },
    { name: 'city', ok: coreCities.length > 0, detail: coreCities.join(', ') || 'none' },
    { name: 'warehouse', ok: coreCities.length > 0 && coreWarehoused.length === coreCities.length, detail: `${coreWarehoused.length}/${coreCities.length}` },
    {
      name: 'staff',
      ok: coreCities.length > 0 && coreStaffed.every((office) => office.size >= initialOfficeSize && office.numEmployees >= initialOfficeSize),
      detail: coreStaffed.map((office) => `${office.numEmployees}/${office.size}`).join(' ') || 'none',
    },
  ];
  return { complete: checks.every((check) => check.ok), checks };
}

/**
 * Pure material seeding plan. `quotes` are `{name, marketPrice, buyAmount, coefficient}`.
 * With Smart Supply owned and enabled the plan is empty: the game buys inputs itself.
 */
export function materialSeedPlan(quotes, { free = 0, cashFraction = 0.05, cycleSeconds = DEFAULT_CYCLE_SECONDS, smartSupplyEnabled = false } = {}) {
  if (smartSupplyEnabled) return { orders: [], cost: 0, budget: 0, reason: 'smart supply enabled' };
  const list = (Array.isArray(quotes) ? quotes : []).filter(
    (quote) => quote && typeof quote.name === 'string' && finite(quote.coefficient) > 0 && finite(quote.marketPrice) > 0,
  );
  if (!list.length) return { orders: [], cost: 0, budget: 0, reason: 'no priced inputs' };
  const budget = Math.max(0, finite(free) * Math.min(1, Math.max(0, finite(cashFraction, 0.05))));
  const wanted = list.map((quote) => {
    const coefficient = finite(quote.coefficient);
    // Enough input for one unit of output per second; `buyMaterial` rates are units per second.
    const rate = Math.max(0.05, coefficient * Math.max(1, finite(cycleSeconds, DEFAULT_CYCLE_SECONDS)) * 0.5);
    return { name: quote.name, rate, price: finite(quote.marketPrice), current: finite(quote.buyAmount), perCycle: rate * finite(quote.marketPrice) * Math.max(1, finite(cycleSeconds, DEFAULT_CYCLE_SECONDS)) };
  });
  const totalPerCycle = wanted.reduce((sum, order) => sum + order.perCycle, 0);
  const scale = totalPerCycle > 0 ? Math.max(0, Math.min(1, budget / totalPerCycle)) : 0;
  const orders = wanted
    .filter((order) => order.current < order.rate * scale - 1e-9)
    .map((order) => ({ name: order.name, rate: order.rate * scale, current: order.current, cost: order.perCycle * scale }));
  return { orders, cost: orders.reduce((sum, order) => sum + order.cost, 0), budget, reason: scale < 1 ? 'budget scaled' : '' };
}

/**
 * Execute the bootstrap plan. Returns a report:
 * `{state, terminal, reason, actions, errors, blockedBy, funds, reserve, progress, dryRun}`.
 * Mutations are skipped in dry-run mode and recorded as `dry-run` actions.
 */
export function runBootstrap(api, config, options = {}) {
  const dryRun = options.dryRun === true || config?.dryRun === true;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const now = finite(options.now, Date.now());
  const actions = [];
  const errors = [];
  const attempt = (label, fn, detail = '') => {
    try {
      const result = fn();
      actions.push({ label, state: result === false ? 'skipped' : 'done', detail: typeof result === 'string' ? result : detail, at: now });
      return result !== false;
    } catch (error) {
      actions.push({ label, state: 'failed', detail: text(error), at: now });
      push(errors, label, error);
      return false;
    }
  };
  const record = (label, state, detail = '') => actions.push({ label, state, detail, at: now });

  let snapshot = readBootstrapSnapshot(api, config, options.context || {});
  errors.push(...snapshot.errors);
  const plan = bootstrapDecisions(snapshot, config, { reserve: options.reserve });
  if (plan.terminal) {
    log('warn', plan.reason, { code: plan.blockedBy[0]?.code });
    return { state: plan.state, terminal: true, reason: plan.reason, actions, errors, blockedBy: plan.blockedBy, funds: snapshot.corp?.funds ?? 0, reserve: plan.reserve, dryRun, progress: plan.progress };
  }

  // A corporation that does not exist yet can only run the creation decision.
  let live = snapshot;
  const refresh = () => {
    live = readBootstrapSnapshot(api, config, options.context || {});
    if (live.errors.length) errors.push(...live.errors);
    return live;
  };
  const ordered = plan.decisions.filter((item) => item.state === 'ready').sort((a, b) => b.priority - a.priority);
  const budget = Math.max(1, finite(options.maxActions, 12));
  let executed = 0;
  for (const item of ordered) {
    if (executed >= budget) {
      record(item.label, 'deferred', 'action budget reached');
      continue;
    }
    if (item.kind === 'create') {
      if (dryRun) {
        record(item.label, 'dry-run', `${item.mode} funding`);
        continue;
      }
      executed++;
      const created = attempt(item.label, () => {
        if (api.hasCorporation() === true) return 'already exists';
        if (item.mode === 'self') {
          const wallet = finite(options.wallet ?? snapshot.wallet);
          const hold = Math.max(0, finite(options.playerReserve ?? snapshot.playerReserve));
          if (wallet < SELF_FUND_COST + hold) throw new Error(`self-funding needs $${SELF_FUND_COST} + $${hold} reserved; wallet has $${Math.round(wallet)}`);
          if (api.canCreateCorporation(true) !== 'Success') throw new Error(`self-funding refused: ${String(api.canCreateCorporation(true))}`);
        } else if (api.canCreateCorporation(false) !== 'Success') {
          throw new Error(`seed funding refused: ${String(api.canCreateCorporation(false))}`);
        }
        api.createCorporation(config?.corporation?.name || 'Apex Holdings', item.mode === 'self');
        if (api.hasCorporation() !== true) throw new Error('createCorporation did not take effect');
        return item.mode === 'self' ? 'self-funded' : 'seed funded';
      });
      log(created ? 'info' : 'error', `${item.label} → ${actions[actions.length - 1].detail}`);
      if (!created) break; // everything else depends on the corporation existing
      // Re-run the planner on the corporation that now exists so unlocks/industry/city happen
      // in the same tick instead of one state per tick.
      const followUp = runBootstrap(api, config, { ...options, allowCreate: false });
      actions.push(...followUp.actions);
      errors.push(...followUp.errors);
      return {
        ...followUp,
        actions,
        errors,
        blockedBy: [...plan.blockedBy, ...(followUp.blockedBy || [])],
        dryRun,
      };
    }

    // Re-read the value this decision changes before spending anything.
    const fresh = live;
    if (!fresh.hasCorporation) {
      record(item.label, 'blocked', 'corporation disappeared');
      break;
    }
    const funds = finite(fresh.corp?.funds);
    const reserve = finite(options.reserve, operatingReserve({ funds, expenses: finite(fresh.corp?.expenses) }, config, fresh.cycleSeconds));
    const free = Math.max(0, funds - reserve);
    const guard = (cost, label = item.label) => {
      if (!Number.isFinite(cost) || cost < 0) {
        record(label, 'skipped', 'cost unavailable');
        return false;
      }
      if (funds <= reserve + cost) {
        record(label, 'blocked', `needs $${Math.round(cost)} above a $${Math.round(reserve)} reserve (funds $${Math.round(funds)})`);
        return false;
      }
      return true;
    };

    if (item.kind === 'unlock') {
      const owned = fresh.unlocks[item.unlock] === true;
      if (owned) {
        record(item.label, 'skipped', 'already owned');
        continue;
      }
      const cost = finite(fresh.unlockCosts[item.unlock], NaN);
      if (!guard(cost)) continue;
      if (dryRun) {
        record(item.label, 'dry-run', `cost $${Math.round(cost)}`);
        continue;
      }
      executed++;
      attempt(item.label, () => {
        api.purchaseUnlock(item.unlock);
        if (api.hasUnlock(item.unlock) !== true) throw new Error('unlock not registered after purchase');
        return `cost $${Math.round(cost)}`;
      });
      refresh();
      continue;
    }

    if (item.kind === 'industry') {
      const existing = fresh.divisions.find((division) => division.industry === item.industry);
      if (existing) {
        record(item.label, 'skipped', `adopted existing division ${existing.name}`);
        continue;
      }
      const start = finite(fresh.industryData[item.industry]?.startingCost, NaN);
      const setup = finite(config?.bootstrap?.setupReserve, 20e6);
      if (!guard(start + setup)) continue;
      if (dryRun) {
        record(item.label, 'dry-run', `cost $${Math.round(start)} + $${Math.round(setup)} setup`);
        continue;
      }
      executed++;
      attempt(item.label, () => {
        api.expandIndustry(item.industry, item.division);
        const created = fresh.divisions.some((division) => division.industry === item.industry) || api.getDivision(item.division)?.industry === item.industry;
        if (!created) throw new Error(`expandIndustry(${item.industry}) did not create ${item.division}`);
        return `cost $${Math.round(start)}`;
      });
      refresh();
      continue;
    }

    if (item.kind === 'warehouse') {
      if (fresh.warehouses[`${item.division}/${item.city}`]) {
        record(item.label, 'skipped', 'warehouse already owned');
        continue;
      }
      const cost = finite(fresh.constants.warehouseInitialCost, DEFAULT_WAREHOUSE_COST);
      if (!guard(cost)) continue;
      if (dryRun) {
        record(item.label, 'dry-run', `cost $${Math.round(cost)}`);
        continue;
      }
      executed++;
      attempt(item.label, () => {
        api.purchaseWarehouse(item.division, item.city);
        if (api.hasWarehouse(item.division, item.city) !== true) throw new Error('warehouse not registered after purchase');
        return `cost $${Math.round(cost)}`;
      });
      refresh();
      continue;
    }

    if (item.kind === 'city') {
      const division = fresh.divisions.find((entry) => entry.name === item.division);
      if (!division) {
        record(item.label, 'blocked', `division ${item.division} missing`);
        continue;
      }
      if (division.cities.includes(item.city)) {
        record(item.label, 'skipped', 'city already owned');
        continue;
      }
      if (fresh.unlocks['Warehouse API'] !== true) {
        record(item.label, 'blocked', 'Warehouse API required');
        continue;
      }
      const cost = cityPackageCost(fresh, config);
      // A city without a warehouse cannot hold stock; require both purchases up front (edge 7).
      if (!guard(cost.total)) continue;
      if (dryRun) {
        record(item.label, 'dry-run', `cost $${Math.round(cost.total)}`);
        continue;
      }
      executed++;
      attempt(item.label, () => {
        api.expandCity(item.division, item.city);
        if (api.hasWarehouse(item.division, item.city) !== true) api.purchaseWarehouse(item.division, item.city);
        if (api.hasWarehouse(item.division, item.city) !== true) throw new Error('city expanded without a warehouse');
        return `cost $${Math.round(cost.total)}`;
      });
      refresh();
      continue;
    }

    if (item.kind === 'office') {
      const office = fresh.offices[`${item.division}/${item.city}`];
      if (!office) {
        record(item.label, 'blocked', 'office missing');
        continue;
      }
      if (office.size >= (item.target || office.size + item.add)) {
        record(item.label, 'skipped', `office already ${office.size} seats`);
        continue;
      }
      const add = Math.max(1, Math.min(item.add, (item.target || office.size + item.add) - office.size));
      let cost;
      try {
        cost = api.getOfficeSizeUpgradeCost(item.division, item.city, add);
      } catch (error) {
        record(item.label, 'failed', text(error));
        push(errors, item.label, error);
        continue;
      }
      if (!guard(finite(cost, NaN))) continue;
      if (dryRun) {
        record(item.label, 'dry-run', `+${add} seats for $${Math.round(cost)}`);
        continue;
      }
      executed++;
      attempt(item.label, () => {
        api.upgradeOfficeSize(item.division, item.city, add);
        return `+${add} seats for $${Math.round(cost)}`;
      });
      refresh();
      continue;
    }

    if (item.kind === 'hire') {
      const office = fresh.offices[`${item.division}/${item.city}`];
      if (!office) {
        record(item.label, 'blocked', 'office missing');
        continue;
      }
      const target = Math.min(finite(item.target, office.size), Math.max(0, office.size));
      if (office.numEmployees >= target) {
        record(item.label, 'skipped', `staffed ${office.numEmployees}/${office.size}`);
        continue;
      }
      if (dryRun) {
        record(item.label, 'dry-run', `hire ${target - office.numEmployees}`);
        continue;
      }
      executed++;
      let hired = 0;
      let failure = null;
      for (let remaining = target - office.numEmployees; remaining > 0; remaining--) {
        try {
          api.hireEmployee(item.division, item.city);
          hired++;
        } catch (error) {
          failure = error;
          break;
        }
      }
      if (hired > 0) record(item.label, 'done', `hired ${hired}`);
      else if (failure) {
        record(item.label, 'failed', text(failure));
        push(errors, item.label, failure);
      } else record(item.label, 'skipped', 'hireEmployee rejected');
      refresh();
      continue;
    }

    if (item.kind === 'materials') {
      const result = seedMaterials(api, fresh, item.division, item.city, config, { reserve, dryRun, context: options.context || {}, now });
      for (const action of result.actions) actions.push({ ...action, at: now });
      errors.push(...result.errors);
      if (result.executed) {
        executed++;
        refresh();
      }
      continue;
    }
  }

  const final = readBootstrapSnapshot(api, config, options.context || {});
  errors.push(...final.errors);
  const progress = bootstrapProgress(final, config, {});
  for (const check of progress.checks) if (!check.ok) log('info', `bootstrap pending: ${check.name} (${check.detail})`);
  return {
    state: !final.hasCorporation ? 'NO_CORP' : progress.complete ? 'READY' : 'BOOTSTRAP',
    terminal: false,
    reason: !final.hasCorporation ? 'No corporation yet' : progress.complete ? 'bootstrap complete' : 'bootstrap in progress',
    actions,
    errors,
    blockedBy: plan.blockedBy,
    funds: finite(final.corp?.funds),
    reserve: finite(options.reserve, operatingReserve({ funds: finite(final.corp?.funds), expenses: finite(final.corp?.expenses) }, config, final.cycleSeconds)),
    progress,
    dryRun,
  };
}

/**
 * Seed input materials for one division/city: enable Smart Supply when owned,
 * otherwise set bounded `buyMaterial` rates. Idempotent: an existing rate that
 * already matches is left alone.
 */
export function seedMaterials(api, snapshot, division, city, config, { reserve = 0, dryRun = false, context = {} } = {}) {
  const actions = [];
  const errors = [];
  const key = `${division}/${city}`;
  const info = snapshot.divisions.find((entry) => entry.name === division);
  if (!info) return { actions, errors, executed: false };
  if (snapshot.warehouses[key] !== true) return { actions: [{ label: `Seed materials ${key}`, state: 'blocked', detail: 'no warehouse' }], errors, executed: false };
  const warehouse = snapshot.warehouseInfo[key] || {};
  const wantsSmartSupply = snapshot.unlocks['Smart Supply'] === true && warehouse.smartSupplyEnabled !== true;
  if (wantsSmartSupply) {
    if (dryRun) return { actions: [{ label: `Enable Smart Supply ${key}`, state: 'dry-run', detail: '' }], errors, executed: false };
    try {
      api.setSmartSupply(division, city, true);
      return { actions: [{ label: `Enable Smart Supply ${key}`, state: 'done', detail: '' }], errors, executed: true };
    } catch (error) {
      errors.push({ operation: `setSmartSupply(${key})`, message: text(error) });
      // Fall through to manual rates: Smart Supply is an optimisation, not a precondition.
    }
  }
  if (snapshot.unlocks['Smart Supply'] === true && warehouse.smartSupplyEnabled === true) {
    return { actions: [{ label: `Seed materials ${key}`, state: 'skipped', detail: 'smart supply enabled' }], errors, executed: false };
  }
  const industry = snapshot.industryData[info.industry] || {};
  const required = industry.requiredMaterials || {};
  const quotes = [];
  for (const [name, coefficient] of Object.entries(required)) {
    try {
      const material = api.getMaterial(division, city, name);
      quotes.push({ name, coefficient: finite(coefficient), marketPrice: finite(material?.marketPrice), buyAmount: finite(material?.buyAmount) });
    } catch (error) {
      errors.push({ operation: `getMaterial(${key}, ${name})`, message: text(error) });
    }
  }
  const funds = finite(snapshot.corp?.funds);
  const plan = materialSeedPlan(quotes, {
    free: Math.max(0, funds - reserve),
    cashFraction: config?.bootstrap?.materialCashFraction ?? 0.05,
    cycleSeconds: snapshot.cycleSeconds,
  });
  if (!plan.orders.length) {
    actions.push({ label: `Seed materials ${key}`, state: 'skipped', detail: plan.reason || 'already stocked' });
    return { actions, errors, executed: false };
  }
  if (dryRun) {
    actions.push({ label: `Seed materials ${key}`, state: 'dry-run', detail: plan.orders.map((order) => `${order.name}@${order.rate.toFixed(2)}/s`).join(' ') });
    return { actions, errors, executed: false };
  }
  let applied = 0;
  for (const order of plan.orders) {
    try {
      api.buyMaterial(division, city, order.name, order.rate);
      applied++;
    } catch (error) {
      errors.push({ operation: `buyMaterial(${key}, ${order.name})`, message: text(error) });
    }
  }
  actions.push({ label: `Seed materials ${key}`, state: applied > 0 ? 'done' : 'failed', detail: `${applied}/${plan.orders.length} rates ($${Math.round(plan.cost)}/cycle)` });
  return { actions, errors, executed: applied > 0 };
}
