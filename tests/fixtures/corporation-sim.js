/**
 * Deterministic corporation simulation used by the optimiser tests.
 *
 * This is a MODEL, not the game. It implements the `ns.corporation` surface the optimiser
 * uses, plus a small economy (research accrual, product development, production, demand,
 * salaries) so a test can prove the loop improves profit, valuation and product quality
 * against a do-nothing baseline on the same starting save. Every mechanic below is
 * labelled with the game rule it approximates; nothing here is measured live-game data.
 */

import { defaultCorporationConfig } from '../../corporation-config.js';

export const RESEARCH_COSTS = {
  'Hi-Tech R&D Laboratory': 200,
  'Market-TA.I': 400,
  'Market-TA.II': 800,
  'Self-Correcting Assemblers': 1500,
  Drones: 2000,
  'Drones - Assembly': 3000,
  'Drones - Transport': 3000,
  Overclock: 4000,
  'Sti.mu': 4000,
  'uPgrade: Fulcrum': 2500,
  'uPgrade: Capacity.I': 2000,
  'uPgrade: Capacity.II': 3000,
  AutoBrew: 1200,
  AutoPartyManager: 1200,
  'HRBuddy-Recruitment': 1500,
  'HRBuddy-Training': 1500,
  'uPgrade: Dashboard': 2500,
};

export const UPGRADE_COSTS = { base: 2e9 };

const JOB_WEIGHTS = { Operations: 0.55, Engineer: 1.4, Business: 0.45, Management: 0.8, 'Research & Development': 6.5, Intern: 0.05 };

const MATERIAL_DATA = {
  Plants: { name: 'Plants', size: 0.05, baseMarkup: 5 },
  Drugs: { name: 'Drugs', size: 0.1, baseMarkup: 8 },
  'Real Estate': { name: 'Real Estate', size: 0.005, baseMarkup: 4 },
  Hardware: { name: 'Hardware', size: 0.06, baseMarkup: 6 },
  Robots: { name: 'Robots', size: 0.5, baseMarkup: 6 },
  'AI Cores': { name: 'AI Cores', size: 0.1, baseMarkup: 6 },
};

const clone = value => JSON.parse(JSON.stringify(value));

/**
 * @param {object} [options]
 * @param {number} [options.funds] starting corporation funds
 * @param {object} [options.config] validated optimiser configuration
 * @param {number} [options.scienceFactor] industry science factor (Tobacco is 0.642 live)
 * @param {number} [options.cycleSeconds] market cycle seconds
 */
export function createCorporationSimulation({
  funds = 50e9,
  config = defaultCorporationConfig(),
  scienceFactor = 0.642,
  cycleSeconds = 10,
  officeSize = 9,
  employees = 9,
} = {}) {
  const state = {
    funds,
    at: 0,
    researchPoints: 0,
    research: new Set(),
    products: [],
    office: {
      city: 'Sector-12', size: officeSize, numEmployees: employees, maxEnergy: 100, maxMorale: 100,
      avgEnergy: 100, avgMorale: 100, totalExperience: 0,
      employeeJobs: { Operations: employees, Engineer: 0, Business: 0, Management: 0, 'Research & Development': 0 },
      employeeProductionByJob: {},
    },
    warehouse: { city: 'Sector-12', level: 1, size: 2e6, sizeUsed: 0, smartSupplyEnabled: false },
    materials: {},
    numAdVerts: 0,
    awareness: 50,
    popularity: 20,
    ta1: false,
    // `ta2` is ownership of the research; the price effect is per-material/per-product and only
    // arrives through setMaterialMarketTA2 / setProductMarketTA2 (the flag, not the 'MP' string).
    ta2: false,
    ta2Materials: new Set(),
    ta2Products: new Set(),
    smartSupply: false,
    upgrades: {},
    revenue: 0,
    expenses: 0,
    cumulativeRevenue: 0,
    cumulativeExpenses: 0,
    minReserveMargin: Infinity,
    calls: [],
    history: [],
  };
  for (const name of ['Plants', 'Drugs', 'Real Estate', 'Hardware', 'Robots', 'AI Cores']) {
    state.materials[name] = {
      name, stored: name === 'Plants' ? 20000 : 0, quality: 1,
      marketPrice: name === 'Drugs' ? 50 : name === 'Plants' ? 5 : MATERIAL_DATA[name].baseMarkup * 20,
      productionAmount: 0, actualSellAmount: 0, buyAmount: 0, importAmount: 0,
      desiredSellPrice: 'MP', desiredSellAmount: 'MAX', exports: [],
      productionLimit: null, demand: 60, competition: 20,
    };
  }

  const record = (fn, args) => state.calls.push({ fn, args, at: state.at });
  const office = () => state.office;
  const productsByName = () => state.products;
  const salary = () => state.office.numEmployees * 400 + state.warehouse.level * 500;

  const api = {
    // ---- reads -------------------------------------------------------------------
    hasCorporation: () => true,
    canCreateCorporation: () => 'CorporationExists',
    getConstants: () => ({
      secondsPerMarketCycle: cycleSeconds,
      teaCostPerEmployee: 500000,
      smartSupplyOptions: ['leftovers', 'imports', 'none'],
      dividendMaxRate: 0.1,
    }),
    hasUnlock: name => name !== 'Smart Supply',
    getCorporation: () => ({
      name: 'Apex Holdings', funds: state.funds,
      revenue: state.revenue / cycleSeconds, expenses: state.expenses / cycleSeconds,
      public: false, totalShares: 1e9, numShares: 1e9, issuedShares: 0, investorShares: 0,
      sharePrice: 1, shareSaleCooldown: 0, issueNewSharesCooldown: 0, dividendRate: 0,
      tributeModifier: 0, dividendEarnings: 0, nextState: 'START', prevState: 'SALE',
      divisions: ['Tobacco'],
      // Valuation proxy: cash plus a 20,000-cycle multiple of positive operating profit.
      // The real game derives valuation from share price; this stands in for it.
      valuation: Math.max(0, state.funds) + 20000 * Math.max(0, state.revenue - state.expenses),
    }),
    getDivision: name => {
      if (name !== 'Tobacco') throw new Error(`No division ${name}`);
      const researchPoints = state.researchPoints;
      return {
        name: 'Tobacco', industry: 'Tobacco',
        awareness: state.awareness, popularity: state.popularity,
        productionMult: 1 + 0.05 * (state.upgrades['Smart Factories'] || 0),
        researchPoints, lastCycleRevenue: state.revenue, lastCycleExpenses: state.expenses,
        thisCycleRevenue: state.revenue, thisCycleExpenses: state.expenses,
        numAdVerts: state.numAdVerts, cities: ['Sector-12'], products: state.products.map(product => product.name),
        makesProducts: true, maxProducts: 3,
      };
    },
    getIndustryData: () => ({
      name: 'Tobacco', startingCost: 2e9, makesProducts: true, makesMaterials: true,
      producedMaterials: ['Drugs'], requiredMaterials: { Plants: 1 },
      scienceFactor, aiCoreFactor: 0.1, hardwareFactor: 0.2, robotFactor: 0.3,
      realEstateFactor: 0.72, advertisingFactor: 0.5,
    }),
    getOffice: () => clone(office()),
    getWarehouse: () => clone(state.warehouse),
    hasWarehouse: (division, city) => city === 'Sector-12',
    getMaterial: (division, city, name) => {
      const material = state.materials[name];
      if (!material) throw new Error(`No material ${name}`);
      return clone(material);
    },
    getProduct: (division, city, name) => {
      const product = state.products.find(item => item.name === name);
      if (!product) throw new Error(`No product ${name}`);
      return clone(product);
    },
    getMaterialData: name => MATERIAL_DATA[name] || { name, size: 0.1, baseMarkup: 5 },
    getUpgradeLevel: name => state.upgrades[name] || 0,
    getUpgradeLevelCost: name => UPGRADE_COSTS.base * ((state.upgrades[name] || 0) + 1) ** 2,
    getOfficeSizeUpgradeCost: (division, city, add) => 300e6 * Math.max(1, add) * (1 + office().size / 20),
    getUpgradeWarehouseCost: () => 2e9 * state.warehouse.level,
    getHireAdVertCost: () => 1e9 + 500e6 * state.numAdVerts,
    hasResearched: (division, name) => {
      if (name === 'Market-TA.I') return state.ta1;
      if (name === 'Market-TA.II') return state.ta2;
      return state.research.has(name);
    },
    getResearchCost: (division, name) => RESEARCH_COSTS[name] ?? NaN,

    // ---- mutations ---------------------------------------------------------------
    hireEmployee: () => {
      record('hireEmployee', []);
      if (office().numEmployees >= office().size) return false;
      office().numEmployees++;
      return true;
    },
    upgradeOfficeSize: (division, city, add) => {
      record('upgradeOfficeSize', [add]);
      const cost = api.getOfficeSizeUpgradeCost(division, city, add);
      if (state.funds < cost) return false;
      state.funds -= cost;
      office().size += add;
      return true;
    },
    setJobAssignment: (division, city, job, amount) => {
      record('setJobAssignment', [job, amount]);
      if (amount < 0) return false;
      office().employeeJobs[job] = amount;
      return true;
    },
    buyTea: () => {
      record('buyTea', []);
      const cost = office().numEmployees * 500000;
      if (state.funds < cost) return false;
      state.funds -= cost;
      office().avgEnergy = office().maxEnergy;
      return true;
    },
    throwParty: (division, city, costPerEmployee) => {
      record('throwParty', [costPerEmployee]);
      const cost = office().numEmployees * Number(costPerEmployee);
      if (state.funds < cost) return false;
      state.funds -= cost;
      office().avgMorale = office().maxMorale;
      return 1.25;
    },
    levelUpgrade: name => {
      record('levelUpgrade', [name]);
      const cost = api.getUpgradeLevelCost(name);
      if (state.funds < cost) return false;
      state.funds -= cost;
      state.upgrades[name] = (state.upgrades[name] || 0) + 1;
      return true;
    },
    hireAdVert: () => {
      record('hireAdVert', []);
      const cost = api.getHireAdVertCost();
      if (state.funds < cost) return false;
      state.funds -= cost;
      state.numAdVerts++;
      state.awareness += 4;
      state.popularity += 2;
      return true;
    },
    buyMaterial: (division, city, name, rate) => {
      record('buyMaterial', [name, rate]);
      const material = state.materials[name];
      if (!material) return false;
      material.buyAmount = Number(rate) || 0;
      return true;
    },
    sellMaterial: (division, city, name, amount, price) => {
      record('sellMaterial', [name, amount, price]);
      const material = state.materials[name];
      if (!material) return false;
      material.desiredSellAmount = amount;
      material.desiredSellPrice = price;
      return true;
    },
    sellProduct: (division, city, name, amount, price, all) => {
      record('sellProduct', [name, amount, price, all]);
      const product = state.products.find(item => item.name === name);
      if (!product) return false;
      product.desiredSellAmount = amount;
      product.desiredSellPrice = price;
      return true;
    },
    setProductMarketTA2: (division, product, on) => {
      record('setProductMarketTA2', [product, on]);
      // The game throws when Market-TA.II is not researched; model it as a refused call.
      if (!state.ta2) return false;
      if (on === false) state.ta2Products.delete(product); else state.ta2Products.add(product);
      return true;
    },
    setMaterialMarketTA2: (division, city, name, on) => {
      record('setMaterialMarketTA2', [name, on]);
      if (!state.ta2) return false;
      if (on === false) state.ta2Materials.delete(name); else state.ta2Materials.add(name);
      return true;
    },
    setSmartSupply: (division, city, on) => { record('setSmartSupply', [on]); state.smartSupply = on !== false; return true; },
    setSmartSupplyOption: (division, city, name, option) => { record('setSmartSupplyOption', [name, option]); return true; },
    makeProduct: (division, city, name, design, marketing) => {
      record('makeProduct', [name, design, marketing]);
      const cost = Number(design) + Number(marketing);
      if (!Number.isFinite(cost) || state.funds < cost) return false;
      if (state.products.length >= 3) return false;
      if (state.products.some(item => item.name === name)) return false;
      state.funds -= cost;
      state.products.push({
        name, developmentProgress: 0, rating: 1, effectiveRating: 1,
        designInvestment: Number(design), marketingInvestment: Number(marketing),
        productionCost: Number(design) * 0.1, stored: 0, productionAmount: 0, actualSellAmount: 0,
        desiredSellPrice: 'MP', desiredSellAmount: 'MAX', createdResearch: state.researchPoints,
        createdEmployees: office().numEmployees,
      });
      return true;
    },
    discontinueProduct: (division, name) => {
      record('discontinueProduct', [name]);
      const index = state.products.findIndex(item => item.name === name);
      if (index < 0) return false;
      state.products.splice(index, 1);
      return true;
    },
    research: (division, name) => {
      record('research', [name]);
      const cost = RESEARCH_COSTS[name];
      if (!Number.isFinite(cost) || state.researchPoints < cost) return false;
      state.researchPoints -= cost;
      if (name === 'Market-TA.I') state.ta1 = true;
      else if (name === 'Market-TA.II') state.ta2 = true;
      else state.research.add(name);
      return true;
    },
    upgradeWarehouse: (division, city, amount = 1) => {
      record('upgradeWarehouse', [amount]);
      const cost = api.getUpgradeWarehouseCost();
      if (state.funds < cost) return false;
      state.funds -= cost;
      state.warehouse.level += amount;
      state.warehouse.size *= 2;
      return true;
    },
    purchaseWarehouse: () => false,
    clearBuyRates: () => {
      for (const material of Object.values(state.materials)) material.buyAmount = 0;
    },
  };

  /** Advance one corporation cycle: purchases, research, development, production, sales, salaries. */
  function advance() {
    state.at += 1;
    const jobs = office().employeeJobs;
    const engineers = Number(jobs.Engineer) || 0;
    const operations = Number(jobs.Operations) || 0;
    const rnd = Number(jobs['Research & Development']) || 0;
    const management = Number(jobs.Management) || 0;
    const level = name => Number(state.upgrades[name]) || 0;
    const lab = state.research.has('Hi-Tech R&D Laboratory') ? 2 : 0;
    // Boost inventory purchases are charged first, before production consumes inputs.
    for (const material of Object.values(state.materials)) {
      if (!(material.buyAmount > 0)) continue;
      const quantity = material.buyAmount * cycleSeconds;
      const cost = quantity * material.marketPrice;
      if (state.funds < cost) { material.buyAmount = 0; continue; }
      state.funds -= cost;
      material.stored += quantity;
    }
    // Research accrues from the R&D role (game: office research speed x Project Insight).
    state.researchPoints += 5 + rnd * (2.5 + 0.1 * level('Project Insight')) +
      engineers * (0.2 + 0.02 * level('Neural Accelerators')) + lab * (1 + 0.1 * level('Project Insight'));
    // Development progress is division-wide in the game; here it scales with engineers + management.
    for (const product of state.products) {
      if (product.developmentProgress >= 100) continue;
      const science = 1 + state.researchPoints ** scienceFactor / 800;
      const speed = (engineers * 1.5 * (1 + 0.08 * level('Speech Processor Implants')) + operations * 0.5) *
        (1 + management / 20) * (1 + 0.05 * level('FocusWires'));
      product.developmentProgress = Math.min(100, product.developmentProgress + speed / 10);
      product.rating = 1 + 0.6 * (science - 1) + 0.5 * Math.log1p(product.designInvestment / 1e9) +
        0.02 * Number(product.createdEmployees) + 0.02 * level('Nuoptimal Nootropic Injector Implants');
      product.effectiveRating = product.rating * (1 + 0.01 * state.numAdVerts);
      if (product.developmentProgress >= 100) product.productionAmount = 100 * product.effectiveRating;
    }
    // Production: materials at a flat rate, constrained by the recipe input on hand.
    const productionMult = 1 + 0.05 * level('Smart Factories');
    const drugs = state.materials.Drugs;
    const plants = state.materials.Plants;
    const wanted = 200 * productionMult;
    const produced = Math.min(wanted, plants.stored);
    plants.stored = Math.max(0, plants.stored - produced);
    drugs.productionAmount = produced;
    drugs.stored += produced;
    // Sales: demand falls with the markup multiplier; a TA.II-enabled material/product sells at
    // the optimal price (the game's Markets.ts multiplier), but only once the flag is set.
    const TA2_PRICE_MULTIPLIER = 1.6;
    const multiplierOf = (price, marketPrice) => {
      if (typeof price !== 'string') return 1;
      if (price === 'MP') return 1;
      const star = price.match(/^MP\s*\*\s*(\d+(?:\.\d+)?)$/);
      if (star) return Math.max(1, Number(star[1]));
      const plus = price.match(/^MP\s*\+\s*(\d+(?:\.\d+)?)$/);
      if (plus) return 1 + Number(plus[1]) / Math.max(1, marketPrice);
      return 1;
    };
    const salesBoost = 1 + 0.02 * level('ABC SalesBots');
    state.revenue = 0;
    for (const material of Object.values(state.materials)) {
      if (!(material.stored > 0)) { material.actualSellAmount = 0; continue; }
      const optimal = state.ta2Materials.has(material.name) && material.desiredSellPrice === 'MP';
      const multiplier = optimal ? TA2_PRICE_MULTIPLIER : multiplierOf(material.desiredSellPrice, material.marketPrice);
      const demand = 400 * salesBoost / (optimal ? 1 : Math.max(1, multiplier ** 2));
      const sold = Math.min(material.stored, demand);
      material.stored -= sold;
      material.actualSellAmount = sold;
      state.revenue += sold * material.marketPrice * multiplier;
    }
    for (const product of state.products) {
      if (product.developmentProgress < 100) { product.actualSellAmount = 0; continue; }
      const optimal = state.ta2Products.has(product.name) && product.desiredSellPrice === 'MP';
      const price = optimal ? TA2_PRICE_MULTIPLIER : multiplierOf(product.desiredSellPrice, 2000);
      const demand = 120 * salesBoost * (1 + Math.log1p(product.effectiveRating)) / (optimal ? 1 : Math.max(1, price ** 1.5));
      const sold = Math.min(product.stored + product.productionAmount, demand);
      product.stored = Math.max(0, product.stored + product.productionAmount - sold);
      product.actualSellAmount = sold;
      state.revenue += sold * 2000 * price;
    }
    state.expenses = salary();
    state.funds += state.revenue - state.expenses;
    state.cumulativeRevenue += state.revenue;
    state.cumulativeExpenses += state.expenses;
    state.warehouse.sizeUsed = Object.values(state.materials).reduce((sum, material) => sum + material.stored * (MATERIAL_DATA[material.name]?.size || 0.1), 0) +
      state.products.reduce((sum, product) => sum + product.stored * 0.1, 0);
    state.history.push(metrics());
    const reserve = Math.max(1e6, Math.min(5e9, Math.max(0, state.funds) * 0.1), state.expenses * cycleSeconds * 2);
    state.minReserveMargin = Math.min(state.minReserveMargin, state.funds - reserve);
  }

  function metrics() {
    const products = state.products.map(product => ({ ...product }));
    return {
      at: state.at,
      funds: state.funds,
      revenue: state.revenue,
      expenses: state.expenses,
      profit: state.revenue - state.expenses,
      cumulativeProfit: state.cumulativeRevenue - state.cumulativeExpenses,
      valuation: api.getCorporation().valuation,
      researchPoints: state.researchPoints,
      ta2: state.ta2,
      ta2Enabled: { materials: [...state.ta2Materials], products: [...state.ta2Products] },
      products,
      bestRating: products.reduce((max, product) => Math.max(max, product.effectiveRating || 0), 0),
      officeSize: office().size,
      employees: office().numEmployees,
      warehouseLevel: state.warehouse.level,
      adverts: state.numAdVerts,
      minReserveMargin: state.minReserveMargin,
    };
  }

  return {
    api,
    state,
    advance,
    metrics,
    calls: () => [...state.calls],
    callCount: name => state.calls.filter(call => call.fn === name).length,
    resetCalls: () => { state.calls = []; },
    config,
  };
}

/**
 * Run `steps` cycles. With an optimiser the tick runs first (choosing actions) and the
 * economy advances after, matching the game's PURCHASE..SALE -> START ordering.
 */
export function runSimulation({ steps = 200, optimizer = null, simulation }) {
  const metrics = [];
  for (let step = 0; step < steps; step++) {
    if (optimizer) optimizer.tick();
    simulation.advance();
    metrics.push(simulation.metrics());
  }
  return metrics;
}
