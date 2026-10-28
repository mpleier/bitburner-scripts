# Bladeburner rank speed planning

## Duration boundaries

The bounded level planner supplements its existing grid with binary searches immediately before native duration jumps. Up to eight promising cached seeds are considered, with duplicate durations skipped. All probes share the existing maximum of 128 per action, preserve success/stamina checks, and restore the live action level even on interruption. No higher-risk action threshold is introduced.

## Overclock bundles

The farming-throughput selector compares native prices for affordable Overclock bundles against ordinary one-level upgrades. It can cross integer action-time plateaus that give a single upgrade zero immediate value. Quotes are bounded by Overclock's level-90 cap and cached only inside one synchronous purchase batch. Before purchase, the worker rechecks ownership/protection, current points, cap and the native total cost; one native multi-level upgrade performs the purchase. Optional API failure retains single-level behavior.

The hash-funded skill goal uses the same selector and native bundle price. Bundle goals retain a string skill name and add an optional `count` field. Skill spending still banks points when no useful upgrade is known and stops after max-stamina-affecting upgrades until the engine refreshes stamina.

## Growth detour rank cost

Pre-gate stat development must pass the existing competence/training-budget checks plus a short rank-cost comparison. The comparison uses finite-horizon completions, reserved stock, bonus time, maintenance and any explicitly modeled fallback mission. Its rank baseline is the alternative rank action, rather than the slower observed growth action's ETA.

When a valid stat ETA exists, a slower rank action must improve estimated Black Op readiness by at least one second. Local stat advancement is capped to the planning interval, never extrapolated to unlimited growth. Without a usable stat ETA, the candidate must retain at least 95% of the alternative's rank throughput and add no more than the smaller of 30 seconds or 5% of remaining rank runway. Unpriced sacrifices are declined. These are conditional planning estimates, not guaranteed completion times. After the rank gate, ordinary capability development retains its existing policy.

## Switch hysteresis

Routine cross-action combat switches price unfinished repeat progress and a bounded switching allowance. During the first minute, the candidate must improve the selected rank/growth objective by at least 10% and repay the switch within the evaluation window. After a stable minute, the margin relaxes to 1% with a longer payback window so small sustained gains are not ignored indefinitely.

Recovery, high-chaos cleanup, Black Ops and unsafe incumbent chances bypass hysteresis. Rank comparisons use a fresh native action-level/metric snapshot. Growth comparisons are used only when the quoted level matches the current level. Unknown comparison data leaves the existing selection behavior intact. Same-action level changes retain their existing completion-boundary and native start checks.

## Diagnostics and limits

The existing Bladeburner development record adds `rankDetour`, including the estimated delay and rejection/acceptance reason. Existing reserve, pause, Source File, protected-work, Black Op risk and team constraints remain in force. No tails are opened.

Offline regression examples recover the exhaustive level-149 optimum missed by the previous coarse search, and a multi-level Overclock purchase that lowers a rounded 32-second action to 31 seconds. These do not establish a live speed percentage.

Next candidates: adaptive growth horizons for missions longer than the current 30-second window, bounded mastery look-ahead for future action-level unlocks, and preserving useful rank-rate history across isolated failed missions while separating one-time rank rewards.
