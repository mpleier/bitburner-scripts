# Gang power growth

Power-focused development activates below the configured safe clash threshold once the territory phase is known and growth observations exist for the strongest rival. It automatically stops favoring power investments once that threshold is met. Explicit money-focus and legacy mode do not enable the power objective. Default automation, manual task overrides and existing pause/maintenance controls remain applicable.

## Training and ascension
A bounded whole-crew simulation can select training or ascension with lower immediate income when the completed fixed-territory forecast repays its lost power inside the actual planning horizon. Crew output may fall by at most 10% against the comparison baseline. Recruitment and augmentation readiness retain their existing milestone guards. Ascension is compared against continued work and matched training without a reset. Partial trajectories cannot authorize actions. Eligibility accounts for all six skill contributions, rather than only crime task weights.

## Equipment
Focused quotes rank direct power per dollar. A power-only item must cost at most 1% of current unreserved money, fit its temporary lifetime, and fit the shared category and progression budgets. Pure power bundles are not authorized. Cheap items are valued during power focus instead of bypassing comparison. Native purchase workers recheck quote age, reset scope, faction, cash reserve, price, current power, territory, rival power, ownership and actual equipment skill improvement. Existing augmentation savings checks still apply. Temporary equipment is not promised to survive an ascension.

## Training during power ticks
Optional trainees can participate in brief warfare pulses only at zero current or residual clash exposure. Explicit manual jobs, wanted preparation and ascension recovery remain protected. Selection compares immediate power against a conservative rounded skill-loss bound over the full planning horizon; it does not assume missed training is free. The native assignment worker rechecks clash exposure immediately before switching a trainee. The next management pass restores training, retaining its existing deadline.

## Territory scenario
Forecasts retain fixed territory as their authorization baseline. A bounded expected-territory scenario can rank already-qualified power plans. It includes the native territory multiplier, power-dependent territory exchange, observed opponent power growth and expected power loss on failed clashes. Unknown NPC-to-NPC territory evolution and stochastic deaths are not predicted. Limited or invalid scenarios do not rank plans. The scenario is an estimate, not a guaranteed conquest time or income forecast.

## Diagnostics
Gang training, ascension and equipment diagnostics include power objective, power gain, power payback and estimated safe-clash time savings where available. Selected development forecasts also expose the conditional territory scenario. Internal simulation traces are removed before persistence to keep diagnostics bounded.

`tasks/gang-growth.json` reports whether power focus was active for its latest equipment valuation pass.

## Territory conquest and verification

Explicit `--power-focus` remains active after training-first readiness is reached. Readiness still targets at least 75%; training, equipment and ascension forecasts retain their production, payback, milestone and cash-reserve checks. Balanced mode can stop power prioritization at readiness.

Ordinary safe warfare can continue through ascension when a fresh native rival snapshot meets the configured ordinary threshold (at least 70%). The member must first move to training. Unknown odds, unsafe odds and failed training confirmation disable warfare. Conditional aggression never qualifies for this exception. The controller also checks disabled warfare every two seconds, subject to the existing pause, maintenance, profile and clash-safety rules.

Completion uses remaining positive rival territory, avoiding premature completion from rounding player territory. Missing or malformed observations never establish completion.

Local diagnostic files are observational and do not grant permission to enable warfare:
- `tasks/gang-warfare-decision.json`: latest native request, confirmed engagement and decision reason.
- `tasks/gang-warfare-supervisor.json`: last independent supervisor suspension, including its reason and timestamp; an old record is not current suspension evidence.
- `tasks/gang-power-pulses.json`: up to twelve recent update observations with expected/actual pulse members, predicted/observed power, lead time and classification. Clash-confounded observations do not calibrate timing. Already assigned crews still get a native pulse snapshot.

Three consecutive verified flat/mismatched pulses produce a rate-limited script-log warning. Failed pulses widen timing padding; padding contracts only following a confirmed power increase. No tails open automatically.

See [optional trainee power pulses](GANG-OPTIONAL-PULSES.md) for guarded participation during active clashes, the shared one-trainee risk allowance, atomic preparation snapshots, and whole-rival-group diagnostics.
