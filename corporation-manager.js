import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import {achievementActionAllowed} from './achievement-policy.js';
import { claimSpending } from './spending-policy.js';
import { treasuryPolicy, recoveryJobCounts, priorSaleMultiplier, partySpendPerEmployee, materialSalePrice, outputBacklog, boostPurchaseBudget, productPriceStep, researchAffordable, salesPotential, formulaSalePrice, inferProductMarkup, supportAdvertLimit } from './corporation-policy.js';
import { researchParents, extraResearch, productInvestment, investmentDecision, rescueShareIssue, shareSale, shareBuyback, recipeInputPlan } from './corporation-lifecycle.js';
import { getNsDataThroughFile } from './helpers.js';
import { isScriptPaused } from './automation-control.js';
/** Standalone corporation controller: recipe-based supply, research, products,
 * expansion and finances. All discretionary spending preserves operating reserves.
 * Investor ownership cannot be recovered; share actions preserve min-ownership.
 * Custom products and existing export routes are preserved. */
import { optimalBoostTargets, chooseRetirement, upgradeReturn } from './automation-policy.js';

export async function main(ns) {
 registerAutomation(ns);
    if (isScriptPaused(ns, ns.getScriptName())) return;
    if (ns.ps("home").some(process => process.filename === ns.getScriptName() && process.pid !== ns.pid)) return;
  const options = typeof ns.flags === 'function' ? ns.flags([
    ['min-ownership', 0.5], ['expand-all-industries', true], ['manage-shares', true], ['bribe-factions', true],
  ]) : { 'min-ownership': 0.5, 'expand-all-industries': true, 'manage-shares': true, 'bribe-factions': true };
  const minOwnership = Number(options['min-ownership']);
  if (!(minOwnership > 0 && minOwnership <= 1)) { ns.tprint('min-ownership must be greater than zero and at most one.'); return; }
  const c = ns.corporation;
  const cities = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];
  const name = "Apex Holdings";
  const agri = "Agri";
  const restaurant = "Dining";
  const chem = "Chem";
  const tobacco = "Tobacco";
  const CITY_EXPAND_BUFFER = 5e9;
  const WAREHOUSE_BUFFER = 5e9;
  let reserve = 5e9;
  let boostBudget = 0;
  const officeJobs = ["Operations", "Engineer", "Business", "Management", "Research & Development", "Intern"];
  let recovering = false;
  let upkeepBudget = 0;
  let growthBank = null;
  const constants = (() => { try { return c.getConstants(); } catch { return {}; } })();
  const cycleSeconds = Number(constants.secondsPerMarketCycle) || 10;
  const teaCostPerEmployee = Number(constants.teaCostPerEmployee) || 500000;

  // ---- Dividend strategy ------------------------------------------------
  const DIVIDEND_TIERS = [
    [1e21, 0.20],
    [1e18, 0.10],
    [1e15, 0.05],
    [1e13, 0.02],
    [0,    0.00],
  ];
  const DIVIDEND_MAX = (() => {
    try {
      const v = c.getConstants().dividendMaxRate;
      return Number.isFinite(v) ? v : 1;
    } catch { return 1; }
  })();
  const dividendRateFor = (cash) => {
    for (const [threshold, rate] of DIVIDEND_TIERS)
      if (cash >= threshold) return Math.min(rate, DIVIDEND_MAX);
    return 0;
  };
  const PAY_DIVIDENDS = true;
  const IPO_VALUATION = 1e12;
  const ACCEPT_INVESTMENT = true;
  let lastDividendRate = -1,financeDecision=null,financeHistory=null,lastShareSaleAt=0;
  const financeFile='tasks/corporation-finance.json';

  // ---- Hash spend plan --------------------------------------------------
  const HASH_SPEND_PLAN = [
    "Sell for Corporation Funds",
    "Exchange for Corporation Research",
  ];
  let hashSpendIndex = 0;
  const SELL_HASHES_FOR_CORP = true;
  const MAX_HASH_COST_PER_PURCHASE = 5000;

  // ---- Hacknet server management ----------------------------------------
  const BUY_HACKNET_SERVERS = true;
  const HACKNET_SPEND_FRACTION = 0.05;
  const HACKNET_MAX_SERVERS = 20;
  const HACKNET_CACHE_TARGET = 4;

  // ---- Upgrade priority -------------------------------------------------

  // ---- Chemical quality loop --------------------------------------------
  const EXPORT_FORMULA = "(IPROD+IINV/10)*(-1)";
  const CHEM_FUNDS_GATE = 2e11;

  // ---- AdVert budget ----------------------------------------------------
  const ADVERT_SPEND_FRACTION = 0.50;

  // ---- Office upkeep ----------------------------------------------------
  // Upkeep is budgeted across offices rather than spending a fixed party amount.


  // ---- Boost target -----------------------------------------------------
  const BOOST_WAREHOUSE_FRACTION = 0.60;

  // ---- Research orders --------------------------------------------------
  const MATERIAL_RESEARCH_ORDER = [
    "Hi-Tech R&D Laboratory",
    "AutoBrew",
    "AutoPartyManager",
    "Market-TA.I",
    "Market-TA.II",
    "Self-Correcting Assemblers",
    "Drones",
    "Drones - Assembly",
    "Drones - Transport",
    "Overclock",
    "Sti.mu",
  ];
  const PRODUCT_RESEARCH_ORDER = [
    "Hi-Tech R&D Laboratory",
    "AutoPartyManager",
    "AutoBrew",
    "Market-TA.I",
    "Market-TA.II",
    "uPgrade: Fulcrum",
    "uPgrade: Capacity.I",
    "uPgrade: Capacity.II",
    "uPgrade: Dashboard",
    "Self-Correcting Assemblers",
    "Drones",
    "Drones - Assembly",
    "Drones - Transport",
    "Overclock",
    "Sti.mu",
  ];

  const safeDisableLog = (label) => { try { ns.disableLog(label); } catch {} };
  safeDisableLog("sleep");
  safeDisableLog("corporation.nextUpdate");

  const safe = (label, fn) => {
    try { return fn(); }
    catch (error) { ns.print(`${label}: ${String(error)}`); return undefined; }
  };
  const corp = () => safe("getCorporation", () => c.getCorporation());
  const funds = () => corp()?.funds ?? 0;
  const divisions = () => corp()?.divisions ?? [];
  const hasDivision = (division) => divisions().includes(division);
  const hasUnlock = (unlock) => safe(`hasUnlock ${unlock}`, () => c.hasUnlock(unlock)) === true;
  const attempt = (label, fn) => safe(label, () => fn() !== false) === true;
  const resetInfo = safe("Read reset information", () => ns.getResetInfo());
  const sourceFiles = resetInfo?.ownedSF;
  const sf = (n) => typeof sourceFiles?.get === "function" ? sourceFiles.get(n) : sourceFiles?.[n];
  const hasSourceFile3 = Number(sf(3)) > 0;
  if (!resetInfo || (resetInfo.currentNode !== 3 && !hasSourceFile3)) {
    ns.tprint("Corporation manager stopped: requires BitNode 3 or Source-File 3 access.");
    return;
  }
  try{const saved=JSON.parse(ns.read(financeFile));if(saved.nodeReset===resetInfo.lastNodeReset&&saved.corporation===corp()?.name){financeHistory=saved.history;lastShareSaleAt=Number(saved.lastShareSaleAt)||0;}}catch{}
  const hasHacknetServers = () =>
    resetInfo.currentNode === 9 || Number(sf(9)) > 0;

  const attemptCreate = (selfFund) => {
    const label = selfFund ? "self-fund" : "seed";
    const eligible = safe(`Check ${label} eligibility`, () => c.canCreateCorporation(selfFund));
    if (eligible !== "Success") return { ok: false, reason: `${label}: ${String(eligible)}` };
    safe(`Create corporation (${label})`, () => c.createCorporation(name, selfFund));
    if (safe("Confirm corporation", () => c.hasCorporation()) === true)
      return { ok: true, label };
    return { ok: false, reason: `${label}: creation rejected` };
  };

  while (!safe("Check corporation API", () => c.hasCorporation())) {
 automationHeartbeat(ns);
    const seed = attemptCreate(false);
    if (seed.ok) { ns.print(`Created ${name} with seed money.`); break; }
    const self = attemptCreate(true);
    if (self.ok) { ns.print(`Created ${name} with self-funding.`); break; }
    ns.print(`Waiting for corporation creation eligibility (${seed.reason}; ${self.reason}).`);
    await ns.sleep(60_000);
  }

  const expand = (division, city) => {
    const d = safe(`Read division ${division}`, () => c.getDivision(division));
    if (d && !d.cities.includes(city) && funds() > reserve + CITY_EXPAND_BUFFER)
      attempt(`Expand ${division} to ${city}`, () => c.expandCity(division, city));
  };
  const createDivision = (industry, division) => {
    if (hasDivision(division)) return true;
    const data = safe(`Get ${industry} data`, () => c.getIndustryData(industry));
    const start = data?.startingCost;
    if (Number.isFinite(start) && funds() > start + reserve * 2)
      return attempt(`Create ${industry} division`, () => c.expandIndustry(industry, division));
    return false;
  };
  const buyUnlock = (unlock) => {
    if (hasUnlock(unlock)) return;
    const cost = safe(`Get ${unlock} cost`, () => c.getUnlockCost(unlock));
    if (Number.isFinite(cost) && funds() > cost + reserve)
      attempt(`Buy ${unlock}`, () => c.purchaseUnlock(unlock));
  };
  const capitalPurchase = (label, cost, fn) => {
    if (recovering || !Number.isFinite(cost) || cost <= 0 || cost > growthBank || funds() <= reserve + cost) return false;
    const before = funds();
    if (!attempt(label, fn)) return false;
    const spent = Math.max(0, before - funds());
    growthBank = Math.max(0, growthBank - spent);
    return spent > 0;
  };
  const advertQueue=new Set();
  const hireAdVert=division=>advertQueue.add(division);
  const buyAdVert = (division) => {
    const d=safe('Read advertising division',()=>c.getDivision(division));
    let goals;try{goals=JSON.parse(ns.read('tasks/achievement-goals.json'));}catch{}
    if(!d||supportAdvertLimit(d,goals?.expiresAt>Date.now()&&goals.finance)||d.awareness===Number.MAX_VALUE&&d.popularity===Number.MAX_VALUE)return;
    const adCost = safe(`Get AdVert cost (${division})`, () => c.getHireAdVertCost(division));
    const cash = funds();
    if (!Number.isFinite(adCost) || adCost > cash * ADVERT_SPEND_FRACTION || cash <= adCost + reserve)
      return;
    capitalPurchase(`Hire AdVert (${division})`, adCost, () => c.hireAdVert(division));
  };

  // ---- IPO / dividends --------------------------------------------------
  const manageIPO = () => {
    if (!PAY_DIVIDENDS) return;
    const info = corp();
    if (!info || info.public || financeDecision?.holdIPO) return;
    const valuation = Number(info.valuation) || 0;
    if (valuation < IPO_VALUATION) return;
    if (attempt("Go public", () => c.goPublic(0)))
      ns.print(`IPO at $${ns.format.number(valuation)} valuation; issued 0 shares.`);
  };

  const manageDividends = () => {
    if (!PAY_DIVIDENDS) return;
    const info = corp();
    if (!info?.public) return;
    const wallet = Number(ns.getPlayer().money) || 0;
    const playerReserve = Math.max(0, Number(ns.read('reserve.txt')) || 0);
    const rate = recovering || Number(info.revenue) <= Number(info.expenses) ? 0 :
      Math.min(DIVIDEND_MAX, Math.max(dividendRateFor(funds()), wallet < playerReserve + 1e9 && funds() > reserve * 5 ? 0.2 : 0));
    if (rate === lastDividendRate) return;
    if (attempt(`Set dividend rate ${(rate * 100).toFixed(0)}%`, () => c.issueDividends(rate)))
      lastDividendRate = rate;
  };

  // ---- Hash spends ------------------------------------------------------
  const spendHashes = () => {
    if(!achievementActionAllowed(ns,"hashSpending"))return null;
    if (!SELL_HASHES_FOR_CORP || !hasHacknetServers()) return null;

    let available = 0;
    try { available = Number(ns.hacknet.numHashes()) || 0; }
    catch { return null; }

    for (let n = 0; n < HASH_SPEND_PLAN.length; n++) {
      const idx = (hashSpendIndex + n) % HASH_SPEND_PLAN.length;
      const target = HASH_SPEND_PLAN[idx];

      let cost = 0;
      try { cost = Number(ns.hacknet.hashCost(target)); }
      catch { continue; }
      if (!Number.isFinite(cost) || cost <= 0 || cost > MAX_HASH_COST_PER_PURCHASE) continue;
      if (available < cost) continue;

      if (attempt(`Spend hashes on ${target}`, () => ns.hacknet.spendHashes(target))) {
        hashSpendIndex = (idx + 1) % HASH_SPEND_PLAN.length;
        return target;
      }
    }
    return null;
  };

  // ---- Hacknet server management ----------------------------------------
  const manageHacknetServers = () => {
    if (!BUY_HACKNET_SERVERS || !hasHacknetServers() || !achievementActionAllowed(ns,"hacknetExpense")) return;

    let numNodes = 0;
    try { numNodes = ns.hacknet.numNodes(); }
    catch { return; }
    const playerReserve = Math.max(0, Number(ns.read('reserve.txt')) || 0);
    let budget = Math.max(0, ns.getPlayer().money - playerReserve) * HACKNET_SPEND_FRACTION;
    const canSpend = cost => Number.isFinite(cost) && cost > 0 && cost <= budget && ns.getPlayer().money >= cost + playerReserve;
    if (budget <= 0) return;

    let bought = 0;
    while (numNodes < HACKNET_MAX_SERVERS && bought < 3) {
      let cost = Infinity;
      try { cost = ns.hacknet.getPurchaseNodeCost(); }
      catch { cost = Infinity; }
      if (!canSpend(cost)) break;
      try { if(claimSpending(ns,"hacknet",cost))ns.hacknet.purchaseNode(); }
      catch { break; }
      const after = ns.hacknet.numNodes();
      if (after <= numNodes) break;
      budget = Math.max(0, budget - cost);
      numNodes = after;
      bought++;
    }

    if (numNodes === 0) return;

    const stats = [];
    for (let i = 0; i < numNodes; i++) {
      const s = safe(`Read hacknet node ${i}`, () => ns.hacknet.getNodeStats(i));
      if (s) stats.push({ i, s });
    }

    const totalCapacity = stats.reduce((sum, { s }) => sum + (Number(s.hashCapacity) || 0), 0);
    const currentHashes = Number(ns.hacknet.numHashes()) || 0;
    const capacityTight = totalCapacity > 0 && currentHashes > totalCapacity * 0.5;

    if (capacityTight) {
      let bestCache = null;
      for (const { i, s } of stats) {
        if (s.cache === undefined || s.cache >= HACKNET_CACHE_TARGET) continue;
        const cost = safe(`cache cost ${i}`, () => ns.hacknet.getCacheUpgradeCost(i, 1));
        if (!canSpend(cost)) continue;
        if (!bestCache || cost < bestCache.cost) bestCache = { i, cost };
      }
      if (bestCache && canSpend(bestCache.cost) && claimSpending(ns,"hacknet",bestCache.cost)) {
        attempt(`Upgrade cache on node ${bestCache.i}`, () => ns.hacknet.upgradeCache(bestCache.i, 1));
        return;
      }
    }

    let best = null;
    for (const { i, s } of stats) {
      const level = Math.max(1, Number(s.level) || 1);
      const ram = Math.max(1, Number(s.ram) || 1);
      const cores = Math.max(1, Number(s.cores) || 1);
      const rateProxy = 0.001 * level * Math.pow(1.07, Math.log2(ram)) * (1 + (cores - 1) / 5);
      if (!Number.isFinite(rateProxy) || rateProxy <= 0) continue;

      const candidates = [
        { type: "level", value: rateProxy / level,
          cost: safe(`level cost ${i}`, () => ns.hacknet.getLevelUpgradeCost(i, 1)) },
        { type: "ram", value: rateProxy * 0.07,
          cost: safe(`ram cost ${i}`, () => ns.hacknet.getRamUpgradeCost(i, 1)) },
        { type: "core", value: rateProxy / (cores + 4),
          cost: safe(`core cost ${i}`, () => ns.hacknet.getCoreUpgradeCost(i, 1)) },
      ];
      for (const cand of candidates) {
        if (!Number.isFinite(cand.cost) || cand.cost <= 0) continue;
        if (!canSpend(cand.cost)) continue;
        const ratio = cand.value / cand.cost;
        if (!best || ratio > best.ratio) best = { ...cand, i, ratio };
      }
    }
    if (!best || !canSpend(best.cost) || !claimSpending(ns,"hacknet",best.cost)) return;
    const upgradeFns = {
      level: () => ns.hacknet.upgradeLevel(best.i, 1),
      ram:   () => ns.hacknet.upgradeRam(best.i, 1),
      core:  () => ns.hacknet.upgradeCore(best.i, 1),
    };
    attempt(`Upgrade ${best.type} on node ${best.i}`, upgradeFns[best.type]);
  };

  // ---- Material export supply chain -------------------------------------
  // exportMaterial throws when either the source or the target warehouse is
  // missing. Both are gated on hasWarehouse so the call only fires when the
  // route is legal. Routes are cached in exportRoutes so the attempt only
  // happens once per (source, city, target, material) tuple per session.
  const exportRoutes = new Set();
  const setupExportChain = (sourceDiv, sourceMat, targetDiv) => {
    const d = safe(`Read ${sourceDiv}`, () => c.getDivision(sourceDiv));
    if (!d?.cities?.length) return;
    for (const city of d.cities) {
      const key = `${sourceDiv}|${city}|${targetDiv}|${sourceMat}`;
      if (exportRoutes.has(key)) continue;
      const material = safe('Read existing export routes', () => c.getMaterial(sourceDiv, city, sourceMat));
      if (Array.isArray(material?.exports)) {
        if (material.exports.some(route => route.division === targetDiv && route.city === city)) continue;
      }
      if (!safe(`Check ${sourceDiv}/${city} wh`, () => c.hasWarehouse(sourceDiv, city))) continue;
      if (!safe(`Check ${targetDiv}/${city} wh`, () => c.hasWarehouse(targetDiv, city))) continue;
      if (attempt(`Export ${sourceMat} → ${targetDiv}`, () =>
        c.exportMaterial(sourceDiv, city, targetDiv, city, sourceMat, EXPORT_FORMULA)))
        exportRoutes.add(key);
    }
  };
  const manageExports = () => {
    const data = divisions().map(name => {
      const division = safe('Read export division', () => c.getDivision(name));
      return { name, industry: division && safe('Read export recipe', () => c.getIndustryData(division.industry)) };
    }).filter(item => item.industry);
    const routes = [];
    data.sort((a,b)=>Number(b.industry.makesProducts)-Number(a.industry.makesProducts));
    for (const target of data) for (const material of Object.keys(target.industry.requiredMaterials || {})) {
      const source = data.find(item => item.name !== target.name && item.industry.producedMaterials?.includes(material));
      if (source) routes.push([source.name, material, target.name]);
    }
    if (!routes.length) return;
    buyUnlock('Export');
    if (!hasUnlock('Export') || !hasUnlock('Warehouse API')) return;
    for (const route of routes) setupExportChain(...route);
  };

  // ---- Per-city office management ---------------------------------------
  const inCity = (division, city) =>
    safe(`Read division ${division}`, () => c.getDivision(division))?.cities?.includes(city) === true;
  const runOffice = (division, city, production, productDivision = false) => {
    if (!hasUnlock("Office API")) return;
    let office = safe(`Read office ${division}/${city}`, () => c.getOffice(division, city));
    if (!office) return;
    let target = productDivision
      ? (funds() > 1e15 ? 120 : funds() > 1e14 ? 100 : funds() > 1e13 ? 80 : funds() > 1e12 ? 60 : 30)
      : (funds() > 1e13 ? 60 : funds() > 5e12 ? 45 : funds() > 1e12 ? 30 : funds() > 1e11 ? 20 : funds() > 1e10 ? 15 : funds() > 1e9 ? 9 : 3);
      let achievements;try{achievements=JSON.parse(ns.read('tasks/achievement-goals.json'));}catch{}
      if(achievements?.expiresAt>Date.now()&&achievements.finance&&!achievements.owned?.includes('CORPORATION_EMPLOYEE_3000'))target=Math.max(target,500);
      if (office.size < target) {
      const add = target - office.size;
      const cost = safe("Get office size cost", () => c.getOfficeSizeUpgradeCost(division, city, add));
      if (Number.isFinite(cost) && funds() > cost + reserve) {
        attempt("Upgrade office", () => c.upgradeOfficeSize(division, city, add));
        office = safe("Refresh office", () => c.getOffice(division, city)) ?? office;
      }
    }
    for (let i = office.numEmployees ?? 0; i < (office.size ?? 0); i++) {
      if (!safe("Hire employee", () => c.hireEmployee(division, city))) break;
    }
    office = safe("Refresh employees", () => c.getOffice(division, city)) ?? office;
    const employees = office.numEmployees ?? 0;
    if (employees > 0) {
      const recoveryGap = Number(office.employeeJobs?.Intern) > 0 ? 2 : 5;
      const needsRecovery = office.avgEnergy < (office.maxEnergy ?? 100) - recoveryGap || office.avgMorale < (office.maxMorale ?? 100) - recoveryGap;
      const cannotFundUpkeep = recovering || upkeepBudget < employees * teaCostPerEmployee;
      const counts = recoveryJobCounts(employees, production, needsRecovery && cannotFundUpkeep);
      const jobs = office.employeeJobs;
      const aligned = jobs && officeJobs.every((job, i) => Number(jobs[job] ?? -1) === counts[i]);
      if (!aligned) {
        for (const job of officeJobs) attempt(`Clear ${job}`, () => c.setJobAssignment(division, city, job, 0));
        for (let i = 0; i < officeJobs.length; i++)
          if (counts[i]) attempt(`Assign ${officeJobs[i]}`, () => c.setJobAssignment(division, city, officeJobs[i], counts[i]));
      }
      const teaCost = employees * teaCostPerEmployee;
      if (!recovering && office.avgEnergy < (office.maxEnergy ?? 100) - 2 && teaCost <= upkeepBudget && funds() >= reserve + teaCost) {
        const success = safe('Buy employee tea', () => c.buyTea(division, city));
        if (success === true) upkeepBudget -= teaCost;
      }
      const allowance = Math.max(0, Math.min(upkeepBudget, funds() - reserve));
      const partyPerEmployee = partySpendPerEmployee(office.avgMorale, office.maxMorale ?? 100, employees, allowance);
      if (!recovering && partyPerEmployee > 0) {
        const result = safe('Throw budgeted party', () => c.throwParty(division, city, partyPerEmployee));
        if (Number(result) > 1) upkeepBudget -= partyPerEmployee * employees;
      }
    }
  };

  // ---- Agriculture inputs and boosts ------------------------------------
  let inputBudget = 0;
  const manageInputs = (division, city) => {
    const d = safe('Read input division', () => c.getDivision(division));
    const industry = d && safe('Read input recipe', () => c.getIndustryData(d.industry));
    if (!industry) return;
    const recipe = industry.requiredMaterials || {};
    if (hasUnlock('Smart Supply')) {
      for (const material of Object.keys(recipe)) {
        attempt('Clear manual input', () => c.buyMaterial(division, city, material, 0));
        if (constants.smartSupplyOptions?.includes('leftovers'))
          attempt('Use exports before purchased inputs', () => c.setSmartSupplyOption(division, city, material, 'leftovers'));
      }
      return;
    }
    let production = 0;
    for (const material of industry.producedMaterials || [])
      production = Math.max(production, Number(safe('Read input demand', () => c.getMaterial(division, city, material))?.productionAmount) || 0);
    for (const product of d.products || [])
      production += Number(safe('Read product input demand', () => c.getProduct(division, city, product))?.productionAmount) || 0;
    const items = Object.fromEntries(Object.keys(recipe).map(material => [material, safe('Read input inventory', () => c.getMaterial(division, city, material))]));
    const warehouse = safe('Read input storage', () => c.getWarehouse(division, city));
    const budget = warehouse && warehouse.sizeUsed < warehouse.size * 0.95 ? Math.min(inputBudget, Math.max(0, funds() - reserve)) : 0;
    const plan = recipeInputPlan(recipe, items, production, budget, cycleSeconds);
    for (const order of plan.orders) attempt('Set recipe input rate', () => c.buyMaterial(division, city, order.name, order.rate));
    inputBudget -= plan.cost;
    reserve += plan.cost; // These rates will be charged during PURCHASE; reserve them now.
  };
  const boosts = [
    { name: "Real Estate", factor: 0.72, size: 0.005 },
    { name: "Hardware", factor: 0.2, size: 0.06 },
    { name: "Robots", factor: 0.3, size: 0.5 },
    { name: "AI Cores", factor: 0.3, size: 0.1 },
  ];
  const boostKeys = { 'Real Estate': 'realEstateFactor', Hardware: 'hardwareFactor', Robots: 'robotFactor', 'AI Cores': 'aiCoreFactor' };
  // buyMaterial sets a rate the game charges every PURCHASE cycle until
  // overwritten. Every early return in manageBoosts must zero the rate,
  // otherwise a stale rate from a prior cycle keeps draining funds.
  const recipeBoosts = division => {
    const d = safe('Read boost recipe division', () => c.getDivision(division));
    return d && safe('Read boost recipe', () => c.getIndustryData(d.industry))?.requiredMaterials || {};
  };
  const clearBoostRates = (division, city) => {
    const recipe = recipeBoosts(division);
    for (const b of boosts.filter(item => !(item.name in recipe)))
      attempt(`Clear ${b.name} buy rate`, () => c.buyMaterial(division, city, b.name, 0));
  };
  const manageBoosts = (city, division = agri) => {
    if (boostBudget <= 0) { clearBoostRates(division, city); return; }
    const wh = safe("Read warehouse", () => c.getWarehouse(division, city));
    if (!wh) return;
    const full = wh.sizeUsed / Math.max(1, wh.size) > 0.9;
    const divisionInfo = safe(`Read ${division}`, () => c.getDivision(division));
    const industry = safe('Read industry factors', () => c.getIndustryData(divisionInfo?.industry));
    const materials = boosts.filter(b => !(b.name in (industry?.requiredMaterials || {}))).map(b => ({ ...b,
      factor: Number.isFinite(industry?.[boostKeys[b.name]]) ? industry[boostKeys[b.name]] : b.factor,
      size: Number(safe(`Read ${b.name} size`, () => c.getMaterialData(b.name))?.size) || b.size,
    }));
    const targets = optimalBoostTargets(materials, wh.size * BOOST_WAREHOUSE_FRACTION);
    const plan = materials.map((b) => {
      const item = safe(`Read ${b.name}`, () => c.getMaterial(division, city, b.name));
      const target = targets[b.name];
      const price = Number(item?.marketPrice) || 0;
      const need = full || price <= 0 ? 0 : Math.max(0, target - (Number(item?.stored) || 0));
      return { name: b.name, need, cost: need * price };
    });
    const total = plan.reduce((a, p) => a + p.cost, 0);
    if (total <= 0) { clearBoostRates(division, city); return; }
    const spend = Math.max(0, Math.min(boostBudget, total, funds() - reserve));
    const scale = total > spend ? spend / total : 1;
    boostBudget -= total * scale;
    for (const p of plan)
      attempt(`Set ${p.name} buy rate`, () => c.buyMaterial(division, city, p.name, (p.need * scale) / cycleSeconds));
  };

  // ---- Research ---------------------------------------------------------
  const runResearch = (division, order) => {
    const d=safe('Read research division',()=>c.getDivision(division));
    if(!d)return;
    const points=d.researchPoints??0;
    if(safe('Check laboratory',()=>c.hasResearched(division,'Hi-Tech R&D Laboratory'))!==true){
      const cost=safe('Laboratory cost',()=>c.getResearchCost(division,'Hi-Tech R&D Laboratory'));
      if(researchAffordable(points,cost,.5))attempt('Research laboratory',()=>c.research(division,'Hi-Tech R&D Laboratory'));
      return;
    }
    if(!hasTA2(division)){
      const hasTA1=safe('Check TA.I',()=>c.hasResearched(division,'Market-TA.I'))===true;
      const first=hasTA1?0:safe('TA.I cost',()=>c.getResearchCost(division,'Market-TA.I'));
      const second=safe('TA.II cost',()=>c.getResearchCost(division,'Market-TA.II'));
      if(Number.isFinite(first)&&Number.isFinite(second)&&researchAffordable(points,first+second,.5)){
        if(!hasTA1&&!attempt('Research TA.I',()=>c.research(division,'Market-TA.I')))return;
        if(safe('Confirm TA.I',()=>c.hasResearched(division,'Market-TA.I'))===true)attempt('Research TA.II',()=>c.research(division,'Market-TA.II'));
      }
      return; // Preserve points toward automated pricing before optional research.
    }
    const available=[...order,...extraResearch,...(constants.researchNamesBase||[]),...(d.makesProducts?constants.researchNamesProductOnly||[]:[])];
    const optionalAutomation=new Set(['AutoBrew','AutoPartyManager','HRBuddy-Recruitment','HRBuddy-Training','uPgrade: Dashboard']);
    for(const name of new Set(available)){
      if(optionalAutomation.has(name))continue;
      if(safe(`Check ${name}`,()=>c.hasResearched(division,name))===true)continue;
      const parent=researchParents[name]||'Hi-Tech R&D Laboratory';
      if(safe(`Check research prerequisite ${parent}`,()=>c.hasResearched(division,parent))!==true)continue;
      const cost=safe(`Get ${name} cost`,()=>c.getResearchCost(division,name));
      if(researchAffordable(points,cost))attempt(`Research ${name}`,()=>c.research(division,name));
      break;
    }
  };
  const hasTA2 = (division) => safe(`Check TA.II ${division}`, () => c.hasResearched(division, "Market-TA.II")) === true;

  // ---- Warehouse management ---------------------------------------------
  // A sales backlog needs pricing recovery before more storage spending.
  let storagePressure = false;
  const runWarehouse = (division, city) => {
    if (!hasUnlock("Warehouse API")) return;
    let has = safe("Check warehouse", () => c.hasWarehouse(division, city)) === true;
    if (!has && funds() > reserve + WAREHOUSE_BUFFER) {
      attempt("Purchase warehouse", () => c.purchaseWarehouse(division, city));
      has = safe("Check warehouse after purchase", () => c.hasWarehouse(division, city)) === true;
    }
    if (!has) return;
    const wh = safe("Read warehouse", () => c.getWarehouse(division, city));
    const divisionData = safe('Read warehouse division', () => c.getDivision(division));
    const industryData = safe('Read warehouse outputs', () => c.getIndustryData(divisionData?.industry));
    const outputs = (industryData?.producedMaterials || []).map(material => safe('Read warehouse output', () => c.getMaterial(division, city, material)));
    if (divisionData?.makesProducts) for (const product of divisionData.products || [])
      outputs.push(safe('Read warehouse product', () => c.getProduct(division, city, product)));
    const backlog = outputBacklog(outputs);
    let used = wh ? wh.sizeUsed / Math.max(1, wh.size) : 0;
    if (used > 0.8) storagePressure = true;
    for (let level = 0; level < 5 && used > 0.7 && !backlog; level++) {
      const cost = safe("Get warehouse upgrade cost", () => c.getUpgradeWarehouseCost(division, city));
      if (!Number.isFinite(cost) || funds() <= cost + reserve) break;
      if (!attempt("Upgrade warehouse", () => c.upgradeWarehouse(division, city))) break;
      const next = safe("Refresh warehouse", () => c.getWarehouse(division, city));
      used = next ? next.sizeUsed / Math.max(1, next.size) : 0;
    }
    if (hasUnlock("Smart Supply")) attempt("Enable Smart Supply", () => c.setSmartSupply(division, city, true));
  };

  // ---- Selling ----------------------------------------------------------
  const productMarkup=new Map(),markupCandidates=new Map(),pricingObservations=new Map();
  const formulaPricing=(division,city,item,materialData=null)=>{
    const d=safe('Read pricing division',()=>c.getDivision(division));
    const industry=d&&safe('Read pricing industry',()=>c.getIndustryData(d.industry));
    const office=safe('Read pricing office',()=>c.getOffice(division,city));
    const bots=safe('Read sales bots',()=>c.getUpgradeLevel('ABC SalesBots'));
    const potential=salesPotential(item,d,industry,office,bots,!!d?.makesProducts);
    if(!potential)return null;
    const key=division+'/'+city+'/'+item.name,markupKey=division+'/'+item.name;
    if(d.makesProducts){
      const previous=pricingObservations.get(key);
      const stable=previous?.potential>0&&Math.abs(potential/previous.potential-1)<.05&&previous.rating>0&&Math.abs(Number(item.effectiveRating)/previous.rating-1)<.05&&previous.base>0&&Math.abs(Number(item.productionCost)/previous.base-1)<.05;
      const observed=stable?inferProductMarkup(item,previous):null;
      if(observed&&!productMarkup.has(markupKey)){
        const candidate=markupCandidates.get(markupKey);
        if(candidate&&Math.abs(observed/candidate-1)<.1)productMarkup.set(markupKey,(observed+candidate)/2);
        else markupCandidates.set(markupKey,observed);
      }
      const markup=productMarkup.get(markupKey);
      if(!markup)return {potential,key};
      return {...formulaSalePrice(item,potential,Math.max(item.effectiveRating,.001)/markup,cycleSeconds),key};
    }
    return formulaSalePrice(item,potential,Number(item.quality)/Number(materialData?.baseMarkup),cycleSeconds);
  };
  const saleMultipliers = new Map();
  const saleTimes = new Map();
  const salePrice = (key, item, automated) => {
    if (automated) return 'MP';
    let state=saleMultipliers.get(key)||{multiplier:priorSaleMultiplier(item?.desiredSellPrice)};
    // Tune after each full market cycle, using only completed sales feedback.
    if(Date.now()-(saleTimes.get(key)||0)>=cycleSeconds*1000){
      state=productPriceStep(item,state,cycleSeconds);
      saleMultipliers.set(key,state);saleTimes.set(key,Date.now());
    }
    const multiplier=state.multiplier;
    return `MP*${multiplier}`;
  };
  // sellMaterial throws when the city has no warehouse. Cities are expanded
  // as funds allow, and warehouses are gated separately on reserve + buffer,
  // so a city can exist without a warehouse. Skip those.
  const sellMaterials = (division, materials) => {
    const d = safe(`Read division ${division}`, () => c.getDivision(division));
    if (!d || d.makesProducts) return;
    const ta2 = hasTA2(division);
    for (const city of d.cities ?? []) {
      if (!safe(`Check ${division}/${city} warehouse`, () => c.hasWarehouse(division, city))) continue;
      for (const material of materials) {
        const item = safe(`Read ${material} sale`, () => c.getMaterial(division, city, material));
        const data = ta2 ? null : safe('Read material markup', () => c.getMaterialData(material));
        const price = ta2 ? 'MP' : formulaPricing(division,city,item,data)?.price || materialSalePrice(item, data);
        attempt(`Sell ${material}`, () => c.sellMaterial(division, city, material, "MAX", price));
        if (ta2)
          attempt(`Market-TA.II ${material}`, () => c.setMaterialMarketTA2(division, city, material, true));
      }
    }
  };

  const sellProducts = (division) => {
    const d = safe(`Read division ${division}`, () => c.getDivision(division));
    if (!d) return;
    const activeCities = d.cities ?? [];
    if (!activeCities.length) return;
    const ta2 = hasTA2(division);
    for (const product of d.products ?? []) {
      const ready = activeCities.every((city) => {
        const item = safe(`Read ${product} in ${city}`, () => c.getProduct(division, city, product));
        return item?.developmentProgress >= 100;
      });
      if (!ready) continue;
      if (ta2) {
        attempt(`Sell ${product}`, () => c.sellProduct(division, activeCities[0], product, "MAX", "MP", true));
        attempt(`Market-TA.II ${product}`, () => c.setProductMarketTA2(division, product, true));
      } else for (const city of activeCities) {
        const item = safe(`Read ${product} sale`, () => c.getProduct(division, city, product));
        const formula=formulaPricing(division,city,item);
        const price=formula?.price||salePrice(`${division}/${city}/${product}`,item,false);
        if(formula?.potential){
          const premium=formula.premium??Math.max(0,(priorSaleMultiplier(price)-1)*Number(item.productionCost));
          pricingObservations.set(formula.key,{potential:formula.potential,target:formula.target??Number(item.productionAmount)+Number(item.stored)/cycleSeconds,premium,rating:Number(item.effectiveRating),base:Number(item.productionCost)});
        }
        if(typeof c.setProductMarketTA1==='function'&&safe('Check TA.I pricing',()=>c.hasResearched(division,'Market-TA.I'))===true)attempt('Disable TA.I for custom pricing',()=>c.setProductMarketTA1(division,product,false));
        attempt(`Sell ${product} in ${city}`, () => c.sellProduct(division, city, product, "MAX", price, false));
      }
    }
  };

  const productComplete = (division, product, cityList) =>
    cityList.every((city) => {
      const item = safe(`Read ${product} in ${city}`, () => c.getProduct(division, city, product));
      return item?.developmentProgress >= 100;
    });
  const startProduct = (division, cityList, productName, investment) => {
    for (const city of cityList) {
      if (!safe(`Check warehouse ${city}`, () => c.hasWarehouse(division, city))) continue;
      if (funds() <= 2 * investment + reserve) return;
      // Products are shared by the division. Choose one development city and
      // confirm creation before returning, rather than recreating in every city.
      attempt(`Start ${productName} in ${city}`, () => c.makeProduct(division, city, productName, investment, investment));
      if (safe(`Confirm ${productName}`, () => c.getDivision(division))?.products?.includes(productName)) return;
    }
  };

  const manageShares = () => {
    if (!options['manage-shares']) return;
    const info = corp();
    if (!info?.public) return;
    const issue = rescueShareIssue(info, reserve, minOwnership);
    if (issue > 0) { attempt('Issue emergency operating capital', () => c.issueNewShares(issue)); return; }
    const wallet = Number(ns.getPlayer().money) || 0;
    const playerReserve = Math.max(0, Number(ns.read('reserve.txt')) || 0);
    const sale = shareSale(info, wallet, playerReserve, minOwnership);
    if (sale > 0) {if(attempt('Sell shares for player liquidity',()=>c.sellShares(sale)))lastShareSaleAt=Date.now();return;}
    const buyback = recovering || Date.now()-lastShareSaleAt<60*60000 ? 0 : shareBuyback(info, wallet, playerReserve, minOwnership);
    if (buyback > 0 && claimSpending(ns,'corporation',buyback*info.sharePrice*1.25)) attempt('Recover public share ownership', () => c.buyBackShares(buyback));
  };
  let lastExpansion = 0, lastBribe = 0;
  const expandIndustries = () => {
    if (!options['expand-all-industries'] || recovering || !hasDivision(tobacco) || !hasTA2(tobacco) || Date.now() - lastExpansion < 300000) return;
    const info = corp();
    if (!(Number(info?.revenue) > Number(info?.expenses))) return;
    const current = new Set(divisions().map(division => safe('Read industry presence', () => c.getDivision(division))?.industry));
    const candidates = (constants.industryNames || []).filter(industry => !current.has(industry)).map(industry => ({
      industry, cost: Number(safe('Read expansion cost', () => c.getIndustryData(industry))?.startingCost),
    })).filter(item => item.cost > 0).sort((a, b) => a.cost - b.cost);
    const next = candidates.find(item => item.cost + 25e9 < Math.max(0, funds() - reserve) * 0.1);
    if (!next) return;
    lastExpansion = Date.now(); // Includes rejected attempts at the BitNode division cap.
    createDivision(next.industry, `Auto ${next.industry}`);
  };
  const bribeFactions = async () => {
    const info = corp();
    if (!options['bribe-factions'] || recovering || !(Number(sf(4)) > 0 || resetInfo.currentNode === 4) ||
        !(info?.valuation >= (Number(constants.bribeThreshold) || 100e12)) || Date.now() - lastBribe < 60000) return;
    lastBribe = Date.now();
    try {
      const targets = await getNsDataThroughFile(ns, `(() => {
        const owned = new Set(ns.singularity.getOwnedAugmentations(true));
        return ns.getPlayer().factions.filter(f => ns.singularity.getFactionWorkTypes(f).length).map(faction => {
          const required = Math.max(0, ...ns.singularity.getAugmentationsFromFaction(faction)
            .filter(aug => aug !== 'NeuroFlux Governor' && !owned.has(aug)).map(aug => ns.singularity.getAugmentationRepReq(aug)));
          return { faction, deficit: Math.max(0, required - ns.singularity.getFactionRep(faction)) };
        }).filter(item => item.deficit > 0).sort((a,b) => a.deficit - b.deficit);
      })()`, 'Temp/corporation-bribe-targets.txt', [], false, 1, 0, true);
      const target = targets?.[0];
      if (!target) return;
      const profit = Math.max(0, (Number(info.revenue) - Number(info.expenses)) * cycleSeconds);
      const amount = Math.min(target.deficit * (Number(constants.bribeAmountPerReputation) || 1e9), Math.max(0, funds() - reserve) * 0.001, profit * 0.05);
      if (amount >= 1e9) attempt('Bribe for useful augmentation reputation', () => c.bribe(target.faction, amount));
    } catch (error) { ns.print(`Faction support waiting: ${String(error)}`); }
  };

  // ---- Main loop --------------------------------------------------------
  let lastInvestmentCycle = 0;
  let lastUpgrade = 0;
  let lastProductAt = 0;
  let managedOnce = false;
  const productStateFile = 'tasks/corporation-product-cycle.json';
  const otherProductStateFile = 'tasks/corporation-other-product-cycles.json';
  let otherProductTimes = {};
  const lifecycleFile = 'tasks/corporation-lifecycle.json';
  try {
    const saved = JSON.parse(ns.read(lifecycleFile) || '{}');
    if (saved.nodeReset === resetInfo.lastNodeReset && saved.corporation === corp()?.name) {
      if (Number.isFinite(saved.growthBank)) growthBank = Math.max(0, saved.growthBank);
      lastExpansion = Number(saved.lastExpansion) || 0;
    }
  } catch { /* No previous lifecycle state. */ }
  try {
    const saved = JSON.parse(ns.read(otherProductStateFile) || '{}');
    if (saved.nodeReset === resetInfo.lastNodeReset && saved.corporation === corp()?.name)
      otherProductTimes = saved.divisions || {};
  } catch { }
  try {
    const previous = JSON.parse(ns.read(productStateFile) || '{}');
    if (previous.nodeReset === resetInfo.lastNodeReset && previous.corporation === corp()?.name)
      lastProductAt = Number(previous.at) || 0;
  } catch { /* First run: start with a fresh product cycle. */ }
  if (typeof ns.atExit === 'function') ns.atExit(() => {
    // Buy rates persist after a script exits. Stop this manager's boost orders.
    for (const division of divisions()) for (const city of cities) {
      try {
        if (!c.hasWarehouse(division, city)) continue;
        const d = c.getDivision(division), industry = c.getIndustryData(d.industry);
        for (const material of new Set([...boosts.map(item => item.name), ...Object.keys(industry.requiredMaterials || {})]))
          c.buyMaterial(division, city, material, 0);
      }
      catch { /* Division or warehouse may no longer exist. */ }
    }
  });
  while (!isScriptPaused(ns,ns.getScriptName())) {
    automationHeartbeat(ns);
    try {
      const info = corp();
      if (!info) { await ns.sleep(30_000); continue; }
      // START applies the previous cycle's results before the next purchases.
      // Manage once per full cycle; the first pass also handles startup mid-cycle.
      if (managedOnce && info.prevState && info.prevState !== 'START') { await c.nextUpdate(); continue; }
      managedOnce = true;
      const treasury = treasuryPolicy(info, cycleSeconds);
      reserve = treasury.reserve;
      recovering = treasury.recovering;
      upkeepBudget = treasury.upkeepBudget;

      const available = Math.max(0, funds() - reserve);
      const profit = Math.max(0, (Number(info.revenue) || 0) - (Number(info.expenses) || 0)) * cycleSeconds;
      growthBank = Math.min(available, (growthBank === null ? available * 0.2 : growthBank) + profit * 0.25);
      inputBudget = available * 0.5;
      if (ACCEPT_INVESTMENT) {
        const offer=safe('Read investment offer',()=>c.getInvestmentOffer());
        const stageReady=offer?.round<=2?hasDivision(agri)&&safe('Read agricultural reach',()=>c.getDivision(agri))?.cities?.length===6&&
          (offer.round===1||hasDivision(chem)):divisions().some(name=>{const d=safe('Read funding product stage',()=>c.getDivision(name));return d?.makesProducts&&d.products?.some(p=>safe('Read funding product',()=>c.getProduct(name,d.cities[0],p))?.developmentProgress>=100);});
        financeDecision=investmentDecision(info,offer,financeHistory,minOwnership,{reserve,cycleSeconds,stageReady});
        financeHistory=financeDecision.history;
        if(financeDecision.accept&&attempt(`Accept round ${offer.round} investment`,()=>c.acceptInvestmentOffer()))financeHistory=null;
      }
      manageShares();

      advertQueue.clear();
      exportRoutes.clear(); // Reinspect persistent routes every cycle; deduplicate calls within this pass.
      storagePressure = false;
      // Preserve cash for upcoming inputs and salaries before discretionary spending.
      const boostLocations = [];

      createDivision("Agriculture", agri);
      buyUnlock("Warehouse API");
      buyUnlock("Office API");
      buyUnlock("Smart Supply");
      const allCities = cities;

      if (hasDivision(agri)) {
        for (const city of allCities) {
          expand(agri, city);
          if (!inCity(agri, city)) continue;
          runOffice(agri, city, false);
          runWarehouse(agri, city);
          if (hasUnlock("Warehouse API") && safe("Check agricultural warehouse", () => c.hasWarehouse(agri, city))) {
            manageInputs(agri, city);
            boostLocations.push({ city, division: agri });
          }
        }
        sellMaterials(agri, ["Plants", "Food"]);
        runResearch(agri, MATERIAL_RESEARCH_ORDER);
        hireAdVert(agri);
      }

      if (hasDivision(agri) && !hasDivision(chem) && funds() > Math.max(reserve * 2, (Number(safe('Read Chemical cost', () => c.getIndustryData('Chemical'))?.startingCost) || CHEM_FUNDS_GATE / 4) * 4)) {
        const agriResearchDone = safe("Check Hi-Tech R&D (Agri)",
          () => c.hasResearched(agri, "Hi-Tech R&D Laboratory")) === true;
        if (agriResearchDone) createDivision("Chemical", chem);
      }
      if (hasDivision(chem)) {
        for (const city of allCities) {
          expand(chem, city);
          if (!inCity(chem, city)) continue;
          runOffice(chem, city, false);
          runWarehouse(chem, city);
          if (hasUnlock("Warehouse API") && safe("Check chemical warehouse", () => c.hasWarehouse(chem, city))) {
            manageInputs(chem, city);
            boostLocations.push({ city, division: chem });
          }
        }
        sellMaterials(chem, ["Chemicals"]);
        runResearch(chem, MATERIAL_RESEARCH_ORDER);
        hireAdVert(chem);
      }

      if(hasDivision(agri)&&hasDivision(chem)&&!hasDivision(tobacco)){
        const cost=Number(safe('Read Tobacco cost',()=>c.getIndustryData('Tobacco'))?.startingCost);
        if(Number.isFinite(cost)&&cost>0&&funds()>reserve+cost*2)createDivision('Tobacco',tobacco);
      }
      if(hasDivision(tobacco)&&hasTA2(tobacco)&&funds()>Math.max(reserve*2,(Number(safe('Read Restaurant cost',()=>c.getIndustryData('Restaurant'))?.startingCost)||250e9)*4))createDivision('Restaurant',restaurant);
      if(divisions().some(name=>safe('Read product data need',()=>c.getDivision(name))?.makesProducts)){
        for(const unlock of ['Market Research - Demand','Market Data - Competition']){
          const cost=hasUnlock(unlock)?Infinity:safe('Market data price',()=>c.getUnlockCost(unlock));
          if(Number.isFinite(cost)&&cost<=Math.max(0,funds()-reserve)*.2)capitalPurchase('Buy '+unlock,cost,()=>c.purchaseUnlock(unlock));
        }
      }
      if (hasDivision(restaurant)) {
        runResearch(restaurant, PRODUCT_RESEARCH_ORDER);
        for (const city of allCities) {
          expand(restaurant, city);
          if (!inCity(restaurant, city)) continue;
          runOffice(restaurant, city, true, true);
          runWarehouse(restaurant, city);
          if (hasUnlock('Warehouse API') && safe('Check restaurant warehouse', () => c.hasWarehouse(restaurant, city))) {
            manageInputs(restaurant, city);
            boostLocations.push({ city, division: restaurant });
          }
        }
        sellProducts(restaurant);
        const d = safe("Read Restaurant division", () => c.getDivision(restaurant));
        const activeCities = d?.cities ?? [];
        const products = d?.products ?? [];
        const maxProducts = d?.maxProducts ?? 3;
        if (!recovering && activeCities.length && hasUnlock("Warehouse API") && productInvestment(funds(), reserve) > 0) {
          const allComplete = products.every(p => productComplete(restaurant, p, activeCities));
          if (allComplete) {
            const investment = productInvestment(funds(), reserve);
            if (funds() > 2 * investment + reserve) {
              const sequence = Math.max(0, ...products.map(p => Number(p.match(/^Apex Dining (\d+)$/)?.[1]) || 0)) + 1;
              if (products.length >= maxProducts && Date.now() - lastProductAt >= 15 * 60_000) {
                const candidates = products.map(p => safe(`Rate ${p}`, () => c.getProduct(restaurant, activeCities[0], p))).filter(Boolean);
                const retiring = chooseRetirement(candidates);
                const canDevelop = activeCities.some(city => safe('Check development warehouse', () => c.hasWarehouse(restaurant, city)));
                if (retiring && products.length > 1 && canDevelop)
                  attempt(`Retire ${retiring.name}`, () => c.discontinueProduct(restaurant, retiring.name));
              }
              const liveProducts = safe('Read product slots', () => c.getDivision(restaurant))?.products || products;
              if (liveProducts.length < maxProducts) {
                const name = `Apex Dining ${sequence}`;
                startProduct(restaurant, activeCities, name, investment);
                if (safe('Confirm new product', () => c.getDivision(restaurant))?.products?.includes(name)) {
                  lastProductAt = Date.now();
                  try { await ns.write(productStateFile, JSON.stringify({ at: lastProductAt, nodeReset: resetInfo.lastNodeReset, corporation: info.name }), 'w'); }
                  catch { /* Product already exists; a report failure must not block production. */ }
                }
              }
            }
          }
        }
        hireAdVert(restaurant);
      }

      if (Date.now() - lastUpgrade >= 30_000) {
        const cash = funds();
        const growingProducts=divisions().some(name=>{const d=safe('Read product advertising need',()=>c.getDivision(name));return d?.makesProducts&&d.products?.length&&!(d.awareness===Number.MAX_VALUE&&d.popularity===Number.MAX_VALUE);});
        let bought = 0;

        if (growingProducts) {
          const cost = safe("Wilson cost", () => c.getUpgradeLevelCost("Wilson Analytics"));
          if (Number.isFinite(cost) && cost <= cash * 0.35 && cash > cost + reserve) {
            if (capitalPurchase("Level Wilson Analytics", cost, () => c.levelUpgrade("Wilson Analytics"))) {
              lastUpgrade = Date.now();
              bought++;
            }
          }
        }

        if (bought === 0) {
          const order = [
            ...(storagePressure ? ["Smart Storage"] : []),
            "Smart Factories", "Smart Storage",
            "Nuoptimal Nootropic Injector Implants", "Speech Processor Implants",
            "Neural Accelerators", "FocusWires",
            "ABC SalesBots", "Project Insight",
          ];
          const ranked = [...new Set(order)].map(upgrade => {
            const cost = safe(`Get ${upgrade} cost`, () => c.getUpgradeLevelCost(upgrade));
            const level = safe(`Read ${upgrade} level`, () => c.getUpgradeLevel(upgrade)) || 0;
            return { upgrade, cost, score: upgradeReturn(upgrade, level, cost, storagePressure) };
          }).filter(item => Number.isFinite(item.cost) && item.cost > 0).sort((a, b) => b.score - a.score);
          for (const { upgrade, cost } of ranked) {
            const cap = storagePressure && upgrade === "Smart Storage" ? 0.35 : 0.20;
            if (Number.isFinite(cost) && cost <= cash * cap && funds() > cost + reserve) {
              if (capitalPurchase(`Level ${upgrade}`, cost, () => c.levelUpgrade(upgrade))) {
                lastUpgrade = Date.now();
                bought++;
              }
              if (bought >= 2) break;
            }
          }
        }
      }

      manageIPO();
      manageDividends();
      // Schedule boost purchases after immediate corporation expenses, so buy
      // rates cannot commit money later consumed by offices, upgrades or products.
      // Maintain divisions already created by the player, using their own industry recipes.
      // Custom products are preserved; only products created by this manager are retired.
      for (const division of divisions().filter(value => ![agri, chem, restaurant].includes(value))) {
        const d = safe(`Read existing ${division}`, () => c.getDivision(division));
        const industry = d && safe(`Read ${division} industry`, () => c.getIndustryData(d.industry));
        if (!d || !industry) continue;
        runResearch(division, d.makesProducts ? PRODUCT_RESEARCH_ORDER : MATERIAL_RESEARCH_ORDER);
        for (const city of cities) {
          expand(division, city);
          if (!inCity(division, city)) continue;
          runOffice(division, city, d.makesProducts, d.makesProducts);
          runWarehouse(division, city);
          if (!hasUnlock('Warehouse API') || !safe('Check existing warehouse', () => c.hasWarehouse(division, city))) continue;
          manageInputs(division, city);
          boostLocations.push({ city, division });
        }
        if (d.makesProducts) {
          sellProducts(division);
          const productList = d.products || [], prefix = `${division} Auto`;
          const canDevelop = d.cities?.some(city => safe('Check existing development warehouse', () => c.hasWarehouse(division, city)));
          const cooldownReady = Date.now() - (Number(otherProductTimes[division]) || 0) >= 15 * 60_000;
          const investment = productInvestment(funds(), reserve);
          if (!recovering && investment > 0 && funds() > reserve + 2 * investment && canDevelop && cooldownReady &&
              productList.every(product => productComplete(division, product, d.cities))) {
            const capacity = d.maxProducts || 3;
            const candidates = productList.map(product => safe('Rate existing product', () => c.getProduct(division, d.cities[0], product))).filter(Boolean);
            const managed = candidates.filter(product => product.name?.startsWith(prefix + ' '));
            const sequence = Math.max(0, ...managed.map(product => Number(product.name.slice(prefix.length + 1)) || 0)) + 1;
            if (productList.length >= capacity && productList.length > 1) {
              const retiring = chooseRetirement(candidates, prefix);
              if (retiring) attempt(`Retire ${retiring.name}`, () => c.discontinueProduct(division, retiring.name));
            }
            const slots = safe('Read existing product slots', () => c.getDivision(division))?.products || productList;
            if (slots.length < capacity) {
              const productName = `${prefix} ${sequence}`;
              startProduct(division, d.cities, productName, investment);
              if (safe('Confirm existing division product', () => c.getDivision(division))?.products?.includes(productName)) {
                otherProductTimes[division] = Date.now();
                await ns.write(otherProductStateFile, JSON.stringify({ nodeReset: resetInfo.lastNodeReset, corporation: info.name, divisions: otherProductTimes }), 'w');
              }
            }
          }
        } else sellMaterials(division, industry.producedMaterials || []);
      }
      let achievements;try{achievements=JSON.parse(ns.read('tasks/achievement-goals.json'));}catch{}
      if(!recovering&&achievements?.expiresAt>Date.now()&&achievements.finance&&!achievements.owned?.includes('CORPORATION_PROD_1000')) {
        for(const division of divisions()){const d=safe('Achievement division',()=>c.getDivision(division));if(!d||d.productionMult>=1000)continue;
          for(const city of d.cities){if(!safe('Achievement warehouse',()=>c.hasWarehouse(division,city)))continue;
            const cost=safe('Achievement warehouse price',()=>c.getUpgradeWarehouseCost(division,city,1));if(Number.isFinite(cost)&&cost<(funds()-reserve)*.01)capitalPurchase('Achievement production storage',cost,()=>c.upgradeWarehouse(division,city,1));}break;}
      }
      manageExports();
      for(const division of [...advertQueue].sort((a,b)=>Number(safe('Read advert priority',()=>c.getDivision(b))?.makesProducts)-Number(safe('Read advert priority',()=>c.getDivision(a))?.makesProducts)))buyAdVert(division);
      expandIndustries();
      // Optional late unlocks, capped individually to leave room for division growth.
      if (!recovering) for (const unlock of constants.unlockNames || []) {
        const cost = hasUnlock(unlock) ? Infinity : safe('Read optional unlock cost', () => c.getUnlockCost(unlock));
        if (Number.isFinite(cost) && cost <= Math.max(0, funds() - reserve) * 0.05)
          capitalPurchase(`Buy optional ${unlock}`, cost, () => c.purchaseUnlock(unlock));
      }
      await bribeFactions();
      let remainingBoostBudget = recovering ? 0 : boostPurchaseBudget({ ...info, funds: funds() }, reserve, upkeepBudget, cycleSeconds);
      for (let index = 0; index < boostLocations.length; index++) {
        boostBudget = remainingBoostBudget / (boostLocations.length - index);
        const allowance = boostBudget;
        manageBoosts(boostLocations[index].city, boostLocations[index].division);
        remainingBoostBudget -= allowance - boostBudget;
      }
      manageHacknetServers();

      const spentOn = spendHashes();
      if (spentOn) {
        const hashCount = (() => {
          try { return Number(ns.hacknet.numHashes()) || 0; }
          catch { return 0; }
        })();
        ns.print(`Spent hashes on "${spentOn}" (${ns.format.number(hashCount)} hashes remaining).`);
      }

      const liveStatus = corp() || info;
      await ns.write(financeFile,JSON.stringify({at:Date.now(),pid:ns.pid,nodeReset:resetInfo.lastNodeReset,corporation:info.name,history:financeHistory,lastShareSaleAt,decision:financeDecision&&{accept:financeDecision.accept,holdIPO:financeDecision.holdIPO,reason:financeDecision.reason}}),'w');
      await ns.write(lifecycleFile, JSON.stringify({nodeReset: resetInfo.lastNodeReset, corporation: info.name, growthBank, lastExpansion}), 'w');
      await ns.write('tasks/corporation-status.json', JSON.stringify({ at: Date.now(), pid: ns.pid, corporation: info.name,
        growthBank, mode: recovering ? 'cash recovery' : 'growth', funds: funds(), reserve, divisions: divisions(),
        revenue: liveStatus.revenue, expenses: liveStatus.expenses, public: liveStatus.public,
        ownership: liveStatus.totalShares > 0 ? liveStatus.numShares / liveStatus.totalShares : null,
        minOwnership, financing:financeDecision?.reason, lastShareSaleAt, dividendRate: Math.max(0, lastDividendRate), expandAllIndustries: options['expand-all-industries'],
      }), 'w');
      const now = Date.now();
      if (now - lastInvestmentCycle > 60_000) {
        lastInvestmentCycle = now;
        const live = corp() ?? info;
        const hashes = (() => {
          try { return Number(ns.hacknet.numHashes()) || 0; }
          catch { return 0; }
        })();
        const serverCount = hasHacknetServers() ? (() => {
          try { return ns.hacknet.numNodes(); }
          catch { return 0; }
        })() : 0;
        const owned = Math.max(0, Number(live?.numShares) || 0);
        const total = Math.max(1, Number(live?.totalShares) || 1);
        ns.print(
          `${info.name}: $${ns.format.number(funds())}; ` +
          `divisions: ${divisions().join(", ") || "none"}; ` +
          `public: ${live?.public ? "yes" : "no"}; ` +
          `mode: ${recovering ? "cash recovery" : "growth"}; ` +
          `shares: ${(owned / total * 100).toFixed(1)}% (${ns.format.number(owned)}/${ns.format.number(total)}); ` +
          `dividends: ${(Math.max(0, lastDividendRate) * 100).toFixed(0)}%; ` +
          `hashes: ${ns.format.number(hashes)}; ` +
          `servers: ${serverCount}; ` +
          `wallet: $${ns.format.number(ns.getPlayer().money)}.`
        );
      }
      await c.nextUpdate();
    } catch (error) {
      ns.print(`Corporation manager recovered from: ${String(error)}`);
      await ns.sleep(10_000);
    }
  }
}
