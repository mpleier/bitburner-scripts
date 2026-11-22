# Game Automation Logic Audit — Goal

**Date:** 2026-11-19
**Scope:** All Bitburner game automation logic in `bitburner-scripts` (735+ deployable scripts, ~180 policy modules, 4051+ tests)
**Status:** Goal defined; audit not yet started

## Objective

Perform a comprehensive, evidence-based audit of every piece of game automation logic in this repository to identify:

1. **Stale-state bugs** — caches, snapshots, or derived values that persist beyond their validity window and cause incorrect decisions (the class of bug fixed in commit `d004462`).
2. **Logic errors** — incorrect branching, off-by-one, wrong comparison operators, inverted conditions, or missing edge cases that produce wrong in-game actions.
3. **Race conditions** — concurrent access to shared state files, unsynchronized multi-writer patterns, or TOCTOU bugs between read and write.
4. **Resource leaks** — unclosed handles, unbounded growth in arrays/maps/sets, scripts that never exit, or RAM held after completion.
5. **Policy contradictions** — two policy modules making conflicting decisions for the same resource (RAM, money, sleeve time, gang tasks, etc.).
6. **Dead code** — unreachable branches, unused exports, orphaned policy modules, or scripts no longer referenced by any manager.
7. **Performance regressions** — O(n²) or worse loops over server lists, redundant API calls per tick, or synchronous blocking in hot paths.

## Non-Goals

- Rewriting working automation from scratch.
- Changing game strategy, route selection, or BitNode-specific priorities (those are policy decisions, not bugs).
- Auditing the Bitburner game engine itself or external libraries.
- Auditing darknet module internals (those belong to another agent's active work; touch only if a cross-module dependency is broken).
- Modifying committed fixes from prior sessions unless a new defect is found.

## Audit Methodology

### Phase 1 — Static Analysis (automated)

| Step | Tool | What it catches |
|------|------|-----------------|
| 1.1 | `npm run check` (735 files, lint + syntax) | Syntax errors, lint violations, unused vars |
| 1.2 | `node scripts/audit-project.js all` | Import/export mismatches, undefined bindings, RAM budgets, API surface drift |
| 1.3 | `grep -rn "cached\|_cache\|stale\|TTL\|expiresAt\|once.*true"` | Cache sites (manual triage) |
| 1.4 | `grep -rn "catch\s*{}"` census | Empty catches hiding failures |
| 1.5 | `grep -rn "ns.write\|ns.read\|writeFileSync\|readFileSync"` | File I/O sites (race-condition candidates) |
| 1.6 | `grep -rn "while\s*(true)\|for\s*(;;)"` | Infinite loops without exit conditions |
| 1.7 | `grep -rn "TODO\|FIXME\|HACK\|XXX"` | Known debt markers |

### Phase 2 — Targeted Deep Audit (manual, by subsystem)

Audit each subsystem in priority order. For each, read the manager + all its policy modules, trace data flow from input to action, and verify against game API contracts.

| Priority | Subsystem | Key files | Estimated scope |
|----------|-----------|-----------|-----------------|
| P1 | Hacking engine (daemon, HGW, targets) | `daemon.js`, `hacking-*.js`, `hgw-*.js` | ~25 files |
| P1 | Hash economy | `spend-hacknet-hashes.js`, `hash-spending-policy.js`, `hacknet-*.js` | ~8 files |
| P1 | RAM management | `home-ram-policy.js`, `ram-reserve.js`, `manager-capacity-policy.js` | ~5 files |
| P2 | Bladeburner | `bladeburner.js`, `bladeburner-*.js` (25+ policy files) | ~30 files |
| P2 | Augmentation pipeline | `autopilot.js`, `work-for-factions.js`, `augmentation-*.js` | ~15 files |
| P2 | Sleeve management | `sleeve.js`, `sleeve-*.js` | ~12 files |
| P2 | Faction management | `faction-manager.js`, `faction-*.js` | ~10 files |
| P3 | Gang system | `gangs.js`, `gang-*.js` (30+ policy files) | ~35 files |
| P3 | Corporation | `corporation-*.js` (12+ files) | ~15 files |
| P3 | Stock market | `stockmaster.js`, `stock-*.js` | ~5 files |
| P3 | Casino | `casino.js`, `casino-*.js` | ~8 files |
| P3 | Go / Stanek | `go.js`, `stanek*.js` | ~8 files |
| P3 | Darknet | `darknet-*.js` (30+ files) | ~35 files |
| P4 | Achievement system | `achievement-*.js` | ~10 files |
| P4 | Infiltration | `infiltration-*.js` | ~5 files |
| P4 | Sleeve grafting | `grafting-manager.js`, `graft-*.js` | ~5 files |
| P4 | Sleeve SOA | `soa-*.js` | ~3 files |

### Phase 3 — Cross-Subsystem Integration Audit

| Check | Method |
|-------|--------|
| 3.1 Shared state file writers/readers matrix | Build producer/consumer map for all `tasks/*.json` and `remote-control/*` files; verify single-writer or proper locking |
| 3.2 RAM budget reconciliation | Sum all script RAM claims from `automation.status` + `ps`; compare to home maxRam; flag over-allocation or phantom holds |
| 3.3 Money flow audit | Trace all income sources (hacking, crime, hash sales, stock, casino, corporation) and all spenders; verify no double-counting or lost transactions |
| 3.4 Process lifecycle audit | Verify every managed script has a clean shutdown path; check for zombie processes, orphaned workers, and leaked child processes |
| 3.5 Policy decision consistency | For each shared resource (RAM, money, sleeve time), verify only one policy module has final authority; flag conflicting recommendations |

### Phase 4 — Live Game Verification

| Step | Method |
|------|--------|
| 4.1 | Run `automation.preflight` in-game; verify all entrypoints compile and are `ready` |
| 4.2 | Run `automation.status` for 5 minutes; check for error spikes, RAM growth, money growth |
| 4.3 | Run `automation.logsFresh` on each managed script; capture and triage warnings/errors |
| 4.4 | Verify HGW timing metrics stay within bounds (deadline overruns < 5%, errors = 0) |
| 4.5 | Verify hash economy: production rate matches sell rate, capacity not growing unexpectedly |
| 4.6 | Verify bladeburner: combat stats increasing, join gate progressing, no stall |

### Phase 5 — Test Coverage Audit

| Check | Method |
|-------|--------|
| 5.1 | Run `npm test` (4051+ tests); verify 0 failures |
| 5.2 | Identify policy modules with 0 test coverage; flag as audit priority |
| 5.3 | Identify test files that only test happy paths; flag for adversarial test additions |
| 5.4 | Verify test assertions match current code behavior (no stale test expectations) |

## Acceptance Criteria

The audit is complete when ALL of the following are true:

1. **Zero P1 (critical) findings** — no stale-state bugs, logic errors, or race conditions in hacking, hash economy, or RAM management.
2. **Zero P2 (high) findings** — no stale-state bugs or logic errors in bladeburner, augmentation, sleeve, or faction subsystems.
3. **All P3/P4 findings documented** — either fixed or explicitly accepted with rationale.
4. **Test suite green** — `npm run check` 0 problems, `npm test` 0 failures.
5. **Live game verified** — all managed scripts running, no error spikes, money/RAM/hash metrics healthy for 10+ minutes.
6. **Audit report written** — findings documented in a `GAME-AUTOMATION-AUDIT-REPORT.md` with severity, file:line, root cause, fix, and verification for each.
7. **No regressions** — all prior fixes (including `d004462`) remain intact and verified.

## Finding Severity Classification

| Severity | Definition | Response time |
|----------|-----------|---------------|
| P1 (Critical) | Causes money loss, RAM waste, or automation stall in live game | Fix immediately |
| P2 (High) | Causes incorrect in-game decisions or degraded performance | Fix in same session |
| P3 (Medium) | Code smell, dead code, or minor inefficiency | Fix or document |
| P4 (Low) | Style, naming, or documentation issue | Document only |

## Known Open Items (from prior sessions)

1. **Daemon dead** — `start daemon.js` fails with "insufficient RAM" (home 512 GB, reserve 200 GB, available ~3 GB). Daemon needs 266 GB. Blocked on home RAM growth.
2. **Hash spender unkillable** — pid 210220 running `--liquidate`; cannot stop via bridge (no `kill`/`write` commands). Currently in healthy spend mode (2.314 hashes/s).
3. **Bladeburner training** — physical stats at ~56/59, needs 100 to join. Training in progress.
4. **Home RAM growth** — achievement-manager not tracking MAX_RAM as a goal; ram-manager won't buy until money > reserve + upgrade cost (~$2-3B). Income ~$665k/s.
5. **Stale cache fix on disk but not exercising** — daemon is dead, so `d004462` changes haven't run in-game yet.

## Audit Entry Points

| Command | Purpose |
|---------|---------|
| `npm run check` | Lint + syntax (735 files) |
| `npm test` | Regression suite (4051+ tests) |
| `node scripts/audit-project.js all` | Project audit (imports, exports, RAM, API) |
| `automation.preflight` (in-game) | Compile + readiness check |
| `automation.status` (in-game) | Live state snapshot |
| `automation.logsFresh [script]` (in-game) | Fresh log capture |
| `git log --oneline -10` | Recent change history |

## Audit Scope Exclusions

- `node_modules/` — third-party, not audited
- `.worktrees/` — ephemeral, not audited
- `tests/` — audited for coverage gaps only, not for game logic
- `scripts/` (tooling) — audited for correctness but not game logic
- Darknet modifications by other agents — not swept into commits; audited only for cross-module breakage
- `Remote/` directory — audited for connection logic only

---

*This goal document defines the scope and acceptance criteria for the game automation logic audit. It is not an implementation plan — the audit itself will produce findings that drive implementation.*
