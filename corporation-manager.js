/**
 * Corporation automation for the Bitburner 3.x Corporation API.
 *
 * Strategy:
 *   - Agriculture, expanded to all six cities; sells Plants and Food with Market-TA.II.
 *   - Chemical division with a quality loop (Agri Plants -> Chem, Chem Chemicals
 *     -> Agri). Gated on funds and on Hi-Tech R&D Lab.
 *   - Restaurant, product-based; develops Apex Dining products. Fed by
 *     Agriculture's Food export so its avgQlt isn't pinned at 1.
 *   - Round 1 investment only, when the cash meaningfully exceeds current funds.
 *   - Late game: IPO with no shares issued, pay dividends on the tiered rate.
 *   - Hacknet: buy and level servers, spend hashes on a rotating plan.
 *
 * Source-verified against bitburner-src/dev/src:
 *   - Seed money is free in BN3 but disallowed outside BN3 (with SF3 you must
 *     self-fund for $150B from the player's wallet). createCorporation returns
 *     { success, message? } rather than a boolean — success is confirmed by
 *     re-checking hasCorporation() after the call.
 *   - getInvestmentOffer returns round: fundingRound + 1 (1-indexed). Round 1
 *     pays 0.3x valuation for 10% of initialShares. Rounds 2-4 are much worse
 *     (0.057-0.080 per 1% given vs 0.300 for round 1). Only round 1 is accepted.
 *   - investorShares cannot be bought back — buybackShares sources only from
 *     issuedShares. Ownership given to investors is permanent.
 *   - goPublic(0) leaves issuedShares at 0; buybackShares then fails with
 *     "Not enough shares are available for buyback." The buyback branch is
 *     removed as dead code.
 *   - buyBackShares draws from Player.money, not corporation funds.
 *   - tributeModifier is reduced by 0.05 per ShadyAccounting and 0.1 per
 *     GovernmentPartnership. Both are purchased, so the dividend payout is
 *     full (dividends^1.0). Without them the payout would be dividends^0.85.
 *   - getIndustryData(...).startingCost is the purchase price.
 *   - Division.maxProducts grows with uPgrade: Capacity.I / .II, starting at 3.
 *   - Production multiplier: (0.002*RE+1)^0.72 * (0.002*HW+1)^0.2 *
 *     (0.002*RB+1)^0.3 * (0.002*AI+1)^0.3 per city, ^0.73, summed.
 *   - Product effective rating caps at avgQlt * sqrt(rating); Restaurant
 *     needs Agriculture's Food export to avoid quality-1 collapse.
 *   - Warehouse size is linear in level; cost is 1e9 * 1.07^level.
 *     Warehouse upgrades are exempted from the reserve check.
 *   - purchaseWarehouse / upgradeWarehouse / upgradeOfficeSize / hireAdVert
 *     return void on insufficient funds. buyMaterial does NOT check funds and
 *     the game keeps charging the last-set rate every PURCHASE cycle until
 *     it's overwritten. Every early-return path in manageBoosts must clear.
 *   - sellMaterial and exportMaterial both throw when the relevant warehouse
 *     is missing from a city. sellMaterials and setupExportChain guard on
 *     hasWarehouse before calling to avoid per-cycle log spam.
 *   - sellProduct with all=true writes every city in one call and doesn't
 *     require a warehouse lookup for the passed city.
 *   - issueDividends takes a fraction in [0, dividendMaxRate]; requires public.
 *   - cancelExportMaterial does not throw on missing routes.
 *   - Ownership is CorporationInfo.numShares / totalShares.
 *   - hasHacknetServers() (BN9 or SF9) gates hashes entirely.
 *   - purchaseNode returns -1 on failure, not false. Node count is the signal.
 *   - throwParty returns a multiplier, not a boolean.
 *   - Hacknet nodes/servers reset on augmentation install (unlike corp/gang).
 */
import { optimalBoostTargets, nextSaleMultiplier, chooseRetirement, officeJobCounts, upgradeReturn } from './automation-policy.js';

export async function main(ns) {
  const c = ns.corporation;
  const cities = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];
  const name = "Apex Holdings";
  const agri = "Agri";
  const restaurant = "Dining";
  const chem = "Chem";
  const CITY_EXPAND_BUFFER = 5e9;
  const WAREHOUSE_BUFFER = 5e9;
  let reserve = 5e9;
  let boostBudget = 0;
  const BOOST_SPEND_FRACTION = 0.20;
  const officeJobs = ["Operations", "Engineer", "Business", "Management", "Research & Development"];

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
  const INVESTMENT_ROUND = 1;
  const INVESTMENT_MIN_FUNDS_RATIO = 1.0;
  const INVESTMENT_MIN_FUNDS = 1e9;
  let lastDividendRate = -1;

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
  const WILSON_TARGET_LEVEL = 17;

  // ---- Chemical quality loop --------------------------------------------
  const EXPORT_FORMULA = "(IPROD+IINV/10)*(-1)";
  const CHEM_FUNDS_GATE = 2e11;

  // ---- AdVert budget ----------------------------------------------------
  const ADVERT_SPEND_FRACTION = 0.50;

  // ---- Office upkeep ----------------------------------------------------
  const PARTY_COST_PER_EMPLOYEE = 5e6;

  // ---- Input buffer -----------------------------------------------------
  const INPUT_BUY_HEADROOM = 1.10;
  const INPUT_STOCK_CEILING = 30;

  // ---- Boost target -----------------------------------------------------
  const BOOST_WAREHOUSE_FRACTION = 0.60;

  // ---- Research orders --------------------------------------------------
  const MATERIAL_RESEARCH_ORDER = [
    "Hi-Tech R&D Laboratory",
    "AutoPartyManager",
    "AutoBrew",
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
  const hireAdVert = (division) => {
    const adCost = safe(`Get AdVert cost (${division})`, () => c.getHireAdVertCost(division));
    const cash = funds();
    if (!Number.isFinite(adCost) || adCost > cash * ADVERT_SPEND_FRACTION || cash <= adCost + reserve)
      return;
    attempt(`Hire AdVert (${division})`, () => c.hireAdVert(division));
  };

  // ---- IPO / dividends --------------------------------------------------
  const manageIPO = () => {
    if (!PAY_DIVIDENDS) return;
    const info = corp();
    if (!info || info.public) return;
    const valuation = Number(info.valuation) || 0;
    if (valuation < IPO_VALUATION) return;
    if (attempt("Go public", () => c.goPublic(0)))
      ns.print(`IPO at $${ns.format.number(valuation)} valuation; issued 0 shares.`);
  };

  const manageDividends = () => {
    if (!PAY_DIVIDENDS) return;
    const info = corp();
    if (!info?.public) return;
    const rate = dividendRateFor(funds());
    if (rate === lastDividendRate) return;
    if (attempt(`Set dividend rate ${(rate * 100).toFixed(0)}%`, () => c.issueDividends(rate)))
      lastDividendRate = rate;
  };

  // ---- Hash spends ------------------------------------------------------
  const spendHashes = () => {
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
    if (!BUY_HACKNET_SERVERS || !hasHacknetServers()) return;

    let numNodes = 0;
    try { numNodes = ns.hacknet.numNodes(); }
    catch { return; }
    let budget = Math.max(0, ns.getPlayer().money * HACKNET_SPEND_FRACTION);
    if (budget <= 0) return;

    let bought = 0;
    while (numNodes < HACKNET_MAX_SERVERS && bought < 3) {
      let cost = Infinity;
      try { cost = ns.hacknet.getPurchaseNodeCost(); }
      catch { cost = Infinity; }
      if (!Number.isFinite(cost) || cost <= 0 || cost > budget) break;
      try { ns.hacknet.purchaseNode(); }
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
        if (!Number.isFinite(cost) || cost <= 0 || cost > budget) continue;
        if (!bestCache || cost < bestCache.cost) bestCache = { i, cost };
      }
      if (bestCache) {
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
        if (cand.cost > budget) continue;
        const ratio = cand.value / cand.cost;
        if (!best || ratio > best.ratio) best = { ...cand, i, ratio };
      }
    }
    if (!best) return;
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
      if (!safe(`Check ${sourceDiv}/${city} wh`, () => c.hasWarehouse(sourceDiv, city))) continue;
      if (!safe(`Check ${targetDiv}/${city} wh`, () => c.hasWarehouse(targetDiv, city))) continue;
      if (attempt(`Export ${sourceMat} → ${targetDiv}`, () =>
        c.exportMaterial(sourceDiv, city, targetDiv, city, sourceMat, EXPORT_FORMULA)))
        exportRoutes.add(key);
    }
  };
  const manageExports = () => {
    if (!hasDivision(agri)) return;
    if (!hasDivision(chem) && !hasDivision(restaurant)) return;
    buyUnlock("Export");
    if (!hasUnlock("Export") || !hasUnlock("Warehouse API")) return;
    if (hasDivision(chem)) {
      setupExportChain(agri, "Plants", chem);
      setupExportChain(chem, "Chemicals", agri);
    }
    if (hasDivision(restaurant)) {
      setupExportChain(agri, "Food", restaurant);
    }
  };

  // ---- Per-city office management ---------------------------------------
  const inCity = (division, city) =>
    safe(`Read division ${division}`, () => c.getDivision(division))?.cities?.includes(city) === true;
  const runOffice = (division, city, production, productDivision = false) => {
    if (!hasUnlock("Office API")) return;
    let office = safe(`Read office ${division}/${city}`, () => c.getOffice(division, city));
    if (!office) return;
    const target = productDivision
      ? (funds() > 1e15 ? 120 : funds() > 1e14 ? 100 : funds() > 1e13 ? 80 : funds() > 1e12 ? 60 : 30)
      : (funds() > 1e13 ? 60 : funds() > 5e12 ? 45 : funds() > 1e12 ? 30 : funds() > 1e11 ? 20 : funds() > 1e10 ? 15 : funds() > 1e9 ? 9 : 3);
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
      const counts = officeJobCounts(employees, production);
      const jobs = office.employeeJobs;
      const aligned = jobs && officeJobs.every((job, i) => Number(jobs[job] ?? -1) === counts[i]);
      if (!aligned) {
        for (const job of officeJobs) attempt(`Clear ${job}`, () => c.setJobAssignment(division, city, job, 0));
        for (let i = 0; i < officeJobs.length; i++)
          if (counts[i]) attempt(`Assign ${officeJobs[i]}`, () => c.setJobAssignment(division, city, officeJobs[i], counts[i]));
      }
      if (office.avgEnergy < (office.maxEnergy ?? 100) - 1)
        attempt("Buy employee tea", () => c.buyTea(division, city));
      if (office.avgMorale < (office.maxMorale ?? 100) - 1)
        attempt("Throw party", () => c.throwParty(division, city, PARTY_COST_PER_EMPLOYEE));
    }
  };

  // ---- Agriculture inputs and boosts ------------------------------------
  const manageInputs = (city) => {
    const set = (material, rate) =>
      attempt(`Set ${material} buy rate`, () => c.buyMaterial(agri, city, material, rate));
    if (hasUnlock("Smart Supply")) { set("Water", 0); set("Chemicals", 0); return; }
    if (hasDivision(chem)) set("Chemicals", 0);
    const wh = safe("Read warehouse", () => c.getWarehouse(agri, city));
    const full = wh ? wh.sizeUsed / Math.max(1, wh.size) > 0.9 : false;
    let produced = 0;
    for (const output of ["Plants", "Food"]) {
      const item = safe(`Read ${output}`, () => c.getMaterial(agri, city, output));
      produced += Number(item?.productionAmount) || 0;
    }
    produced = Math.max(produced, 1);
    const inputs = hasDivision(chem)
      ? [["Water", 0.5]]
      : [["Water", 0.5], ["Chemicals", 0.2]];
    for (const [material, per] of inputs) {
      const item = safe(`Read ${material}`, () => c.getMaterial(agri, city, material));
      const need = per * produced;
      const overCeiling = full || Number(item?.stored) > need * INPUT_STOCK_CEILING;
      set(material, overCeiling ? 0 : need * INPUT_BUY_HEADROOM);
    }
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
  const clearBoostRates = (division, city) => {
    for (const b of boosts)
      attempt(`Clear ${b.name} buy rate`, () => c.buyMaterial(division, city, b.name, 0));
  };
  const manageBoosts = (city, division = agri) => {
    if (boostBudget <= 0) { clearBoostRates(division, city); return; }
    const wh = safe("Read warehouse", () => c.getWarehouse(division, city));
    if (!wh) return;
    const full = wh.sizeUsed / Math.max(1, wh.size) > 0.9;
    const divisionInfo = safe(`Read ${division}`, () => c.getDivision(division));
    const industry = safe('Read industry factors', () => c.getIndustryData(divisionInfo?.industry));
    const materials = boosts.map(b => ({ ...b,
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
      attempt(`Set ${p.name} buy rate`, () => c.buyMaterial(division, city, p.name, (p.need * scale) / 10));
  };

  // ---- Research ---------------------------------------------------------
  const runResearch = (division, order) => {
    const points = safe(`Read ${division}`, () => c.getDivision(division))?.researchPoints ?? 0;
    for (const name of order) {
      if (safe(`Check ${name}`, () => c.hasResearched(division, name)) === true) continue;
      const cost = safe(`Get ${name} cost`, () => c.getResearchCost(division, name));
      if (Number.isFinite(cost) && points >= cost)
        attempt(`Research ${name}`, () => c.research(division, name));
      break;
    }
  };
  const hasTA2 = (division) => safe(`Check TA.II ${division}`, () => c.hasResearched(division, "Market-TA.II")) === true;

  // ---- Warehouse management ---------------------------------------------
  // Warehouse upgrades are exempt from the reserve check: they're what
  // restores production when the warehouse fills, and production is what
  // generates the revenue that refills the reserve.
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
    let used = wh ? wh.sizeUsed / Math.max(1, wh.size) : 0;
    if (used > 0.8) storagePressure = true;
    for (let level = 0; level < 5 && used > 0.7; level++) {
      const cost = safe("Get warehouse upgrade cost", () => c.getUpgradeWarehouseCost(division, city));
      if (!Number.isFinite(cost) || funds() <= cost) break;
      if (!attempt("Upgrade warehouse", () => c.upgradeWarehouse(division, city))) break;
      const next = safe("Refresh warehouse", () => c.getWarehouse(division, city));
      used = next ? next.sizeUsed / Math.max(1, next.size) : 0;
    }
    if (hasUnlock("Smart Supply")) attempt("Enable Smart Supply", () => c.setSmartSupply(division, city, true));
  };

  // ---- Selling ----------------------------------------------------------
  const saleMultipliers = new Map();
  const saleTimes = new Map();
  const salePrice = (key, item, automated) => {
    if (automated) return 'MP';
    let multiplier = saleMultipliers.get(key) || 1;
    // Tune once a minute rather than once per corporation phase.
    if (Date.now() - (saleTimes.get(key) || 0) >= 60_000) {
      multiplier = nextSaleMultiplier(item, multiplier);
      saleMultipliers.set(key, multiplier);
      saleTimes.set(key, Date.now());
    }
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
        const price = salePrice(`${division}/${city}/${material}`, item, ta2);
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
        const price = salePrice(`${division}/${city}/${product}`, item, false);
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

  // ---- Main loop --------------------------------------------------------
  let lastInvestmentCycle = 0;
  let lastUpgrade = 0;
  let lastProductAt = 0;
  while (true) {
    try {
      const info = corp();
      if (!info) { await ns.sleep(30_000); continue; }

      if (ACCEPT_INVESTMENT) {
        const offer = safe("Read investment offer", () => c.getInvestmentOffer());
        if (offer?.round === INVESTMENT_ROUND && offer.funds > 0) {
          const threshold = Math.max(INVESTMENT_MIN_FUNDS, funds() * INVESTMENT_MIN_FUNDS_RATIO);
          if (offer.funds > threshold)
            attempt(`Accept round ${INVESTMENT_ROUND} investment`, () => c.acceptInvestmentOffer());
        }
      }

      storagePressure = false;
      reserve = Math.max(1e7, Math.min(5e9, funds() * 0.1));
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
            manageInputs(city);
            boostLocations.push({ city, division: agri });
          }
        }
        sellMaterials(agri, ["Plants", "Food"]);
        runResearch(agri, MATERIAL_RESEARCH_ORDER);
        hireAdVert(agri);
      }

      if (hasDivision(agri) && !hasDivision(chem) && funds() > CHEM_FUNDS_GATE) {
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
          if (hasUnlock("Warehouse API") && safe("Check chemical warehouse", () => c.hasWarehouse(chem, city)))
            boostLocations.push({ city, division: chem });
        }
        sellMaterials(chem, ["Chemicals"]);
        runResearch(chem, MATERIAL_RESEARCH_ORDER);
        manageExports();
        hireAdVert(chem);
      }

      if (hasDivision(agri) && funds() > 1e12) createDivision("Restaurant", restaurant);
      if (hasDivision(restaurant)) {
        manageExports();
        runResearch(restaurant, PRODUCT_RESEARCH_ORDER);
        for (const city of allCities) {
          expand(restaurant, city);
          if (!inCity(restaurant, city)) continue;
          runOffice(restaurant, city, true, true);
          runWarehouse(restaurant, city);
          if (hasUnlock('Warehouse API') && safe('Check restaurant warehouse', () => c.hasWarehouse(restaurant, city)))
            boostLocations.push({ city, division: restaurant });
        }
        sellProducts(restaurant);
        const d = safe("Read Restaurant division", () => c.getDivision(restaurant));
        const activeCities = d?.cities ?? [];
        const products = d?.products ?? [];
        const maxProducts = d?.maxProducts ?? 3;
        if (activeCities.length && hasUnlock("Warehouse API") && funds() > 2e12) {
          const allComplete = products.every(p => productComplete(restaurant, p, activeCities));
          if (allComplete) {
            const investment = Math.min(10e9, Math.max(1e9, funds() * 0.005));
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
                if (safe('Confirm new product', () => c.getDivision(restaurant))?.products?.includes(name)) lastProductAt = Date.now();
              }
            }
          }
        }
        hireAdVert(restaurant);
      }

      if (Date.now() - lastUpgrade >= 30_000) {
        const cash = funds();
        const wilsonLevel = safe("Wilson level", () => c.getUpgradeLevel("Wilson Analytics")) ?? 0;
        let bought = 0;

        if (wilsonLevel < WILSON_TARGET_LEVEL) {
          const cost = safe("Wilson cost", () => c.getUpgradeLevelCost("Wilson Analytics"));
          if (Number.isFinite(cost) && cost <= cash * 0.35 && cash > cost + reserve) {
            if (attempt("Level Wilson Analytics", () => c.levelUpgrade("Wilson Analytics"))) {
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
              if (attempt(`Level ${upgrade}`, () => c.levelUpgrade(upgrade))) {
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
      let remainingBoostBudget = Math.max(0, Math.min(funds() * BOOST_SPEND_FRACTION, funds() - reserve));
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
