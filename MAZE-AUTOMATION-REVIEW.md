# Maze (Dark Net labyrinth) automation review

Scope: `darknet-maze.js`, `darknet-labyrinth-policy.js`, `darknet-navigator-policy.js`, the maze
lease/scheduler in `darknet-development-policy.js` / `darknet-node.js`, and the older
`darknet-advanced.js` labyrinth solver.

## Live snapshot (BN11)

- Charisma is 902. Lab requirements are 300 (Normal), 600 (Cruel), 1500 (Merciless), then 2500+;
  the deeper labs are charisma-gated.
- A live navigator is running: `darknet-manager.js` reports Maze `th3_l4byr1nth` with 33 moves,
  2.50 s/move, 1 thread and 2.3 s radar. It is a useful live check of the normal exploration path.
- The manager is alive and darknet exploration is running (`Phishing observed…` and StormSeed work
  lines), and has surfaced at least one adjacent labyrinth.

## Fixed in this pass

1. **A failed thread-resize spawn no longer ends the run.**
   `darknet-maze.js` previously called `ns.spawn(...)` and returned unconditionally. If spawn
   returned 0 (RAM race, host disappeared), the old navigator exited and the maze stopped until a
   manager relaunched it. It now keeps navigating when spawn returns 0, and the outer resize guard
   still defers on a thrown error. Added a regression test.

2. **Resize decisions use the known maze route, not Manhattan distance.**
   The remaining-move estimate for `mazeResizePlan` was `(|dx| + |dy|) / 2`, which undercounts a
   winding path and can reject a thread upgrade that would actually repay its restart and retrace
   cost. It now uses `labyrinthRouteDistance` through the known map when available, falling back to
   Manhattan only when the end is not reachable in the current map.

3. **Navigators start under the scout's lease instead of waiting for re-election.**
   The spawning scout passes its PID to the navigator; the navigator tries its own lease first and
   falls back to the scout's still-valid lease. A resized navigator passes its own old PID the same
   way. This removes the initial idle period before the home manager writes a lease for the new PID,
   while preserving the normal handoff once the manager re-elects. `readMazeLease` already supports
   the explicit owner, so no lease format change was needed.

4. **Thread upgrades no longer wait for the exit to be found.**
   Resizing previously required `state.labEnd`, so a navigator that started with few threads kept
   them for most of the maze until radar found `X`. The resize check now uses the number of mapped but
   unvisited rooms as a conservative lower bound on remaining moves when the end is unknown. Each of
   those rooms needs at least one move, so the existing restart/retrace payback test remains safe
   while allowing an early upgrade. The end-known path still uses the exact map route distance.

5. **Standing Charisma target from installed lab augments.**
   A visible, charisma-blocked labyrinth still takes priority, but when none is adjacent the goal now
   derives the next lab threshold from the installed lab augmentations (`The Broken Wings` → 600,
   … `The Sword` → 4000) via `nextLabCharismaTarget`. `darknet-charisma.js` can therefore train toward
   the next lab without waiting for exploration to surface one. A small-gap crime may be interrupted
   for one bounded burst (≤45 s / $1M, two bursts, 10-minute cooldown) only after confirming the
   course can close the gap; otherwise existing work retains priority.

## Confirmed sound

- Movement accepts only an exact native 3×3 map with the player at the centre, and only coordinates
  matching the issued direction. Ambiguous responses force a fresh `labreport` rather than replaying
  a move.
- The exit `X` is only visible through `labradar` (native `authenticate`/`labreport` hide the end),
  so the radar-first end detection is correct; the movement parser must not try to infer the exit.
- Radar has a 30 s cooldown, a three-move warm-up, reachability counting and a move-vs-radar cost
  check; unproductive scans back off.
- Checkpoints are bounded (4,096 map/visited entries, 1,024 edge counts, 16 recent edges), validated
  against reset and scope, and discarded when local geometry disagrees with the saved map.
- Lease election retains an active or progressing navigator, prefers active/expected-time
  alternatives, expires after 90 s, and only the home manager grants leases.
- Thread sizing picks the least RAM within 10% of the fastest quote; resizing requires the savings to
  beat restart and known retracing with a 1.5× margin, and is refused when the checkpoint copy fails.
- Recovery is bounded (three no-route attempts, eight loop refreshes); completion forces a final
  checkpoint and a credential report.

## Opportunities (not changed)

1. **Duplicate solver.** `darknet-advanced.js` still carries an older `solveLabyrinth` that polls
   position every move, calls radar every eight reports, and has its own 64-move budget. The live
   manager/node branches route labyrinths to `darknet-maze.js` first, so this path is effectively
   legacy/test-only. Removing it (or delegating it to the shared policy) would prevent the two
   solvers diverging.
2. **Map/BFS cap versus very large labs.** `Thread` augmentations can expand the maze well beyond the
   4,096-entry checkpoint and BFS caps; checkpoints then silently stop persisting and long routes may
   exceed the search cap. Relevant only after many Thread stacks, but worth raising with a memory
   bound if that progression is pursued.
3. **No total progress watchdog.** Recovery only counts no-route and loop events. A very large maze
   that keeps finding new cells but never reaches the end can run indefinitely; an optional
   moves-without-new-cells budget would give the manager a bounded retry.
4. **Radar threshold.** When exactly two nearby cells are unknown and radar is slightly slower than a
   move, radar is suppressed even though it could reveal the exit across the 7×7. The current cost
   check is conservative; revisit only with measured radar hit rates.

## Verification

- `node --test tests/darknet-navigator.test.js`: **16 pass, 0 fail**, including the zero-spawn,
  scout-lease handoff and pre-exit resize regressions.
- Full suite: **3,604 tests, 3,594 pass, 0 fail, 10 skipped**.
- `npm run check`: 562 files syntax-clean, 237 deployable, 0 audit problems.
- `darknet-maze.js` is synced; the live navigator for `th3_l4byr1nth` is reporting 2.5 s/move at
  1 thread, so the normal exploration path is exercised, though the maze has not completed yet.
