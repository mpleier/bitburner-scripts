/**
 * Minimal in-memory Bitburner corporation model for the bootstrap/expansion tests.
 *
 * It enforces the same preconditions the real game does (unlocks before warehouses,
 * warehouses before materials, funds before purchases, city once per division) and
 * records every mutating call so tests can assert idempotency and dry-run purity.
 *
 * Not a game replica: unlock/industry prices are representative, not exact.
 */

const CITY_NAMES = ['Sector-12', 'Aevum', 'Volhaven', 'Chongqing', 'New Tokyo', 'Ishima'];

export const TEST_CONSTANTS = {
  officeInitialCost: 4e9,
  warehouseInitialCost: 5e9,
  warehouseSize: 100,
  secondsPerMarketCycle: 10,
  industryNames: ['Water Utilities', 'Agriculture', 'Fishing', 'Mining', 'Refinery', 'Restaurant', 'Tobacco', 'Chemical', 'Pharmaceutical', 'Computer Hardware', 'Robotics', 'Software', 'Healthcare', 'Real Estate'],
};

export const TEST_INDUSTRIES = {
  'Water Utilities': { startingCost: 5e9, requiredMaterials: {}, producedMaterials: ['Water'], makesProducts: false },
  Agriculture: { startingCost: 40e9, requiredMaterials: { Water: 0.5, Chemicals: 0.2 }, producedMaterials: ['Plants', 'Food'], makesProducts: false },
  Chemical: { startingCost: 70e9, requiredMaterials: { Plants: 1, Water: 0.5 }, producedMaterials: ['Chemicals'], makesProducts: false },
  Tobacco: { startingCost: 20e9, requiredMaterials: { Plants: 1 }, producedMaterials: [], makesProducts: true },
  Software: { startingCost: 25e9, requiredMaterials: {}, producedMaterials: ['AI Cores'], makesProducts: true },
  Restaurant: { startingCost: 250e9, requiredMaterials: { Food: 1, Water: 0.5 }, producedMaterials: [], makesProducts: true },
};

export const TEST_UNLOCK_COSTS = {
  'Warehouse API': 30e9,
  'Office API': 20e9,
  'Smart Supply': 25e9,
  Export: 40e9,
  'Market Research - Demand': 25e9,
  'Market Data - Competition': 25e9,
};

const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const MATERIAL_PRICES = { Water: 50, Chemicals: 200, Plants: 120, Food: 90, 'Real Estate': 1e4, Hardware: 2e4, Robots: 5e5, 'AI Cores': 1e5 };
const MATERIAL_COEFFICIENTS = { Water: 0.5, Chemicals: 0.2, Plants: 1, Food: 1 };

/**
 * @param {object} options
 * @param {number} [options.wallet]            player money
 * @param {number} [options.funds]             corporation funds (only used when a corporation exists)
 * @param {boolean} [options.existing]         start with a corporation
 * @param {string} [options.name]
 * @param {string[]} [options.unlocks]
 * @param {number} [options.divisionCap]
 * @param {object} [options.files]             in-game files (config, reserve.txt)
 * @param {string[]} [options.mutationFailure] operation names that always throw
 * @param {boolean} [options.failAllMutations]
 * @param {string} [options.canCreateSeed]     override canCreateCorporation(false)
 * @param {string} [options.canCreateSelf]     override canCreateCorporation(true)
 */
export function createTestGame(options = {}) {
  const {
    name = 'Apex Holdings',
    existing = false,
    unlocks = [],
    divisionCap = 20,
    mutationFailure = [],
    failAllMutations = false,
  } = options;
  const files = { ...(options.files || {}) };
  const calls = { sequence: [], attempts: [], mutations: [], logs: [], sleeps: [], files: [] };
  const state = {
    wallet: options.wallet ?? 1e12,
    corporation: existing
      ? { name, funds: options.funds ?? 1e12, revenue: options.revenue ?? 0, expenses: options.expenses ?? 0, public: false }
      : null,
    divisions: {},
    offices: {},
    warehouses: {},
    materials: {},
    unlocks: new Set(unlocks),
    constants: { ...TEST_CONSTANTS, ...(options.constants || {}) },
  };
  const atExit = [];

  const record = (operation, args = []) => {
    const entry = { operation, args };
    calls.sequence.push(operation);
    calls.attempts.push(entry);
    return entry;
  };
  const corp = () => {
    if (!state.corporation) throw new Error('You do not have a corporation');
    return state.corporation;
  };
  const division = (divisionName) => {
    const found = state.divisions[divisionName];
    if (!found) throw new Error(`Division ${divisionName} does not exist`);
    return found;
  };
  const requireFunds = (cost) => {
    if (!(corp().funds >= cost)) throw new Error('Insufficient corporation funds');
    corp().funds -= cost;
  };

  const api = {
    hasCorporation: () => state.corporation !== null,
    canCreateCorporation: (selfFund) => {
      if (state.corporation) return 'CorporationExists';
      if (selfFund) return options.canCreateSelf ?? 'Success';
      return options.canCreateSeed ?? 'Success';
    },
    createCorporation: (corporationName, selfFund) => {
      record('createCorporation', [corporationName, selfFund], true);
      if (state.corporation) throw new Error('You already have a corporation');
      if (selfFund) {
        if (!(state.wallet >= 150e9)) throw new Error('You do not have enough money to self-fund');
        state.wallet -= 150e9;
      } else if ((options.currentNode ?? 3) !== 3) {
        throw new Error('Seed money is only available in BitNode 3');
      }
      state.corporation = { name: corporationName, funds: options.seedFunds ?? 150e9, revenue: 0, expenses: 0, public: false };
      return true;
    },
    getCorporation: () => {
      const c = corp();
      return {
        name: c.name,
        funds: c.funds,
        revenue: c.revenue,
        expenses: c.expenses,
        public: c.public,
        totalShares: 1e9,
        numShares: 1e9,
        sharePrice: 0,
        dividendRate: 0,
        valuation: 0,
        divisions: Object.keys(state.divisions),
      };
    },
    getConstants: () => clone(state.constants),
    getDivision: (divisionName) => {
      const d = division(divisionName);
      const industry = TEST_INDUSTRIES[d.industry] || {};
      return {
        name: d.name,
        industry: d.industry,
        cities: [...d.cities],
        products: [...d.products],
        makesProducts: industry.makesProducts === true,
        maxProducts: industry.makesProducts ? 3 : 0,
        researchPoints: d.researchPoints,
        awareness: 0,
        popularity: 0,
        lastCycleRevenue: d.lastCycleRevenue,
        lastCycleExpenses: d.lastCycleExpenses,
        thisCycleRevenue: 0,
        thisCycleExpenses: 0,
        numAdVerts: 0,
      };
    },
    getIndustryData: (industry) => {
      const data = TEST_INDUSTRIES[industry];
      if (!data) throw new Error(`Unknown industry ${industry}`);
      return clone(data);
    },
    expandIndustry: (industry, divisionName) => {
      record('expandIndustry', [industry, divisionName], true);
      corp();
      const data = TEST_INDUSTRIES[industry];
      if (!data) throw new Error(`Unknown industry ${industry}`);
      if (Object.keys(state.divisions).length >= divisionCap) throw new Error('You have reached the maximum number of divisions');
      if (state.divisions[divisionName]) throw new Error(`Division ${divisionName} already exists`);
      if (Object.values(state.divisions).some((d) => d.industry === industry)) throw new Error(`You already have a ${industry} division`);
      requireFunds(data.startingCost);
      state.divisions[divisionName] = { name: divisionName, industry, cities: [], products: [], researchPoints: 0, lastCycleRevenue: 0, lastCycleExpenses: 0 };
      return true;
    },
    expandCity: (divisionName, city) => {
      record('expandCity', [divisionName, city], true);
      const d = division(divisionName);
      if (d.cities.includes(city)) throw new Error(`You already have an office in ${city}`);
      if (!CITY_NAMES.includes(city)) throw new Error(`Unknown city ${city}`);
      requireFunds(state.constants.officeInitialCost);
      d.cities.push(city);
      state.offices[`${divisionName}/${city}`] = { city, size: 3, numEmployees: 0, avgEnergy: 100, avgMorale: 100 };
      return true;
    },
    hasWarehouse: (divisionName, city) => state.warehouses[`${divisionName}/${city}`] !== undefined,
    purchaseWarehouse: (divisionName, city) => {
      record('purchaseWarehouse', [divisionName, city], true);
      const d = division(divisionName);
      if (!d.cities.includes(city)) throw new Error(`You do not have a city in ${city}`);
      if (state.warehouses[`${divisionName}/${city}`]) throw new Error('You already have a warehouse there');
      if (!state.unlocks.has('Warehouse API')) throw new Error('You have not purchased the Warehouse API');
      requireFunds(state.constants.warehouseInitialCost);
      state.warehouses[`${divisionName}/${city}`] = { level: 1, city, size: state.constants.warehouseSize, sizeUsed: 0, smartSupplyEnabled: false };
      return true;
    },
    getWarehouse: (divisionName, city) => {
      const warehouse = state.warehouses[`${divisionName}/${city}`];
      if (!warehouse) throw new Error('No warehouse there');
      return clone(warehouse);
    },
    getUpgradeWarehouseCost: (divisionName, city) => {
      const warehouse = state.warehouses[`${divisionName}/${city}`];
      if (!warehouse) throw new Error('No warehouse there');
      return 1e9 * warehouse.level;
    },
    upgradeWarehouse: (divisionName, city) => {
      record('upgradeWarehouse', [divisionName, city], true);
      const warehouse = state.warehouses[`${divisionName}/${city}`];
      if (!warehouse) throw new Error('No warehouse there');
      requireFunds(1e9 * warehouse.level);
      warehouse.level += 1;
      return true;
    },
    hasUnlock: (unlock) => state.unlocks.has(unlock),
    getUnlockCost: (unlock) => {
      const cost = TEST_UNLOCK_COSTS[unlock];
      if (cost === undefined) throw new Error(`Unknown unlock ${unlock}`);
      return cost;
    },
    purchaseUnlock: (unlock) => {
      record('purchaseUnlock', [unlock], true);
      if (state.unlocks.has(unlock)) throw new Error('You already have that unlock');
      requireFunds(api.getUnlockCost(unlock));
      state.unlocks.add(unlock);
      return true;
    },
    getOffice: (divisionName, city) => {
      const office = state.offices[`${divisionName}/${city}`];
      if (!office) throw new Error('No office there');
      return clone(office);
    },
    getOfficeSizeUpgradeCost: (divisionName, city, add) => {
      const office = api.getOffice(divisionName, city);
      return Math.round((add * 1e9 * (1 + office.size / 9)) / 1e6) * 1e6;
    },
    upgradeOfficeSize: (divisionName, city, add) => {
      record('upgradeOfficeSize', [divisionName, city, add], true);
      const office = api.getOffice(divisionName, city);
      requireFunds(api.getOfficeSizeUpgradeCost(divisionName, city, add));
      office.size += add;
      state.offices[`${divisionName}/${city}`].size = office.size;
      return true;
    },
    hireEmployee: (divisionName, city) => {
      record('hireEmployee', [divisionName, city], true);
      if (!state.unlocks.has('Office API')) throw new Error('You have not purchased the Office API');
      const office = state.offices[`${divisionName}/${city}`];
      if (!office) throw new Error('No office there');
      if (office.numEmployees >= office.size) throw new Error('No more space in this office');
      office.numEmployees += 1;
      return true;
    },
    setJobAssignment: (divisionName, city, job, amount) => {
      record('setJobAssignment', [divisionName, city, job, amount], true);
      return true;
    },
    setSmartSupply: (divisionName, city, enabled) => {
      record('setSmartSupply', [divisionName, city, enabled], true);
      const warehouse = state.warehouses[`${divisionName}/${city}`];
      if (!warehouse) throw new Error('No warehouse there');
      if (!state.unlocks.has('Smart Supply')) throw new Error('You have not purchased Smart Supply');
      warehouse.smartSupplyEnabled = enabled === true;
      return true;
    },
    getMaterial: (divisionName, city, material) => {
      if (!state.warehouses[`${divisionName}/${city}`]) throw new Error('No warehouse there');
      const key = `${divisionName}/${city}/${material}`;
      const stored = state.materials[key] || { stored: 0, buyAmount: 0 };
      return {
        name: material,
        stored: stored.stored,
        buyAmount: stored.buyAmount,
        productionAmount: 0,
        actualSellAmount: 0,
        marketPrice: MATERIAL_PRICES[material] ?? 100,
        quality: 1,
      };
    },
    buyMaterial: (divisionName, city, material, rate) => {
      record('buyMaterial', [divisionName, city, material, rate], true);
      if (!state.warehouses[`${divisionName}/${city}`]) throw new Error('No warehouse there');
      const key = `${divisionName}/${city}/${material}`;
      const current = state.materials[key] || { stored: 0, buyAmount: 0 };
      state.materials[key] = { ...current, buyAmount: rate };
      return true;
    },
    sellDivision: (divisionName) => {
      record('sellDivision', [divisionName], true);
      division(divisionName);
      delete state.divisions[divisionName];
      return true;
    },
    nextUpdate: async () => undefined,
  };

  const MUTATING_OPERATIONS = [
    'createCorporation',
    'expandIndustry',
    'expandCity',
    'purchaseWarehouse',
    'upgradeWarehouse',
    'purchaseUnlock',
    'upgradeOfficeSize',
    'hireEmployee',
    'setJobAssignment',
    'setSmartSupply',
    'buyMaterial',
    'sellDivision',
  ];
  // Wrap mutations so only successful calls are recorded as purchases; a rejected call is
  // recorded in `attempts`, which keeps idempotency assertions honest.
  for (const operation of MUTATING_OPERATIONS) {
    const original = api[operation];
    api[operation] = (...args) => {
      if (failAllMutations) throw new Error(`${operation} rejected by test API`);
      if (mutationFailure.includes(operation)) throw new Error(`${operation} rejected by test API`);
      const result = original(...args);
      calls.mutations.push({ operation, args, at: calls.mutations.length });
      return result;
    };
  }

  const ns = {
    args: options.args || [],
    pid: 4242,
    corporation: options.apiAvailable === false ? undefined : api,
    getResetInfo: () => ({
      currentNode: options.currentNode ?? 3,
      lastNodeReset: options.lastNodeReset ?? 1000,
      lastAugReset: options.lastAugReset ?? 2000,
      ownedSF: options.ownedSF ?? new Map([[3, 1]]),
      bitNodeOptions: { disableCorporation: options.disableCorporation === true },
    }),
    getPlayer: () => ({ money: state.wallet }),
    read: (path) => (files[path] === undefined ? '' : files[path]),
    write: (path, data) => {
      files[path] = data;
      calls.files.push({ path, data });
      return true;
    },
    rm: (path) => delete files[path],
    fileExists: (path) => files[path] !== undefined,
    print: (message) => calls.logs.push(String(message)),
    tprint: (message) => calls.logs.push(String(message)),
    sleep: async (ms) => {
      calls.sleeps.push(ms);
    },
    disableLog: () => {},
    getScriptName: () => options.scriptName || 'corporation-bootstrap-daemon.js',
    getScriptRam: () => options.scriptRam ?? 60,
    getServerMaxRam: () => options.maxRam ?? 1000,
    getServerUsedRam: () => options.usedRam ?? 100,
    ps: () => options.processes || [{ filename: options.scriptName || 'corporation-bootstrap-daemon.js', pid: 4242 }],
    atExit: (fn) => atExit.push(fn),
  };

  return {
    ns,
    api,
    calls,
    files,
    state,
    atExit,
    /** Add revenue per idle cycle so tests can model a profitable corporation. */
    setRevenue(revenue, expenses = 0) {
      if (state.corporation) {
        state.corporation.revenue = revenue;
        state.corporation.expenses = expenses;
      }
    },
    /** Number of mutating calls for one operation. */
    count(operation) {
      return calls.mutations.filter((call) => call.operation === operation).length;
    },
    mutationsSince(mark) {
      return calls.mutations.slice(mark);
    },
    mark() {
      return calls.mutations.length;
    },
  };
}

export { CITY_NAMES };
