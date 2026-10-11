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
  const reserve = 5e9;
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
    const start = safe(`Get ${industry} starting cost`, () => c.getIndustryData(industry).startingCost);
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
  const runOffice = (division, city, production) => {
    if (!hasUnlock("Office API")) return;
    let office = safe(`Read office ${division}/${city}`, () => c.getOffice(division, city));
    if (!office) return;
    const target = funds() > 1e13 ? 30 : funds() > 1e12 ? 15 : funds() > 2e11 ? 9 : 3;
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
      const ratios = production ? [0.25, 0.25, 0.10, 0.10, 0.30] : [0.20, 0.20, 0.10, 0.10, 0.40];
      const counts = ratios.map(r => Math.floor(employees * r));
      let remainder = employees - counts.reduce((a, b) => a + b, 0);
      for (let i = 0; remainder > 0; i = (i + 1) % counts.length, remainder--) counts[i]++;
      for (const job of officeJobs) attempt(`Assign ${job}`, () => c.setJobAssignment(division, city, job, 0));
      for (let i = 0; i < officeJobs.length; i++)
        if (counts[i]) attempt(`Assign ${officeJobs[i]}`, () => c.setJobAssignment(division, city, officeJobs[i], counts[i]));
    }
    attempt("Buy employee tea", () => c.buyTea(division, city));
  };
  const runWarehouse = (division, city, products = false) => {
    if (!hasUnlock("Warehouse API")) return;
    if (!safe("Check warehouse", () => c.hasWarehouse(division, city)) && funds() > reserve + 5e9)
      attempt("Purchase warehouse", () => c.purchaseWarehouse(division, city));
    if (!safe("Check warehouse", () => c.hasWarehouse(division, city))) return;
    const wh = safe("Read warehouse", () => c.getWarehouse(division, city));
    if (wh && wh.sizeUsed / Math.max(1, wh.size) > 0.8) {
      const cost = safe("Get warehouse upgrade cost", () => c.getUpgradeWarehouseCost(division, city));
      if (Number.isFinite(cost) && funds() > cost + reserve)
        attempt("Upgrade warehouse", () => c.upgradeWarehouse(division, city));
    }
    if (hasUnlock("Smart Supply")) attempt("Enable Smart Supply", () => c.setSmartSupply(division, city, true));
    if (products) {
      const d = safe("Read product division", () => c.getDivision(division));
      for (const product of d?.products ?? []) {
        const item = safe(`Read product ${product}`, () => c.getProduct(division, city, product));
        if (item?.developmentProgress >= 100)
          attempt(`Sell ${product}`, () => c.sellProduct(division, city, product, "MAX", "MP", true));
      }
      return;
    }
    for (const material of ["Plants", "Food"])
      attempt(`Sell ${material}`, () => c.sellMaterial(division, city, material, "MAX", "MP"));
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

      createDivision("Agriculture", agri);
      buyUnlock("Warehouse API");
      buyUnlock("Office API");
      buyUnlock("Smart Supply");
      const allCities = cityNames();
      const cityCount = funds() > 5e12 ? 6 : funds() > 1e12 ? 3 : 1;
      if (hasDivision(agri)) {
        for (const city of allCities.slice(0, cityCount)) {
          expand(agri, city);
          runOffice(agri, city, false);
          runWarehouse(agri, city, false);
          if (hasUnlock("Warehouse API") && safe("Check agricultural warehouse", () => c.hasWarehouse(agri, city))) {
            if (hasUnlock("Smart Supply")) {
              for (const material of ["Water", "Chemicals"])
                attempt(`Stop buying ${material}`, () => c.buyMaterial(agri, city, material, 0));
            }
          }
        }
      }

      // Restaurant is the second, product-based division from the supplied strategy.
      if (hasDivision(agri) && funds() > 1e12) createDivision("Restaurant", restaurant);
      if (hasDivision(restaurant)) {
        const d = safe("Read Restaurant division", () => c.getDivision(restaurant));
        for (const city of allCities.slice(0, Math.min(cityCount, 6))) {
          expand(restaurant, city);
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
      if (Date.now() - lastUpgrade >= 60_000) {
        for (const upgrade of ["Smart Factories", "Smart Storage", "Wilson Analytics"]) {
          const cost = safe(`Get ${upgrade} upgrade cost`, () => c.getUpgradeLevelCost(upgrade));
          if (Number.isFinite(cost) && cost <= funds() * 0.01 && funds() > cost + reserve) {
            if (attempt(`Level ${upgrade}`, () => c.levelUpgrade(upgrade))) lastUpgrade = Date.now();
            break;
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
