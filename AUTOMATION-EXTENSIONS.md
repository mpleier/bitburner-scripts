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

Wilson upgrades now require a product division, are no longer stopped at an arbitrary level 17, and precede queued advert purchases because their effects are not retroactive. Material divisions stop routine adverts at eight unless an active achievement goal requests finance growth. Product adverts are prioritized, and saturated awareness/popularity stops further advertising. Automatic energy/morale research is now evaluated for useful offices after TA.II; recruitment, training, and dashboard research remain skipped. See the growth optimization implementation below. SalesBots upgrade ranking now uses its actual 1% increment.

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


## Hacknet review

Production upgrade selection uses separate [money-node formulas](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Hacknet/formulas/HacknetNodes.ts) and [server hash formulas](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Hacknet/formulas/HacknetServers.ts), including current server RAM occupation. These calculations work without Formulas.exe. A newly purchased node is valued at its actual starting production rather than the weakest upgraded node's output or an unlimited first-node estimate. The selector considers affordable alternatives that meet the configured payoff limit. Cache upgrades are handled by the capacity manager because they do not directly increase production. Hash ROI continues to use the conservative cash conversion value of $250,000 per hash; progression benefits are not priced by this estimate.

The upgrade manager honors pause, maintenance, achievement restrictions, global reserves, shared Hacknet allowances, and its total spending limit. Empty-fleet server detection respects Source File overrides and the disable-server BitNode option. It registers with runtime supervision and reports `tasks/hacknet-upgrade-status.json`. Daemon startup checks measured script RAM plus temporary-worker headroom.

Hash overflow prediction allows for a full 200 ms game tick even with shorter polling intervals. Bulk cash exchanges count their actual quantities against the configured batch limit. Spending rechecks pause, maintenance, and achievement restrictions after yields and before each action. Parameterized server purchases require a valid target. Capacity upgrades choose among valid finite cache/new-node costs, honor the shared spending allowance, and treat native node index zero as success. Cheap capacity purchases no longer bypass global reserves by default. The legacy percentage option cannot bypass shared spending enforcement. Hash status is throttled, stays fresh while balances are unchanged, and reports recovery errors in `tasks/hacknet-hash-status.json`. Invalid settings now produce a readable error instead of a startup logging exception.

Verification: 364 project tests, 15 Remote API tests, and 143 JavaScript syntax checks passed. Native RAM checks report 11 GB for hacknet-upgrade-manager.js and 9.1 GB for spend-hacknet-hashes.js. All 111 game files are synced without errors. Native inspection found production upgrading and three hash-spending configurations running; no extra purchases or spending actions were forced for testing. Long-run payoff performance has not been benchmarked.


## Stockmaster follow-up review

Market quotes, forecasts, volatility, and positions are now collected in one synchronous native snapshot rather than separate workers that could observe different market ticks. Mock mode maintains an independent simulated wallet: purchases debit cash, sales credit their actual simulated proceeds, and repeated refreshes cannot reuse the player's real cash. Mock order budgets and reserves apply before changing the simulated portfolio.

Cycle agreement increases only to its intended cap of 14 stocks. Empty or single-price histories produce a neutral forecast rather than NaN; estimated probability uncertainty uses the actual number of observed transitions. Windows larger than the retained 151 observations are rejected, and an explicit zero blackout option is preserved. Empty symbol lists stop with a readable message.

Ordinary native transactions and access purchases check maintenance as well as persistent pauses and parent ownership. Explicit liquidation can still override the trading pause/maintenance for reset preparation. Runs with disabled 4S skip its purchase/liquidation path. Any partial 4S access purchase or attempted liquidation requests a portfolio refresh before trading from the prior cash/positions. Native quotes remain the authoritative spending check; [official transaction calculations](https://github.com/bitburner-official/bitburner-src/blob/dev/src/StockMarket/StockMarketHelpers.ts) include spread and commission.

Verification: 370 project tests, 15 Remote API tests, and 143 JavaScript syntax checks passed. Updated stockmaster compiles in game at 12.9 GB. All 111 game files are synced without errors. Stockmaster was running at inspection (PID 482004); no trade or restart was forced for verification. The tests validate selected trading and forecasting behavior; future profit is not guaranteed or benchmarked.


## Sleeve follow-up review

Sleeve settings validate recovery ratios, training targets, reserve amounts, cooldowns, and augmentation batch sizes. Explicit crime overrides normalize underscores/case and reject unknown crime names. The training time limit now uses BitNode time as documented. Paid training and augmentation purchases are skipped when sleeve experience/augmentation is disabled. BN6 Bladeburner access is recognized without requiring prior SF7 ownership; contracts remain an explicit opt-in because player success estimates do not prove sleeve safety.

Queued task assignments, travel, training hash purchases, and augmentation batches check parent ownership, persistent pauses, maintenance, and sleeve achievement permissions immediately before execution. Augmentation batches also recheck shock before each purchase. Failed or deferred purchases do not start the full purchase cooldown, and success logs report the actual number bought and money spent. Native [sleeve purchase rules](https://github.com/bitburner-official/bitburner-src/blob/dev/src/PersonObjects/Sleeve/Sleeve.ts) remain authoritative.

Main-loop maintenance and recovery status are visible, and reported actual tasks are refreshed after assignments. Existing native tasks remain assigned while control is paused; the new guards prevent additional changes or purchases. Sleeve expansion checks pauses throughout its lifetime, honors maintenance/achievement restrictions when called directly, validates its budget fraction, and registers with runtime supervision. Outside BN10 it exits before requiring expansion APIs.

Verification: 376 project tests, 15 Remote API tests, and 143 JavaScript syntax checks passed. Native compilation reports 17 GB for sleeve.js and 27.4 GB for sleeve-expansion.js. All 111 game files are synced without errors. Sleeve management was running at inspection (PID 502901); expansion was not running. No extra purchases, memory upgrades, or task changes were forced for testing. Long-run Bladeburner sleeve safety has not been benchmarked.


## Hacking automation review

Fixed manual-hack workers to use the same argument order as ordinary hack workers. Manual workers verify the connected terminal target before each operation and report unavailable Singularity access gracefully; daemon falls back to ordinary hacking when manual mode lacks SF4. Worker delays are recalculated against requested finish times and loop periods as native operation durations change. The [official timing ratios](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Hacking.ts) remain hack:grow:weaken = 1:3.2:4. Looping workers stop starting new operations when their launching daemon exits, while already-started operations may finish. Run-once scheduling deliberately omits that owner restriction.

Fixed Hacknet-host ordering and empty preferred-host handling. Unsplittable jobs require enough RAM on one host before any launch, explicit splitting overrides are respected, and invalid thread counts are rejected. RAM and control checks are repeated after remote-copy waits. Copy failures do not mark files as deployed. Remote hacking/share scripts are refreshed from their authoritative daemon source on first use and when their source hash changes, without killing existing worker instances.

Batch launch failures roll back only the worker PIDs recorded for that batch; completed operations cannot be undone, so targets still require normal preparation/recovery afterward. Scheduling handles missing snapshots before dereferencing them. Zero or invalid per-thread hack production yields zero requested hack threads instead of Infinity/NaN. Daemon targeting and worker launch paths honor pause/maintenance. Existing target-profitability formulas remain intact.

Verification: 383 project tests, 15 Remote API tests, and 145 JavaScript syntax checks passed. Native RAM checks report daemon 5.85 GB, hack worker 1.85 GB, grow/weaken workers 1.9 GB, and manual-hack worker 5.7 GB with current SF4 access. All 112 game files are synced without errors. Daemon was running in XP mode at inspection (PID 537028); no live batch, restart, or hacking-mode switch was forced for testing. Tests exercise the actual executor with mock servers plus rollback and worker timing behavior. Long-run income and lag-sensitive batch timing have not been benchmarked.


## Runtime error repair and sleeve purchase review

Fixed two regressions reported in the attached game log: stock purchase quotes now pass native PositionType values `L`/`S`, and daemon initializes its options before checking manual-hack mode. Stock test doubles now reject invalid enum values so this API mismatch cannot silently pass again; daemon startup order has regression coverage.

The reported $550 million sleeve augmentation was within the local cash-fraction budget but exceeded the current shared sleeve allowance (approximately $195 million at initial inspection). Batch planning now caps its budget to the allocator's remaining allowance for the matching epoch and augmentation reset. Purchase receipts can report whether a purchase was deferred by control, shock, reserve, batch budget, shared allowance, or a native rejection. Ordinary deferrals are informational rather than false purchase errors. Live sleeve status exposes the remaining shared augmentation allowance. These checks preserve the global reserve and shared spending rules.

Verification: 387 project tests, 15 Remote API tests, and 145 syntax checks passed. All 112 game files are synced. Daemon restarted under existing supervision; sleeve and stockmaster were explicitly reloaded through the narrow API so the repairs take effect. Sleeve augmentations still wait when the shared allowance is below their cost; no forced augmentation purchase or liquidation was used to bypass it.


## Casino follow-up review

Casino actions and UI lookup retries now check persistent pause, parent ownership, and active transition ownership. Optional element searches cannot swallow cancellation. Mid-hand cancellation exits quietly, and paused runs report a pause rather than a retryable failure. Modal dismissal is bounded at 20 attempts; expired hand deadlines stop retrying immediately. Queued Singularity travel/location/graft cancellation actions also verify control before acting. Start controls are reacquired after wager changes.

Reloads make at most five attempts, check cancellation while waiting, and restore the previous unload warning when refresh fails or is cancelled. Winning rounds check recorded casino earnings directly after saving instead of waiting for the kick-out dialog to appear. The strict greater-than-$10-billion threshold and 100-million maximum blackjack wager match the [native casino limit](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Casino/Game.ts) and [blackjack implementation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Casino/Blackjack.tsx).

Completion/recovery hooks avoid duplicate launches. If the configured hook cannot start while casino occupies RAM, it can use spawn to release casino RAM first, provided the measured script fits afterward. Casino priority over grafting and preservation of Remote API connectivity remain in force; automatic tails still require explicit logging.

Verification: 392 project tests, 15 Remote API tests, and 145 JavaScript syntax checks passed. Updated casino compiles in game at 18.75 GB. All 112 game files are synced without errors. Native status already reported casino completion this augmentation with approximately $10.07 billion earned, and casino was not running. Gambling, page reload, and actual completion-hook spawning were not forced during this review; local tests simulate these paths.


## Bladeburner team follow-up

The recruitment allowance is now a true rolling-hour ledger of merged activity intervals rather than a fixed hourly reset. Usage survives restarts, and exhausted recruiting can be interrupted promptly. Existing legacy records are migrated conservatively. Enforcement follows the controller polling interval.

Squad preparation now verifies both the native assigned size and the post-assignment success estimate, restoring the former assignment after rejection or an ineffective squad. Maintenance is checked again within the mutation worker. The [official team bonus implementation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Bladeburner/Actions/Operation.ts) and [casualty handling](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Bladeburner/Actions/TeamCasualties.ts) support retaining minimal squads and replanning after losses.

Verification: 397 project tests, 15 Remote API tests, and 145 syntax checks passed. In-game controller RAM: 16.3 GB. Bladeburner was performing Undercover Operation during inspection; no recruitment or Black Op was forced. All 112 game files synced.


## Infiltration reliability follow-up

The [official infiltration UI](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Infiltration/ui/InfiltrationRoot.tsx) still uses the supported eight puzzle models. Automatic entry now has a serialized fresh control guard for delayed workers, protecting pauses, maintenance, UI ownership, and casino/reset transitions. Bladeburner protection recognizes BN6/SF6 access too.

Long runs refresh their supervisor heartbeat outside guard reaction windows. A reward click now has a bounded rendering wait; control is checked again after faction selection. Unexpected errors participate in per-location backoff, and cleanup avoids cancelling a replacement infiltration. Manual-start assistance remains enabled, including while automatic entry is cooling down.

Verification: 401 project tests, 15 API tests, and 145 syntax checks passed. All 112 game files synced. Updated native manager RAM is 45.6 GB; supervision reloaded it normally, and it reported waiting-for-entry. Existing live history includes 19 successful NWO runs. No run was forced for testing.


## Gang reliability follow-up

The [official gang formulas](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Gang/formulas/formulas.ts) match the controller's fallback calculations. Delayed mutation workers now respect maintenance. Maintenance safely disables clashes and restores temporary warfare assignments.

Ascension now rechecks live eligibility and respect, disables clashes before the reset, and immediately assigns training. Training records survive controller restarts within the same augmentation and BitNode run. Dead-member caches are pruned, equipment orders retain their individual spending limits when prices rise, and status includes actual native tasks.

Verification: 406 project tests, 15 API tests, and 145 syntax checks passed. All 112 game files synced. The updated controller reloaded normally at 27.1 GB native RAM; live status showed 12 members with about a 0.26% wanted penalty and warfare disabled. No irreversible mutation was forced for verification.


## Corporation finance and maintenance follow-up

Dividend liquidity waits now match the [official corporation dividend implementation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Corporation/Corporation.ts): tribute applies as an exponent to the full cycle payout. Emergency share-issue pricing matches the [native action order](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Corporation/Actions.ts), which calculates the new share price before increasing total shares. Buyback inputs reject nonfinite values.

Corporation maintenance now suspends new actions and clears persistent boost/manual recipe purchase rates. Error and exit cleanup handles each material independently. Self-funded creation preserves the player reserve and shared corporation allowance. Awaited faction-support work is followed by another control check.

Verification: 411 project tests, 15 API tests, and 145 syntax checks passed; all 112 game files synced. The standalone controller is running at 853 GB native RAM. Live corporation status showed profitable growth and approximately 60% ownership. No finance action or purchase was forced for verification.


## Corporation growth optimizer

New staffing uses bounded local search based on the [official office production and development formulas](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Corporation/Division.ts). Development offices receive a different allocation and larger growth targets than production cities. Managed creation cities and observed development times are persisted; unknown externally started projects keep development support across cities.

Offices, warehouses, city expansion, boost inventory, products, adverts, and upgrades share the growth ledger. Core foundations have priority; remaining purchases use estimated benefit per dollar and report budget waits. Deferred material purchases are charged to the ledger as commitments. Product investment scales with capital rather than a fixed $10b cap. Replacement uses development duration and improvements in funding, research, or staffing, with a bounded stagnation fallback. It preserves custom brands and requires enough budget before retiring a managed product.

AutoBrew and AutoPartyManager are evaluated after TA.II for larger offices that need recovery, while retaining research reserves. Selective supply-chain expansion is now the default. Use `run corporation-manager.js --expand-all-industries` to enable broad diversification, including opening Restaurant after Tobacco. Existing divisions and active Real Estate achievement goals remain managed.

Verification: 424 project tests, including 66 corporation checks; 15 API tests; and 145 syntax checks passed. All 112 game files synced. The controller runs at 853 GB native RAM. Live status shows positive operating profit and 59% ownership. Purchase ranking and staffing objectives are estimates; long-run income improvement has not been benchmarked.


## Research milestones and material quality

The staffing optimizer now protects baseline R&D headcount before the laboratory and Market-TA.II milestones, with stronger early research weighting. Targets match retained research pools, and status exposes points and progress. This addresses the earlier benchmark's reduced research throughput.

Material staffing now accounts for the [native material-quality calculation](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Corporation/Division.ts), which includes engineering output, research points, AI cores, and input quality. Material offices retain a conservative engineering minimum, and recovery intern counts stay intact.

Verification: 428 project tests, 15 API tests, and 145 syntax checks passed. All 112 game files synced; controller RAM remains 853 GB. Live Agriculture reported pricing research at 17,794 / 100,000 RP; its Sector-12 office assigned 3 R&D employees, compared with 2 before this change. Operating profit remained positive. Long-run income and milestone timing remain unbenchmarked.


## Corporation pipeline follow-up

Tobacco and custom product divisions now receive adverts through the common growth planner. All division warehouses are inspected before upgrade scoring. Deferred boost commitments update the reserve seen by subsequent purchase decisions, rather than relying on the reserve captured before the execution pass.

Verification: 431 project tests, 15 API tests, and 145 syntax checks passed. All 112 game files synced, with 853 GB native controller RAM. Live status remains profitable with 59% ownership. No purchase or financial action was forced to verify these changes.


## Faster corporation development

Tobacco can now start as soon as Agriculture exists and creation plus a $5b setup allowance and operating reserves are funded. The [official industry recipe](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Corporation/data/IndustryData.ts) requires Plants; Chemical is not a prerequisite. Chemical creation no longer waits for a laboratory or four times its starting cost. Core launches can draw on retained corporation cash instead of only the profit-funded growth ledger.

Development-office upgrades receive higher priority. Speed-focused product staffing is enabled by default through the development-speed option, preserving baseline R&D and recovery floors. Source-formula comparisons estimate roughly 9–12% shorter development across tested office sizes; this can trade product quality and excess research generation for speed. Live completion-time improvement remains unbenchmarked.

Material quality now uses the public industry scienceFactor property, correctly including accumulated RP. Verification: 436 project tests, 15 API tests, and 145 syntax checks passed. All 112 files synced; native controller RAM is 853 GB.


## Development-office funding activation

Core launch funding now makes the $5b setup allocation usable for the initial product and staffing. Unaffordable full office targets are replaced by three-person upgrade steps. Dedicated development offices receive retained-capital funding and priority while speed focus is active, with operating reserves preserved.

On retry, the controller was stopped and its status was stale. The latest controller was started through the API. Live verification confirmed Tobacco Sector-12 expanding from 9 to 12 fully staffed seats with speed focus enabled. Latest inspected funds were about $4.20b versus a $0.50b reserve. Verification: 438 project tests, 15 API tests, and 145 syntax checks passed. A complete live product-development benchmark remains outstanding.


## Gang recruitment and task allocation

Recruitment now checks every two seconds outside the territory preparation window and fills every currently eligible slot. Each recruit starts training in the same worker that recruits it; recruitment no longer waits for the next territory cycle.

Wanted recovery evaluates every lower-wanted alternative by production lost per unit of wanted reduction, using the selected money/respect objective. After selecting a plan, a bounded improvement pass uses spare wanted capacity to increase production. Mandatory post-recruitment and post-ascension training stays protected.

Gang equipment budgets no longer depend on buying the stock 4S API. Existing cash reserves, shared spending limits and fresh purchase checks remain enforced. BN8 still reduces default budgets, while explicit budget flags take precedence. This can spend more on useful gang equipment earlier in a run.

Implementation reviewed against the official Gang and GangMember source. No new tests or benchmarks were run for this change; runtime income improvement is unmeasured.


### Gang benchmark follow-up

The production-loss-per-wanted heuristic now competes with the previous largest-wanted recovery path for each candidate plan. This repairs 18 synthetic benchmark regressions caused by greedy recovery overshooting a deficit. Refinement runs once after candidate selection.

Verification: 451 project tests, including 26 gang checks; 15 API service tests; and 145 syntax checks passed. Across 810 paired synthetic evaluations, 113 improved and none regressed; all retained wanted feasibility and mandatory training. Median planner time was 0.342 ms versus 0.260 ms before. Live income improvement is unmeasured because the gang controller was stopped. Detailed benchmark artifacts are in C:/Users/mplei/Documents/Codex/gang-benchmarks/.


## Bladeburner action throughput and skill spending

Reliable ordinary actions now compete by conservative expected net rank per second: lower-bound success chance times rank gain, minus expected failure loss, divided by action duration. Qualified Black Ops retain progression priority. Native reward APIs are queried in one worker, with the existing action order retained if reward data is unavailable. The final Black Op start worker rechecks rank and the minimum success chance immediately before starting.

Population-analysis missions now require their lower success estimate to meet the threshold; Field Analysis handles unresolved uncertainty. The controller no longer starts an analysis mission solely because its upper success estimate is high.

Skill spending now uses one bounded worker for up to 100 purchases, refreshing levels, prices and points for each purchase. Pause, maintenance, activity ownership, achievements and live Black Ops are checked inside the worker, including fresh achievement point-banking requests. Upgrade logs are summarized per batch.

Operation count decreases release the first-completion wait when bonus time finishes operations early. Contract counts are excluded because sleeves can consume them independently. Recruitment can stop promptly when a useful team is ready, even before a conservative action-duration estimate expires.

Reviewed against the official Bladeburner Netscript implementation. No tests or live action benchmark were run for this change.


## IPvGO tactical move screening

IPvGO now simulates each native-legal single move before applying existing pattern strategies. Captures are removed before new-group liberties are counted. Connected groups and liberties are deduplicated, so a group touching the move on multiple sides is counted once. A tactical pass prioritizes immediate captures and rescuing endangered groups ahead of openings and pattern heuristics.

Non-capturing self-atari is screened out by default: a move leaving the played group with one liberty is skipped. Use --allow-self-atari to permit such sacrifices through the existing heuristics. Native move validation remains authoritative for legality and ko; this is a bounded tactical heuristic, not a full Go search.

Board, control, legality, liberties and chains are read together in one worker rather than five separate workers. Ordinary moves retain fresh native legality checks before submission. Maintenance is now respected both in the controller and in queued cheat workers.

Reviewed against the official Go API and board implementation. No tests or win-rate benchmarks were run for this change.


## Overview automation summaries

stats.js now shows active automation count, current activity priority, corporation operating profit, sleeve task summaries and IPvGO state. An Attention row surfaces paused managers, cash recovery and fresh controller recovery errors; hover details provide context. Use --hide-automation for the resource-only display. Manager records require a matching live process and a fresh timestamp before values are displayed.

Bladeburner now supports both SF6 and SF7 access and shows the current action with stamina in its tooltip. Optional gang, stock, hash and Bladeburner API failures no longer suppress the rest of the overview. Network/RAM discovery is cached for five seconds.

Overview rows rebuild when the native hooks are replaced and tolerate temporarily missing hooks. Script cleanup removes only its own rows, preserving stockmaster displays. Styles are scoped to these rows, and tooltip text wraps to the available screen width.

No tests or visual UI checks were run for this change. The synced script takes effect when stats.js is next started or restarted.


## Bladeburner recruitment review

Removed the arbitrary two-percentage-point uncertainty restriction from squad sizing. The minimum success estimate now determines the team requirement directly, retaining the configured cap. Existing team members can be assigned even with --disable-recruitment; that option prevents acquiring new members.

Replaced the fixed 50% recruitment-chance cutoff with an expected-time check against the remaining rolling-hour allowance. The estimate uses current recruitment chance and duration, subtracts progress on the current attempt, and is refreshed each pass. Current chance can decline as team size increases, so this estimate does not guarantee completing the whole shortfall within the budget.

Recruiting state is persisted for restart accounting. Owned recruitment is stopped during maintenance or controller exit. Queued team preparation and action-start workers now check that the parent controller is alive; recruitment starts also recheck the current shortfall.

The BB Team tooltip includes the current decision, required team and remaining hourly recruitment allowance. Recruitment remains aimed at pending Black Ops, rather than building an arbitrary standing army. Defaults remain a 30-member cap and 10 minutes per rolling hour. Tests were not run for this review.


## Bladeburner action-level planning

The controller now compares safe action levels by conservative expected net rank per second using native reward, loss, chance and duration APIs. Contracts and operations are eligible; Black Ops retain progression priority and protection. Temporary level probes run synchronously and restore the original level before returning. Plans commit at action start with fresh success checks, and a failed start restores the previous level and autolevel setting.

The planner evaluates every safe level up to 64, then uses bounded sampling for larger ranges, always retaining the current level when safe. Plans are exposed in tasks/bladeburner-levels.json and the chosen level is included in action-switch logs. Use --disable-level-optimization to retain native levels and autolevel behavior.

Verification: 476 project tests, 15 service tests and 146 syntax checks passed. Go tactical moves, overview cleanup/staleness, and recruitment behavior now have focused regression coverage. A 500-case synthetic level benchmark found no regression relative to initially safe levels; this does not establish live progression gains. The updated controller synced successfully and has a native RAM cost of 75.5 GB.


## Native team sizing and recruitment forecast follow-up

Available Black Op teams are now sized using the game's actual success estimates: test the available squad within the configured cap, then binary-search the smallest squad that meets the success threshold. The prior formula remains an estimate for members not yet recruited. Existing assignments are restored if the team cannot help or an API call fails.

Recruitment forecasts now sum expected attempts for each additional member rather than assuming constant success probability. Supporting sleeves are excluded from the human-recruit denominator, matching the native recruitment calculation. If sleeve information is unavailable, the forecast uses a conservative zero-human baseline. Stored bonus time is credited only when it covers the entire forecast plus a full action allowance.

The existing recruitment budget regression fixture was adjusted for declining chance. These follow-up changes have not been tested or benchmarked yet; the prior 476-test result predates them. No live actions were forced.


## Shared home RAM headroom

The project now protects a shared adaptive home reserve for automation and temporary helpers. Hacking and Stanek allocations honor the reserve; autopilot launches managers only when they fit alongside it. Known disposable workers on home can be reclaimed in this order: sharing, Stanek charging, hacking/growing/weakening. Managers, the Remote API and unknown scripts are preserved.

On a 4096 GB home the default reserve is 128 GB. Small homes reserve up to a quarter of their RAM, while larger homes scale toward 2% capped at 2048 GB. Set home-ram-reserve.txt to a larger GB value to increase the reserve. Pending manager and activity reservations remain additional allowances for background allocators.

The reliability monitor enforces the floor periodically, and temporary helper launches reclaim RAM on demand. Interrupted hacking batches recover through normal scheduling. The overview adds a RAM Hold row on its next restart. Essential and manual allocations can still exhaust physical RAM; the project does not kill those scripts to manufacture space.

Verification: 481 project tests, 15 API service tests and 148 syntax checks passed. The updated monitor is active in-game; live free RAM was 195.2 GB with a 128 GB baseline reserve. All 113 deployable files synced.
