# Remaining automation

Autopilot launches `soa-manager.js`: joins Shadows of Anarchy after an infiltration invitation, buys its unique upgrades with fresh money/reputation requirements and prerequisites, and queues them for the usual augmentation installation. Successful infiltrations already award SoA reputation independently of selling or trading information. The regular faction planner keeps SoA separate because its prices use different multipliers.

Stanek creation optimizes the actual grid using a bounded beam search, compares its result with the saved layout, and uses the higher weighted score. Existing grids and charges are preserved. `run optimize-stanek.js` saves a candidate for the next empty grid; `--exhaustive` keeps the research solver available. This heuristic does not guarantee a globally optimal layout.

Go chooses opponents for the current BitNode, using observed wins/losses and accumulated bonus. `--goal` accepts money, speed, hacking, reputation, combat, crime, or hacknet. `--opponent` puts an explicit opponent first; unavailable opponents fall back with a cooldown.

Autopilot publishes one-minute spending allowances after respecting `reserve.txt`. Home RAM, purchased servers, Hacknet, gang equipment, sleeve augmentations and expansion, grafts, SoA purchases, and corporation share buybacks claim their allowance immediately before purchase. Failed attempts conservatively use allowance until the next minute. Corporation operating funds and stock trading capital are separate. Existing local budget limits still apply. Stopped/stale autopilot plans fall back to existing reserve rules. Augmentation resets kill ordinary spenders and bypass expired plans.

Augmentation resets and BitNode departures claim the export bonus when due, then request a local importable save through the connected Remote API service. Binary saves use `.json.gz`, text saves `.json`. Backups are stored in the service's `save-backups` directory, and a matching receipt confirms actual bytes written. Export may open the game's download dialog. An offline service records an unavailable backup after a bounded wait and does not prevent configured progression.

Intelligence farming is disabled by default. Enable using `run autopilot.js --intelligence-farming --intelligence-target 200 --intelligence-max-resets 100 --intelligence-max-minutes 10`. It requires Singularity, intelligence unlocked through BN5 or permanent SF5, a recent reset, and at least ten immediately available faction invitations. Queued augmentations, grafts, program creation, and Black Ops block farming. Options and reset counts survive callbacks; completion resumes autopilot. A blocked/completed session will not repeat in the same BitNode; remove `tasks/intelligence-session.json` deliberately to start a new session. It performs soft resets and is intended for a dedicated session.


## Recovery, updates, and dashboard

Autopilot launches `reliability-manager.js`. It checks controller heartbeats and source/import signatures every ten seconds. It gives new processes two minutes to start, limits recovery to three attempts per script and arguments in fifteen minutes, and preserves the original threads and arguments. Paused managers remain paused. Existing startup logic handles managers that are intentionally absent.

Updates wait for infiltration, casino, grafting, program creation, Black Ops, and reset transitions. Cooperative maintenance prevents a new protected activity from starting while updates are pending. Low RAM postpones replacement. Failures appear in `tasks/reliability-error.json` and the dashboard.

Run `automation-dashboard.js` to display manager health, waiting reasons, pending updates, contract validation/backlog, budget priorities, achievements, and backup state in the terminal. It does not open a tail or navigate the game.

## Contract validation and quarantine

Autopilot launches `contract-validation.js`, which discovers native contract types and validates each supported solver against three disposable native dummy contracts. Only its own dummy files are removed. Real contracts require a passing verdict for the current solver version. Unsupported types remain visible. A failed real answer is quarantined by host, filename, type, input, and solver version in `tasks/contract-quarantine.json`, preventing repeated loss of attempts. Solver changes invalidate old verdicts and quarantine entries.

On October 14, 2026, all 30 native types passed 90 dummy attempts. This does not establish correctness for every possible real input.

## Adaptive funding and backup retention

Spending allowances prioritize corporation startup when eligible and affordable, gang equipment after twenty minutes without territory progress, and BN10 sleeve expansion. High sleeve shock reduces augmentation spending. Total allowances stay within cash after the reserve; existing category and local limits still apply. Reasons are published with the plan.

The local Remote API service rotates verified save backups, retaining twenty recent saves, seven daily representatives, eight weekly representatives, and twelve progression checkpoints. Pinned saves and older saves without trustworthy metadata are preserved. Only recognized regular backup files inside the configured backup directory can be removed; links are skipped. Rotation errors are reported independently of successful save creation. Existing service sessions can use the companion rotation watcher without reconnecting the game.


## Supervisor overhead

Source contents and import lists are cached only within each supervisor pass, so a later pass still discovers every edit. Across the current sixteen managed scripts, this reduces source reads from 145 to 47 per check (68%). Manager status JSON is parsed once per pass. Heartbeat writes are limited to once every ten seconds, comfortably below recovery thresholds. Dead-process observation entries and expired recovery histories are discarded. The terminal dashboard only redraws when its snapshot timestamp changes.


## Recovery hardening

Invalid heartbeat timestamps/signatures require recovery after the startup grace period. A valid recorded process start time preserves that grace across supervisor restarts. Recovery limits apply to each script, arguments, and deployed source signature, so deploying a corrected version does not inherit the previous version's exhausted retry allowance. Dashboard business status belongs to the current PID; stale records from a previous process are shown as awaiting fresh status.

Adaptive gang funding discards observations from previous BitNodes. Contract validation distinguishes a wrong answer or solver exception from a temporary native API error. Temporary errors retry after five minutes; wrong answers stay blocked until the solver version changes. Corrupt validation-cache shapes are rebuilt, and successful catalog scans clear previous availability errors.


## Faster progression

Adaptive resets and bottleneck spending are enabled by default. `--disable-adaptive-resets` restores the count-based reset decision and configured countdown; `--disable-adaptive-spending` retains the base spending weights (unavailable categories still receive no allocation).

The faction manager includes ready augmentation stats, joined-faction reputation, net worth, and candidate costs in its existing output. Successive snapshots estimate cash/reputation gain rates and the next augmentation wait, including unlocked donation alternatives. Candidate bundle costs use conservative price scaling and are estimates, not an exact reoptimized purchase order. Only snapshots from the current augmentation reset, no older than five minutes, are used.

For ordinary runs after thirty minutes, a ready bundle with at least one non-NeuroFlux augmentation can justify an earlier install after ten minutes without bundle growth. Weighted multiplier gains are discounted by half; estimated restart recovery is fifteen minutes (twenty for combat nodes), and projected payback must fit a bounded one-to-four-hour horizon. These assumptions are conservative heuristics, not measured completion-time predictions. BN8 and the first BN9 install keep existing special rules. Critical augmentations, achievement holds, grafts, Black Ops, near-Daedalus conditions, and progression transition checks retain priority.

When useful gains are ready and there is no measured near-term improvement, the installation countdown can shorten to thirty seconds. A nearby candidate receives a bounded wait; growing purchase costs cannot extend an adaptive countdown beyond the configured maximum. Early quick-install logic no longer permanently changes the countdown setting. Observations survive controller updates and are scoped to the augmentation reset.

Cash allocations increase home RAM funding when controller capacity is low, hacking infrastructure when hacking requirements are blocking progression, sleeve/SoA funding when measured reputation waits dominate, and income infrastructure when cash waits dominate. Categories without the required Source File/current BitNode access receive no allocation. Reserves and the separate corporation treasury remain in force. Decisions appear in `tasks/progression-speed.json` and the dashboard.


## Corporation optimization review — October 14, 2026

Pre-TA.II product pricing uses completed sales feedback once per market cycle. It doubles a clearing product's price multiplier to discover a sale boundary, then refines a lower/upper bracket geometrically. Backlogs force price reductions; unavailable production/sales evidence holds the previous price. Multipliers remain bounded, and substantial rating changes discard obsolete bracket bounds. Native TA.II remains preferred when unlocked. This is a feedback heuristic, not an exact reimplementation of the game's optimal-price formula.

Research preserves at least half the current RP pool for the laboratory and TA.I/II purchases. TA.I and II are planned together; optional research waits until native automated pricing is unlocked, then each purchase is capped at twenty percent of current points. Existing prerequisites remain required. This avoids draining the research pool that contributes to production/product quality.

The duplicated production-achievement warehouse expansion and export scheduling were consolidated into one pass after all existing divisions are managed. Custom products, operating reserves, and ownership limits remain protected.

Review verification: 320 project tests, 15 Remote API service tests, and syntax checks for 137 JavaScript files passed. At the live observation, the corporation had Agriculture only and approximately $4.1 million per second operating profit. Product pricing was exercised in local policy tests; it has not yet been measured against a live product division in this save.


## Source-derived corporation strategy

The controller now uses the official dev-branch corporation implementation and documentation as references, while checking the installed API definitions for available fields and unlock names:

- [Division sales implementation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Corporation/Division.ts)
- [Price and markup derivation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/advanced/corporation/optimal-selling-price-market-ta2.md)
- [Supply chain comparisons](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/advanced/corporation/industry-supply-chain.md)
- [Advertising timing](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/advanced/corporation/wilson-analytics-advert.md)

Fresh expansion prioritizes Agriculture, Chemical, and Tobacco. Existing Restaurant divisions and custom products remain managed. New Restaurant and broader industry expansion wait for Tobacco's TA.II stage. Product consumers receive export-route priority over material support consumers. Operating reserves, the configured ownership floor, and existing routes remain protected. Consequently, a high ownership floor can still prevent later venture rounds; the source's advice to accept all four rounds requires choosing a compatible floor deliberately.

Before native TA.II, material pricing uses public business productivity, awareness/popularity, industry advertising factor, demand/competition, and the actual 1% SalesBots bonus to calculate potential sales and a markup premium. Missing market data falls back to safe quality-based pricing. Product markup is hidden by the API; the controller infers it from penalized, uncapped sales only after two consistent observations with stable public inputs, then uses the same pricing formula. Otherwise bounded feedback search remains active. The next-cycle sales quantity is forecast from previous production plus remaining stock; this is not an exact forecast of changing production or export consumption. Native TA.II remains preferred. Market-data unlocks are bought within the growth budget when a product division can use them.

Wilson upgrades now require a product division, are no longer stopped at an arbitrary level 17, and precede queued advert purchases because their effects are not retroactive. Material divisions stop routine adverts at eight unless an active achievement goal requests finance growth. Product adverts are prioritized, and saturated awareness/popularity stops further advertising. Optional research skips automation-only purchases for energy, morale, recruitment, training, and the dashboard; scripted office upkeep already covers those roles. SalesBots upgrade ranking now uses its actual 1% increment.

Formula policies and a Tobacco bootstrap path have local regression coverage. Game files are synced automatically. At the final live inspection only the Remote API agent was running; the automation changes are deployed for the next controller launch, not confirmed running. No controller was forcibly started over that stopped state.


## Manually started infiltration

`infiltration-manager.js` now detects an existing infiltration UI every 200 ms and takes over its puzzle handlers. Manual entry bypasses the automatic location/difficulty/health filters and market-demand cooldown: the controller finishes the location you chose. It claims the existing activity lease, respects pause/reset/casino priority, and uses the existing reward selection (`--faction` or money). It does not travel or stop native work to adopt an existing infiltration.

Run `infiltration-manager.js --manual-only` for passive assistance without starting new infiltrations. Without Singularity the controller automatically operates in this mode; autopilot and daemon may launch it once home RAM reaches 64 GB. With Singularity, the default retains automatic entry at the configured interval while also assisting manual entries. Idle status writes are throttled, and a market cooldown does not block manual detection.


## IPvGO review — October 14, 2026

`go.js --runOnce` starts a new board if the previous game was already finished, then stops after completing one game. An in-progress game is continued. Reset responses must be valid square native boards before opponent selection is reported as successful. `--board-size` accepts 5, 7, 9, or 13 (default 13). Smaller boards may finish sooner, but this review did not benchmark bonus gain per minute or win rates.

Normal cheats reject non-finite or out-of-range success probabilities. Achievement-directed anticheat attempts remain deliberately bounded and disabled during streak goals. Explicit opponent choices remain strict; unavailable choices use the existing cooldown rather than silently changing the requested faction. Legal move/pair validation, pause flags, Source File gating, cache invalidation, and native opponent-result awaiting remain covered by tests.

Go status is refreshed during play and reports recovery errors rather than retaining a stale success record. Verification: 329 project tests, 15 Remote API service tests, and syntax checks for 137 JavaScript files passed. Native script RAM is 8.3 GB. Game files are synced. No Go controller was running during the final live inspection, so no live moves, game resets, or win-rate benchmarks were forced.


## Automatic IPvGO launch

Autopilot now directly supervises `go.js` by default once home has 32 GB RAM and sufficient free memory. It relaunches a missing process during its normal controller checks, including after reset callbacks, honors persistent pause/achievement restrictions, and leaves an existing instance and its arguments intact. `--disable-go` disables this launch. Daemon's competing Go launcher is suppressed when autopilot controls it; daemon used alone can also start Go at 32 GB. Neither path opens a tail. The Go process itself continuously starts subsequent games unless `--runOnce` is configured.


## Investment and share-sale review

Private offer eligibility now uses a minimum raise of $1 billion or five minutes of operating profit, plus the configured ownership floor, rather than comparing an offer with cash remaining after purchases. The controller preserves remaining useful private rounds before IPO. Offers settle for ten market cycles without cumulative growth exceeding 2%; incomplete supply-chain/product stages can wait, but funding waits are capped at thirty minutes. A corporation short of its operating reserve may accept eligible capital immediately. Finance history survives restarts and is scoped to the corporation and BitNode. Missing offer data postpones IPO. After an ownership-blocked round, IPO remains allowed once its valuation threshold is met. The default ownership floor still limits how many private rounds can be accepted; this review does not lower it.

Public share sales can fund a player cash deficit even while the corporation is profitable. The target is the global player reserve plus a $1 billion liquidity cushion. Sales wait if dividends can fill the gap in five minutes, otherwise binary search sizes the smallest block expected to cover the gap using the source's worst-case 0.5% price reduction per million-share batch. Each sale is bounded by one percent of total shares, the ownership floor, the native cooldown, and one trillion shares (below the source quote-loop limit). If those caps prevent raising the entire shortfall, the block is partial. Estimates are conservative, not a guaranteed exact execution quote.

Emergency issuance now chooses the smallest legal ten-million-share multiple that covers the corporation's reserve deficit, capped by native dilution and ownership constraints. Fresh share-price/valuation data determine proceeds; missing valuation uses a discounted price estimate. Buybacks preserve the same $1 billion liquidity cushion and wait an hour after a successful controller sale to avoid immediately spending the raised cash on the shares just sold. Ordinary issuance remains an emergency action, and IPO issues zero shares. Decisions and sale times appear in `tasks/corporation-finance.json` and corporation status.

Reference: [official share pricing and offers](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Corporation/Corporation.ts), [native action constraints](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Corporation/helpers.ts).


## Bladeburner team recruitment

The controller previously never recruited or assigned teams. It now prepares a squad for the next rank-eligible Black Op when a reliable success estimate shows a small team can cross the configured threshold. The official [operation implementation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Bladeburner/Actions/Operation.ts) multiplies success by `(teamCount + 1)^0.05`; the inverse gives the minimum needed team. Wide estimate ranges are rejected until population analysis improves confidence. Existing assignments are restored when the bounded squad cannot help, and already-sufficient solo chances use zero members.

Recruitment requires at least 50% estimated recruitment success, acceptable chaos, no health/stamina recovery, a useful squad shortfall, and budget remaining. It never interrupts active Black Ops and respects UI ownership, pauses, and maintenance. Defaults: `--team-cap 30`, `--recruitment-budget-minutes 10` per rolling hour. `--disable-recruitment` turns off recruitment and automatic next-Black-Op team preparation. Budget records survive script restarts within the BitNode. Squad status appears in `tasks/bladeburner-team.json`.

Teams remain expendable: the official [casualty implementation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Bladeburner/Actions/TeamCasualties.ts) can remove team members even after successful actions. The policy therefore recruits toward a demonstrated threshold, not an unlimited standing army. Ordinary operations retain their existing team assignments. Local tests cover inverse thresholds, bounded squads, assignment restoration, and option validation; live recruitment and casualty rates have not been benchmarked. Total verification: 335 project tests, 15 Remote API tests, and 137 syntax checks passed.


## Stockmarket review

Purchases execute in synchronous native workers that recheck the parent PID, persistent pause, achievement permissions, current reserve, current position/capacity, exact quoted purchase cost (including commission and bid/ask spread), the order allocation, and favorable 4S direction when available. Explicit `--reserve 0` still intentionally overrides the global reserve; ordinary defaults reread the latest reserve inside the worker. Changed quotes that exceed the order allocation are deferred until the next portfolio refresh. Automatic liquidation for 4S access respects pauses and aborts an access purchase when a position cannot be fully sold; explicit liquidation can override a trading pause. Failed buys do not subtract phantom commissions. Native argument values remain strings/numbers/booleans.

Trade receipts measure actual position changes and cash movement. Short-sale cash includes returned collateral and profit/loss rather than incorrectly multiplying the exit price by shares. Failed sales leave positions and profit unchanged; liquidation counts only successful fills and reports failed positions. Ordinary trading refreshes after any successful sale, even when a losing short returns zero/negative cash. Mock short holdings survive refreshes, mock mode never buys missing TIX access, and mock liquidation does not touch real positions.

Strong pre-4S forecast reversals can bypass minimum hold times. Forecast history requirements remain in force; this does not eliminate estimation risk or guarantee gains. Invalid forecasts are not traded. Stock options validate cash fractions, probability margins and history windows. API and 4S purchases recheck pause, ownership, permission and cash reserve immediately before spending. Waiting for TIX now honors pauses and refreshes the heartbeat. Trading reports state, holdings, reserves and session profit in `tasks/stock-status.json`; recovery errors are visible. HUD absence does not stop trading.

Summary tails require explicit `--tail-summary`; forecast files can still be maintained without opening a window. Autopilot waits for the stock script plus 16 GB temporary-worker headroom; daemon's launch requirement is 32 GB free for this worker. Native stock script RAM is currently 12.9 GB. No live trading or liquidation was forced during review. A later Remote API inspection found stockmaster running (PID 202); it was left in place, so the updated main script takes effect on its next restart.

Verification: 345 project tests, 15 Remote API tests and 139 JavaScript syntax checks passed. Reference: [official stock transaction API implementation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/NetscriptFunctions/StockMarket.ts).


## Stanek review

Charging registers with runtime supervision and reports status on the dashboard. The manager refreshes its heartbeat while charging and waiting for maintenance. Active charging workers are cancelled when a persistent pause, achievement restriction, or automation maintenance request arrives; tracked children are also stopped on parent exit. Layout-creation children are tracked during initial setup. Status includes the owning PID, and unexpected errors report recovery instead of leaving an apparently healthy stale status.

Optional Singularity reputation reads now fall back to the configured charge target when access becomes unavailable. Boosters remain excluded from charging, actual charge increases remain required, and peak-charge normalization follows the [official Stanek implementation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/CotMG/StaneksGift.ts). Charging itself requires installed Genesis, as checked by the [native API](https://github.com/bitburner-official/bitburner-src/blob/dev/src/NetscriptFunctions/Stanek.ts).

Forced layout dimensions must be positive integers within the actual gift bounds. Cached layouts are checked against current fragment definitions and geometry before reuse; invalid saved layouts cannot be selected. Layout creation checks pause and maintenance again after optimization and reports unavailable APIs gracefully. Existing layouts remain untouched unless explicit `--clear` is requested. Default tail windows remain closed.

Verification: 348 project tests, 15 Remote API tests, and 139 JavaScript syntax checks passed. Native RAM checks report 7 GB for stanek.js and 4.3 GB for stanek.js.create.js. Stanek was not running at inspection; live charging and layout replacement were not forced. Updated game files are synced.


## Faction automation review

Fixed default forced invitation handling: BN10 includes The Covenant, and eligible gang invitations use a flat list of faction names. Explicit `--force-join` values accept names or arrays, normalize underscores, and override the defaults. The manager uses effective SF4 access, including Source File overrides, before calling Singularity. Existing city-faction exclusion preferences remain in force.

Faction work registers with runtime supervision, refreshes its heartbeat during long work loops, honors persistent pauses and maintenance, and publishes `tasks/faction-work-status.json`. State-changing work commands recheck the parent process, pause, maintenance, activity ownership, and current graft/program work inside the native worker. Invitation acceptance uses the pause/parent checks without requiring an idle player. A blocked crime start returns before computing its sleep duration. Default tails remain closed.

Augmentation purchase workers recheck each native price and available money after the latest global reserve. Reset preparation already clears that reserve deliberately in ascend.js. Donations recalculate the remaining reputation shortfall with current reputation and faction-reputation multiplier, bounded by the planned donation; zero-gain and unaffordable donations are skipped. Purchases and donations honor persistent pauses and the achievement cash-spending restriction. Native membership, prerequisites, and donation eligibility remain authoritative. Formula reference: [official donation calculation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Faction/formulas/donation.ts).

Verification: 354 project tests, 15 Remote API tests, and 141 JavaScript syntax checks passed. Native RAM checks report 4.3 GB for faction-manager.js and work-for-factions.js. Remote API sync reports 110 game files with no pending uploads or errors. Faction work was running at inspection; no donation, augmentation purchase, or reset was forced for testing. Local tests cover default invitations, fresh spending checks, protected work, and serialized native worker execution.
