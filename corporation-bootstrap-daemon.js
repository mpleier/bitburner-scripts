/**
 * Config-driven entrypoint for corporation bootstrap + expansion (spec §4.1, §13).
 *
 * Two entry shapes:
 *   - `runBootstrapExpansionCycle(ns, options)` — one cycle, importable from the main
 *     corporation daemon. Returns the report and writes the status document.
 *   - `main(ns)` — a self-contained loop for manual/diagnostic runs:
 *       run corporation-bootstrap-daemon.js --dry-run
 *       run corporation-bootstrap-daemon.js --ticks=10 --interval=2000
 *
 * RAM: the script only calls `ns.corporation.nextUpdate`, `ns.getResetInfo` and the
 * filesystem/process helpers directly; the corporation reads and writes live in the
 * imported modules and are paid once per script that references them. The static
 * cost of this entrypoint is reported by `ns.getScriptRam`; it is not launched by
 * daemon.js, so the managed controller's reservation is unchanged (spec §4.2).
 */

import { loadConfig } from './corporation-config.js';
import { runBootstrap, corporationGate, operatingReserve } from './corporation-bootstrap.js';
import { runExpansion } from './corporation-expansion.js';
import { clearCorporationBuyRates } from './corporation-policy.js';

export const BOOTSTRAP_STATUS_FILE = 'tasks/corporation-bootstrap-status.json';
export const DRY_RUN_FILE = 'tasks/corporation-dry-run.json';
export const STATUS_SCHEMA_VERSION = 2;
export const MAX_STATUS_ACTIONS = 32;

const finite = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const text = (error) => String(error?.message || error).slice(0, 240);

function safeCall(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * `--ticks=N --interval=ms --dry-run --quiet` (config flags are parsed by corporation-config).
 *
 * `ticks` is `null` when the flag is absent, which is the only case that means "run until
 * stopped". A supplied value that is not a positive integer (`--ticks=0`, `-3`, `abc`) is a
 * mistyped bound, not a request for an unbounded loop: it falls back to one tick and reports
 * `config.invalidTicks` (B8).
 */
export function parseDaemonArgs(argv = []) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
  const options = { ticks: null, interval: 0, dryRun: false, quiet: false, issues: [] };
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    const [flag, inline] = token.split('=');
    const value = inline ?? args[index + 1];
    const takeValue = inline === undefined && value !== undefined && !String(value).startsWith('--') ? (index++, value) : inline;
    if (flag === '--ticks' || flag === '--cycles') {
      const parsed = Number(takeValue);
      if (takeValue === undefined || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        options.issues.push({ code: 'config.invalidTicks', value: takeValue === undefined ? '' : String(takeValue), detail: '--ticks must be a positive integer; running one cycle instead' });
        options.ticks = 1;
      } else {
        options.ticks = parsed;
      }
    }
    else if (flag === '--interval') options.interval = Math.max(0, Math.floor(finite(Number(takeValue), 0)));
    else if (flag === '--dry-run') options.dryRun = takeValue === undefined ? true : takeValue !== 'false';
    else if (flag === '--quiet') options.quiet = true;
  }
  return options;
}

/** Reset metadata with a safe default so a missing API cannot crash the gate. */
export function readResetContext(ns) {
  const reset = safeCall(() => ns.getResetInfo(), null) || {};
  const ownedSF = reset.ownedSF;
  const level = typeof ownedSF?.get === 'function' ? Number(ownedSF.get(3)) : Number(ownedSF?.[3]);
  return {
    currentNode: finite(reset.currentNode, 3),
    lastNodeReset: finite(reset.lastNodeReset, 0),
    lastAugReset: finite(reset.lastAugReset, 0),
    hasSourceFile3: finite(level, 0) > 0,
    disableCorporation: reset.bitNodeOptions?.disableCorporation === true,
    ownedAugs: reset.ownedAugs,
  };
}

/** Roll per-cycle API errors into bounded, restart-safe failure counters (spec §9.3). */
export function summarizeFailures(previous = [], errors = [], now = Date.now()) {
  const map = new Map();
  for (const failure of Array.isArray(previous) ? previous : []) {
    if (!failure || typeof failure.operation !== 'string') continue;
    map.set(failure.operation, { announced: false, count: 0, firstAt: now, lastAt: now, ...failure });
  }
  for (const error of Array.isArray(errors) ? errors : []) {
    const operation = typeof error?.operation === 'string' ? error.operation : 'unknown';
    const prior = map.get(operation);
    map.set(operation, {
      operation,
      message: text(error?.message ?? error),
      count: (prior?.count || 0) + 1,
      firstAt: prior?.firstAt || now,
      lastAt: now,
      announced: prior?.announced || false,
    });
  }
  return [...map.values()].filter((failure) => failure.lastAt >= now - 3600000).slice(-16);
}

function createLogger(ns, { quiet = false, debug = false } = {}) {
  const lines = [];
  const emit = (level, message) => {
    lines.push(`${level}: ${message}`);
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

function describeAction(action) {
  return `${action.label} → ${action.state}${action.detail ? ` (${action.detail})` : ''}`;
}

/** True when another copy of this script already runs on home (spec edge 24). */
export function isDuplicateInstance(ns, script = null) {
  const name = script || safeCall(() => ns.getScriptName(), null);
  if (!name || typeof ns.ps !== 'function') return false;
  const processes = safeCall(() => ns.ps('home'), null);
  if (!Array.isArray(processes)) return false;
  return processes.filter((process) => String(process?.filename || '').replace(/^\//, '') === String(name).replace(/^\//, '')).length > 1;
}

/**
 * Home-RAM verdict for an entrypoint that is already running (spec edge 25).
 *
 * The script's own reservation is part of `getServerUsedRam`, so it is added back before
 * comparing — exactly as `autopilot.js` does (`max - used + getScriptRam(reservation) >=
 * needed`). Without that, a home that hosts the daemon comfortably is refused whenever the
 * *leftover* RAM is smaller than the daemon itself.
 */
export function homeRamVerdict(ns, script = null) {
  const name = script || safeCall(() => ns.getScriptName(), null);
  const required = finite(safeCall(() => ns.getScriptRam(name, 'home'), 0));
  const maxRam = finite(safeCall(() => ns.getServerMaxRam('home'), 0), 0);
  const usedRam = finite(safeCall(() => ns.getServerUsedRam('home'), 0), 0);
  const ownReservation = Math.max(
    required,
    finite(
      safeCall(() => {
        const running = typeof ns.getRunningScript === 'function' ? ns.getRunningScript(ns.pid) : null;
        return running ? finite(running.ramUsage) * Math.max(1, finite(running.threads, 1)) : 0;
      }, 0),
    ),
  );
  const freeRam = Math.max(0, maxRam - usedRam);
  const availableRam = freeRam + ownReservation;
  return {
    script: name,
    required,
    maxRam,
    usedRam,
    freeRam,
    ownReservation,
    availableRam,
    ok: !(required > 0 && maxRam > 0 && (required > maxRam || required > availableRam)),
  };
}

function writeFile(ns, path, value) {
  return safeCall(() => ns.write(path, JSON.stringify(value), 'w'), null) !== null;
}

/**
 * One bootstrap + expansion cycle.
 *
 * Returns `{state, phase, terminal, dryRun, funds, reserve, actions, errors,
 * blockedBy, quotes, cooldowns, progress, persistentFailures, configErrors, status}`.
 */
export async function runBootstrapExpansionCycle(ns, options = {}) {
  const configResult = options.config
    ? { config: options.config, errors: [], warnings: [] }
    : loadConfig(ns, { argv: options.argv ?? (Array.isArray(ns?.args) ? ns.args : []) });
  const config = configResult.config;
  const dryRun = options.dryRun === true || config.dryRun === true;
  const now = finite(options.now, Date.now()) || Date.now();
  const logger = options.logger || createLogger(ns, { quiet: options.quiet === true, debug: config.telemetry?.debug === true });
  const log = logger.log;
  const reset = readResetContext(ns);
  const api = ns?.corporation || null;
  const context = {
    wallet: finite(safeCall(() => ns.getPlayer().money, 0)),
    playerReserve: finite(safeCall(() => Number(ns.read('reserve.txt')) || 0, 0)),
    currentNode: reset.currentNode,
    hasSourceFile3: reset.hasSourceFile3,
    disableCorporation: reset.disableCorporation,
  };
  for (const warning of configResult.warnings || []) log('warn', `config: ${warning.code}${warning.path ? ` (${warning.path})` : ''}`);
  for (const error of configResult.errors || []) log('warn', `config: ${error.code}${error.path ? ` (${error.path})` : ''}`);

  let bootstrap;
  try {
    bootstrap = runBootstrap(api, config, {
      dryRun,
      log,
      context,
      now,
      reserve: options.reserve,
      maxActions: options.maxActions,
    });
  } catch (error) {
    // A planner bug must never take the daemon down: report it as a failed cycle.
    bootstrap = { state: 'FAILED', terminal: false, reason: text(error), actions: [{ label: 'bootstrap cycle', state: 'failed', detail: text(error), at: now }], errors: [{ operation: 'bootstrap', message: text(error), at: now }], blockedBy: [], funds: 0, reserve: 0, progress: null };
    log('error', `Bootstrap cycle failed: ${text(error)}`);
  }

  let expansion = null;
  const corporationExists = bootstrap.state === 'BOOTSTRAP' || bootstrap.state === 'READY' || bootstrap.state === 'EXPANDING';
  if (corporationExists) {
    try {
      expansion = runExpansion(api, config, {
        dryRun,
        log,
        context,
        now,
        reserve: bootstrap.reserve,
        cooldowns: options.cooldowns,
        telemetry: options.telemetry,
        maxActions: options.maxActions,
      });
    } catch (error) {
      expansion = { state: 'FAILED', actions: [{ label: 'expansion cycle', state: 'failed', detail: text(error), at: now }], errors: [{ operation: 'expansion', message: text(error), at: now }], blockedBy: [], quotes: [], cooldowns: options.cooldowns || {}, funds: bootstrap.funds, reserve: bootstrap.reserve, progress: bootstrap.progress };
      log('error', `Expansion cycle failed: ${text(error)}`);
    }
  }

  const actions = [...(bootstrap.actions || []), ...(expansion?.actions || [])];
  for (const action of actions) if (action.state !== 'skipped' && action.state !== 'deferred') log(action.state === 'failed' ? 'error' : 'info', describeAction(action));
  const errors = [...(bootstrap.errors || []), ...(expansion?.errors || [])];
  const persistentFailures = summarizeFailures(options.failures, errors, now);
  for (const failure of persistentFailures) {
    if (failure.count >= 5 && failure.announced !== true) {
      failure.announced = true;
      log('error', `${failure.operation} failed ${failure.count}× in a row: ${failure.message}`);
    }
  }
  const blockedBy = [...(bootstrap.blockedBy || []), ...(expansion?.blockedBy || [])];
  const state = bootstrap.state === 'UNAVAILABLE' ? 'UNAVAILABLE' : expansion?.state || bootstrap.state;
  const phase = bootstrap.progress?.complete ? 'EXPANSION' : 'BOOTSTRAP';
  const corpInfo = safeCall(() => ns?.corporation?.getCorporation(), null);
  const report = {
    state,
    phase,
    terminal: bootstrap.terminal === true,
    reason: bootstrap.reason,
    dryRun,
    funds: finite(expansion?.funds ?? bootstrap.funds),
    reserve: finite(expansion?.reserve ?? bootstrap.reserve),
    divisions: Array.isArray(corpInfo?.divisions) ? [...corpInfo.divisions] : [],
    actions,
    errors,
    blockedBy,
    quotes: expansion?.quotes || [],
    cooldowns: expansion?.cooldowns || options.cooldowns || {},
    progress: bootstrap.progress,
    persistentFailures,
    configErrors: configResult.errors || [],
    configWarnings: configResult.warnings || [],
    cyclesManaged: finite(options.cyclesManaged, 0),
    logger,
  };

  if (options.writeStatus !== false) {
    const status = buildStatusDocument(report, { ns, config, reset, now, bootstrap, expansion });
    writeFile(ns, options.statusFile || BOOTSTRAP_STATUS_FILE, status);
    report.status = status;
    // One writer per document: the integrated daemon owns `tasks/corporation-dry-run.json`
    // (`options.dryRunFile === null`), so the structural half does not overwrite its plan (B6).
    if (dryRun && options.dryRunFile !== null) writeFile(ns, options.dryRunFile || DRY_RUN_FILE, buildDryRunDocument(report, now));
  }
  return report;
}

/** Status document with the §9.1 fixed key set plus the legacy keys dashboards read. */
export function buildStatusDocument(report, { ns = null, config = null, reset = null, now = Date.now(), bootstrap = null, expansion = null } = {}) {
  const actions = (report.actions || []).slice(-MAX_STATUS_ACTIONS).map((action) => ({ label: action.label, state: action.state, detail: action.detail, at: action.at }));
  const progress = report.progress || null;
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    at: now,
    pid: finite(safeCall(() => ns?.pid, null), 0),
    nodeReset: reset?.lastNodeReset ?? null,
    augReset: reset?.lastAugReset ?? null,
    corporation: null,
    state: report.state,
    stateSince: now,
    stateReason: report.reason,
    // Legacy keys (README-AUTOMATION.md:223-225).
    mode: report.state === 'UNAVAILABLE' ? 'unavailable' : report.phase === 'EXPANSION' ? 'expansion' : 'bootstrap',
    funds: report.funds,
    reserve: report.reserve,
    divisions: report.divisions || [],
    growthPriority: report.phase === 'BOOTSTRAP',
    phase: report.phase,
    dryRun: report.dryRun,
    configErrors: report.configErrors || [],
    configWarnings: report.configWarnings || [],
    blockedBy: report.blockedBy || [],
    stagedExpansion: report.quotes || [],
    actions,
    bootstrap: {
      complete: progress?.complete === true,
      checks: progress?.checks || [],
    },
    persistentFailures: report.persistentFailures || [],
    cyclesManaged: report.cyclesManaged,
    telemetry: config ? { statusFile: config.telemetry?.statusFile, cadenceMs: config.telemetry?.cadenceMs } : undefined,
    expansion: expansion ? { state: expansion.state, decisions: expansion.actions?.length || 0 } : null,
    bootstrapReport: bootstrap ? { state: bootstrap.state, reason: bootstrap.reason } : null,
  };
}

/** Dry-run plan document (spec §9.5): intended actions with their guards, no mutation. */
export function buildDryRunDocument(report, now = Date.now()) {
  return {
    schemaVersion: 1,
    at: now,
    dryRun: true,
    state: report.state,
    phase: report.phase,
    funds: report.funds,
    reserve: report.reserve,
    wouldDo: (report.actions || [])
      .filter((action) => action.state === 'dry-run')
      .map((action) => ({ label: action.label, detail: action.detail, at: action.at })),
    skipped: (report.actions || []).filter((action) => action.state === 'skipped').map((action) => ({ label: action.label, detail: action.detail })),
    blocked: [...(report.blockedBy || [])],
    stagedExpansion: report.quotes || [],
  };
}

/**
 * Standalone loop. One iteration = one corporation cycle (or a bounded wait while
 * no corporation exists). `--ticks=N` bounds the run for tests and smoke checks.
 */
export async function main(ns) {
  const args = Array.isArray(ns.args) ? ns.args : [];
  const options = parseDaemonArgs(args);
  const configResult = loadConfig(ns, { argv: args });
  const config = configResult.config;
  const dryRun = options.dryRun === true || config.dryRun === true;
  for (const label of ['sleep', 'corporation.nextUpdate', 'getServerMoneyAvailable', 'getServerUsedRam']) safeCall(() => ns.disableLog(label));

  if (config.enabled === false) {
    safeCall(() => ns.tprint('Corporation bootstrap is disabled in corporation-config.json (enabled: false).'));
    return;
  }
  const script = safeCall(() => ns.getScriptName(), 'corporation-bootstrap-daemon.js');
  const ram = homeRamVerdict(ns, script);
  if (!ram.ok) {
    safeCall(() => ns.tprint(`Corporation bootstrap stopped: needs ${ram.required.toFixed(1)} GB, home has ${ram.maxRam.toFixed(1)} GB total (${ram.freeRam.toFixed(1)} GB free, ${ram.ownReservation.toFixed(1)} GB held by this instance).`));
    return;
  }
  if (isDuplicateInstance(ns, script)) {
    safeCall(() => ns.tprint('Corporation bootstrap already running; this instance exits.'));
    return;
  }
  if (typeof ns.atExit === 'function' && !dryRun) {
    ns.atExit(() => {
      try {
        clearCorporationBuyRates(ns.corporation);
      } catch {
        /* best effort: a crashed process must not leave paid buy rates behind */
      }
    });
  }

  safeCall(() => ns.tprint(`Corporation bootstrap ${dryRun ? '(dry run) ' : ''}starting with ${config.bootstrap.industryChain.join(' → ')} across ${config.bootstrap.cities.length} cities.`));
  for (const issue of options.issues || []) safeCall(() => ns.tprint(`${issue.code}: ${issue.detail}`));
  const reset = readResetContext(ns);
  const gate = corporationGate({
    apiAvailable: !!ns.corporation,
    hasCorporation: safeCall(() => ns.corporation?.hasCorporation() === true, false),
    canCreateSeed: safeCall(() => ns.corporation?.canCreateCorporation(false), null),
    canCreateSelf: safeCall(() => ns.corporation?.canCreateCorporation(true), null),
    disableCorporation: reset.disableCorporation,
    currentNode: reset.currentNode,
    hasSourceFile3: reset.hasSourceFile3,
  });
  if (gate.state === 'UNAVAILABLE') {
    safeCall(() => ns.tprint(`Corporation bootstrap stopped: ${gate.reason}`));
    writeFile(ns, options.statusFile || BOOTSTRAP_STATUS_FILE, { schemaVersion: STATUS_SCHEMA_VERSION, at: Date.now(), state: 'UNAVAILABLE', stateReason: gate.reason, terminal: true, dryRun });
    return;
  }

  let failures = [];
  let cooldowns = {};
  let cycles = 0;
  let lastState = null;
  const maxCycles = options.ticks > 0 ? options.ticks : Infinity;
  while (cycles < maxCycles) {
    cycles++;
    const startedAt = Date.now();
    let report;
    try {
      report = await runBootstrapExpansionCycle(ns, { config, dryRun, argv: args, failures, cooldowns, cyclesManaged: cycles, quiet: options.quiet, statusFile: options.statusFile });
    } catch (error) {
      // Unhandled exceptions are a defect: log once, then keep the loop alive with a bounded sleep.
      safeCall(() => ns.tprint(`Corporation bootstrap cycle crashed: ${text(error)}`));
      await safeSleep(ns, Math.max(options.interval, 60000));
      continue;
    }
    failures = report.persistentFailures;
    cooldowns = report.cooldowns;
    if (report.state !== lastState) {
      safeCall(() => ns.print(`corporation state: ${report.state} (${report.phase})${report.reason ? ` — ${report.reason}` : ''}`));
      lastState = report.state;
    }
    if (report.terminal) {
      safeCall(() => ns.tprint(`Corporation bootstrap terminal state ${report.state}: ${report.reason}`));
      break;
    }
    if (report.state === 'NO_CORP') {
      await safeSleep(ns, Math.max(options.interval, 60000));
      continue;
    }
    const elapsed = Date.now() - startedAt;
    try {
      if (typeof ns.corporation?.nextUpdate === 'function') await ns.corporation.nextUpdate();
      else await safeSleep(ns, Math.max(options.interval, 1000));
    } catch {
      await safeSleep(ns, Math.max(options.interval, 1000));
    }
    // Bonus time can make nextUpdate resolve immediately; never spin tighter than the interval.
    if (Date.now() - startedAt < Math.max(50, options.interval)) await safeSleep(ns, Math.max(50, options.interval));
  }
  return { cycles };
}

async function safeSleep(ns, ms) {
  const duration = Math.max(1, Math.floor(finite(ms, 1000)));
  try {
    if (typeof ns.sleep === 'function') await ns.sleep(duration);
  } catch {
    /* ignore */
  }
}

/** Reserve value the entrypoint would use; exported for diagnostics. */
export function bootstrapReserve(info, config, cycleSeconds = 10) {
  return operatingReserve(info, config, cycleSeconds);
}
