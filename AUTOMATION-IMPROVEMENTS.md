# Automation improvement proposals

Live audit of the running game (BN11, 2026-10-30 ~02:35) plus the current code. These are
opportunities, not defects: each one is a deliberate trade-off I did not change without your call.

## Current snapshot

| Signal | Value |
|---|---|
| BitNode / hacking | BN11, hacking 355, intelligence 165 |
| XP rate | ~741/sec (HUD); daemon log shows ~1.4 XP/thread/sec × ~547 hack threads |
| Home RAM | 2,048 GB max, 857 GB used, ~1.19 TB free |
| Network RAM | 76 servers, 6.17 TB total, ~37% used at screenshot time (≈3.9 TB free) |
| Hacking mode | `daemon.js --xp-only --no-share`; 2 targets (`joesguns`, `foodnstuff`) |
| HGW health | 3,558 operations, 2,455 late (69%), 431 spacing risks (12%), backoff 3.2×, cycle 51.2 s |
| Route | hacking, both route ETAs unknown ("Join Daedalus or acquire The Red Pill…"); `xpMeasurement:null` |
| Spending | all discretionary allowances 0 except corporation 9.08e9; corp startup target 150e9 |
| Gang | not created yet; karma -34,020 vs -54,000 required (~3 h at recent crime rate) |
| Stanek | no process; script exits only at max charge (120) or layout/blocked error |

## P1. Use the idle hosts for XP (highest expected gain)

**Evidence**
- Daemon log: `Targeting: 2 servers`, `16 skipped for now (time, RAM, or target + prepping cap reached)`.
- `farmHackXp` sets `numTargets = min(maxTargets, hosts>1% home RAM)`; `maxTargets` defaults to
  `2 + round(totalNetworkRam / 500 TB)` → 2 with 6.17 TB of network RAM.
- Hack workers cannot spread across hosts (`threadSpreadingAllowed` is false for hack, unlike grow),
  so each target is limited to one host; ~1.19 TB home free but ~3.9 TB network free.

**Proposal**
1. Have autopilot pass `--initial-max-targets 6–10` when it selects `--xp-only` (or scale it from
   free RAM/hosts), then measure XP rate. This uses more hosts without changing batch timing.
2. Separately prototype allowing hack thread spreading in XP-only mode (as grow already does),
   so cloud-server RAM can host extra hack threads. Measure timing risk before enabling by default.

**Expected:** roughly proportional XP gain until CPU/latency saturates — likely +50–100% from more
targets, potentially more with spreading. **Effort:** small (option/autopilot); spreading is a
medium-risk experiment.

## P2. Auto-tune the queue delay from measured start lateness

**Evidence**
- Every recent grow/weaken worker starts **2.5–5.4 s after its planned start**
  (`startLateMs` ≈ `unavoidableMs`), while hack legs are on time.
- `queueMs` is 3.2 s (base 1 s × pacing 3.2). The daemon issues the legs sequentially, so later legs
  miss their planned starts; this drives the 69% late fraction and may keep the pacing multiplier high.

**Proposal**
Feed the observed `startLateMs` back into a dedicated queue-delay controller (e.g. target the 90th
percentile start lateness + margin) instead of tying it only to the cycle backoff. Alternatively,
raise `--queue-delay` to ~6 s and compare the late/risk fractions and cycle length.

**Expected:** fewer late legs, faster recovery to a smaller cycle; likely +10–30% XP at the same
thread count. **Risk:** a longer queue delays batches if the launcher is fast. **Effort:** small
tuning; medium for a controller.

## P3. Corporation startup reservation — addressed (low priority)

**Original evidence**
- The spending plan reserved **all** free cash for corporation startup: `corporation 9.08e9`, every
  other allowance 0 (`home`, `servers`, `hacknet`, `gang`, `sleeves`, `graft`, `soa`, `training`).
- It only launches `corporation-manager.js` once `player.money >= 150e9` (`autopilot.js:779-780`).
- At the measured ~120,551 $/s, the remaining 141e9 was ≈ **13.5 days** of frozen discretionary
  spending; BN11's `CorporationValuation` multiplier is only **0.1**.

**Implemented**
- `spendingPlan` no longer gives corporation startup a priority branch. Corporation competes at its
  normal lowest weight (2%) until unreserved cash already covers the $150b self-fund; only then is
  the full cost set aside. Other managers keep their normal allowances throughout.
- Live check after the reload: `corporationStartupReserve: 0`, corporation allowance 0.38e9, and
  home/servers/hacknet/gang/sleeves/graft/soa allowances restored (19.2e9 distributed), with the
  reason "Corporation startup is low priority until its full cost is affordable".
- `README-AUTOMATION.md` now documents the opportunistic behaviour. Tests updated in
  `tests/corporation-priority.test.js`.
- Hash policy is aligned too: corporation startup is no longer a hash cash goal (`cashGoal` is now
  only augmentation or casino bootstrap), and the stock reserve is only relaxed for a funded
  corporation hold.
- Tests updated in `tests/hash-spending.test.js`; the probe-route gate now uses the committed route.

## P4. Give the route planner real XP/ETA evidence

**Evidence**
- `automation.performance progression`: both routes report `etaMs:null`; the reason is missing
  measured progression, not missing data files. `xpMeasurement` is `null` and the only trigger for a
  measurement is the manual `measurement.xp` Remote API command.
- Route choice/install timing therefore fall back to priors.

**Proposal**
Schedule a short, bounded XP measurement automatically after a reset (or once per N hours) via the
same receipt flow, and/or derive XP rate continuously from `player.exp.hacking` deltas published by
the daemon. The planner already consumes `xpModes.xp.rate`; it just rarely has it.

**Expected:** actual WD/Bladeburner ETAs, better install/augmentation decisions. **Effort:** medium.

## P5. Opportunistic use of spare CPU/RAM (optional)

- `share` is disabled in XP mode (`--no-share`) to protect RAM for XP, but if XP only uses part of
  the network, share threads could fund faction reputation for augmentations. Evaluate only after P1.
- `farm-intelligence.js` exists but is not running; with a long BN11 run and idle RAM, a bounded
  intelligence session could add a small permanent XP multiplier. Low priority.

## What is already healthy (no change)

- **Stanek**: no running process is expected after all fragments reach `--max-charges 120`; the
  script writes `tasks/stanek-status.json` `mode: complete`. Check that file before treating it as a gap.
- **Gang**: gates are behaving as designed — karma must reach -54,000 in this BN; the crime/sleeve
  automation is already moving it (~7k karma/hour recently), so creation is ~3 hours away.
- **Hash spending**: 6,245 `Sell for Money` purchases (~$6.2b) are being used to fund the corporation
  goal above; that is consistent, not a leak.
- **No stale automation code**: controllers reloaded after the fixes; live file hashes match local.

## Suggested order

1. P1 target cap (safe, measurable in minutes) → measure XP/sec.
2. P2 queue delay (safe tuning) → measure late/risk fractions.
3. P3 done: corporation startup is low priority; discretionary budgets are live again.
4. P4 XP evidence (bigger feature).
5. P5 only if RAM remains idle after P1.

P1 and P2 are the remaining technical changes; I can implement them and run a before/after XP
measurement in the live game.

## Round 2 — after the latest augmentation reset

Live state: hacking 127, charisma 288, home RAM 4,096, money 8.57e9 with an 8e9 reserve, gang created
(karma -54,077), and `daemon.js` back to normal pacing (`cycleMs 4,000`, `queueMs 1,000`,
`targetCap 5`). P1/P2 measurements from the previous run are stale; the next run should re-measure.

1. **The standing Charisma goal is blocked by `work-for-factions`.**
   The new goal is working — the manager logged `Dark Net Charisma: 287/300 for the next labyrinth` —
   but the trainer immediately deferred with `Existing player work has priority`. The player is on
   Mug for combat stats. The result is that a 13-point gap to the Normal lab remains untrained.
   **Implemented:** `darknet-charisma.js` now allows a bounded interrupt of a crime when the gap is
   at most 5% of the target, gang karma is already met, and no casino/ascend/augmentation/Bladeburner
   transition is active. The interrupt has its own budget: at most **45 seconds and $1M per target,
   two bursts / 90 seconds total, with a 10-minute cooldown**, and it must still fit inside the
   existing 600 s / $5M study budget. It only stops the crime after confirming that one short course
   can close the gap, and only if passive gain would not close it within 60 seconds; otherwise it
   reports `passive` and leaves work alone.

2. **Gang “collect all equipment” is now opt-in (was the dominant budget).**
   It previously defaulted on: `signals.gangEquipmentPriority` reported 70–84 items / ~1.1e12 and the
   plan gave gang ~2.1e9 while sleeves/graft/SoA received a few million. `gangs.js` now defaults
   `--prioritize-all-equipment` to **false**, so the normal per-tick budgets (0.2% equipment / 20%
   augmentation) apply. Live post-reload: `gangEquipmentPriority:null`, `protectedGangCash:0`, gang
   allowance **55e6** and home/servers/sleeves/graft/SoA restored. Pass the flag explicitly if the
   long-term full-catalogue goal is deliberate.

3. **XP target count still deserves a measured test.**
   At this reset `targetCap` is 5, but the daemon log still targets only two servers. Raising
   `--initial-max-targets` (or auto-sizing it from free RAM/hosts) remains the cheapest XP test once
   the reset settles; measure XP/sec before and after rather than assuming the old numbers apply.

4. **Queue/launch latency was reset with the daemon.**
   The 3.2 s queue / 69% late-operations pattern from the prior run is gone (new pacing starts at
   1 s), so a fresh measurement is needed before changing queue delay. Add the adaptive queue
   controller only if the late fraction reappears at scale.

5. **Maze and late-game limits remain.**
   The dedicated navigator now has pre-exit thread upgrades and lease handoff; the remaining maze
   opportunities are the legacy `solveLabyrinth` duplicate and the 4,096-entry map/BFS cap for
   `Thread`-expanded labs.

6. **Bladeburner team trial implemented.**
   The preparation window now follows `--recruitment-budget-minutes` (10 minutes by default) instead
   of only the last two minutes. While the next Black Op rank gate is still far away, the controller
   recruits up to `--team-trial-size` (default 2) members and lets `planBladeburnerTeams` use them on
   Operations; trial members are not reserved for the future Black Op until the preparation window
   opens. Live check: the controller switched to Recruitment twice, then returned to Retirement with
   the two members available. Set `--team-trial-size 0` to disable the trial.

7. **IPvGO search challenger tuned.**
   Defaults are now `--search-ms 20` / `--search-nodes 256` (was 5/64), and the private search broadens
   to ten root moves and six replies (was six/four). Auto mode also samples the challenger every four
   completions until it has six search results, then returns to the eight-game cadence. This gives the
   search engine a fair test without changing tactical play outside trials. Live `go.js` restarted on
   the new configuration.

8. **Progression speed knobs tightened.**
   HGW latency floors now use a 4× rather than 8× late-leg factor, are capped at 8× the base cycle,
   and restored pacing is capped the same way. Recovery now treats ≤5% spacing risk as eligible for
   a clean window, so isolated 2–4% risks no longer reset recovery forever. XP-only mode keeps at least four targets available
   (`--initial-max-targets` default and explicit values still win). Bladeburner is only disabled on a
   hacking route when **The Blade's Simulacrum is not installed**; with it installed, Bladeburner no
   longer blocks faction work and is left running. A stale-install fallback (`--stale-install-hours`,
   default 2) installs at least one affordable augmentation if the count has stalled.
   Autopilot now starts `work-for-factions.js` even while another activity lock exists; the script
   waits internally and takes over when focus frees, instead of starving faction reputation behind a
   transient lock. A read-only `automation.activity` query exposes the lock owner and current work.
   Live after the daemon restart: cycle 32 s (was 43 s in the same window), four XP targets active,
   16 worker processes.

9. **Labyrinth reward cache claimed on completion.**
   The maze navigator now checks both the labyrinth host and its own host for `.cache` files after a
   successful solve, starts `darknet-cache.js` on the host holding one, and falls back to
   `openCache` when it is already on that host. The scout's normal cache sweep remains the fallback.

Small fix included: the standing Charisma target now counts `The Red Pill` in BitNode 15, where it
advances the lab sequence; non-BN15 counting is unchanged.

