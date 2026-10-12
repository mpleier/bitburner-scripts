/**
 * Corporation automation for the Bitburner 3.x Corporation API.
 * Starts an Agriculture division, expands it steadily, and adds a Restaurant
 * product division once the corporation can comfortably afford it.
 */
export async function main(ns) {
  const c = ns.corporation;
  const cities = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];
  const name = "Apex Holdings";
  const pcOwnerFile = "tasks/__pc_corp_owner.json";
  const agri = "Agri";
  const restaurant = "Dining";
  // Cash kept back from spending. Scales down while the corporation is small so a
  // fixed $5b floor can't freeze a corporation that only has a billion or so.
  let reserve = 5e9;
  const officeJobs = ["Operations", "Engineer", "Business", "Management", "Research & Development"];

  ns.disableLog("sleep");
  ns.disableLog("corporation.nextUpdate");

  const safe = (label, fn) => {
    try { return fn(); }
    catch (error) { ns.print(`${label}: ${String(error)}`); return undefined; }
  };
  const corporation = () => safe("getCorporation", () => c.getCorporation());
  const funds = () => corporation()?.funds ?? 0;
  const divisions = () => corporation()?.divisions ?? [];
  const hasDivision = (division) => divisions().includes(division);
  const hasUnlock = (unlock) => safe(`hasUnlock ${unlock}`, () => c.hasUnlock(unlock)) === true;
  const attempt = (label, fn) => safe(label, () => { fn(); return true; }) === true;
  const pcOwnsCorporation = () => {
    try {
      const lease = JSON.parse(ns.read(pcOwnerFile));
      return lease?.owner === "pc-controller" && Number(lease.expiresAt) > Date.now();
    } catch { return false; }
  };
  // Corporation access is available in BN3 or with active Source-File 3.
  const resetInfo = safe("Read reset information", () => ns.getResetInfo());
  const sourceFiles = resetInfo?.ownedSF;
  const sourceFile3Level = typeof sourceFiles?.get === "function" ? sourceFiles.get(3) : sourceFiles?.[3];
  const hasSourceFile3 = Number(sourceFile3Level) > 0;
  if (!resetInfo || (resetInfo.currentNode !== 3 && !hasSourceFile3)) {
    ns.tprint("Corporation manager stopped: requires BitNode 3 or Source-File 3 access.");
    return;
  }

  while (!safe("Check corporation API", () => c.hasCorporation())) {
    if (pcOwnsCorporation()) {
      await ns.sleep(5_000);
      continue;
    }
    const eligible = safe("Check corporation eligibility", () => c.canCreateCorporation(true));
    if (eligible !== "Success") {
      ns.print(`Waiting for corporation creation eligibility (${String(eligible)}).`);
      await ns.sleep(60_000);
      continue;
    }
    const created = safe("Create corporation", () => c.createCorporation(name, true));
    if (created) {
      ns.print(`Created ${name}.`);
      break;
    }
    await ns.sleep(60_000);
  }

  const cityNames = () => cities;
  const expand = (division, city) => {
    const d = safe(`Read division ${division}`, () => c.getDivision(division));
    if (d && !d.cities.includes(city) && funds() > reserve + 5e9)
      attempt(`Expand ${division} to ${city}`, () => c.expandCity(division, city));
  };
  const createDivision = (industry, division) => {
    if (hasDivision(division)) return true;
    // IndustryData exposes the price as `cost`; `startingCost` is undefined, which
    // made this check fail and left the division uncreated.
    const data = safe(`Get ${industry} data`, () => c.getIndustryData(industry));
    const start = data?.cost ?? data?.startingCost;
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
  // True once the division actually has an office in this city. Cities are
  // expanded as funds allow, so the rest must be skipped until then.
  const inCity = (division, city) =>
    safe(`Read division ${division}`, () => c.getDivision(division))?.cities?.includes(city) === true;
  const runOffice = (division, city, production) => {
    if (!hasUnlock("Office API")) return;
    let office = safe(`Read office ${division}/${city}`, () => c.getOffice(division, city));
    if (!office) return;
    const target = funds() > 1e13 ? 30 : funds() > 1e12 ? 15 : funds() > 1e11 ? 9 : 3;
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
      let counts;
      if (employees <= 5) {
        // Tiny offices: the ratio split rounds Business down to zero, which leaves
        // sales effectivity near nothing. Hand out one job at a time in a fixed
        // order of importance: Operations, Business, Engineer, Management, R&D.
        counts = officeJobs.map(() => 0);
        [0, 2, 1, 3, 4].slice(0, employees).forEach(i => counts[i]++);
      } else {
        const ratios = production ? [0.25, 0.25, 0.10, 0.10, 0.30] : [0.20, 0.20, 0.10, 0.10, 0.40];
        counts = ratios.map(r => Math.floor(employees * r));
        let remainder = employees - counts.reduce((a, b) => a + b, 0);
        for (let i = 0; remainder > 0; i = (i + 1) % counts.length, remainder--) counts[i]++;
      }
      // Only touch assignments when they differ from the target; resetting every
      // job to zero on every update needlessly unassigns the whole office.
      const jobs = office.employeeJobs;
      const aligned = jobs && officeJobs.every((job, i) => Number(jobs[job] ?? -1) === counts[i]);
      if (!aligned) {
        for (const job of officeJobs) attempt(`Clear ${job}`, () => c.setJobAssignment(division, city, job, 0));
        for (let i = 0; i < officeJobs.length; i++)
          if (counts[i]) attempt(`Assign ${officeJobs[i]}`, () => c.setJobAssignment(division, city, officeJobs[i], counts[i]));
      }
    }
    // Tea only helps when energy has dropped, so don't pay for it every update.
    if (office.avgEnergy === undefined || office.avgEnergy < (office.maxEnergy ?? 100) - 1)
      attempt("Buy employee tea", () => c.buyTea(division, city));
  };
  // Agriculture inputs: 0.5 Water + 0.2 Chemicals per Plant/Food produced. Buying
  // them blindly at a fixed rate fills the warehouse and blocks the output.
  const manageInputs = (city) => {
    const set = (material, rate) =>
      attempt(`Set ${material} buy rate`, () => c.buyMaterial(agri, city, material, rate));
    if (hasUnlock("Smart Supply")) { set("Water", 0); set("Chemicals", 0); return; }
    const wh = safe("Read warehouse", () => c.getWarehouse(agri, city));
    const full = wh ? wh.sizeUsed / Math.max(1, wh.size) > 0.9 : false;
    const plants = safe("Read Plants", () => c.getMaterial(agri, city, "Plants"));
    const produced = Math.max(Number(plants?.productionAmount) || 0, 1);
    for (const [material, per] of [["Water", 0.5], ["Chemicals", 0.2]]) {
      const item = safe(`Read ${material}`, () => c.getMaterial(agri, city, material));
      const need = per * produced;
      // Stop buying when the warehouse is full or ~30s of stock is already on hand.
      set(material, full || Number(item?.stored) > need * 30 ? 0 : need);
    }
  };
  // Agriculture production boosters: stored Real Estate, Hardware, Robots and AI
  // Cores multiply output (factors are the game's Agriculture constants; size is
  // storage per unit and is read from the game when available). Space is split
  // in proportion to each factor, up to 40% of the warehouse.
  const boosts = [
    { name: "Real Estate", factor: 0.72, size: 0.005 },
    { name: "Hardware", factor: 0.2, size: 0.06 },
    { name: "Robots", factor: 0.3, size: 0.5 },
    { name: "AI Cores", factor: 0.3, size: 0.1 },
  ];
  const manageBoosts = (city) => {
    const wh = safe("Read warehouse", () => c.getWarehouse(agri, city));
    if (!wh) return;
    const full = wh.sizeUsed / Math.max(1, wh.size) > 0.9;
    const factorSum = boosts.reduce((a, b) => a + b.factor, 0);
    const plan = boosts.map((b) => {
      const item = safe(`Read ${b.name}`, () => c.getMaterial(agri, city, b.name));
      const size = Number(safe(`Read ${b.name} size`, () => c.getMaterialData(b.name))?.size) || b.size;
      const target = (wh.size * 0.4 * (b.factor / factorSum)) / size;
      const price = Number(item?.marketPrice) || 0;
      const need = full || price <= 0 ? 0 : Math.max(0, target - (Number(item?.stored) || 0));
      return { name: b.name, need, cost: need * price };
    });
    // Spend at most a fifth of funds per update so boosts never starve expansion.
    const total = plan.reduce((a, p) => a + p.cost, 0);
    const spend = Math.max(0, Math.min(funds() * 0.2, funds() - reserve));
    const scale = total > spend ? spend / total : 1;
    // buyMaterial takes units per second; a cycle is ~10s, so this fills the gap
    // within one update and is recomputed (and drops to 0) on the next.
    for (const p of plan)
      attempt(`Set ${p.name} buy rate`, () => c.buyMaterial(agri, city, p.name, (p.need * scale) / 10));
  };
  // Research Hi-Tech R&D Lab, then Market-TA.I and .II (automatic optimal pricing).
  const runResearch = (division) => {
    const points = safe(`Read ${division}`, () => c.getDivision(division))?.researchPoints ?? 0;
    for (const name of ["Hi-Tech R&D Laboratory", "Market-TA.I", "Market-TA.II"]) {
      if (safe(`Check ${name}`, () => c.hasResearched(division, name)) === true) continue;
      const cost = safe(`Get ${name} cost`, () => c.getResearchCost(division, name));
      // Keep a buffer: research points also feed product quality.
      if (Number.isFinite(cost) && points >= cost * 1.5) attempt(`Research ${name}`, () => c.research(division, name));
      break; // strictly in order, one at a time
    }
  };
  const hasTA2 = (division) => safe(`Check TA.II ${division}`, () => c.hasResearched(division, "Market-TA.II")) === true;
  let storagePressure = false;
  const runWarehouse = (division, city, products = false) => {
    if (!hasUnlock("Warehouse API")) return;
    if (!safe("Check warehouse", () => c.hasWarehouse(division, city)) && funds() > reserve + 5e9)
      attempt("Purchase warehouse", () => c.purchaseWarehouse(division, city));
    if (!safe("Check warehouse", () => c.hasWarehouse(division, city))) return;
    const wh = safe("Read warehouse", () => c.getWarehouse(division, city));
    // Storage management: upgrade early (70% full) and catch up in a burst of up
    // to 5 levels, so production doesn't stall against a full warehouse.
    let used = wh ? wh.sizeUsed / Math.max(1, wh.size) : 0;
    if (used > 0.8) storagePressure = true;
    for (let level = 0; level < 5 && used > 0.7; level++) {
      const cost = safe("Get warehouse upgrade cost", () => c.getUpgradeWarehouseCost(division, city));
      if (!Number.isFinite(cost) || funds() <= cost + reserve) break;
      if (!attempt("Upgrade warehouse", () => c.upgradeWarehouse(division, city))) break;
      const next = safe("Refresh warehouse", () => c.getWarehouse(division, city));
      used = next ? next.sizeUsed / Math.max(1, next.size) : 0;
    }
    if (hasUnlock("Smart Supply")) attempt("Enable Smart Supply", () => c.setSmartSupply(division, city, true));
    if (products) {
      const d = safe("Read product division", () => c.getDivision(division));
      for (const product of d?.products ?? []) {
        const item = safe(`Read product ${product}`, () => c.getProduct(division, city, product));
        if (item?.developmentProgress >= 100) {
          attempt(`Sell ${product}`, () => c.sellProduct(division, city, product, "MAX", "MP", true));
          if (hasTA2(division)) attempt(`Market-TA.II ${product}`, () => c.setProductMarketTA2(division, product, true));
        }
      }
      return;
    }
    for (const material of ["Plants", "Food"]) {
      attempt(`Sell ${material}`, () => c.sellMaterial(division, city, material, "MAX", "MP"));
      if (hasTA2(division)) attempt(`Market-TA.II ${material}`, () => c.setMaterialMarketTA2(division, city, material, true));
    }
  };

  let lastInvestmentCycle = 0;
  let lastUpgrade = 0;
  while (true) {
    try {
      if (pcOwnsCorporation()) {
        await ns.sleep(5_000);
        continue;
      }
      const info = corporation();
      if (!info) { await ns.sleep(30_000); continue; }

      // Keep early investment rounds going; leave late offers alone rather than
      // accepting a low offer after the share price has already grown.
      const offer = safe("Read investment offer", () => c.getInvestmentOffer());
      if (offer?.funds > 0 && offer.round <= 3 && offer.funds > Math.max(1e9, funds() * 0.1))
        attempt("Accept investment offer", () => c.acceptInvestmentOffer());

      storagePressure = false;
      reserve = Math.min(5e9, funds() * 0.1);
      createDivision("Agriculture", agri);
      buyUnlock("Warehouse API");
      buyUnlock("Office API");
      buyUnlock("Smart Supply");
      const allCities = cityNames();
      // Every expansion/warehouse/office purchase is already gated on available
      // funds, so work all six cities rather than staying in one until 1t.
      const cityCount = allCities.length;
      if (hasDivision(agri)) {
        for (const city of allCities.slice(0, cityCount)) {
          expand(agri, city);
          if (!inCity(agri, city)) continue;
          runOffice(agri, city, false);
          runWarehouse(agri, city, false);
          if (hasUnlock("Warehouse API") && safe("Check agricultural warehouse", () => c.hasWarehouse(agri, city))) {
            manageInputs(city);
            manageBoosts(city);
          }
        }
        runResearch(agri);
        // Advertising multiplier starts near zero and drives sales; hire AdVert
        // whenever it is a small slice of funds.
        const adCost = safe("Get AdVert cost", () => c.getHireAdVertCost(agri));
        if (Number.isFinite(adCost) && adCost <= funds() * 0.25 && funds() > adCost + reserve)
          attempt("Hire AdVert", () => c.hireAdVert(agri));
      }

      // Restaurant is the second, product-based division from the supplied strategy.
      if (hasDivision(agri) && funds() > 1e12) createDivision("Restaurant", restaurant);
      if (hasDivision(restaurant)) {
        runResearch(restaurant);
        const d = safe("Read Restaurant division", () => c.getDivision(restaurant));
        for (const city of allCities.slice(0, Math.min(cityCount, 6))) {
          expand(restaurant, city);
          if (!inCity(restaurant, city)) continue;
          runOffice(restaurant, city, true);
          runWarehouse(restaurant, city, true);
        }
        const activeCities = d?.cities ?? [];
        if (activeCities.length && hasUnlock("Warehouse API")) {
          const products = d?.products ?? [];
          const complete = products.every(p => {
            const item = safe(`Read product ${p}`, () => c.getProduct(restaurant, activeCities[0], p));
            return item?.developmentProgress >= 100;
          });
          if (products.length < 3 && complete && funds() > 2e12) {
            const investment = Math.min(10e9, Math.max(1e9, funds() * 0.005));
            if (funds() > 2 * investment + reserve)
              attempt("Develop Restaurant product", () => c.makeProduct(restaurant, activeCities[0], `Apex Dining ${products.length + 1}`, investment, investment));
          }
        }
      }

      // Limit recurring upgrade spending while preserving cash for expansion.
      if (Date.now() - lastUpgrade >= 30_000) {
        // Smart Storage raises capacity in every warehouse, so it goes first
        // (with a looser spending cap) whenever any warehouse is nearly full.
        const order = [
          ...(storagePressure ? ["Smart Storage"] : []),
          "Smart Factories", "Smart Storage",
          // Employee stat upgrades, then sales/marketing.
          "Nuoptimal Nootropic Injector Implants", "Speech Processor Implants", "Neural Accelerators", "FocusWires",
          // DreamSense is not a levelable upgrade in 3.x, so it must not be listed.
          "ABC SalesBots", "Project Insight", "Wilson Analytics",
        ];
        let bought = 0;
        for (const upgrade of [...new Set(order)]) {
          const cost = safe(`Get ${upgrade} upgrade cost`, () => c.getUpgradeLevelCost(upgrade));
          const cap = storagePressure && upgrade === "Smart Storage" ? 0.05 : 0.01;
          if (Number.isFinite(cost) && cost <= funds() * cap && funds() > cost + reserve) {
            if (attempt(`Level ${upgrade}`, () => c.levelUpgrade(upgrade))) { lastUpgrade = Date.now(); bought++; }
            if (bought >= 2) break; // spread spending across updates
          }
        }
      }

      const now = Date.now();
      if (now - lastInvestmentCycle > 60_000) {
        lastInvestmentCycle = now;
        ns.print(`${info.name}: $${ns.format.number(funds())}; divisions: ${divisions().join(", ") || "none"}.`);
      }
      await c.nextUpdate();
    } catch (error) {
      ns.print(`Corporation manager recovered from: ${String(error)}`);
      await ns.sleep(10_000);
    }
  }
}
