/**
 * Corporation automation configuration: schema, defaults, validation, flag merging.
 *
 * Spec: docs/corp-automation-spec.md §8. One schema, one set of defaults, and the two
 * call shapes the modules grew against:
 *
 *   - `loadConfig(ns, ...)` / `validateConfig(...)` / `parseFlags(...)` — the bootstrap,
 *     expansion and daemon entrypoints (paths as flag keys, `{code, path, detail}` issues).
 *   - `loadCorporationConfig(...)` / `validateCorporationConfig(...)` / `applyCorporationFlags(...)`
 *     — the optimiser, market, people and product modules (flag names, `{path, message}`
 *     issues plus a `report` list of codes).
 *
 * Both shapes are thin adapters over one core (`validateCore`), so a value can never be
 * accepted by one reader and rejected by the other. Nothing in this module throws: a broken
 * configuration must never stop the daemon, it must downgrade to safe defaults and say so.
 *
 * RAM: 0 GB. Nothing here references `ns.corporation`.
 */

export const CONFIG_PATH = 'corporation-config.json';
export const CORPORATION_CONFIG_PATH = CONFIG_PATH;
export const CONFIG_SCHEMA_VERSION = 1;
export const CORPORATION_CONFIG_VERSION = CONFIG_SCHEMA_VERSION;

export const CITY_NAMES = Object.freeze(['Sector-12', 'Aevum', 'Volhaven', 'Chongqing', 'New Tokyo', 'Ishima']);
export const CORPORATION_CITIES = CITY_NAMES;
export const INDUSTRY_CHAIN = Object.freeze(['Agriculture', 'Chemical', 'Tobacco']);

/** Unlocks the bootstrap module buys, in order (spec §6.1). */
export const UNLOCK_ORDER = Object.freeze(['Warehouse API', 'Office API', 'Smart Supply']);

/** Cash thresholds that select an office-size target; one fewer entry than the target array. */
export const DEFAULT_MATERIAL_CASH_TIERS = Object.freeze([1e9, 1e10, 1e11, 1e12, 5e12, 1e13]);
export const DEFAULT_PRODUCT_CASH_TIERS = Object.freeze([1e12, 1e13, 1e14, 1e15]);

/**
 * Defaults, merged from the bootstrap and optimiser modules. Every leaf is validated below;
 * `DEFAULT_CONFIG` itself is never handed to a caller uncloned (`defaultCorporationConfig()`).
 */
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
    // The seed office is grown to this size before any city expansion is funded (spec §14.7).
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
    minimumInvestment: 10e6,
    investmentCashFraction: 0.02,
  },
  people: {
    officeTargets: {
      materials: [3, 9, 15, 20, 30, 45, 60],
      products: [30, 60, 80, 100, 120],
    },
    cashTiers: {
      materials: [...DEFAULT_MATERIAL_CASH_TIERS],
      products: [...DEFAULT_PRODUCT_CASH_TIERS],
    },
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

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function cloneConfig(value) {
  if (Array.isArray(value)) return value.map(cloneConfig);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneConfig(item)]));
  return value;
}

/** Fresh copy of the documented defaults. Every caller owns its own object. */
export function defaultCorporationConfig() {
  return cloneConfig(DEFAULT_CONFIG);
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

const isBoolean = (value) => typeof value === 'boolean';
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function inRange(value, rule) {
  if (!isFiniteNumber(value)) return false;
  if (rule.integer === true && !Number.isInteger(value)) return false;
  if (rule.min !== undefined && value < rule.min) return false;
  if (rule.max !== undefined && value > rule.max) return false;
  return true;
}

function isMonotonic(array, compare = (a, b) => a > b) {
  for (let index = 1; index < array.length; index++) {
    if (!compare(array[index], array[index - 1])) return false;
  }
  return true;
}

/** One rule per leaf. `kind` selects the shape check; bounds are inclusive. */
const SCHEMA = {
  schemaVersion: { kind: 'number', min: 1, max: CONFIG_SCHEMA_VERSION, integer: true },
  enabled: { kind: 'boolean' },
  dryRun: { kind: 'boolean' },
  'corporation.name': { kind: 'name' },
  'corporation.selfFund': { kind: 'boolean' },
  'corporation.seedFirst': { kind: 'boolean' },
  'bootstrap.industryChain': { kind: 'industryChain' },
  'bootstrap.cities': { kind: 'cities' },
  'bootstrap.expandAllIndustries': { kind: 'boolean' },
  'bootstrap.allowDivisionSale': { kind: 'boolean' },
  'bootstrap.warehouseFullThreshold': { kind: 'number', min: 0, max: 1 },
  'bootstrap.expediteStagedExpansion': { kind: 'boolean' },
  'bootstrap.initialOfficeSize': { kind: 'number', min: 1, max: 120, integer: true },
  'bootstrap.setupReserve': { kind: 'number', min: 0, max: 1e12 },
  'bootstrap.materialCashFraction': { kind: 'number', min: 0, max: 1 },
  'product.scienceFloor': { kind: 'number', min: 1, max: 10 },
  'product.scienceAbandonFloor': { kind: 'number', min: 1, max: 10 },
  'product.allowProductRetirement': { kind: 'boolean' },
  'product.developmentSpeed': { kind: 'boolean' },
  'product.maxProductsPerDivision': { kind: 'nullableNumber', min: 1, max: 12, integer: true },
  'product.minimumInvestment': { kind: 'number', min: 1e6, max: 1e15 },
  'product.investmentCashFraction': { kind: 'number', min: 0, max: 1 },
  'people.officeTargets.materials': { kind: 'counts', min: 1, max: 120 },
  'people.officeTargets.products': { kind: 'counts', min: 1, max: 120 },
  'people.cashTiers.materials': { kind: 'thresholds' },
  'people.cashTiers.products': { kind: 'thresholds' },
  'people.teaThreshold': { kind: 'number', min: 0, max: 100, integer: true },
  'people.upgradeFraction': { kind: 'number', min: 0, max: 1 },
  'people.upgradePaybackCycles': { kind: 'number', min: 0, max: 100000 },
  'people.storageUpgradeFraction': { kind: 'number', min: 0, max: 1 },
  'people.starvationTicks': { kind: 'number', min: 1, max: 100, integer: true },
  'finance.minOwnership': { kind: 'number', min: 0.01, max: 1 },
  'finance.investmentMinOwnership': { kind: 'number', min: 0.01, max: 1 },
  'finance.acceptInvestment': { kind: 'boolean' },
  'finance.ipoValuationFloor': { kind: 'number', min: 1e9, max: 1e18 },
  'finance.ipoShares': { kind: 'number', min: 0, max: 1e6, integer: true },
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
  'market.priceCeiling': { kind: 'number', min: 1, max: 1e12 },
  'market.throttleProductionOnBacklog': { kind: 'boolean' },
  'budgets.reserveFloor': { kind: 'number', min: 0, max: 1e15 },
  'budgets.reserveCap': { kind: 'number', min: 0, max: 1e18 },
  'budgets.reserveCashFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.reserveExpenseCycles': { kind: 'number', min: 0, max: 1000 },
  'budgets.growthFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.developmentGrowthFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.upkeepCashFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.boostCashFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.inputCashFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.officeCashFraction': { kind: 'number', min: 0, max: 1 },
  'budgets.recoveryMarginCycles': { kind: 'number', min: 1, max: 10000 },
  'research.affordableFraction': { kind: 'number', min: 0, max: 1 },
  'research.optionalAutomation': { kind: 'boolean' },
  'research.developmentReserveCycles': { kind: 'number', min: 1, max: 100, integer: true },
  'telemetry.statusFile': { kind: 'file' },
  'telemetry.stateFile': { kind: 'file' },
  'telemetry.cadenceMs': { kind: 'number', min: 1000, max: 3600000, integer: true },
  'telemetry.debug': { kind: 'boolean' },
};

/** Branch paths (`a.b`) the schema knows, used for unknown-key traversal. */
const BRANCHES = new Set();
for (const path of Object.keys(SCHEMA)) {
  const keys = path.split('.');
  for (let index = 1; index < keys.length; index++) BRANCHES.add(keys.slice(0, index).join('.'));
}

function checkValue(rule, value) {
  switch (rule.kind) {
    case 'boolean':
      return isBoolean(value);
    case 'name':
      return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 40 && !/[\u0000-\u001f]/.test(value);
    case 'file':
      return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
    case 'industryChain':
      return (
        Array.isArray(value) &&
        value.length >= 1 &&
        value.length <= 6 &&
        value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 64) &&
        new Set(value).size === value.length
      );
    case 'cities':
      return (
        Array.isArray(value) &&
        value.length >= 1 &&
        value.length <= CITY_NAMES.length &&
        value.every((city) => CITY_NAMES.includes(city)) &&
        new Set(value).size === value.length
      );
    case 'counts':
      return (
        Array.isArray(value) &&
        value.length >= 1 &&
        value.length <= 12 &&
        value.every((count) => Number.isInteger(count) && count >= rule.min && count <= rule.max) &&
        isMonotonic(value, (a, b) => a >= b)
      );
    case 'thresholds':
      return (
        Array.isArray(value) &&
        value.length >= 1 &&
        value.length <= 12 &&
        value.every((item) => isFiniteNumber(item) && item > 0) &&
        isMonotonic(value, (a, b) => a > b)
      );
    case 'tiers':
      return (
        Array.isArray(value) &&
        value.length <= 12 &&
        value.every(
          (tier) =>
            Array.isArray(tier) && tier.length === 2 && isFiniteNumber(tier[0]) && tier[0] > 0 && isFiniteNumber(tier[1]) && tier[1] >= 0 && tier[1] <= 1,
        ) &&
        value.every((tier, index) => index === 0 || tier[0] < value[index - 1][0])
      );
    case 'nullableNumber':
      return value === null || inRange(value, rule);
    case 'number':
      return inRange(value, rule);
    default:
      return false;
  }
}

/** Unknown keys are reported once per leaf path, as spec §8 requires. */
function unknownKeys(raw, prefix, issues) {
  if (!isPlainObject(raw)) return;
  for (const [key, value] of Object.entries(raw)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (path === 'schemaVersion' || path in SCHEMA) continue;
    if (BRANCHES.has(path) && isPlainObject(value)) unknownKeys(value, path, issues);
    else issues.push({ code: 'config.unknownKey', path, message: `Unknown configuration key "${path}" was ignored` });
  }
}

/** Tolerant JSON parse; `{}` plus an error entry when the text is unusable. */
export function parseConfigText(text) {
  if (text === null || text === undefined) return { value: {}, errors: [] };
  if (typeof text === 'object') return { value: text, errors: [] };
  const trimmed = String(text).trim();
  if (trimmed === '') return { value: {}, errors: [] };
  let value;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    return { value: {}, errors: [{ code: 'config.invalidJson', detail: String(error?.message || error).slice(0, 120) }] };
  }
  if (!isPlainObject(value)) return { value: {}, errors: [{ code: 'config.invalid', detail: 'root value is not an object' }] };
  return { value, errors: [] };
}

/**
 * The one validator. Returns `{config, issues}` where every issue is
 * `{code, path, detail, value}`; the adapters below reshape it for their callers.
 */
function validateCore(raw) {
  const issues = [];
  let input = raw;
  if (typeof input === 'string') {
    const parsed = parseConfigText(input);
    input = parsed.value;
    issues.push(...parsed.errors.map((error) => ({ code: error.code, path: '', detail: error.detail })));
  }
  if (!isPlainObject(input)) {
    if (input !== undefined && input !== null) issues.push({ code: 'config.invalid', path: '', detail: 'configuration root is not an object' });
    input = {};
  }
  if ('schemaVersion' in input && input.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    issues.push({ code: 'config.unsupportedVersion', path: 'schemaVersion', detail: `expected ${CONFIG_SCHEMA_VERSION}, got ${String(input.schemaVersion)}` });
    input = {};
  }
  const config = defaultCorporationConfig();
  for (const [path, rule] of Object.entries(SCHEMA)) {
    if (path === 'schemaVersion') continue;
    const value = getConfigPath(input, path);
    if (value === undefined) continue;
    if (!checkValue(rule, value)) {
      issues.push({ code: 'config.invalidField', path, detail: JSON.stringify(value)?.slice(0, 80), value });
      continue;
    }
    setConfigPath(config, path, cloneConfig(value));
  }
  unknownKeys(input, '', issues);
  return { config, issues };
}

/** Cross-field rules (spec §8). Each failure restores the whole sensible pair. */
function repairCrossFields(config, issues) {
  if (config.finance.investmentMinOwnership > config.finance.minOwnership) {
    issues.push({ code: 'config.invalidField', path: 'finance.investmentMinOwnership', detail: 'exceeds minOwnership' });
    config.finance.investmentMinOwnership = DEFAULT_CONFIG.finance.investmentMinOwnership;
  }
  if (!(config.product.scienceFloor > config.product.scienceAbandonFloor && config.product.scienceAbandonFloor >= 1)) {
    issues.push({ code: 'config.invalidField', path: 'product.scienceFloor', detail: 'must exceed scienceAbandonFloor >= 1' });
    config.product.scienceFloor = DEFAULT_CONFIG.product.scienceFloor;
    config.product.scienceAbandonFloor = DEFAULT_CONFIG.product.scienceAbandonFloor;
  }
  if (config.budgets.reserveCap < config.budgets.reserveFloor) {
    issues.push({ code: 'config.invalidField', path: 'budgets.reserveCap', detail: 'below reserveFloor' });
    config.budgets.reserveCap = DEFAULT_CONFIG.budgets.reserveCap;
  }
  for (const kind of ['materials', 'products']) {
    const targets = config.people.officeTargets[kind];
    const tiers = config.people.cashTiers[kind];
    if (tiers.length !== targets.length - 1) {
      issues.push({
        code: 'config.invalidField',
        path: `people.cashTiers.${kind}`,
        detail: `needs ${targets.length - 1} thresholds for ${targets.length} targets`,
      });
      config.people.cashTiers[kind] = [...DEFAULT_CONFIG.people.cashTiers[kind]];
      config.people.officeTargets[kind] = [...DEFAULT_CONFIG.people.officeTargets[kind]];
    }
  }
  return config;
}

/** Legacy CLI flags -> config path (spec §8). The bare names are what the optimiser uses. */
export const FLAG_DEFINITIONS = Object.freeze([
  { flag: 'development-speed', path: 'product.developmentSpeed' },
  { flag: 'min-ownership', path: 'finance.minOwnership' },
  { flag: 'investment-min-ownership', path: 'finance.investmentMinOwnership' },
  { flag: 'expand-all-industries', path: 'bootstrap.expandAllIndustries' },
  { flag: 'manage-shares', path: 'finance.manageShares' },
  { flag: 'bribe-factions', path: 'finance.bribeFactions' },
  { flag: 'dry-run', path: 'dryRun' },
]);

/** `--flag` -> path (argv parsing). */
export const FLAG_MAP = Object.freeze(Object.fromEntries(FLAG_DEFINITIONS.map((entry) => [`--${entry.flag}`, entry.path])));
/** `flag` -> path (flag objects handed in by a caller). */
export const CORPORATION_FLAG_MAP = Object.freeze(Object.fromEntries(FLAG_DEFINITIONS.map((entry) => [entry.flag, entry.path])));

export function coerceFlagValue(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value !== 'string') return true;
  const text = value.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text !== '' && Number.isFinite(Number(text))) return Number(text);
  return text;
}

/**
 * Parse argv-style flags. Supports `--flag`, `--flag=value`, and `--flag value` for the
 * documented flags only; anything else is returned in `unknown`.
 */
export function parseFlags(argv = []) {
  const values = {};
  const unknown = [];
  const errors = [];
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

/** Apply path-keyed flag values onto an already validated configuration. */
function applyPathFlags(config, flags, issues) {
  if (!isPlainObject(flags)) return config;
  for (const [path, value] of Object.entries(flags)) {
    if (!(path in SCHEMA)) {
      issues.push({ code: 'config.unknownFlag', path });
      continue;
    }
    if (checkValue(SCHEMA[path], value)) setConfigPath(config, path, cloneConfig(value));
    else issues.push({ code: 'config.invalidField', path, detail: `flag value ${JSON.stringify(value)} rejected`, value });
  }
  return config;
}

/**
 * Validate a raw configuration object (already parsed) plus optional CLI flag values.
 * Returns `{config, errors, warnings}` with `{code, path, detail}` issues; never throws.
 */
export function validateConfig(raw, { flags = {}, flagErrors = [] } = {}) {
  const { config, issues } = validateCore(raw);
  issues.unshift(...(Array.isArray(flagErrors) ? flagErrors : []));
  applyPathFlags(config, flags, issues);
  repairCrossFields(config, issues);
  config.schemaVersion = CONFIG_SCHEMA_VERSION;
  return {
    config,
    errors: issues
      .filter((issue) => issue.code !== 'config.unknownKey')
      .map(({ code, path, detail, flag }) => ({ code, ...(path ? { path } : {}), ...(detail ? { detail } : {}), ...(flag ? { flag } : {}) })),
    warnings: issues
      .filter((issue) => issue.code === 'config.unknownKey')
      .map(({ code, path, message }) => ({ code, ...(path ? { path } : {}), ...(message ? { message } : {}) })),
  };
}

function messageFor(issue) {
  switch (issue.code) {
    case 'config.invalidJson':
      return `Configuration is not valid JSON (${issue.detail || 'parse error'}); defaults are in use`;
    case 'config.invalid':
      return 'Configuration must be a JSON object; running with defaults';
    case 'config.unsupportedVersion':
      return `schemaVersion is not ${CONFIG_SCHEMA_VERSION} (${issue.detail}); defaults are in use`;
    case 'config.flagMissingValue':
      return `Flag ${issue.flag} is missing its value`;
    case 'config.unknownFlag':
      return `Unknown flag for ${issue.path}`;
    default:
      return `Invalid value for ${issue.path} (${issue.detail}); using the default`;
  }
}

/** Optimiser-shaped validator: `{config, errors:[{path,message}], warnings:[{path,message}], report:[codes]}`. */
export function validateCorporationConfig(raw) {
  if (raw === undefined || raw === null) return { config: defaultCorporationConfig(), errors: [], warnings: [], report: [] };
  const { config, issues } = validateCore(raw);
  repairCrossFields(config, issues);
  config.schemaVersion = CONFIG_SCHEMA_VERSION;
  const errors = [];
  const warnings = [];
  const report = [];
  for (const issue of issues) {
    if (issue.code === 'config.unknownKey') {
      warnings.push({ path: issue.path, message: issue.message });
      report.push(`config.unknownKey:${issue.path}`);
      continue;
    }
    errors.push({ path: issue.path || '', message: messageFor(issue) });
    report.push(issue.code === 'config.invalidField' ? `config.invalid:${issue.path}` : issue.code);
  }
  return { config, errors, warnings, report };
}

/** Apply bare-name flags (optimiser shape) on top of a validated configuration. Flags win. */
export function applyCorporationFlags(config, flags = {}, { errors = [], report = [] } = {}) {
  if (!isPlainObject(config) || !isPlainObject(flags)) return config;
  const issues = [];
  for (const [rawFlag, rawValue] of Object.entries(flags)) {
    const name = String(rawFlag).replace(/^--/, '');
    const path = CORPORATION_FLAG_MAP[name];
    if (!path) continue; // unknown flags are not this module's business
    const value = coerceFlagValue(rawValue);
    if (!checkValue(SCHEMA[path], value)) {
      issues.push({ code: 'config.invalidField', path, detail: `flag --${name} value ${JSON.stringify(rawValue)} rejected` });
      continue;
    }
    setConfigPath(config, path, value);
  }
  repairCrossFields(config, issues);
  for (const issue of issues) {
    errors.push({ path: issue.path, message: messageFor(issue) });
    report.push(issue.code === 'config.invalidField' ? `config.invalid:${issue.path}` : issue.code);
  }
  return config;
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

/**
 * Read, parse and validate the configuration file, then layer CLI flags on top.
 * @param {{read?: (path: string) => string, flags?: object, path?: string}} options
 */
export function loadCorporationConfig({ read, flags = {}, path = CORPORATION_CONFIG_PATH } = {}) {
  const errors = [];
  const warnings = [];
  const report = [];
  let raw;
  if (typeof read === 'function') {
    let text = '';
    try {
      text = read(path) ?? '';
    } catch {
      text = '';
    }
    if (typeof text === 'string' && text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        const issue = { code: 'config.invalidJson', path, detail: 'not valid JSON' };
        errors.push({ path: issue.path, message: messageFor(issue) });
        report.push(issue.code);
      }
    }
  }
  const validated = validateCorporationConfig(raw);
  errors.push(...validated.errors);
  warnings.push(...validated.warnings);
  report.push(...validated.report);
  const config = applyCorporationFlags(validated.config, flags, { errors, report });
  return { config, errors, warnings, report };
}

/**
 * Budget ladder from spec §7.2; every module spends within these numbers.
 *
 * `reserveFloor` lets the daemon hold back cash that a structural purchase already has a
 * claim on (city/industry packages), so discretionary growth cannot eat it. It wins over
 * `budgets.reserveCap` on purpose: a floor the cap can undercut is not a floor.
 */
export function corporationBudgetLadder(
  info,
  config,
  { growthBank = 0, cycleSeconds = 10, recovering = false, developing = false, reserveFloor = 0 } = {},
) {
  const budgets = config?.budgets || DEFAULT_CONFIG.budgets;
  const funds = Math.max(0, Number(info?.funds) || 0);
  const revenue = Math.max(0, Number(info?.revenue) || 0);
  const expenses = Math.max(0, Number(info?.expenses) || 0);
  const cycle = Number.isFinite(cycleSeconds) && cycleSeconds > 0 ? cycleSeconds : 10;
  const computed = Math.min(
    budgets.reserveCap,
    Math.max(budgets.reserveFloor, budgets.reserveCashFraction * funds, expenses * cycle * budgets.reserveExpenseCycles),
  );
  const claimed = Number.isFinite(Number(reserveFloor)) ? Math.max(0, Number(reserveFloor)) : 0;
  // The reserve itself is not clamped to `funds`: a floor above the treasury means "spend
  // nothing", which `free` already expresses as 0.
  const reserve = Math.max(computed, claimed);
  const free = Math.max(0, funds - reserve);
  const profit = Math.max(0, revenue - expenses) * cycle;
  const upkeep = recovering
    ? 0
    : Math.min(
        free,
        budgets.upkeepCashFraction * funds,
        developing ? Math.max(budgets.growthFraction * profit, 0.01 * free) : budgets.growthFraction * profit,
      );
  const growthFraction = developing ? budgets.developmentGrowthFraction : budgets.growthFraction;
  const growth = recovering
    ? 0
    : Math.min(free, Math.max(Math.max(0, Number(growthBank) || 0) + profit * growthFraction, developing ? 0.15 * free : 0));
  const allowance = revenue === 0 && expenses === 0 ? Math.min(10e6, 0.01 * funds) : Math.max(0, revenue - expenses) * cycle * 0.5;
  const boost = recovering ? 0 : Math.max(0, Math.min(budgets.boostCashFraction * funds, free, allowance));
  return { funds, revenue, expenses, profit, reserve, free, upkeep, growth, boost, recovering };
}
