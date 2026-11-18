/**
 * Corporation automation configuration (spec §8).
 *
 * Pure helpers only: defaults, merge, validation, CLI flag mapping. The single
 * `loadConfig(ns, ...)` wrapper reads `corporation-config.json` through the game
 * filesystem and never throws — every invalid field falls back to its default and
 * is reported once in `errors` / `warnings`.
 *
 * RAM: 0 GB. Nothing here references `ns.corporation`.
 */

export const CONFIG_PATH = 'corporation-config.json';
export const CONFIG_SCHEMA_VERSION = 1;

export const CITY_NAMES = ['Sector-12', 'Aevum', 'Volhaven', 'Chongqing', 'New Tokyo', 'Ishima'];
export const INDUSTRY_CHAIN = ['Agriculture', 'Chemical', 'Tobacco'];

/** Unlocks the bootstrap module buys, in order (spec §6.1). */
export const UNLOCK_ORDER = ['Warehouse API', 'Office API', 'Smart Supply'];

export const DEFAULT_CONFIG = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  enabled: true,
  dryRun: false,
  corporation: { name: 'Apex Holdings', selfFund: true, seedFirst: true },
  bootstrap: {
    industryChain: [...INDUSTRY_CHAIN],
    cities: [...CITY_NAMES],
    expandAllIndustries: false,
    allowDivisionSale: false,
    warehouseFullThreshold: 0.7,
    expediteStagedExpansion: true,
    // Added by the bootstrap implementation (§13 "modify only as needed"): the seed
    // office is grown to this size before any city expansion is funded.
    initialOfficeSize: 9,
    // Cash kept above an industry/city package so the purchase cannot strand upkeep.
    setupReserve: 20e6,
    // Share of free cash a single material seeding pass may commit to buy rates.
    materialCashFraction: 0.05,
  },
  product: {
    scienceFloor: 1.15,
    scienceAbandonFloor: 1.1,
    allowProductRetirement: false,
    developmentSpeed: true,
    maxProductsPerDivision: null,
  },
  people: {
    officeTargets: { materials: [3, 9, 15, 20, 30, 45, 60], products: [30, 60, 80, 100, 120] },
    teaThreshold: 2,
    upgradeFraction: 0.2,
    storageUpgradeFraction: 0.35,
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
    recoveryMarginCycles: 30,
  },
  research: { affordableFraction: 0.2, optionalAutomation: false },
  telemetry: { statusFile: 'tasks/corporation-status.json', cadenceMs: 60000, debug: false },
};

const FLAG_MAP = {
  '--development-speed': 'product.developmentSpeed',
  '--min-ownership': 'finance.minOwnership',
  '--investment-min-ownership': 'finance.investmentMinOwnership',
  '--expand-all-industries': 'bootstrap.expandAllIndustries',
  '--manage-shares': 'finance.manageShares',
  '--bribe-factions': 'finance.bribeFactions',
  '--dry-run': 'dryRun',
};

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function cloneConfig(value) {
  if (Array.isArray(value)) return value.map(cloneConfig);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneConfig(item)]));
  return value;
}

export function getConfigPath(config, path) {
  let node = config;
  for (const key of String(path).split('.')) {
    if (!isPlainObject(node) || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

function setConfigPath(config, path, value) {
  const keys = String(path).split('.');
  let node = config;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key];
  }
  node[keys[keys.length - 1]] = value;
}

/** Deep merge: arrays and scalars replace, objects merge. Never mutates `base`. */
export function mergeConfig(base, patch) {
  const out = cloneConfig(base);
  if (!isPlainObject(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeConfig(out[key], value);
    else out[key] = cloneConfig(value);
  }
  return out;
}

function coerceFlagValue(raw) {
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text !== '' && Number.isFinite(Number(text))) return Number(text);
  return text;
}

/**
 * Parse argv-style flags. Supports `--flag`, `--flag=value`, and `--flag value`
 * for the documented flags only; anything else is returned in `unknown`.
 */
export function parseFlags(argv = []) {
  const values = {}, unknown = [], errors = [];
  const args = Array.isArray(argv) ? argv.map(String) : [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (typeof token !== 'string' || !token.startsWith('--')) continue;
    const [flag, inline] = token.split('=');
    if (!(flag in FLAG_MAP)) {
      unknown.push(token);
      continue;
    }
    const next = args[index + 1];
    let raw = inline;
    if (raw === undefined && next !== undefined && !String(next).startsWith('--')) {
      raw = next;
      index++;
    }
    if (raw === undefined) {
      // Bare boolean flags default to true (existing autopilot invocations pass `--manage-shares` style values,
      // but `--dry-run` has no value).
      values[FLAG_MAP[flag]] = true;
      continue;
    }
    if (String(raw).startsWith('--')) {
      errors.push({ code: 'config.flagMissingValue', flag });
      values[FLAG_MAP[flag]] = true;
      index--;
      continue;
    }
    values[FLAG_MAP[flag]] = coerceFlagValue(raw);
  }
  return { values, unknown, errors };
}

const isBoolean = (value) => typeof value === 'boolean';
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNumberIn = (value, min, max) => isFiniteNumber(value) && value >= min && value <= max;
const isIntIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/** Leaf validation table. `check` returns true when the value is usable. */
const RULES = {
  enabled: { check: isBoolean },
  dryRun: { check: isBoolean },
  'corporation.name': { check: (v) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 40 && !/[\u0000-\u001f]/.test(v) },
  'corporation.selfFund': { check: isBoolean },
  'corporation.seedFirst': { check: isBoolean },
  'bootstrap.industryChain': {
    check: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 6 && v.every((n) => typeof n === 'string' && n.trim().length > 0) && new Set(v).size === v.length,
  },
  'bootstrap.cities': {
    check: (v) => Array.isArray(v) && v.length >= 1 && v.every((c) => CITY_NAMES.includes(c)) && new Set(v).size === v.length,
  },
  'bootstrap.expandAllIndustries': { check: isBoolean },
  'bootstrap.allowDivisionSale': { check: isBoolean },
  'bootstrap.warehouseFullThreshold': { check: (v) => isNumberIn(v, 0.1, 0.99) },
  'bootstrap.expediteStagedExpansion': { check: isBoolean },
  'bootstrap.initialOfficeSize': { check: (v) => isIntIn(v, 1, 120) },
  'bootstrap.setupReserve': { check: (v) => isNumberIn(v, 0, 1e12) },
  'bootstrap.materialCashFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'product.scienceFloor': { check: (v) => isNumberIn(v, 1, 10) },
  'product.scienceAbandonFloor': { check: (v) => isNumberIn(v, 1, 10) },
  'product.allowProductRetirement': { check: isBoolean },
  'product.developmentSpeed': { check: isBoolean },
  'product.maxProductsPerDivision': { check: (v) => v === null || isIntIn(v, 1, 12) },
  'people.officeTargets': {
    check: (v) =>
      isPlainObject(v) &&
      ['materials', 'products'].every(
        (key) => Array.isArray(v[key]) && v[key].length >= 1 && v[key].length <= 12 && v[key].every((n) => isIntIn(n, 1, 120)),
      ),
  },
  'people.teaThreshold': { check: (v) => isIntIn(v, 0, 100) },
  'people.upgradeFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'people.storageUpgradeFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'finance.minOwnership': { check: (v) => isNumberIn(v, 0.01, 1) },
  'finance.investmentMinOwnership': { check: (v) => isNumberIn(v, 0.01, 1) },
  'finance.acceptInvestment': { check: isBoolean },
  'finance.ipoValuationFloor': { check: (v) => isNumberIn(v, 1e9, 1e18) },
  'finance.ipoShares': { check: (v) => isIntIn(v, 0, 1e6) },
  'finance.payDividends': { check: isBoolean },
  'finance.dividendTiers': {
    check: (v) =>
      Array.isArray(v) &&
      v.length <= 8 &&
      v.every((tier) => Array.isArray(tier) && tier.length === 2 && isNumberIn(tier[0], 1, 1e30) && isNumberIn(tier[1], 0, 1)),
  },
  'finance.manageShares': { check: isBoolean },
  'finance.bribeFactions': { check: isBoolean },
  'market.advertSpendFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'market.boostWarehouseFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'market.exportQualityMargin': { check: (v) => isNumberIn(v, 0, 1) },
  'market.priceCeiling': { check: (v) => isNumberIn(v, 1, 1e12) },
  'market.throttleProductionOnBacklog': { check: isBoolean },
  'budgets.reserveFloor': { check: (v) => isNumberIn(v, 0, 1e15) },
  'budgets.reserveCap': { check: (v) => isNumberIn(v, 0, 1e18) },
  'budgets.reserveCashFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'budgets.reserveExpenseCycles': { check: (v) => isNumberIn(v, 0, 1000) },
  'budgets.growthFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'budgets.developmentGrowthFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'budgets.upkeepCashFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'budgets.boostCashFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'budgets.recoveryMarginCycles': { check: (v) => isNumberIn(v, 1, 10000) },
  'research.affordableFraction': { check: (v) => isNumberIn(v, 0, 1) },
  'research.optionalAutomation': { check: isBoolean },
  'telemetry.statusFile': { check: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200 },
  'telemetry.cadenceMs': { check: (v) => isNumberIn(v, 1000, 3600000) },
  'telemetry.debug': { check: isBoolean },
};

/** Drop unknown keys, reporting each once (spec §8: unknown keys are ignored with a warning). */
function knownFields(input, prefix, warnings) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (path === 'schemaVersion') continue;
    if (!(path in RULES)) {
      if (isPlainObject(value)) out[key] = knownFields(value, path, warnings);
      else warnings.push({ code: 'config.unknownKey', path });
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Tolerant JSON parse; `{}` plus an error entry when the text is unusable. */
export function parseConfigText(text) {
  if (text === null || text === undefined) return { value: {}, errors: [] };
  if (typeof text === 'object') return { value: text, errors: [] };
  const trimmed = String(text).trim();
  if (trimmed === '') return { value: {}, errors: [] };
  try {
    const value = JSON.parse(trimmed);
    if (!isPlainObject(value)) return { value: {}, errors: [{ code: 'config.invalid', detail: 'root value is not an object' }] };
    return { value, errors: [] };
  } catch (error) {
    return { value: {}, errors: [{ code: 'config.invalidJson', detail: String(error?.message || error).slice(0, 120) }] };
  }
}

/**
 * Validate a raw configuration object (already parsed) plus optional CLI flag values.
 * Returns `{config, errors, warnings}` and never throws.
 */
export function validateConfig(raw, { flags = {}, flagErrors = [] } = {}) {
  const errors = [...flagErrors], warnings = [];
  let input = raw;
  if (typeof input === 'string') {
    const parsed = parseConfigText(input);
    input = parsed.value;
    errors.push(...parsed.errors);
  }
  if (!isPlainObject(input)) {
    errors.push({ code: 'config.invalid', detail: 'configuration root is not an object' });
    input = {};
  }
  if ('schemaVersion' in input && input.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    errors.push({ code: 'config.unsupportedVersion', detail: `expected ${CONFIG_SCHEMA_VERSION}, got ${String(input.schemaVersion)}` });
    input = {};
  }
  const merged = mergeConfig(DEFAULT_CONFIG, knownFields(input, '', warnings));
  // Flag values are validated exactly like file values; an invalid flag keeps the current value.
  const flagValues = isPlainObject(flags) ? flags : {};
  for (const [path, value] of Object.entries(flagValues)) {
    if (!(path in RULES)) {
      errors.push({ code: 'config.unknownFlag', path });
      continue;
    }
    if (RULES[path].check(value)) setConfigPath(merged, path, value);
    else errors.push({ code: 'config.invalidField', path, detail: `flag value ${JSON.stringify(value)} rejected` });
  }
  for (const [path, rule] of Object.entries(RULES)) {
    const value = getConfigPath(merged, path);
    if (value === undefined) {
      errors.push({ code: 'config.missingField', path });
      setConfigPath(merged, path, cloneConfig(getConfigPath(DEFAULT_CONFIG, path)));
      continue;
    }
    if (!rule.check(value)) {
      errors.push({ code: 'config.invalidField', path, detail: JSON.stringify(value)?.slice(0, 80) });
      setConfigPath(merged, path, cloneConfig(getConfigPath(DEFAULT_CONFIG, path)));
    }
  }
  // Cross-field rules (spec §8).
  if (merged.finance.investmentMinOwnership > merged.finance.minOwnership) {
    errors.push({ code: 'config.invalidField', path: 'finance.investmentMinOwnership', detail: 'exceeds minOwnership' });
    merged.finance.investmentMinOwnership = DEFAULT_CONFIG.finance.investmentMinOwnership;
  }
  if (!(merged.product.scienceFloor > merged.product.scienceAbandonFloor && merged.product.scienceAbandonFloor >= 1)) {
    errors.push({ code: 'config.invalidField', path: 'product.scienceFloor', detail: 'must exceed scienceAbandonFloor ≥ 1' });
    merged.product.scienceFloor = DEFAULT_CONFIG.product.scienceFloor;
    merged.product.scienceAbandonFloor = DEFAULT_CONFIG.product.scienceAbandonFloor;
  }
  if (merged.budgets.reserveCap < merged.budgets.reserveFloor) {
    errors.push({ code: 'config.invalidField', path: 'budgets.reserveCap', detail: 'below reserveFloor' });
    merged.budgets.reserveCap = DEFAULT_CONFIG.budgets.reserveCap;
  }
  merged.schemaVersion = CONFIG_SCHEMA_VERSION;
  return { config: merged, errors, warnings };
}

/**
 * Read `corporation-config.json` from the game filesystem and validate it.
 * CLI flags override the file. A missing file is not an error: defaults apply.
 */
export function loadConfig(ns, { path = CONFIG_PATH, argv = null, flags = null } = {}) {
  const parsed = parseFlags(argv ?? (Array.isArray(ns?.args) ? ns.args : []));
  let text = '';
  let readError = null;
  try {
    text = typeof ns?.read === 'function' ? ns.read(path) : '';
  } catch (error) {
    readError = String(error?.message || error).slice(0, 120);
  }
  const result = validateConfig(text, { flags: flags ?? parsed.values, flagErrors: parsed.errors });
  for (const token of parsed.unknown) result.warnings.push({ code: 'config.unknownFlag', flag: token });
  if (readError) result.warnings.push({ code: 'config.unreadable', path, detail: readError });
  result.path = path;
  result.rawText = text;
  return result;
}
