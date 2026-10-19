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
  const increments = { 'Wilson Analytics': 0.005, 'Smart Factories': 0.03, 'Smart Storage': 0.10, 'Project Insight': 0.05, 'ABC SalesBots': 0.01 };
  const increment = increments[name] || 0.10;
  const weight = name === 'Smart Storage' ? (storagePressure ? 5 : 0.5) : name === 'Smart Factories' ? 2 : 1;
  return weight * increment / (1 + Math.max(0, level) * increment) / cost;
}

export function graftScore(stats, entropyFactor = 1) {
  const weights = { hacking: 3, hacking_exp: 2, hacking_chance: 1, hacking_speed: 2,
    hacking_money: 3, hacking_grow: 2, faction_rep: 2, company_rep: 1,
    charisma: 1, charisma_exp: 1, strength: 0.3, defense: 0.3, dexterity: 0.3, agility: 0.3 };
  return Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * Math.log(Math.max(0.001, (Number(stats?.[key]) || 1) * entropyFactor)), 0);
}

/** Conservative cash estimate: do not assume skill/speed gains translate directly to income. */
export function graftEconomics({ stats, cost, duration, entropy = 0, immune = false, congruity = false,
  hackingIncome = 0, rates = {}, focusImmune = false, maxPayback = 4 * 3600_000 }) {
  const factor = congruity ? 1 / (0.98 ** Math.max(0, entropy)) : immune ? 1 : 0.98;
  const benefit = graftScore(stats, factor);
  const seconds = duration / 1000 / (focusImmune ? 1 : 0.8);
  const multiplier = key => (Number(stats?.[key]) || 1) * factor;
  let incrementalIncome = Math.max(0, hackingIncome) * (multiplier('hacking_money') - 1);
  for (const [source, key] of Object.entries({ hacknet: 'hacknet_node_money', crime: 'crime_money', work: 'work_money', darknet: 'dnet_money' }))
    incrementalIncome += Math.max(0, Number(rates[source]) || 0) * (multiplier(key) - 1);
  const lostIncome = seconds * ['work', 'infiltration', 'crime', 'bladeburner'].reduce((sum, key) => sum + Math.max(0, Number(rates[key]) || 0), 0);
  const payback = incrementalIncome > 0 ? (seconds + (cost + lostIncome) / incrementalIncome) * 1000 : Infinity;
  return { benefit, incrementalIncome, lostIncome, duration: seconds * 1000, payback,
    eligible: benefit > 0.1 && Number.isFinite(payback) && payback <= maxPayback };
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

/** Credit only observable XP work or native stamina-recovery work, never an invented cash rate.
 * Half of the modeled time saving is credited. Unknown action/chance improvements remain unpriced. */
export function graftProgressionValue({stats={},factor=1,duration,cost,lostIncome=0,maxPayback=14400000,
 route,reset,cash,incomeLossPerSecond=0,now=Date.now()}={}) {
 const no=reason=>({eligible:false,reason,payback:null,netSavedMs:0});
 if(!route||!reset||route.nodeReset!==reset.lastNodeReset||route.augReset!==reset.lastAugReset||
  !Number.isFinite(route.at)||route.at>now||now-route.at>45000)return no('Fresh route evidence unavailable');
 const forecast=route.routes?.[route.selected],remaining=forecast?.lowerMs;
 if(forecast?.actionable!==true||!Number.isFinite(remaining)||remaining<=0||
  !Number.isFinite(forecast.upperMs)||forecast.upperMs<remaining)return no('Comparable route duration unavailable');
 if(![duration,cost,lostIncome,maxPayback,factor,incomeLossPerSecond].every(Number.isFinite)||duration<=0||cost<0||lostIncome<0||maxPayback<=0||factor<=0||incomeLossPerSecond<0)return no('Invalid graft quote');
 const evidence=cash?.cashObservation,samples=Array.isArray(evidence?.samples)?evidence.samples.slice(-2):[];
 if(cash?.augReset!==reset.lastAugReset||!Number.isFinite(cash.at)||cash.at>now||now-cash.at>120000||
  evidence?.schemaVersion!==1||evidence.augReset!==reset.lastAugReset||evidence.mode!=='sources-v1'||samples.length!==2||
  !samples.every(s=>s&&Number.isFinite(s.at)&&s.at<=now&&now-s.at<=300000&&Number.isFinite(s.rate)&&s.rate>0)||
  samples[0].at>=samples[1].at||now-samples[1].at>120000||!Number.isFinite(cash.cashRate)||cash.cashRate<=0)return no('Confirmed recurring cash evidence unavailable');
 const rate=Math.min(cash.cashRate,...samples.map(s=>s.rate))-incomeLossPerSecond;
 if(rate<=0)return no('Entropy would exhaust the measured cash replacement rate');
 const mult=key=>{
  const value=stats[key]??1;return Number.isFinite(value)&&value>0?value*factor:NaN;
 };
 let saved=0,basis;
 if(route.selected==='hacking'){
  if(forecast.phase!=='xp'||!Number.isFinite(forecast.xpRate)||forecast.xpRate<=0)return no('Dedicated hacking XP forecast unavailable');
  if(!['hacking','hacking_chance','hacking_speed','hacking_grow'].every(key=>mult(key)>=1))return no('Entropy would weaken hacking capability');
  const xp=mult('hacking_exp');
  if(!(xp>1))return no('No priced XP improvement');
  saved=remaining*(1-1/xp)*.5;basis='measured-xp-half-credit';
 }else if(route.selected==='bladeburner'){
  if(!['hacking','strength','defense','dexterity','agility','charisma','bladeburner_success_chance','bladeburner_max_stamina','bladeburner_analysis'].every(key=>mult(key)>=1))return no('Entropy would weaken known Bladeburner capability');
  const regen=forecast.staminaRecovery?.regen,hrc=forecast.staminaRecovery?.hrc,gain=mult('bladeburner_stamina_gain');
  if(forecast.recoveryModel!=='amortized-native'||![regen,hrc,forecast.recoveryMs].every(Number.isFinite)||regen<=0||hrc<0||forecast.recoveryMs<=0||!(gain>1))return no('No priced native stamina recovery improvement');
  saved=Math.min(remaining,forecast.recoveryMs)*(1-(regen+hrc)/(regen*gain+hrc))*.5;basis='native-stamina-half-credit';
 }else return no('Unknown progression route');
 const cashRebuildMs=(cost+lostIncome)/rate*1000,overhead=duration+cashRebuildMs;
 const payback=saved>0?overhead/(saved/remaining):Infinity,netSavedMs=saved-overhead;
 return {eligible:Number.isFinite(payback)&&payback<=Math.min(maxPayback,remaining*.75)&&netSavedMs>=Math.max(60000,remaining*.05),
  reason:'Discounted route saving after graft time and cash replacement',basis,payback:Number.isFinite(payback)?payback:null,
  netSavedMs,savedMs:saved,overheadMs:overhead,cashRebuildMs,remainingMs:remaining};
}
