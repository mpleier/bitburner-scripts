import { activityGuard } from './activity-coordination.js';
/** Pure policies shared by the in-game managers. No Netscript calls or PC runtime. */
export function optimalBoostTargets(materials, space) {
  let active = materials.filter(item => item.factor > 0 && item.size > 0);
  const result = Object.fromEntries(materials.map(item => [item.name, 0]));
  while (active.length) {
    const factorSum = active.reduce((sum, item) => sum + item.factor, 0);
    const offset = active.reduce((sum, item) => sum + item.size / 0.002, 0);
    const next = active.map(item => ({ ...item, target: item.factor * (Math.max(0, space) + offset) / (factorSum * item.size) - 1 / 0.002 }));
    const positive = next.filter(item => item.target > 0);
    if (positive.length === active.length) {
      for (const item of next) result[item.name] = Math.floor(item.target);
      break;
    }
    active = positive;
  }
  return result;
}

export function nextSaleMultiplier(item, current = 1) {
  const produced = Math.max(0, Number(item?.productionAmount) || 0);
  const sold = Math.max(0, Number(item?.actualSellAmount) || 0);
  const stored = Math.max(0, Number(item?.stored) || 0);
  if (!(produced > 0)) return current;
  if (stored > produced * 20 || sold < produced * 0.8) return Math.max(1, current / 1.2);
  if (sold >= produced * 0.98 && stored < produced * 2) return Math.min(1e6, current * 1.05);
  return current;
}

export function chooseRetirement(products, prefix = 'Apex Dining') {
  const managed = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\d+$');
  const eligible = products.filter(product => managed.test(product.name) && product.developmentProgress >= 100);
  return eligible.sort((a, b) => (Number(a.effectiveRating ?? a.rating) || 0) - (Number(b.effectiveRating ?? b.rating) || 0))[0] || null;
}

export function officeJobCounts(employees, productDivision) {
  const counts = [0, 0, 0, 0, 0];
  if (employees <= 5) {
    [0, 2, 1, 3, 4].slice(0, employees).forEach(index => counts[index]++);
    return counts;
  }
  const ratios = productDivision ? [0.32, 0.32, 0.10, 0.16, 0.10] : [0.30, 0.25, 0.10, 0.15, 0.20];
  ratios.forEach((ratio, index) => counts[index] = Math.floor(employees * ratio));
  const order = ratios.map((ratio, index) => ({ index, fraction: employees * ratio - counts[index] })).sort((a, b) => b.fraction - a.fraction);
  const remaining = employees - counts.reduce((sum, count) => sum + count, 0);
  for (let index = 0; index < remaining; index++) counts[order[index].index]++;
  return counts;
}

/** Approximate marginal return; storage relief receives priority when production is blocked. */
export function upgradeReturn(name, level, cost, storagePressure) {
  const increments = { 'Smart Factories': 0.03, 'Smart Storage': 0.10, 'Project Insight': 0.05 };
  const increment = increments[name] || 0.10;
  const weight = name === 'Smart Storage' ? (storagePressure ? 5 : 0.5) : name === 'Smart Factories' ? 2 : 1;
  return weight * increment / (1 + Math.max(0, level) * increment) / cost;
}

export function graftScore(stats) {
  const weights = { hacking: 3, hacking_exp: 2, hacking_chance: 1, hacking_speed: 2,
    hacking_money: 3, hacking_grow: 2, faction_rep: 2, company_rep: 1,
    charisma: 1, charisma_exp: 1, strength: 0.3, defense: 0.3, dexterity: 0.3, agility: 0.3 };
  return Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * Math.log(Math.max(0.001, Number(stats?.[key]) || 1)), 0);
}

export function canLaunchFactionWorker(sf4, hasRam, studying) {
 return Number(sf4) > 0 && !studying && hasRam(256 / (2 ** sf4));
}
export function chooseSleeveCrime(override, chance, threshold) { return override || (chance >= threshold ? 'Homicide' : 'Mug'); }
/** Fresh work checks execute in the same RAM-dodged call as each action. */
export function studyCommand(action) {
 if (action === 'travel') return `${activityGuard} || ns.singularity.getCurrentWork()?.type === "GRAFTING" ? false : ns.singularity.travelToCity(ns.args[0])`;
 if (action === 'start') return `${activityGuard} || ns.singularity.getCurrentWork()?.type === "GRAFTING" ? false : ns.singularity.universityCourse(ns.args[0], ns.args[1], ns.args[2])`;
 if (action === 'stop') return 'ns.singularity.getCurrentWork()?.type === "CLASS" ? ns.singularity.stopAction() : false';
 throw new Error('Unknown study action');
}
