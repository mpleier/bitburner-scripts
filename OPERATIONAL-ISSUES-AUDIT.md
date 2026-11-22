# Operational Issues Audit — Live Game State

**Date:** 2026-11-19
**Scope:** Live Bitburner game operational state (not code logic)
**Method:** Bridge diagnostics (port 12525), automation.status, money sources, spending plan

## Current Game State

| Metric | Value |
|--------|-------|
| Money | $2.62B (was $695M earlier, ~$665k/s income) |
| Home RAM | 512 GB (475.1 used, 36.9 free) |
| Essential RAM target | 1024 GB (missing: sleeve.js, health-manager.js, work-for-factions.js) |
| Full RAM target | 2048 GB |
| Spent on home RAM | $1.59B |
| Reserve | $406M |
| Hashes | 4.24 available, capacity 66,048 |
| Hash rate | 2.314/s (selling at $250k/hash) |
| BitNode | 9 (Hacktocracy) |
| Source files | SF4.1, SF5.1 |
| Player XP | hacking 57,389, strength 23,799, defense 23,799, dexterity 30,312, agility 30,312, charisma 2,413,612, intelligence 153,939 |
| Karma | -3,818.87 |
| People killed | 0 |

## Operational Issues

### O1 — P1 (Critical): Daemon dead — insufficient RAM

**Symptom:** `daemon.js` (last pid 248) cannot start. `Error: Failed to start daemon.js: insufficient RAM` (receipt `9c90107b-c61b-46ec-91fd-2b7b65e4a36d`).
**Root cause:** Daemon needs 266 GB. Home has 512 GB total, 475.1 used, 200 GB reserved, leaving ~3-37 GB free.
**Impact:** HGW batch scheduling, target optimization, stock manipulation, and potentially RAM upgrades are all offline. bootstrap-hacking.js (pid 203757) is running instead but lacks the daemon's full capabilities.
**Blocked subsystems:** Stock manipulation ("missing-or-malformed"), HGW timing warnings (dormant), hacking process observation (owner pid 248, dead).
**Resolution:** Grow home RAM to ≥778 GB. At $665k/s, 50-75 min to reach $2-3B. Or kill bladeburner (pid 1531185) to free 129.85 GB immediately.

### O2 — P1 (Critical): Home RAM stuck at 512 GB despite $2.62B available

**Symptom:** Essential RAM target is 1024 GB. Money is $2.62B. Reserve is $406M. $1.59B already spent on home RAM. But home is still 512 GB.
**Root cause:** The ram-manager (`Tasks/ram-manager.js`) requires money > reserve + upgrade cost. The essential upgrade needs $627.65M (from spending plan). Available = $2.62B - $406M = $2.21B, which should be sufficient. But the upgrade hasn't triggered.
**Possible causes:**
- The daemon (pid 248, dead) was the ram-manager's owner or trigger. Without the daemon, the ram-manager may not be invoked.
- The spending plan says "Limit infrastructure reinvestment while Bladeburner is the selected route" — the bladeburner route may be throttling RAM spending.
- The automation manager (pid 201792) may need to explicitly invoke the ram-manager.
**Missing scripts:** sleeve.js, health-manager.js, work-for-factions.js cannot run (RAM constraint).
**Resolution:** Either (a) restart the daemon, (b) invoke ram-manager manually, (c) relax the bladeburner route throttle, or (d) kill bladeburner to free 129.85 GB and let the daemon start.

### O3 — P2 (High): Infiltration interrupted — blocks SOA and Stanek

**Symptom:** Infiltration status is "interrupted" at Blade Industries. SOA (Singularity of Awareness) status is "waiting-for-infiltration". Stanek is in "waiting" mode with 8 pending fragments.
**Root cause:** Infiltration was interrupted (likely by a script restart or RAM reallocation). SOA depends on infiltration to progress. Stanek depends on SOA.
**Impact:** SOA cannot progress. Stanek fragment charging is stalled. Charisma XP (2.4M) may be affected.
**Resolution:** Restart infiltration. The infiltration script (pid 45) should retry automatically, but may need manual intervention if it's stuck.

### O4 — P2 (High): go.js board snapshot failing — RAM constraint

**Symptom:** go.js (pid 203759) repeatedly fails to run a temp script (`go-board-snapshot.txt.*.js`) requiring 61.6 GB RAM. Home only has 36.9 GB free. Error is caught and suppressed. go.js sleeps 10s and retries.
**Root cause:** Board snapshot analysis script is too large for available RAM.
**Impact:** Go automation cannot perform board analysis. CPU wasted on retry loop. 6 warnings in diagnostic log.
**Resolution:** Reduce board snapshot scope, or check available RAM before attempting and skip gracefully with a prominent log. Partly a consequence of O1 (daemon dead, RAM shortage).

### O5 — P2 (High): Hash spender unkillable via bridge

**Symptom:** `spend-hacknet-hashes.js` (pid 210220, args `['--liquidate']`) cannot be stopped via the bridge. `stop` is ineffective (unmanaged script). Bridge allowlist has no `kill` or `write` commands.
**Current state:** In healthy "Sell for Money" mode (1 hash at $250k, 2.314 hashes/s). Capacity 66,048.
**Prior damage:** `--liquidate` flag caused net loss of -$345M (2,505 purchases / 10,020 hashes, capacity 16,384→33,280→66,048).
**Resolution:** Kill pid 210220 in-game. Or add `kill` to bridge allowlist. The spender is currently in healthy mode but cannot be controlled remotely.

### O6 — P3 (Medium): Stock manipulation broken — daemon dead

**Symptom:** Stock manipulation status: "missing-or-malformed" (pid 248, daemon dead). No stock manipulation happening.
**Root cause:** Stock manipulation depends on the daemon (pid 248). Daemon is dead (O1).
**Impact:** Stock market income (historically $7.99M) is not being actively managed. The daemon's stock manipulation module is offline.
**Resolution:** Restart daemon (blocked by O1/O2).

### O7 — P3 (Medium): HGW timing warnings dormant — will resume when daemon restarts

**Symptom:** HGW timing warnings (511-570ms on joesguns/sigma-cosmetics vs 500ms threshold) are not appearing because the daemon is dead.
**Last known metrics:** 15,036 operations, 435 deadline overruns (2.9%), 45 unavoidable, 492 compensated starts, 0 errors, normal pacing (1.96 completions/s).
**Assessment:** Previously judged as host-load jitter, not a defect. Self-correcting via compensated starts.
**Resolution:** When daemon restarts, re-verify HGW metrics. If deadline overruns exceed 5% or errors appear, investigate.

### O8 — P3 (Medium): No MAX_RAM achievement goal — RAM growth not tracked

**Symptom:** Achievement manager (pid 250) does not track MAX_RAM as a goal. The goals list includes finance, stats, debt, xp, combat, karma, reputation, intelligence, bankBladeburnerPoints, goStreak, goFailure, but no MAX_RAM.
**Impact:** The achievement system never triggers home RAM upgrades. Even if it did, the ram-manager's money gate might block it.
**Resolution:** Add MAX_RAM to achievement goals. Or rely on the spending plan's essential RAM target instead.

### O9 — P4 (Low): Infiltration script stuck — may need manual restart

**Symptom:** Infiltration script (pid 45) shows status "interrupted" at Blade Industries. The script may be stuck or waiting for a retry.
**Root cause:** Unknown — possibly a script restart, RAM reallocation, or an error during infiltration.
**Impact:** SOA blocked (O3). Stanek stalled. Charisma XP not progressing.
**Resolution:** Check infiltration script logs. Restart if needed.

### O10 — P4 (Low): Essential RAM missing 3 scripts

**Symptom:** The spending plan lists 3 missing scripts for essential RAM: sleeve.js, health-manager.js, work-for-factions.js. These cannot run due to RAM constraints.
**Impact:** Sleeve management, health management, and faction work are not running. This affects XP gain, augmentation purchasing, and faction reputation.
**Resolution:** Grow home RAM (O1/O2) to accommodate these scripts.

### O11 — P4 (Low): Automation manager owner pid 201792 — verify it's the right process

**Symptom:** The automation status shows ownerPid 201792. This is different from the daemon (pid 248, dead). The automation manager appears to be running but may be a different script.
**Assessment:** The automation manager is managing the spending plan, achievement goals, and HGW pacing. It appears healthy (reliabilityError: None, achievementError: None).
**Resolution:** No action needed. Verify pid 201792 is the expected automation manager.

### O12 — P4 (Low): Hacking income very low — $5.38M total since start

**Symptom:** Money sources show hacking income of only $5.38M since start. The bulk of income comes from hacknet ($8.42B gross, -$14.16B expenses), casino ($10.1B), and darknet ($375M).
**Root cause:** Hacking income is low because the daemon (which manages HGW target optimization and batch scheduling) is dead. bootstrap-hacking.js is running but may not be as efficient.
**Impact:** Primary income source (hacknet) is running at a loss (-$5.74B net). Casino and darknet are the main profit sources.
**Resolution:** Restart daemon to optimize hacking targets and improve HGW efficiency.

## Summary Table

| ID | Priority | Issue | Status | Blocked By |
|----|----------|-------|--------|------------|
| O1 | P1 | Daemon dead (insufficient RAM) | Open | RAM (512 GB) |
| O2 | P1 | Home RAM stuck at 512 GB | Open | Daemon (O1) or bladeburner route throttle |
| O3 | P2 | Infiltration interrupted | Open | Unknown (likely script restart) |
| O4 | P2 | go.js board snapshot failing | Open | RAM (36.9 GB free) |
| O5 | P2 | Hash spender unkillable | Open | Bridge allowlist (no kill/write) |
| O6 | P3 | Stock manipulation broken | Open | Daemon (O1) |
| O7 | P3 | HGW warnings dormant | Dormant | Daemon (O1) |
| O8 | P3 | No MAX_RAM achievement goal | Open | Code change needed |
| O9 | P4 | Infiltration script stuck | Open | Unknown |
| O10 | P4 | 3 essential scripts missing | Open | RAM (O1/O2) |
| O11 | P4 | Automation manager pid verify | Info | None |
| O12 | P4 | Low hacking income | Open | Daemon (O1) |

## Recommendations (Priority Order)

1. **Kill bladeburner (pid 1531185)** — frees 129.85 GB immediately. This would allow the daemon to start (needs 266 GB, 512 - 129.85 = 382 GB available, still short of 266 + 200 reserve). Actually, 512 - 129.85 - 200 = 182 GB, still short of 266. Need to either relax reserve or grow RAM.
2. **Grow home RAM** — essential target 1024 GB. At $665k/s, need $2-3B more (3-4.5 hours). Or relax the 200 GB reserve temporarily.
3. **Restart infiltration** — unblocks SOA and Stanek.
4. **Fix go.js** — add RAM check before board snapshot.
5. **Kill hash spender in-game** — stops the unkillable process.
6. **Add MAX_RAM to achievement goals** — tracks RAM growth.
7. **Re-verify after RAM growth** — restart daemon, check HGW, stock manipulation, hacking income.

---

*Operational audit complete. No code changes made — findings documented for future implementation.*
