/**
 * Product development lifecycle and research priorities for the corporation optimiser.
 *
 * Spec: docs/corp-automation-spec.md §6.2 and §7.5. Everything here is a pure planner:
 * `planProductCycle` / `planResearch` take a snapshot and return a decision, and the
 * `apply*` functions take an injected api so a mock can prove every mutation is
 * re-checked immediately before it happens.
 *
 * Live evidence this module fixes (spec §2.5):
 *   G3 — a division with products:[] and maxProducts:3 was never reconciled or reported.
 *   G5 — makeProduct was called without checking Division.maxProducts.
 */

import { extraResearch, productInvestment, researchParents } from './corporation-lifecycle.js';
import {
  corporationDevelopmentCity,
  corporationProductScience,
  corporationProductScienceHopeless,
  corporationProductScienceMinimum,
  corporationScienceFactor,
  productReplacementReady,
  researchAffordable,
} from './corporation-policy.js';

export const PRODUCT_INVESTMENT_MINIMUM = 10e6;

/**
 * Research priority: laboratory first, then the TA.I + TA.II pricing package, then
 * branch bundles that respect researchParents, then upkeep automation (opt-in).
 */
export const RESEARCH_PRIORITY = [
  'Hi-Tech R&D Laboratory',
  'Market-TA.I',
  'Market-TA.II',
  'Self-Correcting Assemblers',
  'Drones',
  'Drones - Assembly',
  'Drones - Transport',
  'Overclock',
  'Sti.mu',
  'uPgrade: Fulcrum',
  'uPgrade: Capacity.I',
  'uPgrade: Capacity.II',
  'AutoBrew',
  'AutoPartyManager',
  'HRBuddy-Recruitment',
  'HRBuddy-Training',
  'uPgrade: Dashboard',
];

/** The last group only runs when research.optionalAutomation is enabled. */
export const OPTIONAL_RESEARCH = new Set(['AutoBrew', 'AutoPartyManager', 'HRBuddy-Recruitment', 'HRBuddy-Training', 'uPgrade: Dashboard']);

/** Every research item depends on the laboratory unless a more specific parent is known. */
export function researchParentOf(name, parents = researchParents) {
  if (name === 'Hi-Tech R&D Laboratory') return null;
  return parents[name] || 'Hi-Tech R&D Laboratory';
}

/** Slots are authoritative from the division, capped by config.product.maxProductsPerDivision. */
export function productSlots(division, config) {
  const used = Array.isArray(division?.products) ? division.products.length : 0;
  const runtimeMax = Number(division?.maxProducts);
  const configured = config?.product?.maxProductsPerDivision;
  const max = Math.max(0, Math.min(
    Number.isFinite(runtimeMax) && runtimeMax > 0 ? Math.floor(runtimeMax) : 0,
    Number.isInteger(configured) && configured > 0 ? configured : Infinity,
  ));
  return { used, max, full: max > 0 ? used >= max : used === 0 && runtimeMax === 0, empty: used === 0 };
}

/** Monotonic product name: "<Division> <n>", never reusing an existing index. */
export function nextProductName(division, existing = [], counter = 0) {
  const escaped = String(division).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped} (\\d+)$`);
  const highest = existing.reduce((max, name) => {
    const index = Number(String(name).match(pattern)?.[1]);
    return Number.isInteger(index) ? Math.max(max, index) : max;
  }, 0);
  return `${division} ${Math.max(highest, Math.max(0, Math.floor(Number(counter) || 0))) + 1}`;
}

/** Research points still needed for a science multiplier, or 0 when the floor is already met. */
export function researchPointsForScience(multiplier, scienceFactor) {
  const factor = Number(scienceFactor);
  const floor = Number(multiplier);
  if (!(factor > 0) || !(floor > 1)) return 0;
  const points = (800 * (floor - 1)) ** (1 / factor);
  return Number.isFinite(points) ? Math.max(0, Math.ceil(points)) : 0;
}

/** Weakest mature product by rating; ties broken by name for determinism. */
export function weakestProduct(products) {
  return [...(products || [])]
    .filter(product => product && product.developmentProgress >= 100)
    .sort((a, b) => (Number(a.effectiveRating ?? a.rating) || 0) - (Number(b.effectiveRating ?? b.rating) || 0) ||
      String(a.name).localeCompare(String(b.name)))[0] || null;
}

/**
 * Decide what the product division should do this tick.
 *
 * @returns {{
 *   division: string, action: 'create'|'retire'|'discontinue'|'develop'|'wait'|'blocked'|'idle',
 *   reason: string, science: number, slots: {used:number,max:number,full:boolean,empty:boolean},
 *   pending: ({name:string, progress:number}|null), name: string|null, city: string|null,
 *   retire: string|null, investment: number, cost: number, progress: number|null,
 *   scienceTarget: number, researchGap: number
 * }}
 */
export function planProductCycle({
  division,
  industry = null,
  products = [],
  maxProducts = null,
  offices = [],
  researchPoints = 0,
  funds = 0,
  reserve = 0,
  budget = 0,
  config,
  state = {},
  now = Date.now(),
  cycleSeconds = 10,
} = {}) {
  const scienceFactor = corporationScienceFactor(industry);
  const science = corporationProductScience({ points: researchPoints, scienceFactor });
  const slots = productSlots({ products, maxProducts }, config);
  const product = config?.product || {};
  const scienceFloor = Number(product.scienceFloor ?? corporationProductScienceMinimum);
  const abandonFloor = Number(product.scienceAbandonFloor ?? corporationProductScienceHopeless);
  const minimumInvestment = Number(product.minimumInvestment) || PRODUCT_INVESTMENT_MINIMUM;
  const metrics = state?.metrics?.[division] || {};
  const base = {
    division, science, slots, pending: null, name: null, city: null, retire: null,
    investment: 0, cost: 0, progress: null, scienceTarget: scienceFloor, reserve, budget, minimumInvestment,
    researchGap: researchPointsForScience(scienceFloor, scienceFactor),
  };
  if (!industry) return { ...base, action: 'blocked', reason: 'Unknown industry data' };
  if (!slots.max) return { ...base, action: 'blocked', reason: 'Division makes no products' };

  const pending = (products || [])
    .filter(item => item && Number.isFinite(item.developmentProgress) && item.developmentProgress < 100)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))[0] || null;
  if (pending) {
    const progress = Number(pending.developmentProgress);
    if (science < abandonFloor) {
      // The product was priced with science this low; the remaining burn is pure loss.
      return { ...base, action: 'discontinue', name: pending.name, pending: { name: pending.name, progress },
        progress, reason: `Science ${science.toFixed(3)} is below the abandon floor ${abandonFloor}` };
    }
    return { ...base, action: 'develop', name: pending.name, pending: { name: pending.name, progress }, progress,
      reason: `Developing ${pending.name} at ${progress.toFixed(1)}%` };
  }

  const mature = (products || []).filter(item => item && item.developmentProgress >= 100);
  if (slots.full) {
    const weakest = weakestProduct(mature);
    const metric = metrics?.name === weakest?.name ? metrics : state?.history?.[division]?.[weakest?.name] || {};
    const investment = productInvestment(funds, reserve, budget);
    const retire = product.allowProductRetirement && weakest &&
      productReplacementReady({
        product: weakest, investment, at: Number(metric.startedAt) || 0, now,
        developmentMs: Number(metric.developmentMs) || 0,
        baselineResearch: Number(metric.research) || 0, research: researchPoints,
        baselineEmployees: Number(metric.employees) || 0,
        employees: Math.max(0, ...(offices || []).map(office => Number(office.numEmployees) || 0)),
        cycleSeconds,
      }) && investment >= (Number(product.minimumInvestment) || PRODUCT_INVESTMENT_MINIMUM);
    if (!retire) {
      return { ...base, action: 'blocked', name: null, reason: 'Product slots are full', scienceTarget: scienceFloor };
    }
    return { ...base, action: 'retire', name: weakest?.name || null, retire: weakest?.name || null,
      reason: `Replacing ${weakest?.name} after stronger research/staffing evidence` };
  }

  if (science < scienceFloor) {
    return { ...base, action: 'blocked',
      reason: `Science ${science.toFixed(3)} is below the ${scienceFloor} floor (${researchPointsForScience(scienceFloor, scienceFactor).toLocaleString()} RP needed)` };
  }

  const investment = productInvestment(funds, reserve, budget);
  const minimum = Number(product.minimumInvestment) || PRODUCT_INVESTMENT_MINIMUM;
  if (!(investment >= minimum)) {
    return { ...base, action: 'wait', reason: 'Waiting for product investment budget' };
  }
  const city = corporationDevelopmentCity(offices);
  if (!city) return { ...base, action: 'blocked', reason: 'No development office with a warehouse' };
  const name = nextProductName(division, (products || []).map(item => item.name), state?.counters?.[division]);
  return { ...base, action: 'create', name, city, investment, cost: 2 * investment,
    reason: `Design ${name} in ${city} with $${(investment / 1e6).toFixed(1)}m design and marketing` };
}

/**
 * Apply a product decision. Every branch re-reads the division and re-quotes the cost
 * immediately before the mutation; a rejected or unaffordable plan returns a reason
 * instead of throwing (spec §9.3, §9.4).
 */
export function applyProductPlan(api, plan, { allowed = () => true, cycleSeconds = 10 } = {}) {
  const result = (state, reason, extra = {}) => ({ state, reason, spent: 0, ...extra });
  if (!plan || !['create', 'retire', 'discontinue'].includes(plan.action)) return result('no-op', plan?.reason || 'Nothing to do');
  if (!allowed()) return result('blocked', 'Automation is paused');
  const division = plan.division;
  try {
    const live = api.getDivision(division);
    if (!live) return result('blocked', 'Division unreadable');
    if (plan.action === 'discontinue' || plan.action === 'retire') {
      if (!(live.products || []).includes(plan.name)) return result('no-op', 'Product already gone');
      if (!api.discontinueProduct(division, plan.name)) return result('rejected', 'discontinueProduct failed');
      return result('purchased', `Discontinued ${plan.name}`, { discontinued: plan.name });
    }
    // create: retire first when a slot has to be reopened, then re-read the slot count.
    if (plan.retire && (live.products || []).includes(plan.retire)) {
      if (!api.discontinueProduct(division, plan.retire)) return result('rejected', 'Retirement failed');
    }
    const afterRetire = plan.retire ? api.getDivision(division) : live;
    if (!afterRetire) return result('blocked', 'Division unreadable after retirement');
    const products = afterRetire.products || [];
    const max = Number(afterRetire.maxProducts) || 0;
    if (!(max > products.length)) return result('blocked', 'Product slots are full');
    const science = corporationProductScience({
      points: Number(afterRetire.researchPoints) || 0,
      scienceFactor: corporationScienceFactor(api.getIndustryData?.(afterRetire.industry)),
    });
    if (science < plan.scienceTarget) return result('blocked', 'Science floor no longer met');
    const funds = Number(api.getCorporation?.()?.funds);
    const reserve = Number(plan.reserve) || 0;
    // Never spend more than the plan proposed, and never more than the live budget allows.
    const investment = Math.min(Number(plan.investment) || 0, productInvestment(funds, reserve, plan.budget ?? Infinity));
    if (!Number.isFinite(funds) || !(investment >= (Number(plan.minimumInvestment) || PRODUCT_INVESTMENT_MINIMUM))) {
      return result('budget-wait', 'Product investment is no longer affordable');
    }
    if (!api.makeProduct(division, plan.city, plan.name, investment, investment)) return result('rejected', 'makeProduct failed');
    const confirm = api.getDivision(division)?.products || [];
    if (!confirm.includes(plan.name)) return result('rejected', 'Product did not appear after makeProduct');
    return result('purchased', `Started ${plan.name}`, { spent: 2 * investment, investment, name: plan.name, city: plan.city });
  } catch (error) {
    return result('rejected', String(error));
  }
}

/**
 * Research priority plan. Buys the first affordable item in priority order together with
 * its missing prerequisites, never spending more than `affordableFraction` of the pool
 * (so the production-quality floor stays funded) and never draining RP while a product
 * is in development faster than the division can replace it.
 */
export function planResearch({
  division,
  points = 0,
  owned = [],
  costs = {},
  parents = researchParents,
  config,
  developing = false,
  rate = null,
  cycleSeconds = 10,
  priority = RESEARCH_PRIORITY,
} = {}) {
  const settings = config?.research || {};
  const fraction = Number(settings.affordableFraction ?? 0.2);
  const reserveCycles = Number(settings.developmentReserveCycles ?? 5);
  const have = new Set(Array.isArray(owned) ? owned : []);
  const catalog = priority
    .filter(name => settings.optionalAutomation || !OPTIONAL_RESEARCH.has(name))
    .concat(settings.optionalAutomation ? [] : []);
  const available = Math.max(0, Number(points) || 0);
  const missing = catalog.filter(name => !have.has(name));
  const base = { division, points: available, cost: 0, target: null, package: [], retained: available, ready: false, complete: false };
  if (!missing.length) return { ...base, complete: true, reason: 'All priority research is owned' };

  const closure = target => {
    const items = [];
    let valid = true;
    const visit = name => {
      if (have.has(name) || items.some(item => item.name === name)) return true;
      if (!Object.hasOwn(costs, name) || !Number.isFinite(costs[name]) || costs[name] < 0) { valid = false; return false; }
      const parent = researchParentOf(name, parents);
      if (parent && !visit(parent)) return false;
      items.push({ name, cost: costs[name], parent });
      return true;
    };
    if (!visit(target) || !valid || !items.length) return null;
    return items;
  };
  const affordable = items => {
    const cost = items.reduce((sum, item) => sum + item.cost, 0);
    if (!researchAffordable(available, cost, fraction)) return null;
    if (developing && Number.isFinite(rate) && rate > 0 && cost > rate * cycleSeconds * reserveCycles) return null;
    return cost;
  };
  // TA.I and TA.II are bought together: TA.I alone raises prices without the optimal-price model.
  if (!have.has('Market-TA.II') && catalog.includes('Market-TA.II')) {
    const items = closure('Market-TA.II');
    const cost = items && affordable(items);
    if (items && cost !== null) {
      return {
        ...base, target: 'Market-TA.II', cost, package: items.map(item => item.name), items,
        retained: available - cost, ready: true,
        reason: `Buying the Market-TA.I + TA.II pricing package for ${Math.round(cost).toLocaleString()} RP, keeping ${Math.round(available - cost).toLocaleString()} in the pool`,
      };
    }
  }

  // Build the prerequisite closure for the first affordable target in priority order.
  const deferred = [];
  for (const target of missing) {
    if (target === 'Market-TA.I') continue;
    const items = closure(target);
    if (!items) continue;
    const cost = affordable(items);
    if (cost === null) {
      if (developing && Number.isFinite(rate) && rate > 0) {
        deferred.push({ target, cost: items.reduce((sum, item) => sum + item.cost, 0), reason: 'Research costs more RP than the in-development product can replace in the reserve window' });
      }
      continue;
    }
    return {
      ...base, target, cost, package: items.map(item => item.name), items,
      retained: available - cost,
      ready: true,
      reason: `Buying ${target} for ${Math.round(cost).toLocaleString()} RP, keeping ${Math.round(available - cost).toLocaleString()} in the pool`,
    };
  }
  const cheapest = missing
    .map(name => ({ name, cost: Number(costs[name]) }))
    .filter(item => Number.isFinite(item.cost) && item.cost >= 0)
    .sort((a, b) => a.cost - b.cost)[0];
  const needed = cheapest ? Math.max(0, Math.ceil(cheapest.cost / Math.max(1e-9, fraction)) - available) : null;
  return {
    ...base, deferred: deferred.slice(0, 8),
    reason: deferred.length
      ? deferred[0].reason
      : cheapest
        ? `Research pool ${Math.round(available).toLocaleString()} RP cannot fund ${cheapest.name} (${Math.round(cheapest.cost).toLocaleString()} RP at ${Math.round(fraction * 100)}% of the pool)`
        : 'No affordable research',
    gap: needed,
  };
}

/** Apply a research plan through the native call with per-call re-validation. */
export function applyResearchPlan(api, plan, { allowed = () => true } = {}) {
  if (!plan?.ready || !Array.isArray(plan.items) || !plan.items.length) {
    return { state: 'no-op', reason: plan?.reason || 'Nothing to research', purchased: [], spent: 0 };
  }
  const division = plan.division;
  const purchase = name => {
    try {
      if (!allowed()) return false;
      if (api.hasResearched(division, name) === true) return false;
      const cost = api.getResearchCost(division, name);
      const live = api.getDivision(division);
      if (!Number.isFinite(cost) || !Number.isFinite(live?.researchPoints) || live.researchPoints < cost) return false;
      if (api.research(division, name) === false) return false;
      return api.hasResearched(division, name) !== false;
    } catch {
      return false;
    }
  };
  const purchased = [];
  let spent = 0;
  for (const item of plan.items) {
    if (!purchase(item.name)) break;
    purchased.push(item.name);
    spent += Number(item.cost) || 0;
  }
  const complete = purchased.length === plan.items.length;
  return {
    state: complete ? 'purchased' : purchased.length ? 'partial' : 'rejected',
    reason: complete ? `Researched ${purchased.join(', ')}` : 'Research package stopped on a re-check',
    purchased, spent,
  };
}

/** Telemetry row for a product division; reconciles metrics with the live product list (fixes G3). */
export function productTelemetry(plan, divisionInfo = null) {
  const live = Array.isArray(divisionInfo?.products) ? divisionInfo.products : null;
  return {
    division: plan?.division ?? null,
    action: plan?.action ?? 'idle',
    reason: plan?.reason ?? null,
    science: Number(plan?.science) || 0,
    slots: plan?.slots ?? null,
    pending: plan?.pending ?? null,
    product: plan?.name ?? null,
    city: plan?.city ?? null,
    investment: Number(plan?.investment) || 0,
    cost: Number(plan?.cost) || 0,
    researchGap: Number(plan?.researchGap) || 0,
    liveProducts: live,
    staleMetric: !!plan?.name && !!live && !live.includes(plan.name) && plan.action === 'develop',
  };
}

/** Extra research names the manager already buys late; kept as a stable export for callers. */
export const lateResearch = [...extraResearch];
