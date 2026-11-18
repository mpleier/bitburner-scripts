/**
 * Corporation automation entrypoint: bootstrap, expansion and optimisation in one loop.
 *
 *   run corporation-daemon.js                       # full automation
 *   run corporation-daemon.js --dry-run             # plan only, zero mutations
 *   run corporation-daemon.js --ticks=5 --interval=5000
 *
 * One tick = one corporation cycle, in the spec §4.3 order: guard → structural
 * (bootstrap + expansion: creation, unlocks, industries, cities, warehouses) → people,
 * research, products, market, upgrades (`corporation-optimizer.js`) → persist → `nextUpdate()`.
 *
 * Why one script: the corporation API costs ~860 GB per script that references it, so a
 * second process would double the reservation. The optimiser is a library on purpose; this
 * file is the only new running script, and it references four `ns.corporation` members
 * directly (`hasCorporation` is inherited through the bootstrap snapshot, `getConstants` and
 * `nextUpdate` are 0 GB), passing `ns.corporation` into the modules as an injected `api`.
 *
 * Guards so the modules cannot fight each other (docs/corp-automation-spec.md §4.4):
 *
 *   1. One writer per corporation. Another automation entrypoint on home
 *      (`autopilot.js`, `corporation-manager.js`, `corporation-bootstrap-daemon.js`) makes
 *      this daemon report-only: it publishes state, performs no mutation and never touches
 *      shares or dividends, because the legacy controller owns them.
 *   2. Structural before discretionary. The next unaffordable city/industry package keeps a
 *      claim on free cash (`budgets.structuralClaimFraction`), passed to the optimiser as a
 *      reserve floor, so product investment cannot starve expansion.
 *   3. One purchase per cycle. Warehouses the structural phase bought or upgraded are
 *      skipped by the optimiser tick (`skipWarehouse`), because both modules upgrade
 *      warehouses and the game would happily sell two levels in one cycle.
 *   4. No finance mutations. `issueDividends`, `goPublic`, `acceptInvestmentOffer`,
 *      `issueNewShares`, `sellShares` and `buyBackShares` are not called here at all; the
 *      status document says who owns them.
 *   5. Bounded retries. Every phase is wrapped: a throwing module becomes a failed cycle with
 *      a persisted counter, never an unhandled exception, and five consecutive crashes back
 *      the loop off to one cycle per ten minutes.
 */

import { loadConfig, CONFIG_PATH } from './corporation-config.js';
import {
  homeRamVerdict,
  isDuplicateInstance,
  parseDaemonArgs,
  readResetContext,
  runBootstrapExpansionCycle,
  summarizeFailures,
} from './corporation-bootstrap-daemon.js';
import { readBootstrapSnapshot } from './corporation-bootstrap.js';
import { clearCorporationBuyRates } from './corporation-policy.js';
import { createCorporationOptimizer, clearOptimizerBuyRates } from './corporation-optimizer.js';

export const DAEMON_STATUS_FILE = 'tasks/corporation-daemon-status.json';
export const DAEMON_STATE_FILE = 'tasks/corporation-daemon-state.json';
export const DAEMON_DRY_RUN_FILE = 'tasks/corporation-dry-run.json';
export const DAEMON_SCHEMA_VERSION = 1;
export const DAEMON_STATUS_SCHEMA_VERSION = 2;
export const MAX_STATUS_ACTIONS = 40;
export const MAX_LOG_LINES = 60;
export const MAX_FAILURES = 16;
export const MAX_DECISIONS = 128;
export const MAX_FINDINGS = 32;
export const CRASH_BACKOFF_CYCLES = 5;
export const CRASH_BACKOFF_MS = 600000;
/** A persistent failure count at or above this pauses the loop instead of retrying every tick. */
export const PERSISTENT_FAILURE_BACKOFF = 5;

/** Scripts that also write corporation state. While one runs, this daemon only reports. */
export const PEER_WRITER_SCRIPTS = Object.freeze(['autopilot.js', 'corporation-manager.js', 'corporation-bootstrap-daemon.js']);

/** Finance calls this daemon never makes; listed so the guard is testable, not just documented. */
export const FINANCE_ACTIONS = Object.freeze([
  'acceptInvestmentOffer',
  'goPublic',
  'issueDividends',
  'issueNewShares',
  'sellShares',
  'buyBackShares',
]);

const finite = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const text = (error) => String(error?.message || error).slice(0, 240);

/** Flags this entrypoint consumes itself; the config loader must not report them as unknown. */
export const DAEMON_ONLY_FLAGS = Object.freeze(['--ticks', '--cycles', '--interval', '--quiet']);

/**
 * Drop the entrypoint's own flags (and their separate values) before handing argv to the config
 * loader, so a normal `--ticks=5` run does not publish `config.unknownFlag` in the status document.
 */
export function configArgv(argv = []) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
  const kept = [];
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index].split('=');
    if (!DAEMON_ONLY_FLAGS.includes(flag)) {
      kept.push(args[index]);
      continue;
    }
    // A separate value is the next token unless it is itself a flag.
    if (inline === undefined && args[index + 1] !== undefined && !String(args[index + 1]).startsWith('--')) index++;
  }
  return kept;
}

/** Owned share of the corporation, or `null` when the snapshot does not expose a share count. */
function ownershipFraction(info) {
  const total = finite(info?.totalShares, 0);
  const owned = finite(info?.numShares, 0);
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(1, owned / total));
}

function safeCall(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * Compare two `ns.ps('home')` filenames by basename. `ps` mixes both forms — a script in
 * home's root is bare (`autopilot.js`), anything under a subdirectory keeps its path
 * (`/Remote/grow-target.js`) — so comparing the raw strings silently reports "no peer" (B11).
 */
function normalizeScriptName(name) {
  const text = String(name || '').trim();
  if (!text) return '';
  const parts = text.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function writeFile(ns, path, value) {
  const payload = JSON.stringify(value);
  const result = safeCall(() => ns.write(path, payload, 'w'), null);
  return result !== null && result !== undefined;
}

function readJsonFile(ns, path) {
  const raw = safeCall(() => (typeof ns?.read === 'function' ? ns.read(path) : ''), '');
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Other corporation writers on home. A duplicate copy of *this* script is handled separately
 * (it exits); a peer writer means another loop is already spending this corporation's cash.
 */
export function detectPeerWriters(ns, { script = null, scripts = PEER_WRITER_SCRIPTS } = {}) {
  if (typeof ns?.ps !== 'function') return [];
  const own = normalizeScriptName(script || safeCall(() => ns.getScriptName(), null));
  const processes = safeCall(() => ns.ps('home'), null);
  if (!Array.isArray(processes)) return [];
  const peers = [];
  for (const process of processes) {
    const name = normalizeScriptName(process?.filename);
    if (!name || !scripts.includes(name) || name === own) continue;
    peers.push({ script: name, pid: finite(process?.pid, 0) });
  }
  return peers;
}

/**
 * Who owns investment, dividends and share actions this cycle. This daemon does not implement
 * finance, so the honest answer is either "the legacy controller" or "nobody yet" — and the
 * status document reports which, together with the config keys that ask for it.
 */
export function financeOwnership(config, { peers = [] } = {}) {
  const wants = [];
  if (config?.finance?.payDividends !== false) wants.push('dividends');
  if (config?.finance?.manageShares !== false) wants.push('shares');
  if (config?.finance?.acceptInvestment !== false) wants.push('investment');
  const peer = (Array.isArray(peers) ? peers : []).find((entry) =>
    ['corporation-manager.js', 'autopilot.js'].includes(entry?.script));
  return {
    owner: peer ? peer.script : 'unowned',
    delegated: peer ? true : false,
    wanted: wants,
    actions: [...FINANCE_ACTIONS],
    reason: peer
      ? `${peer.script} is running and owns investment, dividends and share actions`
      : 'no finance module is wired into this daemon; investment, dividends and share actions are left untouched',
  };
}

/**
 * Cash the next structural purchase has a claim on (spec §4.4 guard 2).
 *
 * Only a package that is blocked *solely* by funds counts, and only up to
 * `budgets.structuralClaimFraction` of current free cash: a claim above that would starve the
 * operating budgets (inputs, upkeep) that produce the revenue paying for the package, and a
 * `longWait` gap (more than twice the free cash) is not a claim, it is a wish.
 */
export function structuralClaim(report, { config = null, fraction = null } = {}) {
  const quotes = Array.isArray(report?.quotes) ? report.quotes : [];
  const funds = finite(report?.funds, 0);
  const reserve = finite(report?.reserve, 0);
  const free = Math.max(0, funds - reserve);
  const share = Math.max(0, Math.min(1, fraction ?? finite(config?.budgets?.structuralClaimFraction, 0.5)));
  const pending = quotes
    .filter((quote) => quote && quote.reason === 'insufficient funds' && quote.longWait !== true && finite(quote.cost) > 0)
    .sort((a, b) => finite(a.gap) - finite(b.gap));
  if (!pending.length || share <= 0) {
    return { claim: 0, free, fraction: share, pending: pending.length, division: null, city: null, cost: 0, gap: 0 };
  }
  const next = pending[0];
  const claim = Math.min(finite(next.cost), share * free);
  return {
    claim: Math.max(0, claim),
    free,
    fraction: share,
    pending: pending.length,
    division: next.division ?? null,
    city: next.city ?? null,
    cost: finite(next.cost),
    gap: finite(next.gap),
  };
}

/**
 * Warehouses the structural phase touched this cycle, derived from a before/after snapshot
 * rather than from action labels: a new warehouse, or a higher level than before.
 */
export function warehousesTouched(before, after) {
  if (!after || !Array.isArray(after.divisions)) return [];
  const previous = new Map();
  for (const key of Object.keys(before?.warehouseInfo || {})) previous.set(key, finite(before.warehouseInfo[key]?.level, 0));
  const touched = [];
  for (const division of after.divisions) {
    for (const city of division.cities || []) {
      const key = `${division.name}/${city}`;
      if (after.warehouses?.[key] !== true) continue;
      const level = finite(after.warehouseInfo?.[key]?.level, 0);
      if (!previous.has(key) || level > finite(previous.get(key), 0)) touched.push(key);
    }
  }
  return touched;
}

/**
 * Offices the structural phase grew this cycle (N1). The bootstrap grows every warehouse-backed
 * office to `bootstrap.initialOfficeSize` in 3-seat steps and the people module grows it again
 * from the budget ladder, so without this guard one cycle buys two increments for the same
 * office — the same defect the warehouse guard was added for.
 */
export function officesTouched(before, after) {
  if (!after || !Array.isArray(after.divisions)) return [];
  const previous = new Map();
  for (const key of Object.keys(before?.offices || {})) previous.set(key, finite(before.offices[key]?.size, 0));
  const touched = [];
  for (const division of after.divisions) {
    for (const city of division.cities || []) {
      const key = `${division.name}/${city}`;
      const size = finite(after.offices?.[key]?.size, 0);
      if (!previous.has(key) || size > finite(previous.get(key), 0)) touched.push(key);
    }
  }
  return touched;
}

/** Fresh daemon state; `schemaVersion`/identity decide whether a persisted file is reused. */
export function defaultDaemonState() {
  return {
    schemaVersion: DAEMON_SCHEMA_VERSION,
    nodeReset: null,
    augReset: null,
    corporation: null,
    cyclesManaged: 0,
    lastState: null,
    lastAt: 0,
    failures: [],
    finance: null,
    guards: null,
    crashStreak: 0,
  };
}

/** Accept persisted state only for this node/augmentation/corporation; never migrate. */
export function restoreDaemonState(raw, { nodeReset = null, augReset = null, corporation = null } = {}) {
  const fresh = defaultDaemonState();
  if (!raw || typeof raw !== 'object') return fresh;
  if (raw.schemaVersion !== DAEMON_SCHEMA_VERSION) return fresh;
  if (nodeReset !== null && raw.nodeReset !== nodeReset) return fresh;
  if (augReset !== null && raw.augReset !== augReset) return fresh;
  if (corporation !== null && raw.corporation !== corporation) return fresh;
  const state = { ...fresh };
  for (const key of Object.keys(fresh)) if (raw[key] !== undefined) state[key] = raw[key];
  state.schemaVersion = DAEMON_SCHEMA_VERSION;
  return state;
}

/** Read + restore daemon state for this identity. Missing or foreign files are discarded. */
export function readDaemonState(ns, { path = DAEMON_STATE_FILE, identity = {} } = {}) {
  return restoreDaemonState(readJsonFile(ns, path), identity);
}

/** Bounded logger: `ns.print` for the tail window, `tprint` for warnings/errors, ring buffer for the status doc. */
export function createDaemonLogger(ns, { quiet = false, debug = false, limit = MAX_LOG_LINES } = {}) {
  const lines = [];
  const emit = (level, message) => {
    lines.push(`${level}: ${message}`);
    if (lines.length > limit) lines.splice(0, lines.length - limit);
    if (quiet) return;
    safeCall(() => ns.print(message));
    if (level === 'error' || level === 'warn') safeCall(() => ns.tprint(message));
  };
  return {
    lines,
    log: (level, message, data) => {
      const suffix = data && debug ? ` ${JSON.stringify(data)}` : '';
      emit(level, `${message}${suffix}`);
    },
  };
}

/** Merge failure counters from different phases, keeping the highest count per operation. */
export function mergeFailures(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const failure of Array.isArray(list) ? list : []) {
      if (!failure || typeof failure.operation !== 'string') continue;
      const prior = map.get(failure.operation);
      if (!prior) {
        map.set(failure.operation, { ...failure });
        continue;
      }
      const firstAt = Math.min(finite(prior.firstAt, 0) || Infinity, finite(failure.firstAt, 0) || Infinity);
      map.set(failure.operation, {
        operation: failure.operation,
        message: failure.message || prior.message,
        count: Math.max(finite(prior.count, 0), finite(failure.count, 0)),
        firstAt: Number.isFinite(firstAt) ? firstAt : null,
        lastAt: Math.max(finite(prior.lastAt, 0), finite(failure.lastAt, 0)),
        announced: prior.announced === true || failure.announced === true,
      });
    }
  }
  return [...map.values()].sort((a, b) => finite(b.count) - finite(a.count)).slice(0, MAX_FAILURES);
}

/** Context every corporation read module expects (spec §6.1). */
function cycleContext(ns, reset) {
  return {
    wallet: finite(safeCall(() => ns.getPlayer().money, 0)),
    playerReserve: finite(safeCall(() => Number(ns.read('reserve.txt')) || 0, 0)),
    currentNode: reset.currentNode,
    hasSourceFile3: reset.hasSourceFile3,
    disableCorporation: reset.disableCorporation,
  };
}

function describeDecision(decision) {
  const detail = decision.reason || decision.detail || '';
  return { label: decision.label, state: decision.state, detail: String(detail).slice(0, 200), at: finite(decision.at, 0) };
}

/**
 * One full corporation cycle: structural phase, guards, optimiser phase, telemetry.
 *
 * Options: `{config, argv, dryRun, now, cyclesManaged, quiet, isAllowed, peers, failures,
 * statusFile, stateFile, optimizer, writeStatus, script}`. `optimizer` lets the loop reuse one
 * instance (it keeps research samples and failure counters); without it a fresh instance is
 * restored from the state file for this one cycle.
 */
export async function runCorporationCycle(ns, options = {}) {
  const argv = options.argv ?? (Array.isArray(ns?.args) ? ns.args : []);
  const configResult = options.config
    ? { config: options.config, errors: [], warnings: [] }
    : loadConfig(ns, { argv: configArgv(argv) });
  // `--dry-run` must reach the optimiser too: it reads `config.dryRun`, while bootstrap and
  // expansion take the flag as an option. Clone so the caller's config is never mutated.
  const config = options.dryRun === true ? { ...configResult.config, dryRun: true } : configResult.config;
  const dryRun = options.dryRun === true || config.dryRun === true;
  const now = finite(options.now, Date.now()) || Date.now();
  const logger = options.logger || createDaemonLogger(ns, { quiet: options.quiet === true, debug: config.telemetry?.debug === true });
  const log = logger.log;
  const reset = readResetContext(ns);
  const context = cycleContext(ns, reset);
  const api = ns?.corporation || null;
  // One read: the status document reports profit per market cycle, not per arbitrary tick (B12).
  const marketCycleSeconds = Math.max(1, finite(safeCall(() => api?.getConstants?.()?.secondsPerMarketCycle, 10), 10));
  const script = options.script || safeCall(() => ns.getScriptName(), 'corporation-daemon.js');
  const allowed = safeCall(() => (typeof options.isAllowed === 'function' ? options.isAllowed() !== false : true), true);
  const peers = options.peers ?? detectPeerWriters(ns, { script });
  const finance = financeOwnership(config, { peers });

  for (const warning of configResult.warnings || []) log('warn', `config: ${warning.code}${warning.path ? ` (${warning.path})` : ''}`);
  for (const error of configResult.errors || []) log('warn', `config: ${error.code}${error.path ? ` (${error.path})` : ''}`);

  const baseReport = {
    state: 'NO_CORP',
    phase: 'GUARD',
    terminal: false,
    reason: null,
    dryRun,
    funds: 0,
    reserve: 0,
    divisions: [],
    structural: null,
    optimizer: null,
    optimizerDecisions: [],
    findings: [],
    actions: [],
    errors: [],
    blockedBy: [],
    quotes: [],
    guards: { peers, finance, claim: null, skipWarehouse: [], skipOffice: [] },
    progress: null,
    cooldowns: options.cooldowns || {},
    persistentFailures: mergeFailures(options.failures),
    configErrors: configResult.errors || [],
    configWarnings: configResult.warnings || [],
    cyclesManaged: finite(options.cyclesManaged, 0),
    nodeReset: reset.lastNodeReset,
    augReset: reset.lastAugReset,
    marketCycleSeconds,
    // `finance.*` is unowned (spec §4.4): the status document reports the floor it *would* use,
    // so a reader never has to guess whether a share action happened.
    financeConfig: {
      minOwnership: finite(config?.finance?.minOwnership, 0.5),
      acceptInvestment: config?.finance?.acceptInvestment === true,
      payDividends: config?.finance?.payDividends === true,
      manageShares: config?.finance?.manageShares === true,
    },
    lastActionAt: 0,
    logger,
    log,
  };

  // Guard 0 — pause / maintenance / achievement lock: no module runs, buy rates are zeroed.
  if (!allowed) {
    safeCall(() => clearCorporationBuyRates(api));
    log('warn', 'Corporation automation is suspended (paused, maintenance or achievement lock); no action taken.');
    return finalize({ ...baseReport, state: 'SUSPENDED', phase: 'GUARD', reason: 'automation paused, maintenance requested or achievement-locked' }, options, ns);
  }

  // Guard 1 — one writer per corporation. Report-only touches nothing: the peer owns the buy
  // rates too, so zeroing them here disarmed the controller this daemon defers to (B1).
  if (peers.length) {
    const names = [...new Set(peers.map((peer) => peer.script))];
    log('warn', `Corporation daemon is standing down: ${names.join(', ')} already drives this corporation. Report-only cycle, no purchases, buy rates left untouched.`);
    const info = safeCall(() => api?.getCorporation(), null);
    return finalize(
      {
        ...baseReport,
        state: 'REPORT_ONLY',
        phase: 'GUARD',
        reason: `${names.join(', ')} is running; this daemon does not mutate the corporation while another controller is active`,
        funds: finite(info?.funds),
        divisions: Array.isArray(info?.divisions) ? [...info.divisions] : [],
        actions: [{ label: 'cycle', state: 'skipped', detail: `peer writer: ${names.join(', ')}`, at: now }],
      },
      options,
      ns,
    );
  }

  // Structural phase. A before-snapshot is the honest way to learn which warehouses this
  // phase touched, without parsing action labels.
  const before = api ? safeCall(() => readBootstrapSnapshot(api, config, context), null) : null;
  let structural;
  try {
    structural = await runBootstrapExpansionCycle(ns, {
      config,
      dryRun,
      argv,
      failures: options.failures,
      cooldowns: options.cooldowns,
      cyclesManaged: options.cyclesManaged,
      quiet: options.quiet,
      logger,
      now,
      statusFile: options.bootstrapStatusFile,
      // The daemon publishes the integrated dry-run plan; the structural half must not also
      // write `tasks/corporation-dry-run.json` (B6, one writer per document).
      dryRunFile: null,
    });
  } catch (error) {
    structural = {
      state: 'FAILED',
      phase: 'BOOTSTRAP',
      terminal: false,
      reason: text(error),
      actions: [{ label: 'structural cycle', state: 'failed', detail: text(error), at: now }],
      errors: [{ operation: 'structural', message: text(error), at: now }],
      blockedBy: [],
      quotes: [],
      funds: 0,
      reserve: 0,
      progress: null,
    };
    log('error', `Structural phase failed: ${text(error)}`);
  }
  const after = api ? safeCall(() => readBootstrapSnapshot(api, config, context), null) : null;

  const claim = structuralClaim(structural, { config });
  const skipWarehouse = warehousesTouched(before, after);
  const skipOffice = officesTouched(before, after);
  const corporationExists = after?.hasCorporation === true || ['BOOTSTRAP', 'READY', 'EXPANDING'].includes(structural.state);

  // Optimiser phase — only with a corporation and a readable state snapshot.
  let tick = null;
  if (corporationExists) {
    try {
      const optimizer = options.optimizer || buildOptimizer(ns, { api, config, context, reset, dryRun, claim, skipWarehouse, skipOffice, options, logger });
      if (options.optimizer) {
        safeCall(() => options.optimizer.configure(config));
        safeCall(() => options.optimizer.setCycleGuards({ reserveFloor: claim.claim, skipWarehouse, skipOffice }));
      }
      tick = optimizer.tick();
    } catch (error) {
      tick = null;
      log('error', `Optimiser phase failed: ${text(error)}`);
      baseReport.errors.push({ operation: 'optimizer', message: text(error), at: now });
    }
  } else if (structural.state === 'NO_CORP') {
    log('info', 'No corporation yet; the structural phase owns creation and will retry next cycle.');
  }

  const actions = [...(structural.actions || []), ...(tick?.decisions || []).map(describeDecision)].slice(-MAX_STATUS_ACTIONS);
  const errors = [...(structural.errors || []), ...baseReport.errors];
  const persistentFailures = mergeFailures(
    summarizeFailures(options.failures, errors, now),
    tick?.telemetry?.persistentFailures || [],
  );
  for (const failure of persistentFailures) {
    if (failure.count >= 5 && failure.announced !== true) {
      failure.announced = true;
      log('error', `${failure.operation} failed ${failure.count}× in a row: ${failure.message}`);
    }
  }
  for (const action of structural.actions || []) {
    // The structural cycle logs its own actions; only failures need a second, louder line.
    if (action.state === 'failed') log('error', `${action.label}: ${action.detail || 'failed'}`);
  }
  const info = tick?.snapshot?.info || after?.corp || safeCall(() => api?.getCorporation(), null);
  if (claim.claim > 0) {
    log('info', `Holding $${Math.round(claim.claim).toLocaleString()} of free cash for the next ${claim.division}/${claim.city} package ($${Math.round(claim.cost).toLocaleString()} needed).`);
  }
  if (skipWarehouse.length) log('info', `Structural phase touched ${skipWarehouse.join(', ')}; the optimiser skips those warehouses this cycle.`);

  const state = structural.state === 'UNAVAILABLE'
    ? 'UNAVAILABLE'
    : !corporationExists
      ? 'NO_CORP'
      : tick?.state === 'SUSPENDED'
        ? 'SUSPENDED'
        : tick?.state === 'DISABLED'
          ? 'DISABLED'
          : tick?.state === 'RECOVERY'
            ? 'RECOVERY'
            : 'RUNNING';
  const phase = !corporationExists ? 'BOOTSTRAP' : structural.progress?.complete ? 'OPTIMIZE' : 'EXPAND';

  const report = {
    ...baseReport,
    errors,
    state,
    phase,
    terminal: structural.terminal === true,
    reason: structural.reason || tick?.telemetry?.reason || null,
    funds: finite(tick?.telemetry?.funds ?? structural.funds ?? info?.funds),
    reserve: finite(tick?.telemetry?.reserve ?? structural.reserve),
    divisions: Array.isArray(info?.divisions) ? [...info.divisions] : [],
    revenue: finite(info?.revenue),
    expenses: finite(info?.expenses),
    valuation: finite(info?.valuation),
    sharePrice: finite(info?.sharePrice),
    public: info?.public === true,
    ownership: ownershipFraction(info),
    dividendRate: finite(info?.dividendRate),
    growthBank: finite(tick?.telemetry?.growthBank),
    corporation: info?.name ?? null,
    structural: {
      state: structural.state,
      reason: structural.reason || null,
      progress: structural.progress || null,
    },
    optimizer: tick
      ? {
          state: tick.state,
          decisions: tick.decisions.length,
          findings: tick.findings.length,
          findingsList: tick.findings.slice(0, MAX_FINDINGS),
          budgets: tick.telemetry?.budgets || null,
          lastActionAt: finite(tick.telemetry?.lastActionAt, 0),
        }
      : null,
    optimizerDecisions: tick ? tick.decisions.slice(0, MAX_DECISIONS) : [],
    divisionMetrics: tick?.telemetry?.divisions || [],
    offices: tick?.telemetry?.offices || [],
    findings: tick ? tick.findings.slice(0, MAX_FINDINGS) : [],
    lastActionAt: finite(tick?.telemetry?.lastActionAt, 0),
    actions,
    blockedBy: [...(structural.blockedBy || [])],
    quotes: structural.quotes || [],
    guards: { peers, finance, claim, skipWarehouse, skipOffice },
    progress: structural.progress || null,
    cooldowns: structural.cooldowns || options.cooldowns || {},
    persistentFailures,
  };
  return finalize(report, options, ns);
}

/** Build a one-cycle optimiser restored from its state file. */
function buildOptimizer(ns, { api, config, context, reset, dryRun, claim, skipWarehouse, skipOffice, options, logger = null }) {
  const stateFile = config.telemetry?.stateFile || 'tasks/corporation-optimizer.json';
  // The cycle's own logger, so a standalone `runCorporationCycle` keeps the optimiser's action
  // lines in `status.log` and the tail window instead of dropping them (B10).
  const cycleLog = logger?.log || options.logger?.log || (() => {});
  return createCorporationOptimizer({
    api,
    config,
    cycleSeconds: Math.max(1, finite(safeCall(() => api?.getConstants?.().secondsPerMarketCycle, 10), 10)),
    // A dry run must not persist optimiser state: the daemon's plan document is the output.
    write: dryRun ? null : (path, contents) => safeCall(() => ns.write(path, contents, 'w'), null),
    state: readJsonFile(ns, stateFile),
    identity: { nodeReset: reset.lastNodeReset, augReset: reset.lastAugReset, corporation: null },
    isAllowed: () => safeCall(() => (typeof options.isAllowed === 'function' ? options.isAllowed() !== false : true), true),
    log: cycleLog,
    reserveFloor: claim.claim,
    skipWarehouse,
    skipOffice,
  });
}

/** Publish the status (and, in dry-run, the plan) and return the report. */
function finalize(report, options, ns) {
  report.pid = finite(safeCall(() => ns?.pid, 0), 0);
  const status = buildDaemonStatus(report);
  report.status = status;
  if (options.writeStatus !== false) {
    writeFile(ns, options.statusFile || DAEMON_STATUS_FILE, status);
    if (report.dryRun) writeFile(ns, options.dryRunFile || DAEMON_DRY_RUN_FILE, buildDaemonDryRun(report));
  }
  return report;
}

/**
 * Status document (spec §9.1 key set, plus the integration sections). It is deliberately *not*
 * `tasks/corporation-status.json`: that file belongs to the legacy controller, and this daemon
 * may later give way to it (guard 1). One file per writer.
 *
 * Every §9.1 key is present. Keys this daemon cannot support (finance is unowned, there is no
 * hash module) are published as `null`/`[]` **and** named in `unsupported` with the reason, so a
 * dashboard never has to guess whether a zero means "fine" or "not measured".
 */
export function buildDaemonStatus(report) {
  const now = Date.now();
  const actions = (report.actions || []).slice(-MAX_STATUS_ACTIONS).map((action) => ({
    label: action.label,
    state: action.state,
    detail: action.detail ? String(action.detail).slice(0, 200) : '',
    at: finite(action.at, 0),
  }));
  const decisions = (report.optimizerDecisions || []).slice(0, MAX_DECISIONS).map((row) => ({
    kind: row.kind,
    label: row.label,
    state: row.state,
    cost: finite(row.cost, 0),
    target: row.target ?? null,
    reason: row.reason ? String(row.reason).slice(0, 160) : null,
  }));
  const ofKind = (...kinds) => decisions.filter((row) => kinds.includes(row.kind));
  const quotes = (report.quotes || []).map((quote) => ({
    label: quote.label ?? `${quote.division || '?'}/${quote.city || '?'}`,
    division: quote.division ?? null,
    city: quote.city ?? null,
    cost: finite(quote.cost, 0),
    gap: finite(quote.gap, 0),
    etaSeconds: quote.etaSeconds ?? null,
    longWait: quote.longWait === true,
    reason: quote.reason ?? null,
  }));
  const growthDecisions = [...quotes.map((quote) => ({ label: quote.label, state: 'staged', cost: quote.cost, gap: quote.gap })), ...ofKind('city', 'industry', 'warehouse', 'product')];
  const divisionMetrics = report.divisionMetrics || [];
  const offices = (report.offices || []).map((office) => ({
    division: office.division,
    city: office.city,
    size: finite(office.size, 0),
    employees: finite(office.employees, 0),
    energy: finite(office.energy, 0),
    morale: finite(office.morale, 0),
    starvation: office.starvation === true,
  }));
  const productSlotsPerDivision = Object.fromEntries(
    divisionMetrics.filter((division) => division.productSlots).map((division) => [division.name, division.productSlots]),
  );
  const productMetrics = Object.fromEntries(
    divisionMetrics.map((division) => [division.name, {
      researchPoints: finite(division.researchPoints, 0),
      slots: division.productSlots || null,
      products: (division.products || []).map((product) => ({
        name: product.name,
        progress: finite(product.progress, 0),
        rating: finite(product.rating, 0),
        stored: finite(product.stored, 0),
      })),
    }]),
  );
  const growthGoal = quotes[0] || null;
  const findings = (report.findings || []).slice(0, MAX_FINDINGS).map((finding) => ({
    kind: finding.kind,
    label: finding.label,
    division: finding.division ?? null,
    city: finding.city ?? null,
    reason: finding.reason ? String(finding.reason).slice(0, 200) : null,
  }));
  const unsupported = [];
  if (report.public !== true) unsupported.push({ key: 'estimatedDividendIncome', reason: 'private corporation: no dividend is paid' });
  else unsupported.push({ key: 'estimatedDividendIncome', reason: 'no finance module measures dividend income (spec §4.4)' });
  unsupported.push({ key: 'hashMilestone', reason: 'no hash module is wired into the daemon (spec §6.6)' });
  unsupported.push({ key: 'shareActions', reason: 'finance is unowned: investment, IPO, dividends and buyback belong to corporation-manager.js or to nobody' });
  if (report.dividendRate === undefined || report.dividendRate === null) unsupported.push({ key: 'dividendRate', reason: 'the corporation snapshot did not expose a dividend rate' });
  return {
    schemaVersion: DAEMON_STATUS_SCHEMA_VERSION,
    at: now,
    pid: finite(report.pid, 0),
    nodeReset: report.nodeReset ?? null,
    augReset: report.augReset ?? null,
    corporation: report.corporation ?? null,
    // Legacy keys dashboards read (README-AUTOMATION.md:223-225).
    mode: report.state === 'UNAVAILABLE' ? 'unavailable' : report.state === 'REPORT_ONLY' ? 'report-only' : report.phase === 'OPTIMIZE' ? 'optimize' : 'bootstrap',
    state: report.state,
    stateSince: now,
    stateReason: report.reason,
    dryRun: report.dryRun,
    funds: finite(report.funds),
    reserve: finite(report.reserve),
    revenue: finite(report.revenue),
    expenses: finite(report.expenses),
    // Profit per corporation market cycle (`constants.secondsPerMarketCycle`), not a magic ×10 (B12).
    profitPerCycle: (finite(report.revenue) - finite(report.expenses)) * Math.max(1, finite(report.marketCycleSeconds, 10)),
    valuation: finite(report.valuation),
    sharePrice: finite(report.sharePrice),
    public: report.public === true,
    ownership: report.ownership ?? null,
    minOwnership: finite(report.financeConfig?.minOwnership, 0.5),
    dividendRate: report.dividendRate ?? null,
    estimatedDividendIncome: null,
    divisions: report.divisions || [],
    growthPriority: report.phase === 'BOOTSTRAP',
    phase: report.phase,
    growthBank: finite(report.growthBank),
    growthGoal,
    growthDecisions: growthDecisions.slice(0, MAX_DECISIONS),
    fundingDiagnostics: quotes,
    researchDecisions: ofKind('research'),
    productMetrics,
    productSlotsPerDivision,
    staffingGoals: offices.map((office) => ({ division: office.division, city: office.city, size: office.size, employees: office.employees, starvation: office.starvation })),
    offices,
    upgradeDecisions: ofKind('upgrade', 'advert'),
    shareActions: [],
    hashMilestone: null,
    bootstrap: {
      state: report.structural?.state ?? null,
      phase: report.phase,
      complete: report.progress?.complete === true,
      checks: report.progress?.checks || [],
    },
    structural: report.structural,
    optimizer: report.optimizer,
    findings,
    unsupported,
    guards: {
      peers: (report.guards?.peers || []).map((peer) => peer.script),
      finance: report.guards?.finance || null,
      structuralClaim: report.guards?.claim || null,
      skipWarehouse: report.guards?.skipWarehouse || [],
      skipOffice: report.guards?.skipOffice || [],
    },
    blockedBy: report.blockedBy || [],
    stagedExpansion: quotes,
    actions,
    persistentFailures: report.persistentFailures || [],
    configErrors: report.configErrors || [],
    configWarnings: report.configWarnings || [],
    lastActionAt: finite(report.lastActionAt, 0),
    cyclesManaged: finite(report.cyclesManaged),
    log: (report.logger?.lines || []).slice(-MAX_LOG_LINES),
  };
}

/** Dry-run plan (spec §9.5): every intended action with its guard, no mutation. */
export function buildDaemonDryRun(report) {
  const actions = report.actions || [];
  return {
    schemaVersion: 1,
    at: Date.now(),
    dryRun: true,
    state: report.state,
    phase: report.phase,
    funds: finite(report.funds),
    reserve: finite(report.reserve),
    wouldDo: actions.filter((action) => action.state === 'dry-run' || action.state === 'planned').map((action) => ({ label: action.label, detail: action.detail, at: action.at })),
    skipped: actions.filter((action) => action.state === 'skipped').map((action) => ({ label: action.label, detail: action.detail })),
    blocked: report.blockedBy || [],
    stagedExpansion: report.quotes || [],
    guards: report.guards || null,
    optimizerPlans: actions.filter((action) => action.state === 'planned').length,
    // A fresh save plans creation plus the projected next steps (B4); findings[] is the bounded
    // list the status document publishes instead of a bare count (B5).
    findings: (report.findings || []).slice(0, MAX_FINDINGS),
    unsupported: report.state === 'NO_CORP' ? ['no corporation yet: growth, offices and products are planned for the next cycle'] : [],
  };
}

async function safeSleep(ns, ms) {
  const duration = Math.max(1, Math.floor(finite(ms, 1000)));
  try {
    if (typeof ns.sleep === 'function') await ns.sleep(duration);
  } catch {
    /* ignore */
  }
}

/**
 * Standalone loop. One iteration = one corporation cycle, then `nextUpdate()` (or a bounded
 * sleep while no corporation exists). `--ticks=N` bounds the run for tests and smoke checks.
 */
export async function main(ns) {
  const args = Array.isArray(ns.args) ? ns.args : [];
  const options = parseDaemonArgs(args);
  const configResult = loadConfig(ns, { argv: configArgv(args) });
  const config = configResult.config;
  const dryRun = options.dryRun === true || config.dryRun === true;
  for (const label of ['sleep', 'corporation.nextUpdate', 'getServerMoneyAvailable', 'getServerUsedRam']) safeCall(() => ns.disableLog(label));

  if (config.enabled === false) {
    safeCall(() => ns.tprint('Corporation automation is disabled in corporation-config.json (enabled: false).'));
    return { cycles: 0, reason: 'disabled' };
  }
  const script = safeCall(() => ns.getScriptName(), 'corporation-daemon.js');
  const ram = homeRamVerdict(ns, script);
  if (!ram.ok) {
    safeCall(() => ns.tprint(`Corporation daemon stopped: needs ${ram.required.toFixed(1)} GB, home has ${ram.maxRam.toFixed(1)} GB total (${ram.freeRam.toFixed(1)} GB free, ${ram.ownReservation.toFixed(1)} GB held by this instance).`));
    return { cycles: 0, reason: 'ram' };
  }
  if (isDuplicateInstance(ns, script)) {
    safeCall(() => ns.tprint('Corporation daemon already running; this instance exits.'));
    return { cycles: 0, reason: 'duplicate' };
  }
  if (typeof ns.atExit === 'function' && !dryRun) {
    ns.atExit(() => {
      // Both names are the same helper; one call is enough, and a crash must not leave paid rates.
      try {
        clearOptimizerBuyRates(ns.corporation);
      } catch {
        /* best effort */
      }
    });
  }

  const logger = createDaemonLogger(ns, { quiet: options.quiet, debug: config.telemetry?.debug === true });
  for (const issue of options.issues || []) logger.log('warn', `${issue.code}: ${issue.detail}`);
  for (const warning of configResult.warnings) logger.log('warn', `config: ${warning.code}${warning.path ? ` (${warning.path})` : ''}`);
  for (const error of configResult.errors) logger.log('warn', `config: ${error.code}${error.path ? ` (${error.path})` : ''}`);
  safeCall(() => ns.tprint(`Corporation daemon ${dryRun ? '(dry run) ' : ''}starting: ${config.bootstrap.industryChain.join(' → ')} across ${config.bootstrap.cities.length} cities, ${CONFIG_PATH}.`));

  const reset = readResetContext(ns);
  const identity = { nodeReset: reset.lastNodeReset, augReset: reset.lastAugReset, corporation: null };
  const persisted = readDaemonState(ns, { identity });
  let failures = mergeFailures(persisted.failures);
  let cooldowns = {};
  let cycles = 0;
  // Restored, not zeroed: an in-memory streak let every relaunch reset the 10-minute backoff, so
  // a cycle that crashes on start crashed again in a tight loop (B2, spec §9.4).
  let crashStreak = Math.max(0, finite(persisted.crashStreak, 0));
  let lastState = persisted.lastState || null;
  const statePath = DAEMON_STATE_FILE;
  const maxCycles = Number.isFinite(options.ticks) && options.ticks > 0 ? options.ticks : Infinity;

  const persistState = (overrides = {}) =>
    writeFile(ns, statePath, {
      ...persisted,
      schemaVersion: DAEMON_SCHEMA_VERSION,
      nodeReset: reset.lastNodeReset,
      augReset: reset.lastAugReset,
      corporation: safeCall(() => ns.corporation?.getCorporation()?.name, null) ?? persisted.corporation ?? null,
      cyclesManaged: cycles,
      lastState,
      lastAt: Date.now(),
      failures,
      finance: overrides.finance ?? persisted.finance ?? null,
      guards: overrides.guards ?? persisted.guards ?? null,
      crashStreak,
    });

  // One optimiser for the whole run: it keeps research samples, pricing brackets and failure
  // counters instead of restoring them from disk every cycle.
  const optimizer = createCorporationOptimizer({
    api: ns?.corporation || null,
    config,
    cycleSeconds: Math.max(1, finite(safeCall(() => ns.corporation?.getConstants?.().secondsPerMarketCycle, 10), 10)),
    write: dryRun ? null : (path, contents) => safeCall(() => ns.write(path, contents, 'w'), null),
    state: readJsonFile(ns, config.telemetry?.stateFile || 'tasks/corporation-optimizer.json'),
    identity,
    isAllowed: () => true,
    log: logger.log,
  });

  while (cycles < maxCycles) {
    cycles++;
    const startedAt = Date.now();
    let report;
    try {
      report = await runCorporationCycle(ns, {
        config,
        argv: args,
        dryRun,
        optimizer,
        failures,
        cooldowns,
        cyclesManaged: cycles,
        quiet: options.quiet,
        logger,
        ns,
        script,
        statusFile: DAEMON_STATUS_FILE,
      });
    } catch (error) {
      // Never let a cycle kill the loop: log, persist the streak, back off, retry.
      crashStreak++;
      logger.log('error', `Corporation cycle crashed (${crashStreak}×): ${text(error)}`);
      safeCall(() => ns.tprint(`Corporation daemon cycle crashed: ${text(error)}`));
      // The write used to be after the catch, so the crash path exited the iteration without
      // persisting anything and every restart began again at streak 1 (B2).
      persistState();
      await safeSleep(ns, crashStreak >= CRASH_BACKOFF_CYCLES ? CRASH_BACKOFF_MS : Math.max(options.interval, 60000));
      continue;
    }
    crashStreak = 0;
    failures = report.persistentFailures || failures;
    cooldowns = report.cooldowns || cooldowns;
    if (report.state !== lastState) {
      logger.log('info', `corporation state: ${report.state} (${report.phase})${report.reason ? ` — ${report.reason}` : ''}`);
      lastState = report.state;
    }
    persistState({ finance: report.guards?.finance || null, guards: report.guards || null });
    // A call that has failed five times in a row will not succeed because the loop retried in
    // two seconds: back off like a crash instead of burning a cycle per tick (B2, spec §9.3).
    const worstFailure = Math.max(0, ...(report.persistentFailures || []).map((failure) => finite(failure.count, 0)));
    const persistentBackoff = worstFailure >= PERSISTENT_FAILURE_BACKOFF;
    if (persistentBackoff) {
      logger.log('warn', `${worstFailure} consecutive failures on one operation; backing off ${Math.round(CRASH_BACKOFF_MS / 60000)} minutes.`);
    }

    if (report.terminal) {
      safeCall(() => ns.tprint(`Corporation daemon terminal state ${report.state}: ${report.reason || 'no reason given'}`));
      break;
    }
    if (report.state === 'NO_CORP') {
      await safeSleep(ns, Math.max(options.interval, 60000));
      continue;
    }
    if (persistentBackoff) {
      await safeSleep(ns, CRASH_BACKOFF_MS);
      continue;
    }
    try {
      if (typeof ns.corporation?.nextUpdate === 'function') await ns.corporation.nextUpdate();
      else await safeSleep(ns, Math.max(options.interval, 1000));
    } catch {
      await safeSleep(ns, Math.max(options.interval, 1000));
    }
    // Bonus time can make nextUpdate resolve immediately; never spin tighter than the interval.
    if (Date.now() - startedAt < Math.max(50, options.interval)) await safeSleep(ns, Math.max(50, options.interval));
  }
  return { cycles, state: lastState };
}
