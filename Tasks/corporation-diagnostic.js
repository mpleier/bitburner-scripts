/**
 * Read-only corporation API diagnostic for comparison with pc.js.
 * Run: run Tasks/corporation-diagnostic.js
 * Then in the PC controller: corp-verify
 * Writes a fresh snapshot to tasks/corp-diagnostic.json on home.
 * @param {NS} ns
 */
export async function main(ns) {
  const outputFile = "tasks/corp-diagnostic.json";
  ns.disableLog("ALL");
  const safe = (fn, fallback = null) => {
    try { return fn(); } catch { return fallback; }
  };

  try {
    const reset = ns.getResetInfo();
    const owned = reset?.ownedSF;
    const sourceFile3 = Number(typeof owned?.get === "function" ? owned.get(3) : owned?.[3]) || 0;
    const available = reset?.currentNode === 3 || sourceFile3 > 0;
    const c = ns.corporation;
    const hasCorporation = available && safe(() => c.hasCorporation(), false) === true;
    const report = {
      checkedAt: Date.now(),
      available,
      hasCorporation,
      eligible: hasCorporation ? null : available ? safe(() => c.canCreateCorporation(true)) : null,
      currentNode: reset?.currentNode ?? null,
      sourceFile3,
      corporation: hasCorporation ? safe(() => c.getCorporation()) : null,
      unlocks: {}, unlockCosts: {}, industryCosts: {}, divisions: {},
      officeCosts: {}, warehouseCosts: {}, offer: null, upgradeCosts: {}, upgradeLevels: {},
    };
    if (!available) report.reason = "Corporation API requires BitNode 3 or Source-File 3 access.";

    if (hasCorporation) {
      const corp = report.corporation;
      for (const name of ["Warehouse API", "Office API", "Smart Supply"]) {
        report.unlocks[name] = safe(() => c.hasUnlock(name), false);
        report.unlockCosts[name] = safe(() => c.getUnlockCost(name));
      }
      for (const industry of ["Agriculture", "Restaurant"])
        report.industryCosts[industry] = safe(() => c.getIndustryData(industry)?.startingCost);
      for (const upgrade of ["Smart Factories", "Smart Storage", "Wilson Analytics"]) {
        report.upgradeCosts[upgrade] = safe(() => c.getUpgradeLevelCost(upgrade));
        report.upgradeLevels[upgrade] = safe(() => c.getUpgradeLevel(upgrade), 0);
      }
      report.offer = safe(() => c.getInvestmentOffer());

      for (const name of corp?.divisions || []) {
        const division = safe(() => c.getDivision(name));
        if (!division) continue;
        const info = {
          name,
          industry: division.industry,
          cities: division.cities || [],
          products: division.products || [],
          offices: {}, warehouses: {}, productInfo: {},
        };
        for (const city of info.cities) {
          if (report.unlocks["Office API"]) {
            info.offices[city] = safe(() => c.getOffice(name, city));
            const office = info.offices[city];
            const target = corp.funds > 1e13 ? 30 : corp.funds > 1e12 ? 15 : corp.funds > 2e11 ? 9 : 3;
            if (office && office.size < target) {
              const add = target - office.size;
              report.officeCosts[`${name}/${city}/${add}`] = safe(() => c.getOfficeSizeUpgradeCost(name, city, add));
            }
          }
          if (report.unlocks["Warehouse API"]) {
            const hasWarehouse = safe(() => c.hasWarehouse(name, city), false);
            info.warehouses[city] = hasWarehouse ? safe(() => c.getWarehouse(name, city)) : null;
            if (hasWarehouse) report.warehouseCosts[`${name}/${city}`] = safe(() => c.getUpgradeWarehouseCost(name, city));
          }
        }
        if (name === "Dining" && info.cities.length && report.unlocks["Warehouse API"])
          for (const product of info.products)
            info.productInfo[product] = safe(() => c.getProduct(name, info.cities[0], product));
        report.divisions[name] = info;
      }
    }

    await ns.write(outputFile, JSON.stringify(report, null, 2), "w");
    ns.tprint(`Corporation diagnostic saved to ${outputFile}`);
    ns.tprint(`Access=${report.available}; corporation=${report.hasCorporation}; divisions=${Object.keys(report.divisions).join(", ") || "none"}`);
    ns.tprint(`Run corp-verify in pc.js to compare this report with a fresh Remote API snapshot.`);
  } catch (error) {
    ns.tprint(`Corporation diagnostic failed safely: ${String(error)}`);
  }
}
