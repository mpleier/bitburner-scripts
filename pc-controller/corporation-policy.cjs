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

module.exports = { readyProductSales };
