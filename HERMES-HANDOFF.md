# Handoff to Hermes — live test of the Dark Net crack-policy change (23 November 2026)

## Prerequisite

The change set is **uncommitted** in the working tree, so the game still has the old code. `git-pull.js`
pulls from `mpleier/bitburner-scripts` `main`, so it only picks this up after the work is committed and
pushed. Ask for that first (or upload the changed files through your own channel).

Files that must reach the game:

- new: `darknet-crack-policy.js`
- changed: `darknet-node.js`, `darknet-manager.js`, `darknet-throughput-policy.js`, `darknet-charisma.js`, `Tasks/contractor.js.solver.js`
- local only (not in-game): `scripts/api-surface.json`, `scripts/progress-panel.cjs`, the tests

`manual/` is not in `git-pull.js`'s omit list, so the moved diagnostics arrive as `manual/<name>.js`;
`sync-scripts.js` still refuses to copy them to remote hosts. Read-only: no purchases, no resets.

## What to check

1. **Files landed.** `read('darknet-crack-policy.js')` returns the module, and `read('darknet-node.js')`
   contains `const codeFiles = DARKNET_CODE_FILES;`. If either is missing, stop here — nothing else is
   meaningful.
2. **Restart cleanly.** Stop the darknet manager and the scout, let the autopilot start them again.
   Report the first 20 log lines from each; new errors would name `candidatePasswords`,
   `DARKNET_CODE_FILES`, `AUTH_FAILURE` or `RETRY_AFTER_MS`.
3. **Stasis reachability.** `run manual/dw-exec-test.js` (no arguments; it walks `ns.dnet.probe()` and
   prints one row per neighbour with `hasSession`, `online`, `free`, `root`). Cross-check against
   `ns.dnet.getStasisLinkedServers()`: a stasis-linked host must now pass the manager's `executionState`
   gate. If it is still skipped, send the exact `no direct connection` / `session check` log line.
4. **Candidate merge.** Over ~10 minutes, report each host's `tasks/dnet-solver-<host>.json`: attempts, solved,
   and any increase in 401/408 responses. Watch specifically for a host whose answer only appears in
   its hint (the manager now tries those) and for numeric-clue hosts (digits now lead).
5. **RAM.** `ps` for `darkweb` and the manager host; report scout/manager threads and any
   `insufficient RAM` or `waiting for ... RAM` line.
6. **Panel.** On the machine with the bridge: `node scripts/progress-panel.cjs` — it should print
   `bridge: <path>` next to the summary, and the augmentation-basket / hashes cards should render
   rather than fall back to "no basket reported".
7. **Open items from the earlier audit.** Whether `go.js` still fails its board snapshot, whether the
   hash spender still cannot be stopped via the bridge, and whether the augmentation basket is genuinely
   in its casino/seed phase.

## What to send back

For each check: the command, the raw output (log lines with timestamps or the JSON snippet), and a
one-line verdict. Anything that throws should include the full stack-trace line. If something regresses,
revert the commit locally and push, then run `git-pull.js` again (`--download [files]` limits it to the
named files); `git-pull.js` pins to the branch head, so there is no in-game way to roll back to an older
commit. Credential and candidate files are never overwritten by an update.
