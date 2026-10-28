# Infiltration ownership and rewards

The runner requires a live activity lease owned by its PID and marked `infiltration` before puzzle input, Start or reward selection. Missing, expired, corrupt, foreign and wrong-kind leases interrupt the run. It does not reclaim an expired lease merely because no competing owner is visible. Existing main entry paths claim the lease before calling the runner.

Guard stages keep file writes out of their short response window. Routine refreshes recheck ownership after asynchronous writes, and reward waits check both ownership and infiltration identity before touching the UI.

Faction reward selection waits up to 30 polls at 50 ms for the requested faction and enabled Trade button. A selection event is submitted at most once after acceptance. Buttons are reacquired after rendering; a replaced infiltration cannot receive a stale reward click. If the faction remains unavailable, the existing cash fallback is retained and the result includes `requestedFaction` plus `rewardFallback: faction-not-confirmed`.

Manual and automatic entries share reward precedence:

1. `--money-only` selects cash.
2. An explicit joined `--faction` wins over other defaults.
3. A Red Pill plan can choose Daedalus reputation or funding cash when no faction is explicitly configured.
4. Otherwise, ongoing faction work supplies the default faction, if joined.
5. Unknown or unavailable faction information uses cash. Automatic entry still rejects an explicitly unjoined faction before starting a run.

For manual assistance, optional Singularity work metadata is fetched only on the victory screen. Missing Source File 4 or optional query failures do not block puzzle assistance. A metadata wait can refresh a still-owned lease before UI confirmation, but cannot revive an expired lease.

These changes preserve graft, program-creation, Black Op, route, pause, reset-transition, demand and entry guards. The tests use isolated puzzle/UI models rather than starting real infiltrations. No tails are opened.
