/**
 * Market actions for the corporation optimiser: material buying and selling, product
 * selling and pricing, input purchasing, boosts and warehouse upgrades.
 *
 * Spec: docs/corp-automation-spec.md §6.5 and §7.4. Planners are pure; appliers re-read
 * the city, the warehouse and the price immediately before every mutation (spec §9.4).
 *
 * Live evidence (spec §2.5): G6/G9 — price brackets and inferred markups were in-memory
 * only and export/limit paths were write-only. The optimiser persists pricing state and
 * never calls sell* for a city without a warehouse (the live API throws there).
 */

import { optimalBoostTargets } from './automation-policy.js';
import {
  formulaSalePrice,
  inferProductMarkup,
  materialSalePrice,
  productPriceStep,
  salesPotential,
  outputBacklog,
} from './corporation-policy.js';
import { recipeInputPlan } from './corporation-lifecycle.js';

/** Boost materials with the live industry factors as fallbacks (spec §6.5). */
export const BOOST_MATERIALS = [
  { name: 'Real Estate', factor: 0.72, size: 0.005 },
  { name: 'Hardware', factor: 0.2, size: 0.06 },
  { name: 'Robots', factor: 0.3, size: 0.5 },
  { name: 'AI Cores', factor: 0.3, size: 0.1 },
];
const BOOST_FACTORS = { 'Real Estate': 'realEstateFactor', Hardware: 'hardwareFactor', Robots: 'robotFactor', 'AI Cores': 'aiCoreFactor' };

const priceState = (pricing, key) => pricing?.[key] || {};

/**
 * Plan every sale for one division.
 *
 * @param {object} input
 * @param {Array<{city:string, office:object, materials:object, products:object}>} input.cities
 * @returns {{materials:Array, products:Array, pricing:object, markupCandidates:object}}
 */
export function planSales({
  division,
  divisionInfo = null,
  industry = null,
  cities = [],
  ta2 = false,
  materialData = {},
  pricing = {},
  markup = null,
  salesBots = 0,
  cycleSeconds = 10,
} = {}) {
  const materials = [], products = [], nextPricing = { ...pricing }, markupCandidates = {};
  if (!divisionInfo || !industry) return { materials, products, pricing: nextPricing, markupCandidates };
  const produced = industry.producedMaterials || [];
  for (const row of cities) {
    if (!row?.warehouse) continue;
    for (const name of produced) {
      const item = row.materials?.[name];
      if (!item) continue;
      const price = ta2 ? 'MP' : materialSalePrice(item, materialData[name]);
      materials.push({ city: row.city, name, price, ta2 });
    }
    for (const name of divisionInfo.products || []) {
      const item = row.products?.[name];
      if (!item || Number(item.developmentProgress) < 100) continue;
      const key = `${division}/${row.city}/${name}`;
      if (ta2) {
        // One call per product sells in every city; the first warehoused city is the target.
        if (!products.some(entry => entry.name === name)) products.push({ city: row.city, name, price: 'MP', all: true, ta2: true });
        continue;
      }
      const potential = salesPotential(item, divisionInfo, industry, row.office, salesBots, true);
      const state = priceState(pricing, key);
      const rating = Number(item.effectiveRating ?? item.rating) || 0;
      if (markup > 0 && potential) {
        const formula = formulaSalePrice(item, potential, Math.max(rating, 0.001) / markup, cycleSeconds);
        if (formula?.price) {
          products.push({ city: row.city, name, price: formula.price, all: false, ta2: false, formula: true });
          const observed = inferProductMarkup(item, state);
          if (observed) markupCandidates[`${division}/${name}`] = observed;
          nextPricing[key] = {
            potential, target: formula.target, premium: formula.premium, rating,
            base: Number(item.productionCost) || 0, at: Date.now(),
          };
          continue;
        }
      }
      const step = productPriceStep(item, state, cycleSeconds);
      nextPricing[key] = step;
      products.push({ city: row.city, name, price: `MP*${step.multiplier}`, all: false, ta2: false, multiplier: step.multiplier });
    }
  }
  return { materials, products, pricing: nextPricing, markupCandidates };
}

/** Apply planned sales; a city without a warehouse is skipped, never thrown at. */
export function applySales(api, plan, { allowed = () => true } = {}) {
  if (!plan || !allowed()) return { state: 'blocked', reason: 'Automation is paused', sold: 0 };
  const division = plan.division;
  let ok = 0, failed = 0;
  for (const order of plan.materials || []) {
    try {
      if (!allowed()) break;
      if (api.hasWarehouse(division, order.city) !== true) continue;
      if (api.sellMaterial(division, order.city, order.name, 'MAX', order.price) === false) { failed++; continue; }
      ok++;
      if (plan.ta2) api.setMaterialMarketTA2(division, order.city, order.name, true);
    } catch { failed++; }
  }
  for (const order of plan.products || []) {
    try {
      if (!allowed()) break;
      if (api.hasWarehouse(division, order.city) !== true) continue;
      if (api.sellProduct(division, order.city, order.name, 'MAX', order.price, !!order.all) === false) { failed++; continue; }
      ok++;
      if (plan.ta2) api.setProductMarketTA2(division, order.name, true);
    } catch { failed++; }
  }
  return { state: failed && !ok ? 'rejected' : ok ? 'purchased' : 'no-op', sold: ok, failed };
}

/**
 * Plan input purchasing. With Smart Supply the optimiser clears the manual rate and lets
 * exports be consumed first; without it the recipe is sized to observed production.
 */
export function planInputs({
  division,
  city,
  industry = null,
  warehouse = null,
  smartSupply = false,
  items = {},
  products = [],
  budget = 0,
  cycleSeconds = 10,
} = {}) {
  const recipe = industry?.requiredMaterials || {};
  const base = { division, city, mode: 'skip', orders: [], cost: 0, reason: null };
  if (!warehouse) return { ...base, reason: 'City has no warehouse' };
  if (!Object.keys(recipe).length) return { ...base, reason: 'Division has no recipe inputs' };
  if (smartSupply) {
    return { ...base, mode: 'smart', leftovers: true, orders: Object.keys(recipe).map(name => ({ name, rate: 0 })),
      reason: 'Smart Supply buys recipe inputs' };
  }
  let production = 0;
  for (const name of industry.producedMaterials || []) {
    const item = items[name];
    production = Math.max(production, Number(item?.productionAmount) || 0);
  }
  for (const name of products) production += Number(name.productionAmount) || 0;
  // Production can collapse when an input ran out; without a restart batch nothing would ever
  // be bought again (the live manager has the same deadlock). Size one batch from the warehouse.
  const restart = !(production > 0);
  if (restart) production = Math.max(1, Number(warehouse.size) * 0.01);
  const space = Number(warehouse.sizeUsed) < Number(warehouse.size) * 0.95;
  if (!space) return { ...base, reason: 'Warehouse is full; inputs are paused' };
  const plan = recipeInputPlan(recipe, items, production, Math.max(0, budget), cycleSeconds);
  if (!(plan.cost > 0)) return { ...base, reason: 'Input budget is exhausted' };
  return { ...base, mode: 'rates', orders: plan.orders, cost: plan.cost,
    reason: restart ? 'Restarting production with a warehouse-sized input batch' : 'Purchasing recipe inputs' };
}

/** Apply input purchasing; `smart` clears manual rates and prefers exports. */
export function applyInputs(api, plan, { allowed = () => true, smartSupplyOptions = null } = {}) {
  if (!plan || plan.mode === 'skip' || !allowed()) return { state: 'no-op', reason: plan?.reason || 'Nothing to buy' };
  let ok = 0;
  try {
    if (plan.mode === 'smart') {
      for (const order of plan.orders) {
        if (api.buyMaterial(plan.division, plan.city, order.name, 0) === false) continue;
        if (plan.leftovers && (!smartSupplyOptions || smartSupplyOptions.includes('leftovers'))) {
          api.setSmartSupplyOption(plan.division, plan.city, order.name, 'leftovers');
        }
        ok++;
      }
      return { state: ok ? 'purchased' : 'no-op', orders: ok };
    }
    for (const order of plan.orders) {
      if (!allowed()) break;
      if (api.buyMaterial(plan.division, plan.city, order.name, order.rate) !== false) ok++;
    }
    return { state: ok ? 'purchased' : 'rejected', orders: ok, spent: plan.cost };
  } catch (error) {
    return { state: 'rejected', reason: String(error) };
  }
}

/**
 * Plan boosts toward the factor-weighted inventory targets, scaled into the boost budget.
 * A backlog or a nearly-full warehouse means the inventory cannot pay back: buy nothing.
 */
export function planBoosts({
  division,
  city,
  industry = null,
  warehouse = null,
  items = {},
  materialData = {},
  budget = 0,
  config,
  cycleSeconds = 10,
  backlog = false,
} = {}) {
  const base = { division, city, ready: false, orders: [], cost: 0, reason: null };
  if (!warehouse || backlog) return { ...base, reason: backlog ? 'Output backlog: boosts paused' : 'City has no warehouse' };
  if (!(budget > 0)) return { ...base, reason: 'No boost budget' };
  const pressure = Number(warehouse.sizeUsed) / Math.max(1, Number(warehouse.size));
  if (pressure > 0.9) return { ...base, reason: 'Warehouse is full' };
  const recipe = industry?.requiredMaterials || {};
  const materials = BOOST_MATERIALS.map(boost => ({
    ...boost,
    factor: Number.isFinite(Number(industry?.[BOOST_FACTORS[boost.name]])) ? Number(industry[BOOST_FACTORS[boost.name]]) : boost.factor,
    size: Number(materialData[boost.name]?.size) || boost.size,
  })).filter(boost => !(boost.name in recipe));
  if (!materials.length) return { ...base, reason: 'Division has no boost materials' };
  const share = Number(config?.market?.boostWarehouseFraction ?? 0.6);
  const targets = optimalBoostTargets(materials, Number(warehouse.size) * share);
  const rows = materials.map(boost => {
    const item = items[boost.name] || {};
    const target = Number(targets[boost.name]) || 0;
    const stored = Number(item.stored) || 0;
    const price = Number(item.marketPrice) || 0;
    const need = Math.max(0, target - stored);
    return { name: boost.name, need, cost: need * price, price, stored };
  });
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  if (!(total > 0)) return { ...base, reason: 'Boost targets are already met' };
  const spend = Math.max(0, Math.min(budget, total));
  const scale = total > 0 ? spend / total : 0;
  if (!(scale > 0)) return { ...base, reason: 'Boost purchase would exceed the budget' };
  return {
    ...base, ready: true, cost: total * scale,
    orders: rows.filter(row => row.need > 0).map(row => ({ name: row.name, rate: row.need * scale / cycleSeconds, need: row.need * scale })),
    reason: `Boosting ${rows.filter(row => row.need > 0).map(row => row.name).join(', ')}`,
  };
}

/** Apply boost orders; a partial failure zeroes every rate it touched (spec §5.3 invariant 4). */
export function applyBoosts(api, plan, { allowed = () => true, recipe = [] } = {}) {
  if (!plan?.ready || !allowed()) return { state: 'no-op', reason: plan?.reason || 'Nothing to boost' };
  let ok = 0;
  try {
    for (const order of plan.orders) {
      if (api.buyMaterial(plan.division, plan.city, order.name, order.rate) === false) break;
      ok++;
    }
    for (const boost of BOOST_MATERIALS) {
      if (recipe.includes(boost.name)) continue;
      if (!plan.orders.some(order => order.name === boost.name)) api.buyMaterial(plan.division, plan.city, boost.name, 0);
    }
    return { state: ok === plan.orders.length ? 'purchased' : 'partial', orders: ok, spent: plan.cost };
  } catch (error) {
    clearBoostRates(api, plan.division, plan.city, recipe);
    return { state: 'rejected', reason: String(error) };
  }
}

/** Zero every boost buy rate this module may have set (also used on early return / atExit). */
export function clearBoostRates(api, division, city, recipe = []) {
  const cleared = [];
  for (const boost of BOOST_MATERIALS) {
    if (recipe.includes(boost.name)) continue;
    try { api.buyMaterial(division, city, boost.name, 0); cleared.push(boost.name); } catch { /* optional */ }
  }
  return cleared;
}

/**
 * Warehouse upgrade: only under real pressure, never while output is backlogged, one level
 * per city per tick, and never above level 5 without a nearly full warehouse (spec §6.1).
 */
export function planWarehouseUpgrade({ division, city, warehouse = null, quotedCost = NaN, cash = 0, reserve = 0, budget = 0, config, backlog = false } = {}) {
  const base = { division, city, ready: false, cost: 0, pressure: 0, level: 0, reason: null };
  if (!warehouse) return { ...base, reason: 'City has no warehouse' };
  const pressure = Number(warehouse.sizeUsed) / Math.max(1, Number(warehouse.size));
  const level = Number(warehouse.level) || 0;
  const threshold = Number(config?.bootstrap?.warehouseFullThreshold ?? 0.7);
  const cost = Number(quotedCost);
  const row = { ...base, pressure, level };
  if (backlog) return { ...row, reason: 'Output backlog: storage spend paused' };
  if (!(pressure > threshold)) return { ...row, reason: `Warehouse pressure ${(pressure * 100).toFixed(0)}% is below the ${(threshold * 100).toFixed(0)}% threshold` };
  if (level >= 5 && pressure < 0.95) return { ...row, reason: 'Warehouse level 5 needs a nearly full warehouse' };
  if (!Number.isFinite(cost) || cost <= 0) return { ...row, reason: 'Warehouse cost unavailable' };
  const free = Math.max(0, cash - reserve);
  if (cost > Math.min(free, budget)) return { ...row, cost, reason: 'Warehouse upgrade is not affordable' };
  return { ...row, ready: true, cost, reason: `Warehouse at ${(pressure * 100).toFixed(0)}% pressure` };
}

/** Apply one warehouse level after re-reading the warehouse and its price. */
export function applyWarehouseUpgrade(api, plan, { allowed = () => true, reserve = 0 } = {}) {
  if (!plan?.ready || !allowed()) return { state: 'no-op', reason: plan?.reason || 'Nothing to upgrade' };
  try {
    const before = api.getWarehouse(plan.division, plan.city);
    if (!before) return { state: 'blocked', reason: 'Warehouse unreadable' };
    const cost = Number(api.getUpgradeWarehouseCost(plan.division, plan.city, 1));
    const funds = Number(api.getCorporation?.()?.funds);
    if (!Number.isFinite(cost) || cost <= 0) return { state: 'blocked', reason: 'Warehouse cost unavailable' };
    if (!Number.isFinite(funds) || funds - reserve < cost) return { state: 'budget-wait', reason: 'Warehouse upgrade is no longer affordable' };
    if (api.upgradeWarehouse(plan.division, plan.city, 1) === false) return { state: 'rejected', reason: 'upgradeWarehouse failed' };
    const after = api.getWarehouse(plan.division, plan.city);
    if (!(Number(after?.level) > Number(before.level))) return { state: 'rejected', reason: 'Warehouse level did not increase' };
    return { state: 'purchased', reason: `Warehouse ${plan.division}/${plan.city} level ${after.level}`, spent: cost, level: after.level };
  } catch (error) {
    return { state: 'rejected', reason: String(error) };
  }
}

/** True when any output is backlogged (spec §6.5 warehouse-full handling). */
export function cityBacklogged(materials = [], products = []) {
  return outputBacklog([...Object.values(materials || {}), ...Object.values(products || {})].filter(Boolean));
}

/** Persistent pricing state, capped so the state file stays small (spec §9.2). */
export function compactPricing(pricing) {
  return Object.fromEntries(Object.entries(pricing || {}).slice(0, 64).filter(([, value]) =>
    value && Number.isFinite(Number(value.multiplier ?? value.potential ?? value.rating))));
}
