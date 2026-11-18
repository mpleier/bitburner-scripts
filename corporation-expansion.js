/**
 * Corporation expansion (spec §6.1): cities, warehouses and industries.
 *
 * Guard order matters and is enforced here, not only in the controller:
 *   1. a city only opens when every owned city of that division already has a
 *      warehouse and every existing office is fully staffed (never buy an empty
 *      city while staff are missing),
 *   2. a warehouse is bought before anything tries to store or sell stock in
 *      that city (spec edge 13),
 *   3. an industry is only created when free cash covers its starting cost plus
 *      the configured setup reserve, and the core division is not still
 *      unstaffed (spec edge 5),
 *   4. a rejected industry expansion (division cap) is retried after
 *      `DIVISION_RETRY_MS`, never in the same tick (spec edge 19).
 *
 * Pure planning + injected effects, same contract as `corporation-bootstrap.js`.
 */

import { CITY_NAMES } from './corporation-config.js';
import {
  DEFAULT_WAREHOUSE_COST,
  DIVISION_RETRY_MS,
  bootstrapProgress,
  cityPackageCost,
  divisionNameForIndustry,
  operatingReserve,
  readBootstrapSnapshot,
} from './corporation-bootstrap.js';

/** Warehouse levels above this are only bought while the warehouse is nearly full. */
export const WAREHOUSE_SOFT_MAX_LEVEL = 5;
/** Storage pressure that allows an upgrade past the soft cap. */
export const WAREHOUSE_HARD_PRESSURE = 0.95;
/** A staged package registers cheaper alternatives only when the gap exceeds this multiple of the bank. */
export const STAGED_GAP_MULTIPLE = 2;

const finite = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const text = (error) => String(error?.message || error).slice(0, 240);

const decision = (fields) => ({ state: 'ready', cost: 0, priority: 0, detail: '', ...fields });

/** Per-division snapshot helpers. */
export function divisionCities(division) {
  return Array.isArray(division?.cities) ? division.cities : [];
}

export function ownedCitiesWithWarehouse(snapshot, division) {
  return divisionCities(division).filter((city) => snapshot.warehouses[`${division.name}/${city}`] === true);
}

/** True when every owned city of the division has a warehouse and an office. */
export function divisionComplete(snapshot, division) {
  const cities = divisionCities(division);
  return cities.length > 0 && cities.every((city) => snapshot.warehouses[`${division.name}/${city}`] === true && !!snapshot.offices[`${division.name}/${city}`]);
}

/**
 * True when every office of the division is at the configured minimum size and fully
 * staffed. Offices cannot be staffed without the Office API, so that case is exempt
 * (spec edge 9: expansion stays allowed).
 */
export function divisionStaffed(snapshot, division, minSize = 9) {
  if (snapshot.unlocks?.['Office API'] !== true) return true;
  const target = Math.max(1, finite(minSize, 9));
  return divisionCities(division).every((city) => {
    const office = snapshot.offices[`${division.name}/${city}`];
    return !!office && office.size >= target && office.numEmployees >= target;
  });
}

/** Next configured city that this division does not own, in config order. */
export function nextCity(division, config) {
  const cities = config?.bootstrap?.cities || CITY_NAMES;
  return cities.find((city) => !divisionCities(division).includes(city)) || null;
}

/**
 * Industries worth adding: the rest of the configured chain, plus (when
 * `expandAllIndustries`) any industry that produces a material an existing
 * division requires and no existing division produces. Cheapest first.
 */
export function industryCandidates(snapshot, config) {
  const used = new Set(snapshot.divisions.map((division) => division.industry));
  const chain = config?.bootstrap?.industryChain || [];
  const candidates = [];
  for (const [index, industry] of chain.entries()) {
    if (index === 0 || used.has(industry)) continue;
    const data = snapshot.industryData[industry] || {};
    candidates.push({
      industry,
      division: divisionNameForIndustry(industry),
      startingCost: finite(data.startingCost, NaN),
      makesProducts: data.makesProducts === true,
      chain: true,
      order: index,
    });
  }
  if (config?.bootstrap?.expandAllIndustries === true) {
    const required = new Set();
    const produced = new Set();
    for (const division of snapshot.divisions) {
      const data = snapshot.industryData[division.industry] || {};
      for (const material of Object.keys(data.requiredMaterials || {})) required.add(material);
      for (const material of data.producedMaterials || []) produced.add(material);
    }
    for (const [industry, data] of Object.entries(snapshot.industryData || {})) {
      if (used.has(industry)) continue;
      const fills = (data.producedMaterials || []).some((material) => required.has(material) && !produced.has(material));
      if (!fills) continue;
      candidates.push({
        industry,
        division: divisionNameForIndustry(industry),
        startingCost: finite(data.startingCost, NaN),
        makesProducts: data.makesProducts === true,
        chain: false,
        order: 100 + finite(data.startingCost, 0),
      });
    }
  }
  return candidates.sort((a, b) => a.order - b.order || a.startingCost - b.startingCost);
}

/**
 * Expansion decisions for the current snapshot.
 * Returns `{state, decisions, staged, blockedBy, reserve, free, funds, progress}`.
 */
export function expansionDecisions(snapshot, config, options = {}) {
  const gate = snapshot.gate || { state: snapshot.hasCorporation ? 'READY' : 'NO_CORP', reason: '' };
  const base = { state: gate.state, decisions: [], staged: [], blockedBy: [], reserve: 0, free: 0, funds: 0, progress: null };
  if (gate.state === 'UNAVAILABLE') return { ...base, blockedBy: [{ code: gate.code, detail: gate.reason, gap: 0 }] };
  if (!snapshot.hasCorporation) return { ...base, blockedBy: [{ code: 'corporation.none', detail: 'No corporation', gap: 0 }] };

  const corp = snapshot.corp || {};
  const funds = finite(corp.funds);
  const reserve = finite(options.reserve, operatingReserve({ funds, expenses: finite(corp.expenses) }, config, snapshot.cycleSeconds));
  const free = Math.max(0, funds - reserve);
  const cycleSeconds = Math.max(1, finite(snapshot.cycleSeconds, 10));
  const profitPerSecond = finite(corp.revenue) - finite(corp.expenses);
  const decisions = [];
  const staged = [];
  const blockedBy = [];
  const progress = bootstrapProgress(snapshot, config, {});
  const bootstrapComplete = progress.complete;
  const setupReserve = finite(config?.bootstrap?.setupReserve, 20e6);
  const packageCost = cityPackageCost(snapshot, config);
  const warehouseCost = finite(snapshot.constants.warehouseInitialCost, DEFAULT_WAREHOUSE_COST);
  const threshold = finite(config?.bootstrap?.warehouseFullThreshold, 0.7);
  const now = finite(options.now, Date.now());
  const cooldowns = options.cooldowns || {};

  // 1. Warehouses for cities that already exist (highest priority: nothing can be stored without one).
  if (snapshot.unlocks['Warehouse API'] === true) {
    for (const division of snapshot.divisions) {
      for (const city of divisionCities(division)) {
        if (snapshot.warehouses[`${division.name}/${city}`] === true) continue;
        const affordable = warehouseCost <= free;
        decisions.push(
          decision({
            id: `expansion.warehouse:${division.name}/${city}`,
            kind: 'warehouse',
            division: division.name,
            city,
            label: `Purchase warehouse ${division.name}/${city}`,
            priority: 100,
            cost: affordable ? warehouseCost : 0,
            state: affordable ? 'ready' : 'blocked',
            detail: affordable ? '' : `needs $${Math.round(warehouseCost)} (free $${Math.round(free)})`,
          }),
        );
        if (!affordable) blockedBy.push({ code: 'expansion.warehouseFunds', detail: `${division.name}/${city} warehouse unaffordable`, gap: Math.max(0, warehouseCost - free) });
      }
    }
  }

  // 2. Industries: configured chain first, then gap fillers when enabled.
  const divisionCapCooldown = finite(cooldowns['expansion.industry'], 0);
  for (const candidate of industryCandidates(snapshot, config)) {
    const cooling = divisionCapCooldown > now;
    // Product industries are only launched on a staffed material foundation; a second empty
    // division otherwise competes with the first for the same setup cash.
    const foundationReady = candidate.makesProducts ? bootstrapComplete : snapshot.divisions.length === 0 || bootstrapComplete || free > (candidate.startingCost + setupReserve) * 2;
    const affordable = Number.isFinite(candidate.startingCost) && candidate.startingCost > 0 && free > candidate.startingCost + setupReserve;
    const state = cooling ? 'blocked' : affordable && foundationReady ? 'ready' : 'blocked';
    decisions.push(
      decision({
        id: `expansion.industry:${candidate.industry}`,
        kind: 'industry',
        industry: candidate.industry,
        division: candidate.division,
        label: `Create ${candidate.industry} division ${candidate.division}`,
        priority: 90 - Math.min(9, candidate.order),
        cost: state === 'ready' ? candidate.startingCost : 0,
        state,
        detail: cooling
          ? `division cap retry in ${Math.ceil((divisionCapCooldown - now) / 60000)}m`
          : !affordable
            ? `needs $${Math.round(candidate.startingCost)} + $${Math.round(setupReserve)} setup (free $${Math.round(free)})`
            : !foundationReady
              ? 'foundation not staffed yet'
              : '',
      }),
    );
    if (state === 'blocked' && !cooling) {
      blockedBy.push({
        code: affordable ? 'expansion.industryFoundation' : 'expansion.industryFunds',
        detail: `${candidate.industry} division not ready`,
        gap: affordable ? 0 : Math.max(0, candidate.startingCost + setupReserve - free),
      });
    }
  }

  // 3. City expansion, staged when unaffordable (spec edge 7).
  for (const division of snapshot.divisions) {
    const city = nextCity(division, config);
    if (!city) continue;
    const complete = divisionComplete(snapshot, division);
    const minStaff = Math.max(1, finite(config?.bootstrap?.initialOfficeSize, 9));
    const staffed = divisionStaffed(snapshot, division, minStaff);
    const affordable = free > packageCost.total;
    const ready = complete && staffed && affordable && snapshot.unlocks['Warehouse API'] === true;
    if (ready) {
      decisions.push(
        decision({
          id: `expansion.city:${division.name}/${city}`,
          kind: 'city',
          division: division.name,
          city,
          label: `Expand ${division.name} to ${city} ($${(packageCost.total / 1e9).toFixed(2)}b package)`,
          priority: 80,
          cost: packageCost.total,
        }),
      );
      continue;
    }
    const reason = !complete
      ? 'existing cities need warehouses'
      : !staffed
        ? 'existing offices are understaffed'
        : snapshot.unlocks['Warehouse API'] !== true
          ? 'Warehouse API required'
          : 'insufficient funds';
    const gap = Math.max(0, packageCost.total - free);
    const netProfitPerSecond = profitPerSecond > 0 ? profitPerSecond : 0;
    const quote = {
      division: division.name,
      city,
      cost: packageCost.total,
      gap,
      reason,
      etaSeconds: netProfitPerSecond > 0 ? Math.ceil(gap / netProfitPerSecond) : null,
      alternatives: [],
    };
    // Cheaper rungs are always quoted while the package is unaffordable, so a stalled expansion
    // still leaves the tick with work (spec §6.1, fixes G4). `longWait` marks a gap that needs
    // more than twice the cash currently free.
    quote.alternatives.push({ kind: 'office', label: `Grow office ${division.name}/${divisionCities(division)[0] || city}`, cost: null });
    quote.alternatives.push({ kind: 'storage', label: `Upgrade warehouse ${division.name}/${divisionCities(division)[0] || city}`, cost: null });
    quote.longWait = gap > STAGED_GAP_MULTIPLE * Math.max(1, free);
    staged.push(quote);
    blockedBy.push({ code: 'expansion.cityStaged', detail: `${division.name} → ${city}: ${reason}`, gap });
  }

  // 4. Warehouse upgrades under storage pressure (never per-city duplicated: one level per city per tick).
  for (const division of snapshot.divisions) {
    for (const city of divisionCities(division)) {
      const key = `${division.name}/${city}`;
      if (snapshot.warehouses[key] !== true) continue;
      const warehouse = snapshot.warehouseInfo[key] || {};
      const size = finite(warehouse.size);
      const used = finite(warehouse.sizeUsed);
      const pressure = size > 0 ? used / size : 0;
      if (pressure < threshold) continue;
      const level = finite(warehouse.level);
      if (level >= WAREHOUSE_SOFT_MAX_LEVEL && pressure < WAREHOUSE_HARD_PRESSURE) continue;
      if (division.lastCycleRevenue < division.lastCycleExpenses && pressure < WAREHOUSE_HARD_PRESSURE) continue; // do not buy storage for unsold stock
      decisions.push(
        decision({
          id: `expansion.warehouseUpgrade:${key}`,
          kind: 'warehouseUpgrade',
          division: division.name,
          city,
          label: `Upgrade warehouse ${key} (level ${level}, ${(pressure * 100).toFixed(0)}% full)`,
          priority: 20,
          detail: 'cost quoted on execution',
        }),
      );
    }
  }

  // 5. Division sale is opt-in and evidence-gated (spec edge 5 / §6.1).
  if (config?.bootstrap?.allowDivisionSale === true) {
    for (const division of snapshot.divisions) {
      if (divisionCities(division).length > 0) continue;
      const idleCycles = finite(options.telemetry?.[division.name]?.idleCycles);
      if (idleCycles < 1000) {
        blockedBy.push({ code: 'expansion.saleEvidence', detail: `${division.name} has no cities but only ${idleCycles} idle cycles`, gap: 0 });
        continue;
      }
      decisions.push(
        decision({
          id: `expansion.sale:${division.name}`,
          kind: 'sale',
          division: division.name,
          label: `Sell stranded division ${division.name}`,
          priority: 10,
        }),
      );
    }
  }

  return {
    state: 'EXPANDING',
    decisions,
    staged,
    blockedBy,
    reserve,
    free,
    funds,
    cycleSeconds,
    progress,
  };
}

/**
 * Execute expansion decisions against an injected api. Returns
 * `{state, actions, errors, blockedBy, quotes, cooldowns, funds, reserve, progress, dryRun}`.
 */
export function runExpansion(api, config, options = {}) {
  const dryRun = options.dryRun === true || config?.dryRun === true;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const now = finite(options.now, Date.now());
  const actions = [];
  const errors = [];
  const quotes = [];
  const cooldowns = { ...(options.cooldowns || {}) };
  const record = (label, state, detail = '') => actions.push({ label, state, detail, at: now });
  const fail = (label, error) => {
    record(label, 'failed', text(error));
    errors.push({ operation: label, message: text(error), at: now });
  };

  let live = readBootstrapSnapshot(api, config, options.context || {});
  errors.push(...live.errors);
  const plan = expansionDecisions(live, config, { reserve: options.reserve, cooldowns, now, telemetry: options.telemetry });
  if (!live.hasCorporation || live.gate?.state === 'UNAVAILABLE') {
    return { state: live.gate?.state || 'NO_CORP', actions, errors, blockedBy: plan.blockedBy, quotes, cooldowns, funds: 0, reserve: 0, progress: null, dryRun };
  }

  const ordered = plan.decisions.filter((item) => item.state === 'ready').sort((a, b) => b.priority - a.priority);
  // Publish decisions the planner already ruled out (funds, cooldown, foundation) so the
  // status document explains why nothing happened this tick (spec §9.3 expected/illegal).
  for (const item of plan.decisions) {
    if (item.state === 'blocked' && item.detail) record(item.label, 'blocked', item.detail);
  }
  let executed = 0;
  const budget = Math.max(1, finite(options.maxActions, 6));
  const refresh = () => {
    live = readBootstrapSnapshot(api, config, options.context || {});
    if (live.errors.length) errors.push(...live.errors);
    return live;
  };

  for (const item of ordered) {
    if (executed >= budget) {
      record(item.label, 'deferred', 'action budget reached');
      continue;
    }
    if (cooldowns[item.id] && cooldowns[item.id] > now) {
      record(item.label, 'blocked', `retry in ${Math.ceil((cooldowns[item.id] - now) / 60000)}m`);
      continue;
    }
    const funds = finite(live.corp?.funds);
    const reserve = finite(options.reserve, operatingReserve({ funds, expenses: finite(live.corp?.expenses) }, config, live.cycleSeconds));
    const affordable = (cost) => Number.isFinite(cost) && cost >= 0 && funds > reserve + cost;

    if (item.kind === 'warehouse') {
      if (live.warehouses[`${item.division}/${item.city}`] === true) {
        record(item.label, 'skipped', 'warehouse already owned');
        continue;
      }
      const cost = finite(live.constants.warehouseInitialCost, DEFAULT_WAREHOUSE_COST);
      if (!affordable(cost)) {
        record(item.label, 'blocked', `needs $${Math.round(cost)} above a $${Math.round(reserve)} reserve`);
        continue;
      }
      if (dryRun) {
        record(item.label, 'dry-run', `cost $${Math.round(cost)}`);
        continue;
      }
      executed++;
      try {
        api.purchaseWarehouse(item.division, item.city);
        if (api.hasWarehouse(item.division, item.city) !== true) throw new Error('warehouse not registered after purchase');
        record(item.label, 'done', `cost $${Math.round(cost)}`);
      } catch (error) {
        fail(item.label, error);
      }
      refresh();
      continue;
    }

    if (item.kind === 'industry') {
      const existing = live.divisions.find((division) => division.industry === item.industry);
      if (existing) {
        record(item.label, 'skipped', `industry already owned as ${existing.name}`);
        continue;
      }
      const start = finite(live.industryData[item.industry]?.startingCost, NaN);
      const setup = finite(config?.bootstrap?.setupReserve, 20e6);
      if (!affordable(start + setup)) {
        record(item.label, 'blocked', `needs $${Math.round(start + setup)} above a $${Math.round(reserve)} reserve`);
        continue;
      }
      if (dryRun) {
        record(item.label, 'dry-run', `cost $${Math.round(start)} + $${Math.round(setup)} setup`);
        continue;
      }
      executed++;
      try {
        api.expandIndustry(item.industry, item.division);
        record(item.label, 'done', `cost $${Math.round(start)}`);
      } catch (error) {
        // A division cap (or any rejection) is expected, not fatal: back off for five minutes (spec edge 19).
        const message = text(error);
        if (/cap|maximum|maximum number|limit|too many/i.test(message)) {
          cooldowns['expansion.industry'] = now + DIVISION_RETRY_MS;
          record(item.label, 'blocked', `division cap: ${message}; retry in 5m`);
        } else fail(item.label, error);
      }
      refresh();
      continue;
    }

    if (item.kind === 'city') {
      const division = live.divisions.find((entry) => entry.name === item.division);
      if (!division) {
        record(item.label, 'blocked', `division ${item.division} missing`);
        continue;
      }
      if (division.cities.includes(item.city)) {
        record(item.label, 'skipped', 'city already owned');
        continue;
      }
      if (!divisionComplete(live, division)) {
        record(item.label, 'blocked', 'existing cities need warehouses');
        continue;
      }
      if (!divisionStaffed(live, division)) {
        record(item.label, 'blocked', 'existing offices are understaffed');
        continue;
      }
      const cost = cityPackageCost(live, config);
      if (!affordable(cost.total)) {
        record(item.label, 'blocked', `needs $${Math.round(cost.total)} above a $${Math.round(reserve)} reserve`);
        continue;
      }
      if (dryRun) {
        record(item.label, 'dry-run', `cost $${Math.round(cost.total)}`);
        continue;
      }
      executed++;
      try {
        api.expandCity(item.division, item.city);
        if (api.hasWarehouse(item.division, item.city) !== true) api.purchaseWarehouse(item.division, item.city);
        if (api.hasWarehouse(item.division, item.city) !== true) throw new Error('city expanded without a warehouse');
        record(item.label, 'done', `cost $${Math.round(cost.total)}`);
      } catch (error) {
        fail(item.label, error);
      }
      refresh();
      continue;
    }

    if (item.kind === 'warehouseUpgrade') {
      const warehouse = live.warehouseInfo[`${item.division}/${item.city}`] || {};
      let cost;
      try {
        cost = api.getUpgradeWarehouseCost(item.division, item.city);
      } catch (error) {
        fail(item.label, error);
        continue;
      }
      if (!affordable(finite(cost, NaN))) {
        record(item.label, 'blocked', `needs $${Math.round(finite(cost))} above a $${Math.round(reserve)} reserve`);
        continue;
      }
      if (dryRun) {
        record(item.label, 'dry-run', `level ${finite(warehouse.level)} → ${finite(warehouse.level) + 1} for $${Math.round(cost)}`);
        continue;
      }
      executed++;
      try {
        api.upgradeWarehouse(item.division, item.city);
        record(item.label, 'done', `level ${finite(warehouse.level)} → ${finite(warehouse.level) + 1} for $${Math.round(cost)}`);
      } catch (error) {
        fail(item.label, error);
      }
      refresh();
      continue;
    }

    if (item.kind === 'sale') {
      if (config?.bootstrap?.allowDivisionSale !== true) {
        record(item.label, 'blocked', 'allowDivisionSale is false');
        continue;
      }
      if (dryRun) {
        record(item.label, 'dry-run', 'sellDivision');
        continue;
      }
      executed++;
      try {
        api.sellDivision(item.division);
        record(item.label, 'done', 'sold');
      } catch (error) {
        fail(item.label, error);
      }
      refresh();
      continue;
    }
  }

  // Publish quotes for staged packages so the dashboard shows the gap and the cheapest alternative.
  for (const quote of plan.staged) {
    const division = live.divisions.find((entry) => entry.name === quote.division);
    const alternatives = [];
    const firstCity = division ? divisionCities(division)[0] : null;
    if (division && firstCity) {
      try {
        const officeCost = api.getOfficeSizeUpgradeCost(quote.division, firstCity, 3);
        if (Number.isFinite(officeCost) && officeCost > 0) alternatives.push({ kind: 'office', label: `Grow office ${quote.division}/${firstCity}`, cost: officeCost, affordable: finite(live.corp?.funds) > plan.reserve + officeCost });
      } catch {
        /* quote only */
      }
      const key = `${quote.division}/${firstCity}`;
      if (live.warehouses[key] === true) {
        try {
          const upgradeCost = api.getUpgradeWarehouseCost(quote.division, firstCity);
          if (Number.isFinite(upgradeCost) && upgradeCost > 0) alternatives.push({ kind: 'storage', label: `Upgrade warehouse ${key}`, cost: upgradeCost, affordable: finite(live.corp?.funds) > plan.reserve + upgradeCost });
        } catch {
          /* quote only */
        }
      }
    }
    quotes.push({ ...quote, alternatives });
  }

  const final = live;
  return {
    state: final.hasCorporation ? 'EXPANDING' : 'NO_CORP',
    actions,
    errors,
    blockedBy: plan.blockedBy,
    quotes,
    cooldowns,
    funds: finite(final.corp?.funds),
    reserve: plan.reserve,
    progress: bootstrapProgress(final, config, {}),
    dryRun,
  };
}
