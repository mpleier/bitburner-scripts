# Hermes review — improvements, and what was done (23 November 2026)

The list below started as code evidence from this checkout and has been implemented where the code
could settle it. The running save is still not reachable from here, so the live checks at the bottom
remain open for Hermes.

## P1 — shared cracking policy — **done (ordering and deploy list)**

`darknet-crack-policy.js` now owns the three pieces that used to exist twice:

- `AUTH_FAILURE` (401), `TIMED_OUT` (408) and `RETRY_AFTER_MS` — one definition instead of two.
- `DARKNET_CODE_FILES` — the deploy list both entrypoints sync. It used to be two 30-entry literals
  that had drifted; `darknet-crack-policy.js` itself is in the list, so a new dependency is one edit.
- `candidatePasswords(details, words, {stated})` — the ordered candidate list. The scout and the
  coordinator now differ only in whether they pass a stated password from the heartbleed logs. The
  merged ordering is the scout's (digits dug out of the clue lead on numeric hosts) and it includes
  the hint candidates the coordinator was missing, so a puzzle whose answer only appeared in the hint
  is no longer skipped by the manager.

`darknet-node.js` and `darknet-manager.js` keep thin `candidatesFor` wrappers, so their call sites and
the behaviour tests around them are unchanged (`candidatesFor(details, candidates, host)` still feeds
`statedPasswordFromLogs`).

**Still open:** the authentication loops themselves (`tryPassword`, `tryPasswordBatch`,
`trySavedPassword`, `authenticate`) are genuinely different — worker delegation and maze leases in the
scout, native calls and a turn budget in the coordinator. Merging them is a behaviour change that
needs the running game, so they stay separate for now.

## P2 — hand-run diagnostics out of the deployed set — **done**

55 one-off scripts (`dw-*`, `probe-*`, `dnet-*`, `debug-maze.js`, `find-maze-host.js`,
`labyrinth-probe.js`, `copy-dw-debug.js`, …) moved to `manual/`, which `sync-scripts.js` already
skips. `dw-ensure-stasis.js` and `dw-probe-neighbours.js` stayed at the root because
`darknet-labyrinth-connector.js` runs them.

Deployable files: 318 → 264 (55 moved out, one policy module added). The operator tools are still in
the repository, just no longer copied to every host; run them as `manual/dw-exec-test.js` after
uploading the folder to the game.

## P3 — panel bridge path — **done**

`scripts/progress-panel.cjs` now reads `process.env.HERMES_BRIDGE` and falls back to the original
`C:/Users/mplei/Documents/Codex/bitburner-remote-api`, and prints `bridge: <resolved path>` next to
the panel summary so a failed refresh shows where it looked.

## P4 — snapshot provenance — **done**

`scripts/generate-api-surface.js` writes the input path as `source` (a label can be passed as the
third argument), and `scripts/api-surface.json` now reads
`bitburner-official/bitburner-src dev @ 0c65cfb1 src/ScriptEditor/NetscriptDefinitions.d.ts`,
matching the `sha256` it already carried.

## Tests changed with the move

Five assertions in `tests/darknet-*.test.js` used to grep the entrypoint sources for the deploy list
or for the candidate filter. They now assert the same properties against `darknet-crack-policy.js` /
`DARKNET_CODE_FILES`, plus a new `tests/darknet-crack-policy.test.js` covering the ordering (stated
password first, digits first on numeric hosts, length/format filtering, blank password).

## Checks run

- `node scripts/check-syntax.js`: 738 files pass.
- `node scripts/audit-project.js all`: 264 deployable files, 0 problems.
- `node --test tests/darknet-*.test.js tests/*contract*.test.js`: 337 pass.
- `node --test tests/`: 4071 tests, 0 fail.

Not verified: no game instance here, so RAM accounting, the native compile and the live behaviour of
the merged candidate ordering still need a run in Bitburner.

## Checks only the game can answer

1. **Stasis fix.** On a stasis-linked host: does `ns.dnet.getStasisLinkedServers()` list it, and does
   `manual/dw-exec-test.js` report a session and free RAM for it, where the manager previously said
   `not directly connected`?
2. **Merged candidates.** After the first rotation, do the per-host `tasks/dnet-solver-<host>.json` files show more solved
   hosts (hint-only and numeric-clue puzzles in particular), and any host that now burns attempts it
   did not before?
3. **RAM.** The panel showed 1,867 / 2,048 GB with 0 waiting; is the darknet scout still placed?
4. **Augmentation basket** empty — casino/seed phase, or never published?
5. **Hashes 0 with 12,113 rewards bought** — deliberate or a stuck spender?
6. **O4/O5** — `go.js` board snapshot and the hash spender still failing?

Paste the answers and I'll fold them into the remaining P1 work (the authentication loops).
