/**
 * Staffing, office upkeep and upgrade purchasing for the corporation optimiser.
 *
 * Spec: docs/corp-automation-spec.md §6.3, §7.6. Planning is pure (the caller supplies
 * quotes through callbacks); applying re-reads every authoritative value first so a plan
 * computed from a stale snapshot can never spend money it cannot afford.
 *
 * Live evidence (spec §2.5): G12 — zero-employee offices were silent; G7 — upgrade
 * purchasing had hard-coded fractions instead of configuration.
 */

import { upgradeReturn } from './automation-policy.js';
import {
  corporationAdvertBenefit,
  corporationOfficeUpkeepNeed,
  growthBankForOffice,
  optimizedOfficeJobs,
  partySpendPerEmployee,
  supportAdvertLimit,
} from './corporation-policy.js';

export const OFFICE_JOBS = ['Operations', 'Engineer', 'Business', 'Management', 'Research & Development'];

/** Global upgrades, ranked by automation-policy.upgradeReturn (approximate marginal return per dollar). */
export const UPGRADE_ORDER = [
  'Smart Factories',
  'Smart Storage',
  'Nuoptimal Nootropic Injector Implants',
  'Speech Processor Implants',
  'Neural Accelerators',
  'FocusWires',
  'ABC SalesBots',
  'Project Insight',
];

/** Cash tier -> office target; the last target holds for every higher cash level. */
export function officeTargetFor({ makesProducts = false, cash = 0, config }) {
  const kind = makesProducts ? 'products' : 'materials';
  const targets = config?.people?.officeTargets?.[kind] || (makesProducts ? [30] : [3]);
  const tiers = config?.people?.cashTiers?.[kind] || [];
  const tier = tiers.filter(threshold => Number.isFinite(threshold) && cash > threshold).length;
  return Math.max(1, Math.floor(Number(targets[Math.min(tier, targets.length - 1)]) || 1));
}

/**
 * Plan one office: target size, hires, job mix, tea/party and the next size increment.
 *
 * @param {object} input
 * @param {(add: number) => number} input.quoteSizeUpgrade
 * @returns {object} plan consumed by applyOfficePlan
 */
export function planOffice({
  division,
  city,
  office,
  divisionInfo = null,
  products = [],
  developing = false,
  recovering = false,
  funds = 0,
  reserve = 0,
  budget = 0,
  upkeepBudget = null,
  config,
  researchGoal = {},
  quoteSizeUpgrade = () => NaN,
  teaCostPerEmployee = 500000,
  autoTea = false,
  autoParty = false,
} = {}) {
  const makesProducts = divisionInfo?.makesProducts === true;
  const size = Math.max(0, Math.floor(Number(office?.size) || 0));
  const employees = Math.max(0, Math.floor(Number(office?.numEmployees) || 0));
  const base = {
    division, city, size, employees, target: size, hires: 0, counts: null, aligned: false,
    sizeUpgrade: null, upkeep: { tea: 0, party: 0, cost: 0 }, starvation: size > 0 && employees === 0,
    growthBank: 0, reason: null,
  };
  if (!office) return { ...base, reason: 'Office unreadable' };
  let target = officeTargetFor({ makesProducts, cash: funds, config });
  // A product division only keeps one development office fully staffed; the rest sell.
  if (makesProducts && !developing) target = Math.max(9, Math.floor(target / 2));
  // A one-city material division needs nine staff before the city-expansion gate opens.
  if (!makesProducts && (divisionInfo?.cities?.length || 0) <= 1) target = Math.max(9, target);
  base.target = target;

  let sizeUpgrade = null;
  // Hiring into existing space is free; growing an office nobody works in only wastes cash (G12).
  const emptyOffice = size > 0 && employees === 0;
  if (size < target && budget > 0 && !emptyOffice) {
    const free = Math.max(0, funds - reserve);
    const quote = add => {
      const cost = Number(quoteSizeUpgrade(add));
      return Number.isFinite(cost) && cost > 0 ? cost : NaN;
    };
    const desired = target - size;
    const steps = [...new Set([desired, Math.min(3, desired), 1])].filter(add => add > 0);
    for (const add of steps) {
      const cost = quote(add);
      if (Number.isFinite(cost) && cost <= Math.min(budget, free)) { sizeUpgrade = { add, cost }; break; }
    }
    if (sizeUpgrade) {
      base.growthBank = growthBankForOffice(0, free, sizeUpgrade.cost);
    } else {
      const desiredCost = quote(desired);
      base.reason = Number.isFinite(desiredCost)
        ? `Office upgrade costs $${Math.round(desiredCost).toLocaleString()} against a $${Math.round(Math.min(budget, free)).toLocaleString()} budget`
        : 'Office upgrade is unaffordable';
    }
  }

  const counts = employees > 0
    ? optimizedOfficeJobs(office, makesProducts, developing, starving(recovering, office), {
      ...researchGoal,
      developmentSpeed: developing && config?.product?.developmentSpeed !== false,
      researchWeight: developing ? Math.max(0.12, Number(researchGoal?.researchWeight) || 0.35) : researchGoal?.researchWeight,
    })
    : null;
  const aligned = !counts || (office.employeeJobs
    ? OFFICE_JOBS.every((job, index) => Number(office.employeeJobs?.[job] ?? -1) === counts[index])
    : false);

  // Upkeep is a cash request, not a fixed allowance: tea for energy, a party for morale.
  const need = corporationOfficeUpkeepNeed({
    ...office,
    autoTea: autoTea === true,
    autoParty: autoParty === true,
  }, teaCostPerEmployee);
  const threshold = Number(config?.people?.teaThreshold ?? 2);
  const wantsTea = employees > 0 && Number(office.avgEnergy) < Number(office.maxEnergy ?? 100) - threshold;
  const teaCost = wantsTea ? employees * teaCostPerEmployee : 0;
  const upkeepAllowance = Math.min(Number.isFinite(upkeepBudget) ? upkeepBudget : budget, Math.max(0, funds - reserve));
  const upkeep = { tea: teaCost <= upkeepAllowance && need.tea > 0 ? teaCost : 0, party: 0, cost: 0 };
  const partyPerEmployee = recovering ? 0
    : partySpendPerEmployee(Number(office.avgMorale), Number(office.maxMorale ?? 100), employees, Math.max(0, upkeepAllowance - upkeep.tea));
  upkeep.party = partyPerEmployee;
  upkeep.cost = upkeep.tea + partyPerEmployee * employees;
  return {
    ...base, target, counts, aligned, sizeUpgrade, upkeep,
    starvation: size > 0 && employees === 0,
    jobContext: {
      makesProducts, developing, recovering,
      context: {
        ...researchGoal,
        developmentSpeed: developing && config?.product?.developmentSpeed !== false,
        researchWeight: developing ? Math.max(0.12, Number(researchGoal?.researchWeight) || 0.35) : researchGoal?.researchWeight,
      },
    },
    reason: base.reason || (employees === 0 && size > 0 ? 'Office has no employees' : null),
  };
}

/** Recovery staffing only kicks in when the office is actually short of energy/morale. */
function starving(recovering, office) {
  if (!recovering) return false;
  return Number(office?.avgEnergy) < Number(office?.maxEnergy ?? 100) - 5 ||
    Number(office?.avgMorale) < Number(office?.maxMorale ?? 100) - 5;
}

/**
 * Apply an office plan: size upgrade, hires, job mix, tea and party.
 * Each mutation is re-guarded; `hireEmployee` returning false stops that office, never the tick.
 */
export function applyOfficePlan(api, plan, { allowed = () => true, reserve = 0 } = {}) {
  const results = [];
  const spent = { growth: 0, upkeep: 0 };
  if (!plan || !allowed()) return { results, spent, state: 'blocked', reason: 'Automation is paused' };
  const { division, city } = plan;
  let ok = true;
  const attempt = (label, run) => {
    try {
      if (!allowed()) { ok = false; return false; }
      const value = run();
      results.push({ label, state: value === false ? 'rejected' : 'purchased' });
      return value;
    } catch (error) {
      results.push({ label, state: 'rejected', reason: String(error) });
      return false;
    }
  };

  if (plan.sizeUpgrade) {
    const { add, cost } = plan.sizeUpgrade;
    const fresh = api.getCorporation?.()?.funds;
    const quoted = Number(api.getOfficeSizeUpgradeCost(division, city, add));
    if (Number.isFinite(fresh) && fresh - reserve >= cost && Number.isFinite(quoted) && quoted <= Math.max(0, fresh - reserve)) {
      const before = Number(api.getOffice(division, city)?.size) || 0;
      if (attempt(`Upgrade office ${division}/${city} by ${add}`, () => api.upgradeOfficeSize(division, city, add))) {
        const after = Number(api.getOffice(division, city)?.size) || 0;
        if (after > before) spent.growth += cost;
        else ok = false;
      }
    }
  }

  let office = api.getOffice(division, city);
  if (!office) return { results, state: ok ? 'no-op' : 'rejected', reason: 'Office unreadable' };
  const capacity = Math.max(0, Math.floor(Number(office.size) || 0));
  const employed = Math.max(0, Math.floor(Number(office.numEmployees) || 0));
  if (employed < capacity) {
    const target = Math.min(capacity, Math.max(employed, Number(plan.target) || employed));
    for (let count = employed; count < target; count++) {
      if (!attempt(`Hire ${division}/${city}`, () => api.hireEmployee(division, city))) break;
    }
    office = api.getOffice(division, city);
  }

  const employees = Math.max(0, Math.floor(Number(office?.numEmployees) || 0));
  // New hires need a job mix for the *new* headcount; the planned counts described the old one.
  const counts = office && employees !== plan.employees && plan.jobContext
    ? optimizedOfficeJobs(office, plan.jobContext.makesProducts === true, plan.jobContext.developing === true,
      plan.jobContext.recovering === true, plan.jobContext.context || {})
    : plan.counts;
  if (employees > 0 && counts && (!plan.aligned || employees !== plan.employees)) {
    for (const job of OFFICE_JOBS) {
      if (!attempt(`Clear ${job} ${division}/${city}`, () => api.setJobAssignment(division, city, job, 0))) break;
    }
    for (let index = 0; index < counts.length; index++) {
      const count = Math.max(0, Math.floor(counts[index] || 0));
      if (!count) continue;
      if (!attempt(`Assign ${OFFICE_JOBS[index]} ${division}/${city}`, () => api.setJobAssignment(division, city, OFFICE_JOBS[index], count))) break;
    }
  }

  if (employees > 0 && plan.upkeep?.tea > 0) {
    const funds = Number(api.getCorporation?.()?.funds);
    if (!(Number.isFinite(funds) && funds - reserve < plan.upkeep.tea)) {
      if (attempt(`Tea ${division}/${city}`, () => api.buyTea(division, city)) !== false) spent.upkeep += plan.upkeep.tea;
    }
  }
  if (employees > 0 && plan.upkeep?.party > 0) {
    const funds = Number(api.getCorporation?.()?.funds);
    const cost = plan.upkeep.party * employees;
    if (!(Number.isFinite(funds) && funds - reserve < cost)) {
      if (attempt(`Party ${division}/${city}`, () => Number(api.throwParty(division, city, plan.upkeep.party)) > 1)) spent.upkeep += cost;
    }
  }
  return { results, spent, state: ok ? (results.some(item => item.state === 'purchased') ? 'purchased' : 'no-op') : 'partial' };
}

/** Best single global upgrade this tick, or null. Ranked by upgradeReturn, capped by config. */
export function planUpgrade({ cash = 0, reserve = 0, config, storagePressure = false, levelOf = () => 0, costOf = () => NaN, order = UPGRADE_ORDER, profitPerCycle = null } = {}) {
  const fraction = Number(config?.people?.upgradeFraction ?? 0.2);
  const storageFraction = Number(config?.people?.storageUpgradeFraction ?? 0.35);
  // An upgrade may only claim cash the corporation earns back inside the payback window.
  // This is what stops a loss-making corporation from buying upgrades out of its reserve (G2).
  const paybackCycles = Number(config?.people?.upgradePaybackCycles ?? 600);
  const profitAllowance = paybackCycles > 0 ? Math.max(0, Number(profitPerCycle) || 0) * paybackCycles : Infinity;
  const rows = [];
  for (const name of new Set([...(storagePressure ? ['Smart Storage'] : []), ...order])) {
    const level = Math.max(0, Number(levelOf(name)) || 0);
    const cost = Number(costOf(name));
    if (!Number.isFinite(cost) || cost <= 0) continue;
    const cap = Math.min(cash * (name === 'Smart Storage' && storagePressure ? storageFraction : fraction), profitAllowance);
    const score = upgradeReturn(name, level, cost, storagePressure);
    if (!Number.isFinite(score) || score <= 0) continue;
    if (cost > cap || cash - reserve < cost) { rows.push({ name, level, cost, score, state: 'budget-wait' }); continue; }
    rows.push({ name, level, cost, score, state: 'ready' });
  }
  return {
    ready: rows.filter(row => row.state === 'ready').sort((a, b) => b.score - a.score || a.cost - b.cost)[0] || null,
    ranked: rows.sort((a, b) => b.score - a.score || a.cost - b.cost).slice(0, 16),
    profitAllowance,
  };
}

/** Apply one upgrade after re-reading its cost, the level and the corporation's funds. */
export function applyUpgrade(api, plan, { allowed = () => true, reserve = 0 } = {}) {
  if (!plan || !allowed()) return { state: 'no-op', reason: 'Nothing to upgrade' };
  try {
    const cost = Number(api.getUpgradeLevelCost(plan.name));
    const level = Number(api.getUpgradeLevel(plan.name)) || 0;
    const funds = Number(api.getCorporation?.()?.funds);
    if (level !== plan.level) return { state: 'blocked', reason: 'Upgrade level changed since planning' };
    if (!Number.isFinite(cost) || cost <= 0) return { state: 'blocked', reason: 'Upgrade cost unavailable' };
    if (!Number.isFinite(funds) || funds - reserve < cost) return { state: 'budget-wait', reason: 'Upgrade is no longer affordable' };
    if (api.levelUpgrade(plan.name) === false) return { state: 'rejected', reason: 'levelUpgrade failed' };
    const after = Number(api.getUpgradeLevel(plan.name));
    if (!(after > level)) return { state: 'rejected', reason: 'Upgrade level did not increase' };
    return { state: 'purchased', reason: `Level ${plan.name} to ${after}`, spent: cost, level: after };
  } catch (error) {
    return { state: 'rejected', reason: String(error) };
  }
}

/** Quote one AdVert for a division; benefit is a heuristic estimate, never a measured claim. */
export function planAdVert({ division, divisionInfo, industry, cost, cash = 0, reserve = 0, budget = 0, config, wilsonLevel = 0, revenue = 0 } = {}) {
  const price = Number(cost);
  const base = { division, cost: price, benefit: 0, ready: false, reason: null };
  if (!divisionInfo) return { ...base, reason: 'Division unreadable' };
  if (supportAdvertLimit(divisionInfo)) return { ...base, reason: 'Material division reached its AdVert limit' };
  if (Number(divisionInfo.awareness) >= Number.MAX_VALUE && Number(divisionInfo.popularity) >= Number.MAX_VALUE) {
    return { ...base, reason: 'Awareness and popularity are already saturated' };
  }
  if (!Number.isFinite(price) || price <= 0) return { ...base, reason: 'AdVert cost unavailable' };
  const share = Number(config?.market?.advertSpendFraction ?? 0.5);
  const allowance = Math.min(budget, cash * share, Math.max(0, cash - reserve));
  if (price > allowance) return { ...base, reason: `AdVert costs $${Math.round(price).toLocaleString()} against a $${Math.round(allowance).toLocaleString()} allowance` };
  const benefit = corporationAdvertBenefit(divisionInfo, industry || {}, wilsonLevel);
  if (!(benefit > 0)) return { ...base, reason: 'No estimated advertising benefit' };
  // An AdVert only pays for itself if the estimated sales gain repays it inside the horizon.
  const horizon = Number(config?.market?.advertPaybackSeconds ?? 21600);
  const revenuePerSecond = Math.max(0, Number(revenue) || 0);
  if (horizon > 0 && revenuePerSecond > 0) {
    const paybackSeconds = price / Math.max(1e-9, benefit * revenuePerSecond);
    if (paybackSeconds > horizon) {
      return { ...base, benefit, paybackSeconds,
        reason: `AdVert payback ${Math.round(paybackSeconds / 3600)}h exceeds the ${Math.round(horizon / 3600)}h horizon` };
    }
    return { ...base, ready: true, benefit, paybackSeconds,
      reason: `AdVert for ${division} repays in ${Math.round(paybackSeconds / 60)} min of estimated sales gain` };
  }
  if (horizon > 0) return { ...base, benefit, reason: 'No revenue yet to repay an AdVert' };
  return { ...base, ready: true, benefit, reason: `AdVert for ${division} at ${(benefit * 100).toFixed(2)}% estimated sales benefit` };
}

/** Apply one AdVert after re-quoting the price and re-reading the funds. */
export function applyAdVert(api, plan, { allowed = () => true, reserve = 0 } = {}) {
  if (!plan?.ready || !allowed()) return { state: 'no-op', reason: plan?.reason || 'Nothing to advertise' };
  try {
    const info = api.getDivision(plan.division);
    if (!info) return { state: 'blocked', reason: 'Division unreadable' };
    const before = Number(info.numAdVerts) || 0;
    const cost = Number(api.getHireAdVertCost(plan.division));
    const funds = Number(api.getCorporation?.()?.funds);
    if (!Number.isFinite(cost) || cost <= 0) return { state: 'blocked', reason: 'AdVert cost unavailable' };
    if (!Number.isFinite(funds) || funds - reserve < cost) return { state: 'budget-wait', reason: 'AdVert is no longer affordable' };
    if (api.hireAdVert(plan.division) === false) return { state: 'rejected', reason: 'hireAdVert failed' };
    const after = Number(api.getDivision(plan.division)?.numAdVerts) || 0;
    if (after <= before) return { state: 'rejected', reason: 'AdVert count did not increase' };
    return { state: 'purchased', reason: `AdVert ${plan.division} ${before}→${after}`, spent: cost, count: after };
  } catch (error) {
    return { state: 'rejected', reason: String(error) };
  }
}

/** Telemetry row per office. */
export function officeTelemetry(plan) {
  if (!plan) return null;
  return {
    division: plan.division, city: plan.city, size: plan.size, employees: plan.employees,
    target: plan.target, jobs: plan.counts ? Object.fromEntries(OFFICE_JOBS.map((job, index) => [job, plan.counts[index] || 0])) : null,
    starvation: !!plan.starvation, sizeUpgrade: plan.sizeUpgrade, upkeep: plan.upkeep,
  };
}
