# Rival attrition warfare

The default `--training-first true` policy blocks early attrition while preparing for at least 75% win chance against every active rival. It requests off for an inherited active attrition lease, while existing residual clash probability still decays normally. Use `--training-first false` to restore optional attrition under the guards below; `--disable-attrition` remains an independent opt-out.

## Mechanics and projection

The official game source applies rival power loss of 1/1.01 on player victories and player power loss of 1/1.008 on defeats. Disabling warfare reduces clash probability by only 0.01 per territory update; it does not remove risk immediately. The ordinary expected-territory projection now includes rival loss from player wins.

Reference: https://github.com/bitburner-official/bitburner-src/blob/dev/src/Gang/Gang.ts

The separate attrition comparison models waiting/development and early engagement over the same retained crew power trajectory, including NPC-versus-NPC encounters in both paths. It includes territory transfer, player/rival power loss, natural rival growth, bonus time and the full residual clash tail. Rival growth uses observed high samples plus a margin and a conservative planning floor of 0.85 power per update. These are expected-value forecasts, not guaranteed outcomes.

## Automatic entry

Attrition requires explicit power priority, adaptive growth, twelve members, a confirmed territory phase, three usable growth samples for every active rival, at least 65% current win chance against every rival, zero residual clash risk, and a development/reset horizon of at least 2,060 wall seconds. A disabled or unavailable feature retains ordinary defensive warfare.

Both comparison paths retain current training and recovery commitments. The attrition path discounts power production for members excluded by existing defense/protected-work rules. Safe readiness must persist for at least three modeled updates. Qualification requires:

- At least 60 seconds and 20% faster safe readiness, plus a six-hour recovery charge per expected extra member death.
- At most 0.02 total expected deaths and 0.005 extra expected deaths versus waiting. Every member is conservatively treated as exposed for the entire tail, even though actual deaths only affect warfare-assigned members.
- At most 0.001 territory loss from the initial position and relative to waiting.
- At least 90% of initial player power throughout and 85% of the waiting path's terminal power.

The forecast assumes up to three engaged updates before switch-off as a scheduling margin, followed by the residual tail. Simulation is bounded to 1,800 modeled updates, 256 baseline points and twelve rivals. Incomplete/malformed forecasts cannot authorize entry. Quotes are evaluated at most once a minute, with a 50 ms budget for the retained crew trajectory.

## Native lease and controls

Immediately before engagement a self-contained native gate checks pause/maintenance permission, the live controller, reset scope, quote age, member signature, current rival set/powers, player power/territory, zero residual risk and prior cooldown. The controller requests switch-off at the first observed territory update or lease expiry (at most 22 seconds). Runtime scheduling can delay observation; this is a best-effort lease, not an engine-level guarantee.

A 45-minute wall-time cooldown persists across controller reloads within the same reset. It prevents repeated early-engagement trials; ordinary defensive warfare remains available when its configured threshold is met. A stopped/orphaned/disabled lease requests warfare off without extending cooldown. Existing member defense filters and protected training/manual work remain authoritative.

Use `--disable-attrition` to opt out. Decisions are recorded in `tasks/gang-attrition-plan.json`, with lease/cooldown state in `tasks/gang-attrition.json`.

## Further improvements

Measure forecast versus realized rival growth and readiness during ordinary warfare before relaxing entry thresholds. A range of rival-growth outcomes would give a stronger uncertainty check than the current expected path. Longer or repeated bursts should not be added until residual-tail and casualty predictions have evidence.


## Sensitivity and observed outcomes

Entry must pass every existing benefit, territory, power and casualty limit at 0.5x, 1x and 2x the rival natural-growth estimate. The baseline comparison remains available in the plan; all three full comparisons are included under `scenarios`. These are sensitivity cases, not statistical confidence bounds.

Each successful native entry carries a small next-update forecast into the lease. On the first observed territory update, the controller appends a diagnostic to `tasks/gang-attrition-observations.json` (at most 64 records within the current reset). It reports own and rival power/territory, baseline errors and whether the net result fell within the scenario range. Partial, delayed or missed intervals and changed active-rival sets are marked unscored. Receipts from other owners or resets are rejected, and each receipt is consumed only once.

Clashes are random. Net changes include NPC clashes, natural growth and intervening management changes; these observations do not prove that player warfare caused a rival loss, validate casualty probabilities, or measure long-term speed gains. Observation errors never relax entry rules. Existing pause checks, defensive warfare, native revalidation, stop conditions and cooldown remain in effect.
