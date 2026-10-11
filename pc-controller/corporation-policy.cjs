"use strict";

/** Build product sale orders only after development completes, and only in active cities. */
function readyProductSales(division, cities) {
  const activeCities = new Set(division?.cities || []);
  return (division?.products || []).flatMap((product) => {
    const progress = Number(division?.productInfo?.[product]?.developmentProgress || 0);
    if (progress < 100) return [];
    return cities
      .filter((city) => activeCities.has(city))
      .map((city) => [division.name, city, product, "MAX", "MP", true]);
  });
}

/** Avoid recurring tea spending when the office already has healthy morale and energy. */
function shouldBuyTea(office, threshold = 95) {
  if (!office) return false;
  const energy = Number(office.avgEnergy);
  const morale = Number(office.avgMorale);
  // Older API snapshots may omit these fields; preserve the old recovery behavior.
  if (!Number.isFinite(energy) || !Number.isFinite(morale)) return true;
  return energy < threshold || morale < threshold;
}

/** Compare stable corporation fields from an in-game report and a PC API snapshot. */
function compareSnapshots(game, pc) {
  const mismatches = [];
  const compare = (path, a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push({ path, game: a, pc: b });
  };
  if (!game || !pc) return [{ path: "snapshot", game: !!game, pc: !!pc }];
  for (const key of ["available", "currentNode", "sourceFile3"])
    compare(key, game[key], pc[key]);
  if (!game.available || !pc.available) {
    compare("reason", game.reason, pc.reason);
    return mismatches;
  }
  compare("hasCorporation", game.hasCorporation, pc.hasCorporation);
  compare("eligible", game.eligible, pc.eligible);
  if (!game.hasCorporation || !pc.hasCorporation) return mismatches;

  compare("corporation.name", game.corporation?.name, pc.corporation?.name);
  compare("corporation.divisions", [...(game.corporation?.divisions || [])].sort(), [...(pc.corporation?.divisions || [])].sort());
  for (const key of ["Warehouse API", "Office API", "Smart Supply"])
    compare(`unlocks.${key}`, game.unlocks?.[key], pc.unlocks?.[key]);
  for (const key of ["Warehouse API", "Office API", "Smart Supply"])
    compare(`unlockCosts.${key}`, game.unlockCosts?.[key], pc.unlockCosts?.[key]);
  for (const key of ["Agriculture", "Restaurant"])
    compare(`industryCosts.${key}`, game.industryCosts?.[key], pc.industryCosts?.[key]);
  for (const key of ["Smart Factories", "Smart Storage", "Wilson Analytics"]) {
    compare(`upgradeCosts.${key}`, game.upgradeCosts?.[key], pc.upgradeCosts?.[key]);
    compare(`upgradeLevels.${key}`, game.upgradeLevels?.[key], pc.upgradeLevels?.[key]);
  }
  for (const key of new Set([...Object.keys(game.officeCosts || {}), ...Object.keys(pc.officeCosts || {})]))
    compare(`officeCosts.${key}`, game.officeCosts?.[key], pc.officeCosts?.[key]);
  for (const key of new Set([...Object.keys(game.warehouseCosts || {}), ...Object.keys(pc.warehouseCosts || {})]))
    compare(`warehouseCosts.${key}`, game.warehouseCosts?.[key], pc.warehouseCosts?.[key]);
  compare("offer.round", game.offer?.round, pc.offer?.round);
  for (const name of Object.keys(pc.divisions || {})) {
    const a = game.divisions?.[name];
    const b = pc.divisions?.[name];
    if (!a || !b) { compare(`divisions.${name}.present`, !!a, !!b); continue; }
    compare(`divisions.${name}.industry`, a.industry, b.industry);
    compare(`divisions.${name}.cities`, [...(a.cities || [])].sort(), [...(b.cities || [])].sort());
    compare(`divisions.${name}.products`, [...(a.products || [])].sort(), [...(b.products || [])].sort());
    for (const city of new Set([...Object.keys(a.offices || {}), ...Object.keys(b.offices || {})])) {
      const ao = a.offices?.[city], bo = b.offices?.[city];
      compare(`divisions.${name}.offices.${city}.present`, !!ao, !!bo);
      if (ao && bo) for (const key of ["size", "numEmployees", "avgEnergy", "avgMorale"])
        compare(`divisions.${name}.offices.${city}.${key}`, ao[key], bo[key]);
      const aw = a.warehouses?.[city], bw = b.warehouses?.[city];
      compare(`divisions.${name}.warehouses.${city}.present`, !!aw, !!bw);
      if (aw && bw) compare(`divisions.${name}.warehouses.${city}.size`, aw.size, bw.size);
    }
    for (const product of new Set([...Object.keys(a.productInfo || {}), ...Object.keys(b.productInfo || {})])) {
      const ap = a.productInfo?.[product], bp = b.productInfo?.[product];
      compare(`divisions.${name}.productInfo.${product}.present`, !!ap, !!bp);
      if (ap && bp) compare(`divisions.${name}.productInfo.${product}.developmentProgress`, ap.developmentProgress, bp.developmentProgress);
    }
  }
  return mismatches;
}

module.exports = { readyProductSales, shouldBuyTea, compareSnapshots };
