/**
 * Corporation optimiser configuration: schema, defaults, validation and legacy flag merging.
 *
 * Spec: docs/corp-automation-spec.md §8. The file is read with ns.read, parsed defensively and
 * any invalid field falls back to its default and is reported once. CLI flags override the file
 * so existing autopilot invocations keep working. Nothing in here throws: a broken config must
 * never stop the controller, it must downgrade to safe defaults and say so.
 */

export const CORPORATION_CONFIG_PATH = 'corporation-config.json';
export const CORPORATION_CONFIG_VERSION = 1;
export const CORPORATION_CITIES = ['Sector-12', 'Aevum', 'Volhaven', 'Chongqing', 'New Tokyo', 'Ishima'];

/** Cash thresholds that select an office-size target; one fewer entry than the target array. */
export const DEFAULT_MATERIAL_CASH_TIERS = [1e9, 1e10, 1e11, 1e12, 5e12, 1e13];
export const DEFAULT_PRODUCT_CASH_TIERS = [1e12, 1e13, 1e14, 1e15];

/** The schema in docs/corp-automation-spec.md §8, plus additive keys the optimiser needs. */
export function defaultCorporationConfig() {
  return {
    schemaVersion: CORPORATION_CONFIG_VERSION,
    enabled: true,
    dryRun: false,
    corporation: { name: 'Apex Holdings', selfFund: true, seedFirst: true },
    bootstrap: {
      industryChain: ['Agriculture', 'Chemical', 'Tobacco'],
      cities: ['Sector-12', 'Aevum', 'Volhaven', 'Chongqing', 'New Tokyo', 'Ishima'],
      expandAllIndustries: false,
      allowDivisionSale: false,
      warehouseFullThreshold: 0.7,
      expediteStagedExpansion: true,
    },
    product: {
      scienceFloor: 1.15,
      scienceAbandonFloor: 1.1,
      allowProductRetirement: false,
      developmentSpeed: true,
      maxProductsPerDivision: null,
      minimumInvestment: 10e6,
      investmentCashFraction: 0.02,
    },
    people: {
      officeTargets: {
        materials: [3, 9, 15, 20, 30, 45, 60],
        products: [30, 60, 80, 100, 120],
      },
      cashTiers: { materials: [...DEFAULT_MATERIAL_CASH_TIERS], products: [...DEFAULT_PRODUCT_CASH_TIERS] },
      teaThreshold: 2,
      upgradeFraction: 0.2,
      upgradePaybackCycles: 600,
      storageUpgradeFraction: 0.35,
      starvationTicks: 3,
    },
    finance: {
      minOwnership: 0.5,
      investmentMinOwnership: 0.1,
      acceptInvestment: true,
      ipoValuationFloor: 1e10,
      ipoShares: 0,
      payDividends: true,
      dividendTiers: [[1e21, 0.2], [1e18, 0.1], [1e15, 0.05], [1e13, 0.02]],
      manageShares: true,
      bribeFactions: true,
    },
    market: {
      advertSpendFraction: 0.5,
      maxAdVerts: { materials: 8, products: 20 },
      advertPaybackSeconds: 21600,
      boostWarehouseFraction: 0.6,
      exportQualityMargin: 0.05,
      priceCeiling: 1e6,
      throttleProductionOnBacklog: false,
    },
    budgets: {
      reserveFloor: 1e6,
      reserveCap: 5e9,
      reserveCashFraction: 0.1,
      reserveExpenseCycles: 2,
      growthFraction: 0.25,
      developmentGrowthFraction: 0.75,
      upkeepCashFraction: 0.02,
      boostCashFraction: 0.2,
      inputCashFraction: 0.5,
      officeCashFraction: 0.1,
      recoveryMarginCycles: 10,
    },
    research: { affordableFraction: 0.2, optionalAutomation: false, developmentReserveCycles: 5 },
    telemetry: {
      statusFile: 'tasks/corporation-status.json',
      stateFile: 'tasks/corporation-optimizer.json',
      cadenceMs: 60000,
      debug: false,
    },
  };
}

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));

/** Schema entries: every known path with its value rule. Unknown paths are warned about, not copied. */
const SCHEMA = {
  schemaVersion: { kind: 'number', min: 1, integer: true },
  enabled: { kind: 'boolean' },
  dryRun: { kind: 'boolean' },
  'corporation.name': { kind: 'string' },
  'corporation.selfFund': { kind: 'boolean' },
  'corporation.seedFirst': { kind: 'boolean' },
  'bootstrap.industryChain': { kind: 'strings' },
  'bootstrap.cities': { kind: 'cities' },
  'bootstrap.expandAllIndustries': { kind: 'boolean' },
  'bootstrap.allowDivisionSale': { kind: 'boolean' },
  'bootstrap.warehouseFullThreshold': { kind: 'number', min: 0, max: 1 },
  'bootstrap.expediteStagedExpansion': { kind: 'boolean' },
  'product.scienceFloor': { kind: 'number', min: 1, max: 1000 },
  'product.scienceAbandonFloor': { kind: 'number', min: 1, max: 1000 },
  'product.allowProductRetirement': { kind: 'boolean' },
  'product.developmentSpeed': { kind: 'boolean' },
  'product.maxProductsPerDivision': { kind: 'nullableNumber', min: 1, max: 64, integer: true },
  'product.minimumInvestment': { kind: 'number', min: 1e6, max: 1e15 },
  'product.investmentCashFraction': { kind: 'number', min: 0, max: 1 },
  'people.officeTargets.materials': { kind: 'counts', min: 1, max: 10000 },
  'people.officeTargets.products': { kind: 'counts', min: 1, max: 10000 },
  'people.cashTiers.materials': { kind: 'thresholds' },
  'people.cashTiers.products': { kind: 'thresholds' },
  'people.teaThreshold': { kind: 'number', min: 0, max: 100, integer: true },
  'people.upgradeFraction': { kind: 'number', min: 0, max: 1 },
  'people.upgradePaybackCycles': { kind: 'number', min: 0, max: 100000 },
  'people.storageUpgradeFraction': { kind: 'number', min: 0, max: 1 },
  'people.starvationTicks': { kind: 'number', min: 1, max: 100, integer: true },
  'finance.minOwnership': { kind: 'number', min: 1e-6, max: 1 },
  'finance.investmentMinOwnership': { kind: 'number', min: 1e-6, max: 1 },
  'finance.acceptInvestment': { kind: 'boolean' },
  'finance.ipoValuationFloor': { kind: 'number', min: 1e9, max: 1e18 },
  'finance.ipoShares': { kind: 'number', min: 0, max: 1e15, integer: true },
  'finance.payDividends': { kind: 'boolean' },
  'finance.dividendTiers': { kind: 'tiers' },
  'finance.manageShares': { kind: 'boolean' },
  'finance.bribeFactions': { kind: 'boolean' },
  'market.advertSpendFraction': { kind: 'number', min: 0, max: 1 },
  'market.maxAdVerts.materials': { kind: 'number', min: 0, max: 1000, integer: true },
  'market.maxAdVerts.products': { kind: 'number', min: 0, max: 1000, integer: true },
  'market.advertPaybackSeconds': { kind: 'number', min: 0, max: 1e9 },
  'market.boostWarehouseFraction': { kind: 'number', min: 0, max: 1 },
  'market.exportQualityMargin': { kind: 'number', min: 0, max: 1 },
  'market.priceCeiling': { kind: 'number', min: 1, max: 1e9 },
  'market.throttleProductionOnBacklog': { kind: 'boolean' },
  'budgets.reserveFloor': { kind: 'number', min: 0, max: 1e12 },
  'budgets.reserveCap': { kind: 'number', min: 0, max: 1e15 },
  'budgets.reserveCashFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.reserveExpenseCycles': { kind: 'number', min: 0, max: 100 },
  'budgets.growthFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.developmentGrowthFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.upkeepCashFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.boostCashFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.inputCashFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.officeCashFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.recoveryMarginCycles': { kind: 'number', min: 1, max: 1000, integer: true },
  'research.affordableFraction': { kind: 'number', min: 0, max: 1 },
  'research.optionalAutomation': { kind: 'boolean' },
  'research.developmentReserveCycles': { kind: 'number', min: 1, max: 100, integer: true },
  'telemetry.statusFile': { kind: 'string' },
  'telemetry.stateFile': { kind: 'string' },
  'telemetry.cadenceMs': { kind: 'number', min: 1000, max: 3600000, integer: true },
  'telemetry.debug': { kind: 'boolean' },
};

/** Legacy CLI flags -> config path, per spec §8. Unknown flags are ignored by this module. */
export const FLAG_MAP = {
  'development-speed': 'product.developmentSpeed',
  'min-ownership': 'finance.minOwnership',
  'investment-min-ownership': 'finance.investmentMinOwnership',
  'expand-all-industries': 'bootstrap.expandAllIndustries',
  'manage-shares': 'finance.manageShares',
  'bribe-factions': 'finance.bribeFactions',
  'dry-run': 'dryRun',
};

const getPath = (object, path) => path.split('.').reduce((value, key) => (isPlainObject(value) ? value[key] : undefined), object);
const setPath = (object, path, value) => {
  const keys = path.split('.');
  let cursor = object;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = value;
};

function validateValue(rule, value) {
  switch (rule.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
    case 'strings':
      return Array.isArray(value) && value.length > 0 && value.length <= 32 &&
        value.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 64);
    case 'cities':
      return Array.isArray(value) && value.length > 0 && value.length <= CORPORATION_CITIES.length &&
        value.every(city => CORPORATION_CITIES.includes(city)) && new Set(value).size === value.length;
    case 'counts':
      return Array.isArray(value) && value.length > 0 && value.length <= 12 &&
        value.every(count => Number.isInteger(count) && count >= rule.min && count <= rule.max) &&
        value.every((count, index) => index === 0 || count >= value[index - 1]);
    case 'thresholds':
      return Array.isArray(value) && value.length > 0 && value.length <= 12 &&
        value.every(item => Number.isFinite(item) && item > 0) &&
        value.every((item, index) => index === 0 || item > value[index - 1]);
    case 'tiers':
      return Array.isArray(value) && value.length > 0 && value.length <= 12 &&
        value.every(pair => Array.isArray(pair) && pair.length === 2 &&
          Number.isFinite(pair[0]) && pair[0] > 0 && Number.isFinite(pair[1]) && pair[1] >= 0 && pair[1] <= 1) &&
        value.every((pair, index) => index === 0 || pair[0] < value[index - 1][0]);
    case 'nullableNumber':
      return value === null || (Number.isFinite(value) && (!rule.integer || Number.isInteger(value)) &&
        (rule.min === undefined || value >= rule.min) && (rule.max === undefined || value <= rule.max));
    case 'number':
      return Number.isFinite(value) && (!rule.integer || Number.isInteger(value)) &&
        (rule.min === undefined || value >= rule.min) && (rule.max === undefined || value <= rule.max);
    default:
      return false;
  }
}

function warnUnknownKeys(source, schemaPrefix, warnings, report) {
  if (!isPlainObject(source)) return;
  for (const key of Object.keys(source)) {
    const path = schemaPrefix ? `${schemaPrefix}.${key}` : key;
    const known = Object.hasOwn(SCHEMA, path);
    const branch = Object.keys(SCHEMA).some(candidate => candidate.startsWith(`${path}.`));
    if (known || branch) {
      if (!known && isPlainObject(source[key])) warnUnknownKeys(source[key], path, warnings, report);
      continue;
    }
    warnings.push({ path, message: `Unknown configuration key "${path}" was ignored` });
    report?.push(`config.unknownKey:${path}`);
  }
}

/**
 * Validate a parsed configuration object against the schema.
 * @returns {{config: object, errors: Array<{path:string,message:string}>, warnings: Array<{path:string,message:string}>, report: string[]}}
 */
export function validateCorporationConfig(raw) {
  const config = defaultCorporationConfig();
  const errors = [], warnings = [], report = [];
  if (raw === undefined || raw === null) return { config, errors, warnings, report };
  if (!isPlainObject(raw)) {
    errors.push({ path: '', message: 'Configuration must be a JSON object; running with defaults' });
    report.push('config.invalidShape');
    return { config, errors, warnings, report };
  }
  if (Number.isInteger(raw.schemaVersion) && raw.schemaVersion > CORPORATION_CONFIG_VERSION) {
    errors.push({ path: 'schemaVersion', message: `schemaVersion ${raw.schemaVersion} is newer than ${CORPORATION_CONFIG_VERSION}; defaults are in use` });
    report.push('config.unsupportedVersion');
    return { config, errors, warnings, report };
  }
  warnUnknownKeys(raw, '', warnings, report);
  for (const [path, rule] of Object.entries(SCHEMA)) {
    const value = getPath(raw, path);
    if (value === undefined) continue;
    if (!validateValue(rule, value)) {
      errors.push({ path, message: `Invalid value for ${path} (${JSON.stringify(value)}); using the default` });
      report.push(`config.invalid:${path}`);
      continue;
    }
    setPath(config, path, clone(value));
  }
  // Cross-field rules from §8. Each failure keeps the whole default pair rather than half a rule.
  if (!(config.product.scienceFloor > config.product.scienceAbandonFloor && config.product.scienceAbandonFloor >= 1)) {
    errors.push({ path: 'product.scienceFloor', message: 'scienceFloor must be greater than scienceAbandonFloor >= 1; defaults restored' });
    report.push('config.invalid:product.scienceFloor');
    const fallback = defaultCorporationConfig().product;
    config.product.scienceFloor = fallback.scienceFloor;
    config.product.scienceAbandonFloor = fallback.scienceAbandonFloor;
  }
  if (config.finance.investmentMinOwnership > config.finance.minOwnership) {
    errors.push({ path: 'finance.investmentMinOwnership', message: 'investmentMinOwnership must not exceed minOwnership; defaults restored' });
    report.push('config.invalid:finance.investmentMinOwnership');
    config.finance.investmentMinOwnership = defaultCorporationConfig().finance.investmentMinOwnership;
  }
  if (config.budgets.reserveCap < config.budgets.reserveFloor) {
    errors.push({ path: 'budgets.reserveCap', message: 'reserveCap must be at least reserveFloor; defaults restored' });
    report.push('config.invalid:budgets.reserveCap');
    config.budgets.reserveCap = defaultCorporationConfig().budgets.reserveCap;
  }
  for (const [kind, key] of [['materials', 'materials'], ['products', 'products']]) {
    const targets = config.people.officeTargets[kind];
    const tiers = config.people.cashTiers[key];
    if (tiers.length !== targets.length - 1) {
      errors.push({ path: `people.cashTiers.${key}`, message: `cashTiers.${key} needs ${targets.length - 1} thresholds for ${targets.length} targets; defaults restored` });
      report.push(`config.invalid:people.cashTiers.${key}`);
      config.people.cashTiers[key] = [...defaultCorporationConfig().people.cashTiers[key]];
      config.people.officeTargets[kind] = [...defaultCorporationConfig().people.officeTargets[kind]];
    }
  }
  return { config, errors, warnings, report };
}

/** Coerce a CLI flag value (string from the game's args parser or an already-typed value). */
export function coerceFlagValue(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value !== 'string') return true;
  const text = value.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  const number = Number(text);
  return text !== '' && Number.isFinite(number) ? number : text;
}

/** Apply legacy CLI flags on top of a validated configuration. Flags win, per spec §8. */
export function applyCorporationFlags(config, flags = {}, { errors = [], report = [] } = {}) {
  if (!isPlainObject(flags)) return config;
  for (const [flag, path] of Object.entries(FLAG_MAP)) {
    if (!Object.hasOwn(flags, flag)) continue;
    const value = coerceFlagValue(flags[flag]);
    const rule = SCHEMA[path];
    if (!rule || !validateValue(rule, value)) {
      errors.push({ path, message: `Flag --${flag} has an invalid value (${JSON.stringify(flags[flag])}); ignored` });
      report.push(`config.invalidFlag:${flag}`);
      continue;
    }
    setPath(config, path, value);
  }
  if (config.finance.investmentMinOwnership > config.finance.minOwnership) {
    config.finance.investmentMinOwnership = defaultCorporationConfig().finance.investmentMinOwnership;
    errors.push({ path: 'finance.investmentMinOwnership', message: 'Flags left investmentMinOwnership above minOwnership; default restored' });
    report.push('config.invalid:finance.investmentMinOwnership');
  }
  return config;
}

/**
 * Read, parse and validate the configuration file, then layer CLI flags on top.
 * @param {{read?: (path: string) => string, flags?: object, path?: string}} options
 */
export function loadCorporationConfig({ read, flags = {}, path = CORPORATION_CONFIG_PATH } = {}) {
  const errors = [], warnings = [], report = [];
  let raw;
  if (typeof read === 'function') {
    let text = '';
    try { text = read(path) ?? ''; } catch { text = ''; }
    if (typeof text === 'string' && text.trim()) {
      try { raw = JSON.parse(text); }
      catch { errors.push({ path, message: `${path} is not valid JSON; defaults are in use` }); report.push('config.invalidJson'); }
    }
  }
  const validated = raw === undefined ? { config: defaultCorporationConfig(), errors: [], warnings: [], report: [] }
    : validateCorporationConfig(raw);
  errors.push(...validated.errors);
  warnings.push(...validated.warnings);
  report.push(...validated.report);
  const config = applyCorporationFlags(validated.config, flags, { errors, report });
  return { config, errors, warnings, report };
}

/** Budget ladder from spec §7.2; the optimiser never spends beyond these numbers. */
export function corporationBudgetLadder(info, config, { growthBank = 0, cycleSeconds = 10, recovering = false, developing = false } = {}) {
  const budgets = config.budgets;
  const funds = Math.max(0, Number(info?.funds) || 0);
  const revenue = Math.max(0, Number(info?.revenue) || 0);
  const expenses = Math.max(0, Number(info?.expenses) || 0);
  const cycle = Number.isFinite(cycleSeconds) && cycleSeconds > 0 ? cycleSeconds : 10;
  const reserve = Math.min(budgets.reserveCap,
    Math.max(budgets.reserveFloor, budgets.reserveCashFraction * funds, expenses * cycle * budgets.reserveExpenseCycles));
  const free = Math.max(0, funds - reserve);
  const profit = Math.max(0, revenue - expenses) * cycle;
  const upkeep = recovering ? 0 : Math.min(free, budgets.upkeepCashFraction * funds,
    developing ? Math.max(budgets.growthFraction * profit, 0.01 * free) : budgets.growthFraction * profit);
  const growthFraction = developing ? budgets.developmentGrowthFraction : budgets.growthFraction;
  const growth = recovering ? 0 : Math.min(free,
    Math.max(Math.max(0, Number(growthBank) || 0) + profit * growthFraction, developing ? 0.15 * free : 0));
  const allowance = revenue === 0 && expenses === 0 ? Math.min(10e6, 0.01 * funds) : Math.max(0, revenue - expenses) * cycle * 0.5;
  const boost = recovering ? 0 : Math.max(0, Math.min(budgets.boostCashFraction * funds, free, allowance));
  return { funds, revenue, expenses, profit, reserve, free, upkeep, growth, boost, recovering };
}
