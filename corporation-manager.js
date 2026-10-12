/**
 * Corporation automation for the Bitburner 3.x Corporation API.
 *
 * Strategy:
 *   - Agriculture, expanded to all six cities; sells Plants and Food with Market-TA.II.
 *   - Restaurant, added once Agriculture is stable; develops Apex Dining products.
 *   - Late game: IPO, buy shares back toward the ownership target, then pay the
 *     player a tiered dividend on corporation profit. Buybacks and dividends are
 *     decoupled: buybacks run whenever they can afford to, and the dividend rate
 *     is set from the current tier regardless of ownership. The actual payout is
 *     scaled automatically by how much of the corporation the player owns, so a
 *     diluted player still receives a proportional slice rather than nothing.
 *
 * Source-verified against bitburner-src/dev/src/Corporation:
 *   - getIndustryData(...).startingCost is the purchase price (no `cost` field).
 *   - Division.maxProducts grows with uPgrade: Capacity.I / .II, starting at 3.
 *   - sellProduct / sellMaterial with `all=true` write per-city state in one call.
 *   - Market-TA.II is a division-wide flag, not per-city.
 *   - issueDividends takes a fraction in [0, dividendMaxRate] and requires a
 *     public corporation (goPublic).
 *   - CorporationInfo exposes `numShares`, `sharePrice`, `shareSaleCooldown`,
 *     `public`, `valuation`. Player-owned shares live at `ns.getPlayer().shares`.
 */
export async function main(ns) {
  const c = ns.corporation;
  const cities = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];
  const name = "Apex Holdings";
  const pcOwnerFile = "tasks/__pc_corp_owner.json";
  const agri = "Agri";
  const restaurant = "Dining";
  const CITY_EXPAND_BUFFER = 5e9;
  const WAREHOUSE_BUFFER = 5e9;
  let reserve = 5e9;
  const officeJobs = ["Operations", "Engineer", "Business", "Management", "Research & Development"];

  // ---- Dividend strategy ------------------------------------------------
  // issueDividends takes a *fraction* in [0, dividendMaxRate]. During the
  // growth phase the rate is 0; every dollar retained compounds. As the corp
  // matures, a growing slice of profit is paid out.
  const DIVIDEND_TIERS = [
    [1e21, 0.20], // mature
    [1e18, 0.10],
    [1e15, 0.05],
    [1e13, 0.02],
    [0,    0.00], // growth phase: reinvest everything
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
  // Dividends require a public corporation. The IPO hands ~25% of shares to
  // the public, so buyBackShares() is used afterwards to restore ownership.
  const PAY_DIVIDENDS = true;
  const IPO_VALUATION = 1e12;
  // Buybacks run whenever possible, but ownership is never required to reach
  // this before dividends start; the payout is scaled by the actual share.
  const OWNERSHIP_TARGET = 0.90;
  const BUYBACK_SPEND_FRACTION = 0.10;
  // Early investment rounds inject capital but permanently dilute the player's
  // share of every future dividend. Flip to false for a pure dividend play.
  const ACCEPT_INVESTMENT = true;
  let lastDividendRate = -1;

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
  // A `false` return is treated the same as a throw: the call did not succeed.
  const attempt = (label, fn) => safe(label, () => fn() !== false) === true;
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

  const expand = (division, city) => {
    const d = safe(`Read division ${division}`, () => c.getDivision(division));
    if (d && !d.cities.includes(city) && funds() > reserve + CITY_EXPAND_BUFFER)
      attempt(`Expand ${division} to ${city}`, () => c.expandCity(division, city));
  };
  const createDivision = (industry, division) => {
    if (hasDivision(division)) return true;
    // getIndustryData() returns the industry definition. Its purchase price is
    // `startingCost`; there is no `cost` field on this shape in 3.x.
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

  // ---- IPO / shares / dividends -----------------------------------------
  // Player-owned shares live on Player, not CorporationInfo. 3.x stores them
  // as a map keyed by corporation name.
  const ownedShares = () => {
    try { return Number(ns.getPlayer()?.shares?.[name]) || 0; }
    catch { return 0; }
  };
  const ownershipOf = (info) => {
    const owned = ownedShares();
    const total = Math.max(1, Number(info?.numShares) || 1);
    return { owned, total, fraction: owned / total };
  };

  const manageIPO = () => {
    if (!PAY_DIVIDENDS) return;
    const info = corp();
    if (!info || info.public) return;
    const valuation = Number(info.valuation) || 0;
    if (valuation < IPO_VALUATION) return;
    // goPublic accepts an optional numShares; 0 lets the game pick the IPO size.
    if (attempt("Go public", () => c.goPublic(0))) {
      const after = corp();
      const { fraction } = ownershipOf(after);
      ns.print(
        `IPO at $${ns.format.number(valuation)} valuation; ` +
        `own ${(fraction * 100).toFixed(1)}% of shares.`
      );
    }
  };

  const manageSharesAndDividends = () => {
    if (!PAY_DIVIDENDS) return;
    const info = corp();
    if (!info?.public) return;

    const { total, fraction } = ownershipOf(info);

    // Buybacks run whenever the player is below target and the market is open.
    // They are not a prerequisite for dividends; the payout is scaled by the
    // actual ownership fraction, so a diluted player still receives a slice.
    if (fraction < OWNERSHIP_TARGET) {
      const onCooldown = (Number(info.shareSaleCooldown) || 0) > 0;
      if (!onCooldown) {
        const perShare = Number(info.sharePrice) || 0;
        if (perShare > 0) {
          const budget = Math.max(0, Math.min(funds() * BUYBACK_SPEND_FRACTION, funds() - reserve));
          const sharesWanted = Math.ceil((OWNERSHIP_TARGET - fraction) * total);
          const sharesAffordable = Math.floor(budget / perShare);
          const sharesToBuy = Math.min(sharesWanted, sharesAffordable);
          if (sharesToBuy > 0)
            attempt(`Buy back ${ns.format.number(sharesToBuy)} shares`, () => c.buyBackShares(sharesToBuy));
        }
      }
    }

    // Set the rate on the current tier regardless of ownership. The game
    // applies the payout to the player's actual holding, so this is safe.
    const rate = dividendRateFor(funds());
    if (rate === lastDividendRate) return;
    if (attempt(`Set dividend rate ${(rate * 100).toFixed(0)}%`, () => c.issueDividends(rate)))
      lastDividendRate = rate;
  };

  // ---- Per-city office management ---------------------------------------
  // True once the division actually has an office in this city. Cities are
  // expanded as funds allow, so the rest must be skipped until then.
  const inCity = (division, city) =>
    safe(`Read division ${division}`, () => c.getDivision(division))?.cities?.includes(city) === true;
  const runOffice = (division, city, production) => {
    if (!hasUnlock("Office API")) return;
    let office = safe(`Read office ${division}/${city}`, () => c.getOffice(division, city));
    if (!office) return;
    // Office size ladder. The old ladder stayed at 3 employees/city until the
    // corp had $100b+, which starved revenue during the early game; this one
    // grows headcount alongside the cash balance.
    const target =
      funds() > 1e13 ? 60 :
      funds() > 5e12 ? 45 :
      funds() > 1e12 ? 30 :
      funds() > 1e11 ? 20 :
      funds() > 1e10 ? 15 :
      funds() > 1e9  ? 9  : 3;
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
      // Tea only helps when energy has dropped, so don't pay for it on a full office.
      if (office.avgEnergy < (office.maxEnergy ?? 100) - 1)
        attempt("Buy employee tea", () => c.buyTea(division, city));
    }
  };

  // ---- Agriculture inputs and boosts ------------------------------------
  // Agriculture inputs: 0.5 Water + 0.2 Chemicals per unit of output. Both Plants
  // and Food are produced, so both count when sizing the buy rate. Buying them
  // blindly at a fixed rate fills the warehouse and blocks the output.
  const manageInputs = (city) => {
    const set = (material, rate) =>
      attempt(`Set ${material} buy rate`, () => c.buyMaterial(agri, city, material, rate));
    if (hasUnlock("Smart Supply")) { set("Water", 0); set("Chemicals", 0); return; }
    const wh = safe("Read warehouse", () => c.getWarehouse(agri, city));
    const full = wh ? wh.sizeUsed / Math.max(1, wh.size) > 0.9 : false;
    let produced = 0;
    for (const output of ["Plants", "Food"]) {
      const item = safe(`Read ${output}`, () => c.getMaterial(agri, city, output));
      produced += Number(item?.productionAmount) || 0;
    }
    produced = Math.max(produced, 1);
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

  // ---- Research ---------------------------------------------------------
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

  // ---- Warehouse management (no selling here) ---------------------------
  let storagePressure = false;
  const runWarehouse = (division, city) => {
    if (!hasUnlock("Warehouse API")) return;
    let has = safe("Check warehouse", () => c.hasWarehouse(division, city)) === true;
    if (!has && funds() > reserve + WAREHOUSE_BUFFER)
      has = attempt("Purchase warehouse", () => c.purchaseWarehouse(division, city));
    if (!has) return;
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
  };

  // ---- Selling ----------------------------------------------------------
  // Material sales are inherently per-city (stored, salesVolume, etc. are per
  // city). Market-TA.II is a division-wide flag, so check it once.
  const sellMaterials = (division) => {
    const d = safe(`Read division ${division}`, () => c.getDivision(division));
    if (!d || d.makesProducts) return; // product divisions have no output materials
    const ta2 = hasTA2(division);
    for (const city of d.cities ?? []) {
      for (const material of ["Plants", "Food"]) {
        attempt(`Sell ${material}`, () => c.sellMaterial(division, city, material, "MAX", "MP"));
        if (ta2)
          attempt(`Market-TA.II ${material}`, () => c.setMaterialMarketTA2(division, city, material, true));
      }
    }
  };

  // Product sales: sellProduct with all=true writes desiredSell* for every city
  // in one call. Fire once per product, only after every active city has
  // finished developing it. Market-TA.II is a division-wide flag.
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
      // The city argument is arbitrary when `all=true`; pass the first one.
      attempt(`Sell ${product}`, () => c.sellProduct(division, activeCities[0], product, "MAX", "MP", true));
      if (ta2)
        attempt(`Market-TA.II ${product}`, () => c.setProductMarketTA2(division, product, true));
    }
  };

  // Product helpers, used by the Restaurant block.
  const productComplete = (division, product, cityList) =>
    cityList.every((city) => {
      const item = safe(`Read ${product} in ${city}`, () => c.getProduct(division, city, product));
      return item?.developmentProgress >= 100;
    });
  // A product can only be developed in a city that has a warehouse there;
  // otherwise the division-level sell flag has nothing to sell from.
  const startProduct = (division, cityList, productName, investment) => {
    for (const city of cityList) {
      if (!safe(`Check warehouse ${city}`, () => c.hasWarehouse(division, city))) continue;
      attempt(`Start ${productName} in ${city}`, () => c.makeProduct(division, city, productName, investment, investment));
    }
  };

  // ---- Main loop --------------------------------------------------------
  let lastInvestmentCycle = 0;
  let lastUpgrade = 0;
  while (true) {
    try {
      if (pcOwnsCorporation()) {
        await ns.sleep(5_000);
        continue;
      }
      const info = corp();
      if (!info) { await ns.sleep(30_000); continue; }

      // Keep early investment rounds going unless we're optimizing for an
      // undiluted dividend stream. Leave late offers alone either way.
      if (ACCEPT_INVESTMENT) {
        const offer = safe("Read investment offer", () => c.getInvestmentOffer());
        if (offer?.funds > 0 && offer.round <= 3 && offer.funds > Math.max(1e9, funds() * 0.1))
          attempt("Accept investment offer", () => c.acceptInvestmentOffer());
      }

      storagePressure = false;
      reserve = Math.min(5e9, funds() * 0.1);
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
            manageBoosts(city);
          }
        }
        sellMaterials(agri);
        runResearch(agri);
        // Advertising multiplier starts near zero and drives sales; hire AdVert
        // whenever it is a small slice of funds.
        const adCost = safe("Get AdVert cost (Agri)", () => c.getHireAdVertCost(agri));
        if (Number.isFinite(adCost) && adCost <= funds() * 0.25 && funds() > adCost + reserve)
          attempt("Hire AdVert (Agri)", () => c.hireAdVert(agri));
      }

      // Restaurant is the second, product-based division from the supplied strategy.
      if (hasDivision(agri) && funds() > 1e12) createDivision("Restaurant", restaurant);
      if (hasDivision(restaurant)) {
        runResearch(restaurant);
        for (const city of allCities) {
          expand(restaurant, city);
          if (!inCity(restaurant, city)) continue;
          runOffice(restaurant, city, true);
          runWarehouse(restaurant, city);
        }
        // Selling happens once per product, after every active city is done.
        sellProducts(restaurant);
        // Re-read after the expansion loop so newly added cities are visible.
        const d = safe("Read Restaurant division", () => c.getDivision(restaurant));
        const activeCities = d?.cities ?? [];
        const products = d?.products ?? [];
        // maxProducts grows to 5 once uPgrade: Capacity.I / .II finish.
        const maxProducts = d?.maxProducts ?? 3;
        if (activeCities.length && hasUnlock("Warehouse API") && products.length < maxProducts && funds() > 2e12) {
          const allComplete = products.every(p => productComplete(restaurant, p, activeCities));
          if (allComplete) {
            const investment = Math.min(10e9, Math.max(1e9, funds() * 0.005));
            // Each active city needs its own copy of the product.
            if (funds() > 2 * investment * activeCities.length + reserve)
              startProduct(restaurant, activeCities, `Apex Dining ${products.length + 1}`, investment);
          }
        }
        // AdVert also multiplies product sales; hire it when it's a small slice.
        const adCost = safe("Get AdVert cost (Restaurant)", () => c.getHireAdVertCost(restaurant));
        if (Number.isFinite(adCost) && adCost <= funds() * 0.25 && funds() > adCost + reserve)
          attempt("Hire AdVert (Restaurant)", () => c.hireAdVert(restaurant));
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
        // Cache funds once so the inner loop doesn't re-query every iteration.
        const cash = funds();
        let bought = 0;
        for (const upgrade of [...new Set(order)]) {
          const cost = safe(`Get ${upgrade} upgrade cost`, () => c.getUpgradeLevelCost(upgrade));
          // The old cap was 1% of funds (0.05 for Smart Storage under storage
          // pressure). At $20b funds that's a $200m ceiling, and level 1 of
          // every upgrade costs more than that, so nothing was ever bought.
          // 20% (35% for Smart Storage under pressure) unblocks leveling while
          // the funds() > cost + reserve check still keeps reserve untouched.
          const cap = storagePressure && upgrade === "Smart Storage" ? 0.35 : 0.20;
          if (Number.isFinite(cost) && cost <= cash * cap && cash > cost + reserve) {
            if (attempt(`Level ${upgrade}`, () => c.levelUpgrade(upgrade))) { lastUpgrade = Date.now(); bought++; }
            if (bought >= 2) break; // spread spending across updates
          }
        }
      }

      // Pay the player. IPO first, then buy shares back toward the ownership
      // target, then set the dividend rate for the current tier. Buybacks and
      // dividends are independent; the payout scales with the actual holding.
      manageIPO();
      manageSharesAndDividends();

      const now = Date.now();
      if (now - lastInvestmentCycle > 60_000) {
        lastInvestmentCycle = now;
        const live = corp() ?? info;
        const { fraction } = ownershipOf(live);
        ns.print(
          `${info.name}: $${ns.format.number(funds())}; ` +
          `divisions: ${divisions().join(", ") || "none"}; ` +
          `public: ${live?.public ? "yes" : "no"}; ` +
          `shares: ${(fraction * 100).toFixed(1)}%; ` +
          `dividends: ${(Math.max(0, lastDividendRate) * 100).toFixed(0)}%; ` +
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