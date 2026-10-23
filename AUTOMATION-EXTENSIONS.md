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


## Corporation optimization review â€” October 14, 2026

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


## IPvGO review â€” October 14, 2026

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

Development-office upgrades receive higher priority. Speed-focused product staffing is enabled by default through the development-speed option, preserving baseline R&D and recovery floors. Source-formula comparisons estimate roughly 9â€“12% shorter development across tested office sizes; this can trade product quality and excess research generation for speed. Live completion-time improvement remains unbenchmarked.

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


## Sleeve priorities for Bladeburner

Priority order: synchronization and shock recovery; explicit crime override; a useful live Black Op support shortfall; configured training; following player faction/company work; gang karma; useful reputation work; ordinary Bladeburner work; fallback crime.

Automatic Black Op support uses only healthy, fully synchronized sleeves and a fresh team plan from the live Bladeburner controller. It retains existing supporters, prefers spare/infiltration sleeves, and allocates only the required shortfall. --disable-bladeburner-team-support disables this behavior. Regular Bladeburner tasks retain their prior position; contracts remain opt-in and now require each sleeve's own estimated success probability.

Six new regression cases cover support sizing, stability, recovery priority, spare-sleeve preference, native contract probability lookup and source-file access. Verification: 487 project tests and 148 syntax checks passed. The Remote API disconnected during final verification; final sync after the last edit remains unconfirmed.


## Simulacrum installation and concurrent player work

The Blade's Simulacrum remains a priority purchase. Only an installed copy enables concurrent ordinary player work and Bladeburner; a queued purchase is insufficient. Bladeburner now refreshes this state before work decisions and verifies again immediately before starting an action. Unknown state without Singularity access waits safely, with --ignore-busy-status retained as an explicit override.

Faction work refreshes its cached missing-augmentation result after grafting and recognizes both SF6 and SF7 access. Work-state diagnostics are written to tasks/bladeburner-work.json. Activity ownership and active Black Op protections remain enforced.

Verification: 491 project tests and 148 syntax checks passed. The Remote API was disconnected, so live augmentation ownership and final deployment remain unconfirmed.

## Simulacrum installation trigger follow-up

Autopilot now includes The Blade's Simulacrum in its default install-for-augs list. Priority reset detection considers both affordable augmentations and purchases already queued, excluding installed augmentations. Custom trigger lists remain respected. Normal countdown, graft, Black Op, activity and progression guards still apply. Existing running autopilot instances adopt this logic on their next restart; no reset or purchase was forced during verification.

Verification: all 493 project tests passed, including two new priority-install regression cases. Live Remote API queries confirmed The Blade's Simulacrum is neither installed nor queued; The Shadow's Simulacrum is a separate augmentation. Both changed game files synced with no pending uploads.

## Cash bottleneck and product backlog improvements

Cash-bottleneck spending plans now limit Hacknet allowance to at most 2% of unreserved cash per plan and reduce its allocation weight. Unallocated cash is retained. BN9 keeps its primary Hacknet development policy. Upgrade selection additionally caps requested repayment horizons at one hour when a current, live autopilot plan identifies a cash bottleneck; stale plans, different augmentation resets and dead owners do not apply this cap. The upgrade manager exposes --disable-adaptive-spending to retain its requested horizon.

Corporation fallback pricing now reacts faster when inventory exceeds two production cycles and sales fall below 90% of production. It uses observed sales and the native inverse-square markup relationship to reduce the premium toward a three-cycle inventory drain target, retaining the MP floor and regular search behavior outside this backlog case. Market-TA.II and formula pricing remain authoritative when available. This is an adaptive price estimate, not a guaranteed clearance time.

Deployment: four changed game files synced through the Remote API. Live controllers reload cooperatively after protected infiltration; no infiltration was interrupted. All 148 JavaScript files passed syntax checks. The regression suite and performance benchmarks were not run for this change.

## Growth-first player liquidity (supersedes cash-shortage dividends in development mode)

With development-speed enabled, dividends are now zero and share buybacks are disabled: all operating profit remains available to the corporation. Cash-shortage funding uses fresh augmentation planner evidence to select a reputation-ready or donation-eligible milestone that a bounded share sale can completely fund. Existing stock-inclusive worth counts toward the milestone, targets prioritize The Red Pill, The Blade's Simulacrum, then Neuroreceptor Management Implant, and the ordinary one-billion emergency wallet floor remains a fallback. Plans expire after one minute, must match the current augmentation reset, and cannot authorize milestone sales without a live cash bottleneck. The existing one-percent-per-sale limit, ownership floor, and native cooldown remain enforced.

Equity sales do not debit corporate funds, but reduce CEO ownership and can affect share price and future funding. They cannot be described as having no economic tradeoff. Income mode (--development-speed false) retains tiered dividend behavior. Status exposes retainedProfitFraction and liquidityDecision.

Live verification: controller PID 178619 is in growth mode with native dividendRate zero, retainedProfitFraction one, no pending reloads, and no reliability errors. No new milestone sale was authorized in the observed state; the player already had more than the emergency wallet target. Both modified JavaScript files passed syntax checks. Regression tests were not run.

## Node ETA correctness follow-up

Confirmed live that The Red Pill was not installed and Bladeburner had no active player action. The former ETA incorrectly accepted a daemon hacking target without an installed Red Pill and extrapolated instantaneous script XP.

Hacking projections now require an installed Red Pill. Rates use actual player XP and Bladeburner rank changes over a rolling five-minute history, with at least 60 seconds and three observations. Histories reset on augmentation/BitNode resets, stat multiplier changes, decreasing counters or observation gaps over 30 seconds. Missing Bladeburner observations do not poison the entire history. Idle Bladeburner displays BB paused rather than extrapolating passive rank trickles. Long straight-line projections display Slow XP / Slow BB beyond 24 hours, with the raw current-pace figure in the tooltip. Estimates remain conditional on current performance and do not forecast future augmentation gains.

Overview diagnostics are published to tasks/overview-status.json and exposed by the supervisor dashboard. The supervisor now watches stats.js and can safely refresh this read-only display during protected activities without pausing other managers or using desktop input. Syntax checks passed; regression tests were not run for this follow-up.


## BitNode completion route planner

Autopilot samples native completion evidence every 15 seconds. `node-route-policy.js` keeps dedicated XP and income-mode XP separate (60 seconds minimum, five-minute observation window, ten-minute rate expiry). Reset, XP regression, multiplier changes and sampling gaps invalidate history.

World Daemon forecasting requires installed Red Pill and a native hacking requirement. Before installation, status includes Daedalus/Red Pill acquisition stages and concurrent cash/reputation waits; a post-install finish time remains unknown until measured. Bladeburner simulates remaining BlackOps in order, credits their rank rewards, includes expected failed-attempt rank losses, and consumes finite supplies of safe current contracts/operations. Bonus time is bounded; recovery, recruitment and chaos use an explicitly approximate 50â€“100% duty range. Insufficient success chances, action supply or APIs produce unknown estimates. Future upgrades are not extrapolated.

Priority requires both routes to have actionable estimates and a 25% advantage across estimate ranges for two continuous minutes. Unknown evidence clears overrides; stale plans, dead owners and plans from older resets cannot control managers. Until comparison is possible, the existing progression policy remains active. `--disable-node-route-planner` disables overrides.

WD priority requests hacking XP, releases conflicting Bladeburner work (preserving BlackOps), and pauses dedicated BB hash spending. BB priority releases conflicting faction work and favors combat support spending. Installed Blade's Simulacrum permits parallel player/Bladeburner work. Casino/activity locks, grafting, program creation, maintenance and achievement protections keep their existing precedence. Overview displays Node Route with estimate reasons; the dashboard publishes nodeRoute. No native purchases, resets, or action starts are performed by the forecast collector.


## Continuous hacking XP priority

Autopilot now defaults to continuous daemon XP mode, including above the high-hack threshold and on small home servers. Home RAM and server allowances favor hacking progress. Other managers and augmentation/BitNode progression remain active. Use `--disable-continuous-xp` to return to adaptive income/XP scheduling. This preference persists across ordinary restarts through the script default.


## Default World Daemon route

World Daemon is the default completion priority, even before Daedalus/Red Pill access or reliable finish estimates. Forecasts continue to report blockers and uncertainty. Conflicting faction work and hash spending favor WD; Bladeburner remains available in parallel with installed Simulacrum, and existing BlackOps finish before faction work takes over. Use `--adaptive-node-route` to restore ETA-driven route switching. Already-completed BitNode victory conditions retain their normal departure handling.


## WD sleeve and overview coordination

A fresh, live autopilot WD plan releases sleeve slots previously reserved for Bladeburner, disables default BB task/support assignments, and refreshes reputation targets when route priority changes. Recovery/synchronization, explicit crime overrides and cash reserves retain their precedence. A healthy sleeve is reserved for a critical Red Pill reputation target before ordinary company/faction allocations; remaining sleeves take distinct useful reputation tasks or earn cash. Missing/stale plans fall back to normal sleeve policy.

When the selected route has no trustworthy ETA, Node ETA displays its actual blocker (Daedalus, Red Pill reputation/cash, installation, or XP sampling) instead of displaying a paused alternative route.


## Automatic Red Pill milestone policy

`red-pill-policy.js` evaluates native membership, installed/queued TRP, native offer/price/rep requirement, current favor/favor gain, donation eligibility, current conversion and measured cash/reputation rates. WD focuses on entry funding only after entry stats/augmentation requirements are met, then focuses on TRP rep/funding once Daedalus is joined. BN15's unavailable faction TRP is not treated as a free purchase.

Infiltration candidates compare direct rep with cash converted at the native donation rate, using existing measured durations, failure history, travel restrictions and market-demand guards. Explicit faction and money-only overrides remain authoritative. Idle faction work targets Daedalus until its native requirement is met, including when donations are unlocked.

The native TRP transaction checks requirements/costs again and donates only when the complete donation+purchase budget plus $1b buffer is available. It buys TRP separately from the augmentation basket. Existing stock investments can grow; liquidation occurs only to fund a complete ready purchase. Optional augmentation/NF resets are held while the milestone is active. Stale favor flag files no longer authorize a reset: donation-access resets require fresh native favor evidence, a fully funded post-reset bill, and a conservative ten-minute recovery forecast at least 25% faster than measured direct work.

Queued TRP installs directly after existing graft, BlackOp, infiltration and achievement protections permit it. It bypasses unrelated 4S/basket/countdown waits and rechecks queued/native reset state before installation. Installed TRP protects WD XP from optional resets. Corporation equity funding still respects its sale cap and ownership floor; zero-price TRP uses its standalone donation bill, and an oversized savings reserve does not trigger partial ownership sales. Missing native APIs remain unknown and fail without purchases.

Daedalus work selection also records the marginal player reputation rate, subtracting an idle baseline so sleeve/passive reputation is not counted as a benefit of player work. Infiltration uses its conservative demand floor, measured duration and reliability, and yields when it cannot beat that rate by 25%. Rate evidence expires after ten minutes and is invalidated by reset or material stat/multiplier changes. Manually started infiltrations use the same reward-value comparison while explicit reward overrides remain authoritative.

After TRP is installed, non-NeuroFlux augmentation resets remain possible only when measured WD finish time exceeds both estimated augmentation payback and recovery of lost XP by at least 25%; unknown rates preserve the current run.

### 32 GB casino startup

Running `autopilot.js` on a home server with at most 32 GB now prioritizes a $300,000 cash seed. It uses a short-lived Singularity worker to choose a short crime by expected money per second, focuses that crime, and leaves repeating crimes intact between checks. Other managers and spending wait; $300,000 is reserved for travel and betting. Once funded, the casino starts immediately without the normal one-minute income observation. After casino earnings reach the existing completion threshold, normal automation resumes. Disabled or paused casino settings are respected; without Singularity the startup status explains that the seed must be earned manually.

### Dark Net Mastermind and yesâ€™nt feedback

`DeepGreen` (Mastermind) now discovers character multiplicities with uniform probes, then bisects unresolved positions using native exact/misplaced counts. It handles repeated characters without enumerating exponential candidate sets. `NIL` (yesâ€™nt) locks confirmed positions and accepts straight/curly apostrophes and both negative-token spellings. Both retain pending guesses across temporary authentication/Heartbleed failures, reject malformed feedback, seed progress from structured native logs, and retain progress after bounded work. The manager deploys `darknet-feedback.js` alongside every scout. Existing model fixtures now use the native duplicate-counting rules; no test suite was run for this change.

### Adaptive sleeve opening priorities

Default sleeve management now funds the $300,000 casino seed using money crimes without waiting for synchronization or zero shock. Once funded, if gang access is available and karma remains above -54,000, approximately half the sleeves work toward gang karma while the others recover shock. Fully recovered and synchronized sleeves also join karma work. Worker ownership stays stable between polls. Synchronization is selected when its estimated completion benefit outweighs working immediately; crime money does not require it. Paid training, sleeve augmentations, and training hash upgrades wait during these urgent milestones. Afterward sleeves recover for augmentation access, synchronize, then follow normal reputation, training and work priorities.

`--disable-adaptive-startup` restores the previous strict recovery-first ordering. Explicit crimes, custom shock thresholds or recovery ratios, disabled gang priorities, paused/disabled casino settings, and achievement restrictions remain respected. The 32 GB autopilot casino bootstrap still defers the sleeve manager. Status includes the opening stage, worker indexes, and planned tasks.

### Shared faction joining decisions

Faction workers, augmentation purchases and ascension now share tasks/faction-join-plan.json, scoped to the current augmentation and BitNode resets. City groups are compared by remaining augmentation benefits, reputation requirements, duplicate supply and hacking/XP/reputation priorities. Existing city membership anchors the compatible group; explicit --first or --force-join city preferences take priority before membership. Native join workers recheck current membership and the shared choice, so automatic NeuroFlux preferences cannot override the city plan. Intelligence farming also honors that guard. Non-conflicting invitations remain available, with Daedalus and gang invitations processed first. Gang rush stops pursuing harder invitations once a qualifying faction is joined and focuses on the remaining karma. Daedalus funding now recognizes either 2,500 hacking or all four combat stats at 1,500.


### Shared gang host selection

Faction work and gang creation now use the same host policy. Combat is the default; joining NiteSec or The Black Hand does not stop pursuit of a combat invitation. Once an eligible host is joined, no harder invitation is pursued for gang creation. Existing gangs remain authoritative and are never replaced. BN2 does not farm the otherwise required -54,000 karma after a host is ready.

Configure `gangs.js` with `--gang-type hacking` to allow both hacking hosts, including NiteSec, or `--gang-faction "The Black Hand"` to require an exact host (implies its type). `--gang-skip` excludes hosts. The same flags can be saved in `gangs.js.config.txt`; live gang-manager flags are shared through a reset-scoped, owner-checked preference file. Faction skip preferences are also respected. Explicit hosts may wait for an invitation; default selection never waits for a better host. Invalid preferences defer creation.

Among joined hosts of the selected type, higher faction favor wins, then the count of unowned native unique augmentations, then a deterministic NPC-rival order. Existing host reputation is deliberately not counted as retained value: creation erases it, and the log reports that loss. Missing Singularity or host benefit data falls back to the deterministic order without blocking gang development. Player hacking/combat stats do not select gang type. Unique augmentation counts are a tie breaker, not an exact forecast of the seeded post-creation augmentation catalog.


### Faster opening progression

Cash-poor casino startup now applies at every home size and bypasses the one-minute income observation below $1b wealth. Missing Singularity or insufficient worker RAM yields to ordinary hacking, with casino cash reserved and money hacking enabled while the seed is missing. Retry/protected-activity waits cannot freeze other progression.

An optional one-shot sleeve worker assigns money crimes without a persistent manager or Singularity dependency. It respects sleeve pauses, explicit sleeve settings, challenge restrictions, existing manager ownership and activity locks. The player seed worker is detached; it compares whole-payout expected time to the remaining target and awaits the native crime-completion promise before changing an existing crime. It rechecks ownership, protected work and target cash after the wait.

After casino completion a guarded worker immediately buys essential home RAM up to 128 GB within half the free wallet and the shared home allowance. The periodic RAM task also permits reaching 128 GB in nodes where hacking income is disabled. Sleeve gang opening compares all native-size worker subsets by estimated gang ETA plus average recovery delay, keeps near-equal assignments stable, and evaluates synchronization against the remaining karma. BN2 does not allocate sleeves to unnecessary gang karma. These forecasts use current stats and rates; they are not guaranteed completion times.


### Gang growth and augmentation purchase acceleration

Default gang management projects native member XP and stats to compare another training interval with productive work. The old ten territory-tick training period becomes a maximum forced-training window, with a brief two-second settling period. Random whole-gang training is replaced by per-member decisions. Set `--disable-adaptive-growth` to restore legacy decisions; `--growth-horizon-minutes` defaults to fifteen.

Recruitment remains the first respect goal. Once recruitment finishes, a fresh reset-scoped purchase plan from the faction manager selects the next useful augmentation. Gang work switches to money when its rep requirement is met or cash is far behind. Equipment orders compare projected productive value gained per dollar and remain subject to current wallet reserves, explicit budgets, and the shared allocator. Short-payback opportunities increase the next gang allowance. Temporary equipment is withheld from members selected for ascension; BN8 retains conservative legacy spending.

Member ascensions model lost production, training and replacement equipment costs, retain the existing respect/recruitment guards, and stagger resets. Native workers recheck plan expiry, member stats and ascension results before mutating. All rates and payback times are estimates at current stats, not promised earnings.

Before Daedalus entry, default augmentation selection may add prerequisite-complete cheap unique augmentations within ten percent of wealth toward the installed-count requirement. Explicit stat filters, omissions and `--disable-count-building` remain authoritative. Existing dependency-aware purchase order and native affordability checks still apply.

Reset forecasts now include a conservative gang income penalty allowance and, on the first BN9 install, the native formula cost of rebuilding current Hacknet servers (including the free starting server). If formula access is unavailable, existing conservative first-BN9 behavior remains. Measured rebuild costs can authorize a worthwhile earlier reset or hold an ordinary reset whose modeled payback exceeds four hours. Explicit priority augmentation and Red Pill paths retain their existing protections.


### Faster IPvGO games

IPvGO now builds each connected stone group and its liberties once per board snapshot. Capture/rescue calculations use group sets rather than copying and flood-filling the board for every legal move. Pattern rotations and reflections are deduplicated and cached, with static patterns warmed at startup. Native legality and pause checks remain in the action path.

`tasks/go-performance.json` stores up to twenty recent completed-game measurements per opponent, board size and cheat mode, scoped to the BitNode and augmentation reset. Measurements include elapsed wall time, wins, turns, bonus growth and native node-power awards; resumed partial games and ambiguous results are excluded. Opponent ranking incorporates observed bonus growth per minute with a bounded adjustment to existing goal priorities. Adaptive boards begin at 13x13, establish a three-game baseline, then sample other supported sizes at most once per eight completed games. Board comparison uses node power per minute to avoid bias from diminishing percentage bonuses. Board selection uses at least three recent samples and realized rewards including losses; validated positive rewards can qualify a loss-only board. There is no fixed 80% win-rate gate. Evidence expires after two hours, and bounded trials refresh alternatives after thirty minutes. Illuminati trials consider 5x5 first because of its native special reward multiplier.

Explicit `--board-size` arguments/configuration remain authoritative. `--adaptive-boards false` retains the configured board size. Streak achievement goals disable board exploration. `--early-pass false` disables the conservative endgame rule, which otherwise requires a clear score lead, no neutral empty regions, no playable enemy territory/captures/rescues, and two independent vital empty regions for every friendly group. Each counted region must contain no enemy boundary and consist entirely of liberties of the chain it supports. Shared regions can support multiple chains. Chains with fewer than two vital regions and every region touching a removed chain are repeatedly eliminated until stable; every friendly chain must survive. This admits mutually supported shared eyes and larger narrow or 2x2 eyes while rejecting blocked corridors, unsupported neighbors and merely potential eyes. Existing move heuristics remain the fallback.


### Measured IPvGO search profiles

`--search-mode auto` keeps tactical play as the baseline and permits one challenger trial per eight native completions. Search promotion needs six distinct matching games per player, adequate duration coverage, more than 15% measured reward-rate gain, and separated approximate uncertainty bands. These are finite-window decision heuristics, not guaranteed sequential confidence intervals. Board/opponent trials and achievement streaks retain tactical play; explicit `off`, `shadow`, and `play` modes remain available.

Version 4 performance storage records configuration identities alongside opponent, board size and cheat mode. Search time/node limits affect the search profile; shadow-search limits also affect tactical timings. Early passing, self-atari policy and cheat success thresholds affect both identities. Automatic tactical measurements survive search-only budget changes. Up to four profiles per engine are retained, with twenty recent games per bucket. Switching back can reuse retained matching evidence. Version 2/3 rows without configuration provenance remain archived and cannot promote a newly configured player. The controller computes a `p2` source fingerprint once at startup from `go.js`, `go-policy.js`, and `go-search-policy.js`, including their private helpers and constants. Search-only source changes preserve automatic tactical evidence, while shadow timing depends on search source too. BOM and line-ending differences are normalized; other text changes conservatively start a new profile. The revision remains fixed until controller restart. Missing required source disables learning and automatic engine promotion while allowing play to continue. Historical `p1` profiles remain archived; they cannot promote a new implementation. These fingerprints identify the three primary files, not every transitive dependency or cryptographic authenticity.

Move timings include ordinary moves, passes, two-move cheats and failed actions. Cheat wait includes worker overhead. Completed histories retain timing evidence; resumed partial games and deliberate achievement-failure attempts are not credited as ordinary performance outcomes. Status reports whether the latest outcome was accepted and why it was excluded.

### Interrupted IPvGO time

`tasks/go-session.json` checkpoints the active controller segment at most once every five seconds, with forced checkpoints at game boundaries and deliberate achievement-failure attempts. Recovery counts only elapsed time confirmed by the last checkpoint. It excludes unobserved time while closed/offline, and the uncheckpointed tail is a conservative undercount. Resumed games receive a new partial segment; their unverified full-game reward is never credited to that segment.

Valid interrupted segments are kept separately from completed histories (up to twenty per bucket). Matching board and engine throughput includes the past two hours of confirmed interruption cost; opponent comparisons use their existing thirty-minute window. This adds no wins, rewards, completed games, or confidence samples. Engine uncertainty bands scale with the observed time burden; they do not model the probability of future interruptions. Intentional achievement-failure attempts remain excluded from ordinary learning.

Completed results carry a session receipt. A saved receipt prevents charging its checkpoint if the script stops between saving a result and closing the session. Interruption IDs prevent duplicate charges on repeated recovery, and reset/configuration boundaries remain authoritative. Status exposes the latest interruption and latest sample acceptance reason.

### External IPvGO board changes

Snapshot workers return a compact identity based on opponent, board size, current position and newest-first history ancestry. Captures and passes preserve continuity; a changed opponent/dimension, truncated history or unrelated ancestry starts a replacement segment. The controller charges only the old session's last confirmed checkpoint, clears its plan/caches, and starts the observed replacement as an uncredited partial game. Checkpoints advance only after a valid identity observation.

Ordinary moves and passes check history/turn and native validity dimensions immediately before submission. Two-move cheat workers repeat identity and size checks after launch. A stale game-over reply cannot overwrite a newly opened live board: current-player state is checked before/after the final snapshot and immediately before automated reset. Expected replacement signals trigger a fast refresh rather than the ten-second generic error backoff.

No public game-generation identifier exists in the observed API. An identical same-opponent board/history recreated between observations is indistinguishable, and same-size empty-history replacements cannot always be detected before submission. Native legality still applies, and observable changes are split at the next snapshot. These checks do not intentionally reset live boards for QC.

### External IPvGO move intervention

The controller records its own submitted action and checks the next snapshot against that receipt. Unsubmitted progress, unexpected player placements/history growth, outside turn changes observed during planning, and untracked completion exclude the current game from ordinary performance learning. The exclusion is checkpointed and remains sticky through retries/recovery. Native rewards still accrue in the game; excluded games supply no comparative reward, completion sample, or ordinary interruption penalty.

Accepted ordinary moves permit one Black placement plus at most one AI placement; passes permit only the AI move. Native two-stone cheats mutate the board directly without logging the Black placements in history. Their accepted receipts allow that direct mutation and at most one AI history entry, including failed/ejected cheats. This prevents legitimate cheats from looking like board replacements. True board-replacement handling takes precedence over intervention classification.

The native API does not identify every actor. Invisible pass sequences or interventions that reproduce the same observable result can remain indistinguishable from normal play. These checks exclude detectable intervention; they do not prove that a game had no external input.

### Faster early-game startup

Casino seed crimes now run alongside a minimal hacking controller. Funding mode suppresses optional managers, infrastructure purchases, startup study and startup XP warmups, protecting both cash and the player's crime action. Without Singularity, ordinary hacking remains the fallback. Normal manager settings resume once funding mode ends.

The default daemon home reservation is 25% of installed RAM up to 32 GB (8 GB at a 32 GB start). Explicit `--reserved-ram` values remain authoritative. Available-thread planning no longer subtracts that reservation twice. Autopilot scales its Source File 4 helper reservation on small home servers.

TOR and program purchase workers recheck the shared cash reserve and honor pauses, maintenance and cash-spending achievement restrictions. Missing APIs exit with a log message. Infrastructure polling wakes on rising wallet milestones, while retaining ordinary timed retries. Post-casino essential RAM upgrades already run immediately through autopilot.

Daemon now launches one Hacknet controller with `--adaptive-tiers` rather than four competing configurations. It combines one-hour upgrades, four-hour upgrades costing at most 10% of cash, eight-hour upgrades costing at most 1%, and very cheap upgrades costing at most 0.1%. Cash bottleneck limits and shared allowances still apply. Up to ten guarded purchases run per poll so consolidation does not reduce startup purchases to one per second. The worker stays available when upgrades are temporarily unaffordable.


### Early-game readiness, fallback and exact purchase thresholds

Daemon publishes startup readiness after its study/XP warmup and initial rooting finish. Autopilot can then launch faction work immediately, checking the current daemon PID and augmentation/BitNode reset identities instead of waiting thirty seconds. Missing, mismatched or warming records do not steal study focus.

If the main controller cannot fit, autopilot attempts a smaller one-thread `bootstrap-hacking.js` worker. It roots hosts needing no port openers, selects an accessible fast money target, and weakens, grows or hacks without buying anything or changing player work. Pauses, maintenance, owner exit, casino and a running daemon stop further actions. Autopilot preserves a productive fallback until there is enough space to replace it with daemon, avoiding repeated interruptions merely to retry the larger controller.

TOR, program and RAM workers publish native purchase costs. The scheduler checks reserve-adjusted affordability, including RAM spending fractions, and wakes on exact threshold crossings even within the same general cash milestone. Quotes expire after five minutes and cannot cross reset boundaries. Crossings remain queued through the one-second retry cooldown; unchanged affordable quotes do not cause repeated immediate launches. Normal timed retries remain available when a quote is missing or a purchase is deferred by shared allowances.


### Faster faction backdoors and TOR handoff

Successful native TOR purchases publish a reset-scoped handoff that wakes the existing program scheduler within its one-second retry limit, rather than waiting the ordinary 26-second interval. A failed RAM or pause check retains the handoff for bounded retries; successful dispatch consumes it. The program worker still enforces reserves, pauses and achievement spending guards.

Backdoor targets now prioritize CSEC, avmnite-02h, I.I.I.I, run4theh111z and fulcrumassets before optional servers. Eligibility includes matching the required hacking level exactly. Default helper headroom is 25% of home RAM capped at 22 GB, with explicit task and global reservations honored. Each launch additionally requires the worker's measured native script RAM, including current Source File multipliers. Failed routes skip installation, and activity ownership, pauses and maintenance are rechecked before each target.

QC: 606 project tests passed and 164 JavaScript files passed syntax checks, including actual scheduler and backdoor-manager harnesses for TOR retries, 32 GB home operation, exact hacking requirements, faction ordering, high Source File RAM costs, failed connections and changed activity ownership. This is simulated startup coverage; no fresh BitNode reset was performed for testing.


Live QC additionally exposed a reset-cache scope error in periodic scheduling. The cache is now shared with startup instead of being declared only inside startup; a regression check prevents that shadowing from returning.


### Batched backdoor discovery and confirmed startup

Network discovery now scans every reachable server inside one serialized helper, retaining home-rooted routes and reporting isolated scan failures. It replaces one helper launch per server with one helper launch for discovery; metadata queries remain separate.

Each backdoor worker verifies the connected server before invoking native installation, then acknowledges invocation using its PID, target and unique request token. The parent reconnects home only after a matching confirmation. Startup waits are bounded by `--start-timeout` (default five seconds, maximum one minute); `--spawn-delay` is retained as the polling interval rather than an assumed startup delay. Unconfirmed workers are stopped on cancellation, failed startup or timeout, and confirmation files are removed. Optional Source File access failures and failed cleanup connections remain graceful.

QC: 617 project tests passed and 165 JavaScript files passed syntax checks. Regression coverage includes one-scan-per-host discovery, cyclic networks, unavailable scan hosts, delayed worker startup, stale/wrong receipts, cancellation, timeouts, target mismatches, missing SF4 and native promise rejection. Native inspection measured the guarded worker at 6.7 GB in the current run; the existing RAM launch guard uses that measured cost. No new installation was forced solely for live testing.


### Batched server metadata and installed-backdoor shortcuts

Backdoor startup now collects hacking skill and each candidate's required skill, root access, installed-backdoor flag and ownership in one metadata worker. Server reads are deduplicated and failed or malformed hosts are skipped individually. Discovery, purchased-server enumeration and metadata now use three startup data helpers instead of the previous six; RAM, connection and running-worker checks remain separate. This is a reduction in helper launches, not a measured end-to-end speedup.

Routes use the deepest installed backdoor on the scanned path as a direct connection shortcut. Original paths remain intact, and a failed shortcut is retried using the original home-rooted path before skipping the target. Worker target checks and startup confirmations remain in force.

QC: 626 project tests passed and 166 JavaScript files passed syntax checks. Coverage includes metadata serialization, one read per distinct host, failed-host isolation, shortcut selection, original-route retries and actual manager integration. Files synced without pending updates or sync errors, and inspected autopilot/daemon logs showed no new runtime errors. No installation was forced solely for live testing.


### Prompt faction-backdoor unlock scheduling

Daemon observes the five faction servers using current hacking skill, current native root access and known installed-backdoor state. Newly eligible servers wake the backdoor scheduler after its one-second retry cooldown instead of waiting for the ordinary 33-second interval. Pending unlocks survive cooldowns and failed RAM/pause checks. If a manager is already running, pending work waits for a new dispatch because the running manager may have captured its snapshot before the unlock. State is scoped to BitNode and augmentation resets; ordinary interval retries remain available after dispatch.

Live QC found that the game's RAM analyzer rejected a redundant relative re-export in the backdoor policy. Removing it restored the manager's native RAM estimate to 7.5 GB. Helper launch checks now refresh native RAM estimates, preserve configured minimum RAM requirements, and defer invalid estimates rather than entering repeated exec retries that interrupt the hacking loop.

QC: 638 project tests and 169 JavaScript syntax checks passed. Coverage includes exact hacking thresholds, root acquisition, in-flight managers, cooldowns, reset boundaries, failed dispatch retries, repaired imports, updated RAM costs and configured minimum requirements. Files synced without pending updates; the backdoor manager has a valid native RAM estimate. No new backdoor installation or reset was forced solely for testing.


### Faction-first rooting and backdoor completion handoff

Daemon attempts eligible faction-server roots before ordinary startup rooting and before periodic scheduling in each targeting loop. It uses current root access and owned port openers, respects pauses/maintenance, checks helper RAM and waits five seconds between failed attempts on a host. Newly rooted faction servers can therefore enter the existing prompt backdoor scheduler without waiting behind income-target processing.

Successful faction backdoors publish one completion file per host, scoped to the reset in which installation started. Failed installations and changed-reset completions publish no event. Valid completion events wake the existing faction manager after its one-second retry cooldown, including below the ordinary first-faction wealth gate. Joining, gang-host and city decisions continue through the existing faction policy. Pending events survive RAM/pause failures and wait for an in-flight faction manager to finish before being consumed by a new dispatch.

QC: 646 project tests passed and 170 JavaScript files passed syntax checks. Tests cover concurrent completion records, reset boundaries, failed native installation, available port openers, priority rooting, pause/RAM deferral, bounded root retries and completion-triggered faction checks. Native RAM estimates remain valid (daemon 5.95 GB; guarded backdoor worker 6.7 GB). Files synced without pending updates or sync errors; inspected controller logs showed no new runtime errors. No reset or installation was forced solely for testing.


### Early faction-work reassessment after membership changes

The faction worker observes membership changes from its existing player snapshots. During reputation grinding, it additionally probes only the membership list at most once per normal five-second work poll. Changes remain latched until the main planner resets its work scope and acknowledges them, rather than waiting for the ten-minute periodic priority review. Membership ordering and duplicate entries do not cause false wakeups; same-count membership changes do.

Reassessment uses the existing first/skip, preferred faction, gang and activity policies. It does not directly stop work or force a specific new faction. Explicit continuing crime/karma modes retain their existing boundary rules. Pauses and maintenance yield without launching a membership query; temporary probe failures leave work running, warn once per failure streak and retry later. Existing player snapshots avoid duplicate membership probes, and scope messages now reflect the reassessed priority level.

QC: 655 project tests passed, 172 JavaScript files passed syntax checks and whitespace checks passed. Coverage includes membership latching/acknowledgment, five-second throttling, ordinary snapshot reuse, probe failures, pause handling, the actual reputation-loop guard and the planner's scope reset. Files synced; the native faction-worker RAM estimate is valid at 5.35 GB. Inspected controller logs showed no new runtime errors. No faction membership or reset was forced solely for testing.


### Progression-aware IPvGO opponents

Automatic opponent selection reads fresh, current-reset spending/progression signals before each new game. Hacking bottlenecks favor the hacking-level opponent and Illuminati speed; reputation/combat/economic phases choose their corresponding benefits while retaining the BitNode baseline as a secondary priority. Stale or unavailable planner evidence falls back to the existing node goals. BN8 does not prioritize ordinary hacking-money gains.

Selection compares recent log multiplier gain per minute for each established board size and cheat mode. Board experiments are scheduled after opponent ranking and explicitly identify the comparison board, so a cold board trial cannot stall exploration by suppressing the incumbent score. Switching an established opponent requires a 15% score advantage, except for bounded trials and explicit/achievement choices. New records carry individual timestamps; samples expire after thirty minutes, and untimed legacy history remains available only to the existing board policy. Measured rates already include losses and diminishing multiplier gains. Opponents with fewer than three recent matching samples receive at most one trial per eight completed native games; unavailable opponents retain their five-minute cooldown. Opponent trials use the established board rather than combining two experiments.

Faction membership and the remaining SF14 favor allowance provide a bounded secondary preference. This is favor progress, not spendable faction reputation, and reaching the allowance never caps the opponent's global multiplier. Explicit opponents/goals and explicit board sizes remain authoritative; achievement streak protection suppresses opponent/board trials. Selection reasons, matching sample counts, rates, trial status and remaining favor allowance are visible in tasks/go-status.json. No additional UI windows open.


IPvGO opponent QC: 672 project tests passed, including 17 new selection regressions, and 174 JavaScript files passed syntax checks. Both VM controller harnesses now import the selection policy. Three matching zero-gain samples remain measured evidence with zero utility rather than reverting to an optimistic prior; malformed null history entries are safely discarded during recording. Coverage includes live/reset-scoped planner signals, stale/future/legacy samples, board/cheat matching, one-in-eight opponent trials, favor caps, explicit choices, achievement protection, switching hysteresis and separate board experiments. Native go.js compilation/RAM is valid at 9.75 GB. The game reports Go playing, no Go error, and files synced with no pending updates; inspected dashboard logs contain no new runtime errors. No native game reset was forced for QC.


### BitNode-aware World Daemon / Bladeburner route selection

Autopilot now defaults to automatic route selection. BN6/7/9/10/13/14 start with a Bladeburner preference; BN1/3/5/15 start with World Daemon; BN2/4/11/12 use a weak WD preference until comparative evidence exists. BN8 excludes Bladeburner. Preferences are heuristics, never measured ETAs. Source File/API access, native restrictions, pauses and achievement controls exclude unavailable BB automation. Explicit --node-route wd or --node-route bb overrides automatic decisions; unavailable explicit BB reports unavailable instead of silently choosing WD. --adaptive-node-route false retains the legacy WD preference.

Complete, actionable ETA ranges can replace a BN preference only when the challenger is at least 25 percent faster across ranges for two minutes, with fresh evidence in the same reset. Early WD prerequisite stages and observed combat-entry/rank milestones are shown separately. Unsafe BlackOps, unknown augmentation development, regeneration, or post-install XP remain unknown; partial forecasts never become full completion times. BN12 uses current native multipliers and observed rates rather than treating every level as the same run.

BB priority disables automatic continuous hacking XP and directs adaptive spending toward combat. --force-xp preserves an explicit XP override, and measurement/achievement XP requests still apply. Existing faction-work yielding, sleeve routing, Simulacrum handling and BlackOp protection continue through live route plans. Before joining BB, its controller may train combat with short income-producing crimes under an activity lease, respecting protected work, pause, maintenance, Source File and achievement controls. It stops only its own matching entry crime upon reaching the threshold. Casino and transition owners retain priority.


Route QC: added 24 regressions covering every BN preference, Source File/native/achievement/pause restrictions, explicit/legacy overrides, measured comparison stability, reset/freshness boundaries, XP handoff, partial WD/BB development estimates, finite native grind supply, generated snapshot execution, and serialized entry-worker ownership/protected-work/casino guards. Native RAM review moved entry APIs into literal temporary-worker sources, removing their 16.5 GB addition to the persistent BB controller. Autopilot and the faction controller compile at 5.85 GB and 5.35 GB; BB compiles at 81.95 GB with its existing recruitment-exit API costs. Low-RAM starts continue to defer unavailable controllers through the existing launch/headroom checks. In-game BN9 now selects the labelled BB prior, adaptive spending reports combat, and the daemon no longer starts in automatic XP-only mode. Entry training correctly defers while another activity owns focus. No reset, installation or forced interruption was performed solely for QC.


### Native temporary-worker filename fix

Live error review found Bladeburner repeatedly failing to start actions because the default helper filename included namespace arguments, commas and brackets from a serialized function call. Default names now extract only a bounded ASCII namespace identifier, or use a deterministic command hash when no ordinary namespace reference exists. Worker command hashes and per-PID receipts still isolate concurrent queries; ordinary ns-function result filenames remain compatible. Bladeburner action starts additionally use the explicit /Temp/bladeburner-start-action.txt result path.

QC: all 700 tests passed and all 176 JavaScript files passed syntax checks, including four new regressions for namespace arguments, multiline/computed/unicode/long expressions, ordinary filename compatibility and the explicit BB path. Files synced without pending updates or connection errors. Only the idle BB script was restarted after native getCurrentAction returned null, because supervisor reload was deferred by another protected activity. Existing stock holding warnings and gang territory-tick resynchronization warnings were classified separately from the repeating runtime failure.


### BB focus protection and warning clarity

Automatic infiltrations now defer while a live BB route plan reports Simulacrum not installed. Existing manually started infiltration UIs are still detected and assisted before the automatic-entry gate. --ignore-node-route explicitly permits automatic entries during BB priority. The entry worker, combat-stop worker and final UI-entry check repeat the live owner/reset/freshness guard so a changed route cannot slip past a previous decision. Already-started infiltrations continue to completion. Unknown or queued Simulacrum is not treated as installed; stale route plans do not reserve focus.

BB clears old assignment tracking when deliberately yielding to an activity, WD priority or known player work. Unexpected action changes remain warnings, state only the observed transition rather than diagnosing native automation, and repeat at most once per transition per minute. Existing hash controllers are informational only after checking their processes; true launch failures still warn. Stock minimum-hold safeguards are informational. Isolated fast stock ticks are diagnostics, with warnings retained for persistent rapid ticks. Gang timing resync retains its recovery behavior and escalates after three consecutive misses, at most once a minute.


### HGW timing and outcome measurements

Hack/grow/weaken workers now compare observed completion against the planned deadline, with a tolerance of half the inter-leg spacing (5 to 250 ms). Nominal late starts that are compensated through additionalMsec no longer toast. A zero-money hack, growth factor <=1, or zero security reduction is recorded separately as an outcome, not diagnosed as a timing failure. Native operation exceptions remain exceptions and are recorded before rethrowing. Looping workers retain their existing period and owner-stop behavior.

Port 20 is reserved for synchronous bounded HGW telemetry aggregation. Standalone remote workers require no deployed imports. Each completed operation merges counters into one shared message without awaiting; targets and recent events are bounded. The daemon drains it into tasks/hgw-misfires.json, preserving totals across daemon reloads within the same augmentation/node reset. Alerts are limited to once per target/tool per minute; silent mode suppresses alerts while retaining measurements. Foreign port traffic is preserved and reported as blocking measurement. Standalone workers without daemon metadata retain local deadline alerts. The dashboard and read-only Remote API automation.status expose the measurements. Observed late completion is a timing risk, not proof that in-game batch effects were applied out of order.


Native integration review confirmed 1.85 GB hack and 1.9 GB grow/weaken workers. Timing metadata is JSON encoded because native script arguments accept only strings, numbers and booleans. The daemon was refreshed to apply this format; Remote API policy 16 refreshes the agent for the new read-only timing status field. Diagnostics failures are isolated from production scheduling. Syntax and whitespace checks passed; no unit tests were added or run in this implementation turn.


### Bladeburner team opportunity costs

Team preparation now opens within two minutes of the next Black Op's rank gate, based on at least one minute of observed rank progress (up to five minutes retained). Healthy, fully synchronized sleeves can supply this squad in parallel. Below the rank gate, useful rank work takes priority over human recruitment; early human recruitment is limited to forecasts within two minutes when no positive-rank action was selected. Recovery, protected activities, and the rolling recruitment budget still apply.

Ordinary operation planning compares zero to three spare human recruits. It reserves the pending Black Op squad, excludes support sleeves from expendable capacity, and charges expected casualties as recruitment replacement time. A team must improve conservative rank throughput by over ten percent against a viable solo plan. Successful operations can lose up to ceil(team/2) members; failed operations can lose the full assigned team. Plans restore temporary levels and squads; action start rechecks the current reserve and native success chance and restores settings on failure. No recruitment is performed solely to supply repeatable operations. Native auto-repeat can consume recruits between controller ticks, so this is a conservative forecast rather than a casualty guarantee.

The BB Team tooltip reports the next Black Op, rank gap, measured rank ETA, team cap, healthy sleeves, expected recruitment time, and remaining hourly budget. No tests were added or run for this implementation request.


QC follow-up: fixed unnecessary team restoration for level-only action plans, and rejected malformed success intervals before accepting an already-sufficient lower bound. The early recruitment timing gate is now a directly checked pure policy. Eleven new regressions cover casualty replacement costs, a meaningful throughput advantage, Black Op reserves, supporting sleeves, unknown recruitment estimates, probe cancellation/errors, fresh reserve checks, rejected starts/assignments, late cancellation, restored settings, early recruitment timing, and serialized helpers. All 711 tests passed; syntax checks passed for all 177 JavaScript files; git whitespace checks passed. The game reported 81.95 GB controller RAM and the sync service reported no pending files or errors. This does not establish a measured progression speedup or guarantee casualties under native auto-repeat.


### Live-game bottleneck follow-up

Hacking pacing uses deltas from completed-operation telemetry, not lifetime warning totals. After a window of at least 30 seconds and 20 completions, at least three late completions and a late fraction of 5% trigger 1.5x spacing (up to 4x), at most once per minute. The future target cap falls with spacing. Three windows at <=1% late, with a two-minute cooldown, restore pacing gradually. Missing/blocked/stale evidence holds the current setting. Existing jobs are not killed. tasks/hgw-pacing.json records the decision and automation.status exposes it. Lower utilization cannot immediately undo the target cap.

All hash spenders now re-evaluate a common route reserve immediately before each synchronous purchase. A live Bladeburner spender reserves the next rank purchase; skills take priority once the rank gate is reached or when they cost less than half as much. Only actions configured on live spenders are reserved. Other purchases can use surplus. If a priority cannot fit in capacity, imminent overflow remains spendable and the existing capacity-upgrade path stays active. Missing/expired route evidence retains ordinary behavior. Existing World Daemon/achievement/pause protections remain.

During a Bladeburner route, infrastructure allowances are capped at 2% each for home (after 128 GB) and purchased servers, and 5% for Hacknet per budget epoch. Nearby reputation-ready augmentation goals with a useful route bonus lower the Hacknet allowance to 2%. Candidate bills must have known purchase prerequisites, fresh reset-scoped evidence, and cost between 25% and three times current cash. The Hacknet payoff horizon is capped at two hours for Bladeburner, or one hour for a nearby augmentation goal, including BN9; explicitly shorter limits win. Essential home RAM funding is retained. Unused allocations stay as player cash, not redistributed spending.

Queued augmentations no longer block all grafts indefinitely. A fresh reset countdown owned by the live autopilot still blocks them; the planner clears pending intent when it defers installation. Grafting rechecks that intent before spending/travel and before starting. Existing grafts, Black Ops, program creation, maintenance, shared budgets and payback checks stay protected. Native reset-plan checks do not infer a countdown from the queued augmentation list.

Corporation records now carry node and augmentation reset identity. Read-only API status rejects archived, stale, future-dated or orphaned records without deleting history. Remote API policy 17 refreshes the agent for the scoped status and pacing fields; no command permissions were added.

QC: all 723 tests passed, including twelve new focused tests and the updated queued-augmentation regression. All 179 JavaScript files passed syntax checks; whitespace checks passed. Native API confirmed 5.85 GB autopilot and 5.95 GB daemon scripts. Files synced with no pending updates or connection errors. Live pacing widened from 4000 to 6000 ms and reduced the future target cap to one after seven late completions in a 40-operation window. The Bladeburner spender purchased rank while the server-upgrade spender retained the shared reserve. Infrastructure caps and absent corporation status were visible through the API; no runtime errors appeared in the captured post-reload logs. This validates integration, not a measured long-term progression speedup.


### Shared augmentation cash and chance-bound development

Fresh, live-autopilot augmentation savings goals are now enforced as cash floors in shared spending claims and stock transactions, including synchronous native trade and stock-access workers. An explicit zero stock reserve cannot bypass this goal. The goal expires with its plan or reset; missing/malformed/dead-owner data does not strand cash. Essential home RAM purchases below 128 GB retain funding, and stock sales retain their prior control and liquidation semantics. This protects new purchases; it does not force-liquidate existing positions.

Gang training is no longer permanently disabled after the initial 200-second default window. Older members can train when the modeled incremental output over working repays lost work within the configured horizon. --no-training retains the old initial-window restriction. Invalid projections and zero-value training do not keep old members in training. Live QC observed an older member assigned Train Combat. Task assignment now distinguishes maintenance/pause deferral, already-applied native state and actual native rejection; failed orders alone are reported as failures.

When rank is sufficient but the next Black Op's lower success estimate is unsafe, skill spending favors native marginal chance multipliers and effective combat improvements. Unrelated cheap money, contract-only and speed skills no longer drain points during this bottleneck; points are banked if the useful skills are unaffordable. Context is refreshed after each purchase. Stamina shortage admits Cyber's Edge. Evasive Systems uses its native 4% level multiplier with a half-weight combat contribution. Outside the chance bottleneck, existing skill selection remains active. This is a conservative marginal ranking, not a complete simulator of each Black Op's stat weights.

Chance-blocked actions can prioritize Field Analysis for a range spanning the success threshold, or Training for combat and stamina development. Training is limited to two minutes per rolling ten minutes, respects the existing training limit, and yields to health, stamina, chaos recovery, recruitment and protected Black Ops. Accounting survives controller reloads and does not credit a prior reset's interrupted action as continuous training. tasks/bladeburner-development.json records the decision and rolling budget.

Adaptive hacking recovery accepts clean sparse windows after eight completed operations and two minutes. Two such windows permit gradual recovery, while normal traffic still needs three clean windows. Silence is not a clean sample and fresh overruns prevent recovery. Target caps use rounded concurrency so partial recovery can restore a second target earlier. tasks/hgw-pacing.json reports observed completion throughput separately from the late fraction. These measurements do not establish profit throughput or a progression speedup.

QC: all 738 tests passed, including fifteen new checks for native stock reserve injection, live/reset-scoped cash floors, serialized shared spending, extended gang training and task deferrals, blocked Black Op skill choices, refreshed skill context, bounded development, and sparse recovery. All 180 JavaScript files passed syntax checks; whitespace checks passed. Native RAM remained 81.95 GB for Bladeburner and was 13.85 GB for stockmaster. Sync reported no pending files or errors. The latest captured post-reload logs contained no runtime errors; supervisor reported no pending updates. Live gang training and pacing telemetry were observed; long-term progression gains remain unmeasured.


### Alignment with installed Bitburner 3.0.1

Autopilot now queries stock.hasTixApiAccess(), allowing the existing helper to translate the modern spelling for version 2 when needed. Live QC revealed that restoring detection also activated the old 8-billion stock-capital target and starved all spending allowances. That optional target now yields to a selected Bladeburner route or a fresh nearby augmentation savings goal. Casino funding, Red Pill reservations, pending augmentation purchases and the existing early cash buffer retain their prior precedence.

bladeburner-action-data.js contains all 21 native BlackOp kill/stealth flags, stat weights and decay coefficients. Every record was compared directly against official v3.0.1 BlackOperations.ts and matched exactly. Chance-bound skill selection now includes Short-Circuit for kill operations and Cloak for stealth operations. Combat upgrades are evaluated by their relative change to the native weighted competence sum, including Reaper/Evasive multiplication and the action's stat decay exponents. Direct success skill benefits use the native marginal linear level multiplier. Fresh native chances, costs, ownership and protected-action checks remain authoritative; this is not an unrestricted speculative purchase worker.

Sleeve crime scoring, opening gang ETA/subset planning, ordinary crime selection, homicide thresholds and the serialized low-RAM casino funding worker now receive the effective CrimeSuccessRate before the probability cap. sleeve.js obtains native BitNode multipliers with the existing source-based fallback when SF5 is unavailable. Autopilot passes its existing multiplier into the seed worker. BN14's 0.4 multiplier can alter the best crime after probability saturation, so it is applied separately for every candidate.

Sleeve faction task selection follows the native hacking, security and field expressions, including intelligence, the distinct divisors, share power and effective SF15 level-3 charisma bonuses. The native getSharePower() API already returns the calculated share bonus; no second logarithmic conversion is applied. Unsupported work types are excluded. Favor and other common same-faction multipliers are omitted only because they cannot affect the task ranking. Share input is refreshed in a temporary worker and effective SF15 access uses the existing override-aware Source File handling.

QC: all 750 tests passed; all 182 JavaScript files passed syntax checks; whitespace checks passed. Twelve new source-alignment checks include 486 combinations of faction-work stats/share/SF15 context, skill category applicability and native competence, probability saturation, startup ETA, the low-RAM seed worker, input propagation and the restored stock reserve's funding priorities. Native RAM confirmed 81.95 GB Bladeburner and 20.15 GB sleeves. Source metadata was independently compared against the official pinned v3.0.1 file. Sync reported no pending files or errors, and the captured post-reload logs contained no runtime errors. Native logs also showed the bounded Bladeburner Training mode followed by normal contract work. Long-term speed gains are not established by these checks.


### Automatic StormSeed recycling

- Scouts publish fresh surveys of neighbours, blocked RAM, caches, contracts and the native `STORM_SEED.exe` program. Busy or missing scouts block recycling, including unsolved labyrinth/frontier hosts.
- The manager requires the entire reachable network to be surveyed, rewards exhausted, and topology unchanged for five minutes. State survives manager restarts and is scoped to the BitNode reset; dispatch attempts have a conservative 30 minute cooldown.
- A separate helper runs on the seed holder, keeping the native StormSeed API cost out of low-RAM scouts. It rechecks current rewards/processes and cancels expired requests, maintenance, or failed checks. Missing access/API errors are caught.
- A webstorm replaces/restarts much of the network; normal scout deployment then rebuilds exploration. It does not grant an immediate reward. Disconnected or unknown regions cannot be certified exhausted; any discovered frontier lacking a fresh completed survey prevents automatic recycling.

- StormSeed QC: 757 project tests passed, 185 JavaScript syntax checks passed, and Git whitespace checks passed. Remote API confirmed connected with no pending sync files or sync error; updated manager deployed a 7.65 GB scout. No storm was forced during QC.


### Chance-blocked Bladeburner progression and hacking pacing

- During a fresh, live Bladeburner Black Op chance bottleneck, default adaptive sleeve management can borrow one fully synchronized sleeve with shock at most 50 for free combat-XP crimes. Other shocked sleeves recover. Native expected XP includes failure-quarter XP, per-stat XP multipliers, shock, sync and BitNode crime success. Casino and gang-karma milestones, explicit sleeve settings, disabled XP and the selected route remain authoritative. `--disable-combat-xp-support` retains full recovery.
- HGW telemetry retains all raw deadline warnings and adds half-leg-spacing risk counters. Adaptive pacing uses the new counters only when every operation in a window has spacing evidence; mixed/legacy windows retain the old conservative behavior. Recovery still needs measured clean windows. Fresh, validated pacing state survives controller reloads.
- First-BN9 reset economics remain protected; status now distinguishes weak route gains, unknown rebuild costs and excessive payback. No augmentation reset or storm was forced during QC.
- Live validation confirmed sleeve 4 doing Mug (five completed crimes) while six sleeves recovered, updated spacing counters arriving without operation errors, and the explicit first-BN9 reset-hold reason.

- Final progression QC: 768 tests passed; 187 JavaScript files passed syntax checks; Git whitespace checks passed. Live API showed one combat-XP sleeve and six recovering, spacing-aware pacing active, zero HGW operation errors, no sampled manager runtime errors, and no pending sync files. Longer-term throughput gains have not yet been measured.


### Follow-up progression review fixes

- Reset count gains require crossing the configured installed augmentation threshold from below. NeuroFlux and duplicate names do not build the count; the count bonus does not apply to the Bladeburner route.
- StormSeed helpers retrieve current pause and maintenance files from home before the final synchronous reward/process checks. Failed copies or malformed maintenance records defer the attempt; stale local control copies are ignored when home has no corresponding flag.
- Dispatches have reset-scoped identifiers and matching result receipts. Only confirmed native success starts a 30 minute storm cooldown. Failed launches, cancelled helpers and missing receipts have a one minute attempt delay, while the existing network readiness and quiet-period requirements remain in force. Receipt IDs, host, reset and timestamps are validated before accepting success.
- Combat XP sleeves finish an already invested crime before selecting another crime or worker. Higher priority milestones, disabled support, shock/synchronization eligibility and route changes still take precedence.
- QC: 773 project tests passed, 187 JavaScript files passed syntax checks, and Git whitespace checks passed. Live verification showed `completingCrime: true`, the preserved BN9 reset hold, an active updated Dark Net manager, no pending sync files and no sampled runtime errors. Storm success/failure/cancellation and pause behavior were exercised with mocked game APIs; no live storm or augmentation reset was forced.


### Native-source progression improvements (v3.0.1)

- Removed fictitious direct Black Op chance gain from Cyber's Edge. Native max-stamina changes preserve the current stamina percentage. The ordinary skill planner can still buy endurance upgrades outside a chance bottleneck.
- Manager and scouts try the synchronous native `connectToSession` path for saved credentials on nonstationary servers. Rejection, absent APIs and unsupported token lengths fall back to authentication. Blank saved credentials are supported. Stationary/story servers keep their existing authentication path.
- Sleeve crime ranking estimates the pending Black Op competence gained per second using its stat weights/decays, the native logarithmic XP-to-level sensitivity, player stat multipliers, sleeve XP multipliers, shock/sync, failure-quarter XP and BitNode level/crime modifiers. This is a local marginal estimate, not a completion forecast. Existing crime completion protection remains authoritative. Status labels the scoring metric.
- StormSeed now requires six minutes of measured zero native Dark Net income and no recent cache reward, in addition to full network readiness. Productive networks are retained because future replacement rewards are unknown. Native income is read directly rather than parsed from formatted messages; cache helpers publish reward timestamps through scout surveys. Unknown, reset or stale evidence starts a new observation window. The reported income opportunity cost assumes 30 seconds of storm plus a conservative five-minute deployment allowance; that allowance is an estimate, not a benchmark.
- QC: 781 project tests passed and 189 JavaScript files passed syntax checks; Git whitespace checks passed. Live verification showed the targeted sleeve score active, all three relevant controllers running, no sampled runtime errors and no pending sync files. Native scout RAM is 7.70 GB, retaining room on 16 GB darkweb. No live storm or reset was forced; long-term throughput gains are not yet measured.


### Gang development improvements

- Regression tests first reproduced three reviewed issues: accepting ascension forecasts with unguaranteed equipment restoration, order-dependent adaptive thresholds, and rejecting bounded recruitment investments on direct cash payback alone.
- Ascension forecasts use only retained augmentations and compare post-reset production with natural growth from continued work. The native worker rejects any restoration-dependent forecast. Adaptive eligibility uses the configured base multiplier threshold, then economic payback; legacy spacing remains under `--disable-adaptive-growth`. Native respect-loss and imminent-recruit guards, per-member cooldowns, and one successful ascension per pass remain enforced.
- Training compares 20/60/120/200/300 second durations over the configured growth horizon. Both continued work and trained work use the same bounded timeline, include natural XP and task unlocks, and require a five percent production advantage. Productive members preserve imminent recruits; protected cases skip unnecessary forecasting. Status includes per-member forecast decisions.
- Equipment retains direct production-payback ranking and adds a recruitment exception when it saves at least 20 seconds and two percent of next-recruit ETA. Its entire batch is capped at one percent of currently available player cash and the remaining shared allowance. Explicit money focus disables the exception; equipment/augmentation budget limits and native purchase guards still apply. Respect gains are evaluated on each member's actual task.
- Final QC: 789 tests passed, 190 JavaScript files passed syntax checks, and Git whitespace checks passed. Live controller confirmed all eight productive members preserving the imminent ninth recruit (15,101 / 15,625 respect), with no sampled runtime errors or pending sync files. No ascension was forced during live QC; sustained speed gains are not yet measured.

## Gang productive time and economics

Gang members resume their previous productive tasks immediately after a territory tick, before development calculations. The status includes postTickRestoreMs. Surviving members already working or training are left on those tasks; pause and maintenance guards apply to each restoration.

Equipment valuation separates cashPaybackSeconds from progression utility. Only schemaVersion 2 production opportunities with measured-formula incremental cash qualify for extra shared cash funding. Recruitment and reputation opportunities share a bounded 1% discretionary allowance and respect explicit equipment budgets.

Work selection, training and equipment forecasts share the same goal-derived objective. Forecast task choices honor wanted headroom with the other crew assignments held fixed. Ascension forecasts integrate the entire crew, working XP, retained augmentations, training downtime, global wanted effects and a modeled cost for delaying recruitment. Native execution rechecks crew membership, respect, wanted and expected respect loss. Recruitment and training forecasts remain estimates, not promises of measured earnings.

Territory timing now discards unknown phases after maintenance and misfires. Members wait for a fresh rival power update before entering warfare again; completed territory still receives periodic development passes. This prevents repeated stale-deadline warfare windows.

## Shared hash spending and marginal value

Every automated hash consumer now checks hash-spending-policy.js immediately before its native purchase. Fresh route ownership, reset identity, maintenance, achievements and available hashes are rechecked. Casino bootstrap cash and reachable reserved augmentation bills can take precedence over Bladeburner reserves.

Bladeburner rank purchases record their observed rank and skill-point yield. Known maximum-rank evidence values only new high-water rank at a conservative one SP per three rank; unknown history permits at most one observation purchase per augmentation reset, costing no more than half the next direct-SP purchase. Zero-yield observations cannot repeat speculatively. Future purchases compare rank-derived SP against direct SP and rank gates. Observation cost is a bounded experiment, not a guaranteed profitable purchase. Source File dependent rank calls are confined to the dedicated worker; other consumers use fresh Bladeburner telemetry.

Automatic server boosts require reset-scoped profitability analysis, current income-mode RAM assigned to that server and modeled repayment within thirty minutes by default (never more than one hour). Analysis gainRate is interpreted as dollars per RAM-second. A pending augmentation reset blocks discretionary investments. Predictions remain approximations; server money softcaps and disabled income allocations are handled conservatively.

Automatic gym/study upgrades require at least a minute of estimated remaining training, at least twenty seconds of modeled savings and a cash-equivalent cost under 1% of unreserved player cash. Current automated training callers use a bounded fifteen-minute estimate. Corporation hash purchases require an operating-cash shortage or a research milestone within one 1,000-point purchase, with the same 1% cash opportunity-cost cap. Contract generation requires a verified solver, no unresolved network contracts and a 0.1% cash opportunity-cost ceiling.

Cash overflow converts automatically in v3.0.1. Automatic cache expansion therefore only serves a useful reserved purchase that cannot fit, with a 1% player-cash cap and the existing shared expense claim. Cache selection compares added capacity per dollar among affordable choices. Explicit manual goals can request capacity for an unreachable configured action.

Hash worker flags: --automatic defaults true. --manual disables investment-value estimates for explicit goals; --ignore-route-priority separately overrides the route reserve. Achievement, maintenance and owner guards remain active. Bladeburner checks for a worker with both rank and SP capabilities, and retries missing workers once per minute instead of accepting a cash/server worker by filename alone.

Each worker and consumer writes bounded per-PID decision records containing costs, cash-equivalent opportunity cost, reserve/preference and reasons. Current API status and the reliability dashboard expose the latest 24 fresh records for live owners. Existing API workers pick up the extended top-level status on their next restart; dashboard diagnostics are also available to older status readers after the supervisor reloads.


## Stock transitions and adaptive sleeve purchases

Stock-focus direction changes now retire only controller-owned work through the phased hacking drain. Live loop inventory is reconciled every five seconds; split grow/weaken jobs count as one scheduled loop, while hack counts retain all worker threads. Urgent home RAM reclamation precedes background stock refreshes.

Sleeve augmentation purchases now compare crime income, karma, or combat XP against continuing without a sleeve skill reset. Adaptive batches must fit the shared allowance and the original planned cost, and all quotes are checked before buying. Decisions and receipts appear in sleeve status under `purchasePlans`. Missing stats or an unpriced task defer the purchase. Faction, company, class, and Bladeburner task estimates are not implemented yet.

Use `run sleeve.js --disable-adaptive-augmentations` to explicitly retain budget-only purchases. This option retains reserve, pause, maintenance, eligibility, cooldown, and achievement checks.

### Gang equipment bundles and progression purchases

Adaptive gang equipment buying evaluates missing items against the current shadow crew after every purchase. If no affordable single qualifies, it evaluates same-member pairs among the twelve cheapest missing items in each category (permanent augmentations or temporary equipment). Combined stat multipliers can expose task improvements that neither item unlocks alone. This is bounded pair search, not an exhaustive portfolio optimizer.

Alongside cash payback and recruitment ETA, the existing shared progression allowance can fund at least a 2% improvement in that member's feasible objective. This allowance remains capped at 1% of spendable cash per planning pass, with shared spending limits, category limits, reserve and augmentation cash targets still enforced. Respect gains never count as cash payback. Explicit money focus disables this progression allowance. Temporary equipment is excluded for members already selected to ascend; equivalent-return ties favor permanent augmentations.

Bundles reserve their full quoted cost before the first purchase. Fresh prices, cash and pause guards are checked before buying; an unexpected native rejection stops the rest of that bundle. The game provides no atomic purchase or rollback, so partial purchases remain possible if a native call unexpectedly fails. Successful receipts are reported individually.

Gang status includes equipment diagnostics: ownership/missing counts, initial single-item qualification and rejection counts, budget blocks, bounded rejection samples, pair evaluations, planning time, planned cost and native receipts. Diagnostic ownership is captured before purchases; `equipmentOwnership` in gang status reports the refreshed inventory after purchases. Production opportunities retain separate cash payback telemetry for the shared spending planner.

### Stock signals, crew equipment forecasts, and sleeve work valuations

Stock manipulation snapshots now carry schema version, producer PID, capture time, both reset IDs, and a mock flag. The daemon requires a live stockmaster producer, a snapshot no older than sixty seconds, and valid mapped symbols and positions. Legacy, partial, malformed, mock, and stale signals disable new stock directions; existing owned stock work is retired through the recovery drain. Direction reversals also retire obsolete stock loops outside stock-focus mode. On exit, stockmaster removes its own signal file even with HUD disabled. Status reports the validation reason through `stockManipulation` in the existing Remote API status response.

Equipment progression forecasts use deterministic, wanted-constrained whole-crew task allocation. Gear can gain value by making one member a better wanted reducer and freeing another member for productive work. The shadow planner invalidates all member candidates after any purchase, caches equivalent stat quotes for that crew state, and stops further search after an approximate 100 ms planning budget. A single evaluation already in progress may overrun the budget. Diagnostics report incomplete searches; the next tick can price further purchases. Mandatory training and imminent ascension protections remain active; actual task optimization is seeded with the same deterministic allocator. Cash payback still uses incremental income from current work, so speculative reassignment is not treated as cash already earned. These are immediate rate forecasts; changes in future wanted penalty and recruitment behavior are not fully simulated.

Healthy sleeve augmentation quotes can use native work formulas for faction reputation, company reputation, university courses, and gyms. Both continued work and installation with reset skills are projected over at most fifteen minutes; native XP gains rebuild the sleeve's skills during the projection. Reputation and work utility must improve by more than ten percent. Formulas or required Source File access failures defer purchases. The temporary forecasting helper is self-contained and does not charge its native formula API RAM to the long-running sleeve controller.

General Bladeburner Training, Field Analysis, and Diplomacy use coefficients from the official v3.0.1 source. Support and synthoid infiltration have no stat-dependent augmentation benefit. Recruitment and contract purchases remain deferred because their changing team/success conditions are not modeled safely. Forecasts ignore XP from other sleeves, do not assume future task changes or company promotions, and use thirty-second integration steps. Existing reserves, shared budgets, shock checks, cooldowns, and minimum batch size still govern native purchases.

Native references: [work formulas](https://github.com/bitburner-official/bitburner-src/blob/v3.0.1/src/Work/Formulas.ts), [general Bladeburner actions](https://github.com/bitburner-official/bitburner-src/blob/v3.0.1/src/Bladeburner/data/GeneralActions.ts), and [Bladeburner rewards](https://github.com/bitburner-official/bitburner-src/blob/v3.0.1/src/Bladeburner/Bladeburner.ts).

### Stock checkpoint continuity and gang maintenance diagnostics

Stockmaster checkpoints at most 151 price samples per symbol, forecast phase and held-age metadata under `tasks/stock-history.json` (mock runs use a separate file). Quick reloads can resume a checkpoint only within fifteen seconds, in the same reset, mode and forecast settings, with all fresh native bid/ask quotes unchanged and the previous producer exited. A quote change cannot establish how many ticks were missed, so it requires a cold start. Corrupt or oversized checkpoints are rejected. Estimated forecasts are recalculated from raw prices; native positions, cash and 4S forecasts remain authoritative. Held age survives only when all native position fields still match.

A restored first refresh does not invent another market tick. Fresh manipulation signals are published on every refresh after reading native positions, including when prices have not changed. Bid-only price changes now count as market ticks. Stock status reports checkpoint restoration outcome and history length. Checkpoints are local runtime data and are excluded from repository-to-game file sync.

Gang maintenance retains the last complete status from the same PID and reset. `at` remains the controller heartbeat, while `dataAt` stays at the last complete observation through repeated maintenance. New complete observations replace both timestamps. Shared budget progress uses `dataAt` for freshness, so retained diagnostics cannot keep an obsolete territory measurement active indefinitely. Foreign-owner, wrong-reset and future-dated measurements are discarded.

### Split-loop capacity, observed sleeve XP and stock uncertainty

New looping HGW jobs carry one job ID and expected total thread count across every fragment. The home coordinator compares native live thread totals with that contract and a reset/owner-scoped local ledger. Partial loss, excess capacity, inconsistent metadata and disappearance of a previously known group trigger target recovery through attack, grow and weaken phases. Jobs without capacity metadata remain unmeasured; incomplete host scans cannot update the ledger or advance recovery. Finite workers in the same target still gate recovery. Unsupported or reset-incompatible loop protocols are not forced to stop. The ledger is capped at 2,048 groups, prioritizing damaged groups and reporting untracked groups; the local ledger is not copied to worker hosts. Fully disappeared healthy groups beyond the retained ledger cannot be reconstructed from metadata alone.

Sleeve XP observation requires at least two healthy, fully synchronized observers and two stable thirty-second windows. It uses the minimum observed shared XP rate across observers and recent windows, subtracts the candidate's own XP contribution with a timing margin, and discards calibration after task changes, XP resets, gaps, owner/reset changes or observed bonus cycles. Incoming XP affects projected skill rebuilding; receiving augmentation XP multipliers do not multiply it, and it is not counted as the candidate's own output. Crime subtraction reserves for discrete completion bursts. Observed XP is credited for at most ninety seconds, rather than assuming it continues through the entire fifteen-minute forecast. Missing or stale observations keep the own-work-only fallback. Post-install crime stats now use native zero-XP skill reconstruction with level multipliers immediately.

Estimated stock forecasts use a Wilson bound with z=1 toward the neutral midpoint, replacing the normal approximation that had zero uncertainty at all-up/all-down endpoints. The `probStdDev` compatibility field now stores the toward-neutral confidence margin. Current 4S forecasts retain their native values and zero estimated uncertainty. Restored checkpoints recompute the same margin from raw prices. This is a sampling heuristic; it does not establish that serially correlated game returns have the stated statistical coverage. Trading thresholds are unchanged.

### Estimated stock exits, launch manifests, and sleeve reputation audits

- Ordinary estimated stock exits confirm weak reversals or low returns over two to three distinct observed market ticks. A three-tick forward loss estimate above the sale commission requires two observations; lower-confidence signals require three. This is bounded noise filtering, not a profit guarantee. Strong reversals and native 4S exits remain immediate; explicit liquidation and cash raising bypass this policy. Entry commission is a sunk cost and is not used to justify holding.
- Fully launched income batches commit their expected looping groups to the controller's reset-scoped capacity ledger before returning success. Failed launches never commit; rejected or throwing commits roll back the batch's new workers. The 2,048-group bound rejects untracked batches. Existing XP loops continue to acquire capacity records from inventory, so whole-job loss before their first scan remains a follow-up opportunity.
- Sleeve status now includes a read-only reputation accuracy audit. Native per-cycle reputation quotes are converted to per-second rates, integrated across ten-second samples, and compared with thirty-second reputation changes. Task/job/favor/multiplier changes, resets, owner changes, sampling gaps, shock, incomplete synchronization, stored bonus cycles, and competing player/sleeve/gang producers invalidate the window. Deviations above 25% are flagged as unexplained changes. These approximate diagnostics do not retune forecasts or spending; donations or producer changes between samples may contaminate a window. Missing API/formula access defers gracefully. No helper runs when reputation work or Singularity access is absent.

### XP loop launch records and dependency upload order

Standalone looping XP jobs now write expected capacity before their first worker starts. One record covers all fragments, so partial allocation and whole-job loss remain detectable before the first inventory. Failed manifest writes prevent new workers starting. Finite jobs skip this record, income batches retain their existing commit behavior, and pause/maintenance is checked again after the write. Recovery still follows attack, grow, then weaken phases.

The local Remote API listener now orders changed uploads by relative module dependencies, traversing unchanged intermediate modules. Each upload is read back before its importers are exposed; mismatches or connection changes abort the pass. This addresses temporary missing-export errors when a controller arrives before an updated policy. Cyclic module groups cannot be uploaded atomically by the native API and retain deterministic traversal order. The listener was restarted to activate this behavior.

### Fresh launch RAM, independent reloads, and compact diagnostics

- XP worker RAM is recalculated after awaiting the launch manifest write, immediately before execution. Unsplittable jobs require their complete fresh capacity; partial split jobs retain the expected full capacity for recovery.
- During grafting, program creation or Black Ops, only stockmaster.js, gangs.js and corporation-manager.js may reload independently. Activity locks, casino/reset transitions, unknown protection state, RAM limits, and daemon recovery drains retain their guards. Independent reloads during protected work do not request global maintenance. Stats retains its existing exception.
- Remote command policy 20 makes automation.status compact: bulk logs, file audits and recent event arrays are omitted; other arrays, objects, strings and nesting are bounded. Explicit _diagnostics metadata identifies omissions. The returned diagnostic data has a 65,536-byte UTF-8 limit; transport envelopes add overhead.
- automation.logs optionally accepts one managed script name and returns the latest twenty stored lines per selected process. automation.files accepts an optional nonnegative offset and a page size from 1 through 100, returning an audit page and nextOffset. Both use the same byte bound. These are fixed, read-only diagnostic queries; arbitrary file reads remain unsupported.
- Generated jobs are self-contained. Existing workers must adopt policy 20 before the compact status and added methods become active. Autopilot already refreshes workers when it adopts a changed policy; protected work may defer that activation.

### Independent API worker upgrades and dashboard summaries

- The reliability supervisor now owns idle-only Remote API worker upgrades. It debounces source signatures for ten seconds, preserves RAM headroom, blocks under hard activity/reset locks or unknown protection, waits for pending/running commands, and limits failed restorations to three per fifteen minutes. Completed result files are retained; requests are not replayed by the upgrade helper.
- Worker heartbeats report activePolicy and the loaded source signature separately from the legacy policy field. Managed upgrades preserve the legacy value expected by an older running autopilot. Current workers are not downgraded, and compatibility survives stale-heartbeat recovery. Updated autopilot only starts a missing worker; it no longer replaces workers based on policy inequality.
- The read-only supervisor may adopt its own updates during soft protected work, retaining hard-lock, pending-restore, debounce and RAM checks.
- tasks/dashboard-summary.json contains bounded summary data and trusted owner/reset/time metadata. Routine API status prefers this file only while fresh (under thirty seconds), owned by a live supervisor in the current reset. Missing, stale or invalid summaries fall back to the detailed dashboard. Logs and file-audit queries continue to use detailed data.
- Command validation/constants now live in the import-free remote-api-command-policy.js. The local listener reloads this module independently, avoiding stale renderer/helper imports in Node's module cache. The existing remote-api-command.js exports remain compatible.

### Diagnostic cadence and upgrade explanations

- Health summaries and warning checks remain on the ten-second supervisor cycle. Detailed logs and the full dashboard are materialized once per minute, including the initial pass. The lightweight warning feed scans the same last 120 native log lines, classifies warnings before shortening strings, deduplicates messages, retains up to 24 recent entries for five minutes, and reports tracked/omitted process counts (maximum 32 tracked). These are observed messages, not proof of current failure or a lossless event stream.
- Detailed log/audit queries expose their older snapshot timestamp. The dashboard UI prefers the fresh summary and falls back to detailed data if required manager/pending fields were truncated. Summary production preserves all manager entries within its byte budget rather than applying the compact API's eight-entry array limit.
- Supervisor update status explains settling, protected activity, paused state, pending restorations and retry limits. Native handoff checks add waiting-activity, waiting-process or waiting-ram with available, required and shortfall RAM values. Existing activity, retry and RAM headroom checks remain enforced.
- Combined lifecycle tests execute the actual autopilot worker-start block with the supervisor upgrade helper and real worker heartbeat. They cover low RAM, a failed replacement, autopilot restoration, legacy policy preservation and avoiding repeated replacement.
- The command facade exports its already imported policy bindings locally. Relative re-export sources are avoided because the native RAM calculator treats their paths differently from ordinary imports; the former form caused zero RAM quotes despite valid JavaScript syntax.

### Native preflight, fresh logs, and warning observations

- Run `npm run check:game` from the local repository before manual restart workflows. It issues the read-only `automation.preflight` query for all 26 allowed entrypoints. To check selected scripts, use `npm run check:game -- daemon.js reliability-manager.js`. Set `BITBURNER_REMOTE_API_DIR` if the local listener tools are outside the default Documents/Codex/bitburner-remote-api folder. The command fails on missing, invalid, unavailable, empty, incomplete or failed native results.
- Native preflight quotes RAM without running scripts. It does not guarantee successful JavaScript module execution, Source File access, or every runtime feature. Existing cooperative reloads retain their native RAM checks. Remote `start` now validates a finite positive quote and available RAM before clearing a pause; returned failures and thrown launch errors restore an existing pause.
- Command policy 21 adds `automation.preflight` (no arguments checks the full allowlist; optional arguments are managed script names) and `automation.logsFresh` (exactly one allowed script name). Neither exposes arbitrary file access or code execution.
- Fresh logs come directly from current native processes, newest PID first: up to four instances, ten lines each, and 256 characters per line, with omitted-process counts and an overall 65,536-byte diagnostic data bound. Missing processes yield an empty current sample; per-process read failures are reported. `automation.logs` retains the cached detailed snapshot behavior.
- Warning entries report firstSeenAt, lastSeenAt, observations, visibleCount, lastNewOccurrenceAt and confirmedOccurrences. Observations count polls where the message is present; confirmedOccurrences is a conservative lower bound based on increases in matching text within the sampled 120-line window. Identical retained windows do not inflate occurrence counts. lastSeenAt means presence in the sampled window, not proof the warning was emitted again. Full-line fingerprints distinguish messages before their display strings are shortened. Entries expire five minutes after they leave the observed window.


IPvGO timing exposes `earlyPasses` as the subset of accepted passes requested by the settled-position policy. It is available in live timing and completed-game timing records; rejected, stale and failed submissions do not increment it. This counts usage, not turns saved or measured throughput gains.


IPvGO pads the board with synthetic walls only when `isPattern` first runs for a native snapshot. Subsequent pattern checks reuse that padding; every new snapshot invalidates it, including reused arrays. Early-pass, tactical, search and opening decisions do not prepare the pattern board. This reduces allocation, without changing matching rules or claiming a measured native-turn speedup.


IPvGO evaluates native-valid move candidates in a synchronous batch. Cached board analysis is validated once per batch, then reused by a private evaluation core. Standalone `goMoveOutcome` retains its stale-analysis check; changed or foreign analysis is recomputed. Legality filtering and result values are unchanged. This reduces repeated signature allocation without implying measured gameplay throughput gains.


IPvGO move and capture evaluation reuse private flat orthogonal-neighbor index tables for native board sizes 5, 7, 9 and 13. Tables are written only during construction and never exposed through analysis or results. Diagnostic sizes get temporary tables, so persistent cache size remains bounded at four. Board-specific groups, liberties and stale-analysis checks remain separate. Frozen nested arrays were rejected after CPU benchmarks showed a regression.


IPvGO group/liberty traversal uses the same private neighbor tables and an integer stack, removing per-stone neighbor-coordinate arrays and queued coordinate pairs. Public stone coordinates, chain enumeration order, group membership and liberty sets remain unchanged. Independent coordinate-based analysis remains in tests as the correctness and CPU baseline.


IPvGO assigns cell-to-chain IDs when a stone is first processed during group traversal. The same map acts as the visited marker, removing the per-chain visited set and post-traversal labeling scan. Stones are marked when popped, preserving the prior depth-first order. Empty and blocked cells keep ID -1. Exhaustive 3x3 analysis comparisons and a previous-indexed-version CPU baseline cover the change.


IPvGO hypothetical moves derive the merged friendly-chain size from deduplicated chain lengths. Captured points become liberties only when adjacent to the new stone or a neighboring friendly-chain ID. This removes per-candidate own-stone Set construction and repeated enumeration of friendly stones. Independent copying comparisons include every empty point across all 3x3 Black/White/empty layouts and larger capture interiors.


IPvGO capture evaluation now accumulates capture counts and exposed liberties directly while visiting each captured enemy chain. Chain IDs already prevent duplicate visits, so no captured-stone Set or list is needed. Captured interior points remain excluded from the resulting group liberties unless they directly border that group. Tests cover repeated contact, mixed captures, 49-stone captures and the exhaustive independent 3x3 comparisons.


IPvGO allocates a friendly-chain ID set on first neighboring friendly contact, and an enemy-chain ID set only for neighboring chains capturable at the candidate point. Isolated moves allocate only their liberty set. Mixed and enemy-only captures retain chain deduplication and null-safe friendly membership checks. Allocation-count tests instrument the private evaluator without adding runtime telemetry.


IPvGO filters enemy chains by sole-liberty capture eligibility before recording them. Noncapturable neighbors allocate no enemy collection and do not enter the capture loop. Eligible chains remain deduplicated before count/liberty accumulation. The synchronous evaluator preserves the prior capture conditions and all existing stale-analysis checks.

When a candidate touches neither a friendly chain nor a capturable enemy chain, IPvGO returns its directly adjacent empty-space liberty count without entering merge/capture handling. Blocked and edge cases and captures without friendly neighbors remain covered by independent simulator comparisons.


## IPvGO benchmark isolation

Routine `npm test` runs IPvGO correctness checks while skipping CPU microbenchmarks. Run `npm run bench:go` for the benchmark-only comparison set in one test process. Benchmarks are diagnostic and impose no timing pass threshold. Keeping them separate reduces routine QC time and avoids mixing correctness-run load into benchmark comparisons.

The short neighbor-ID list prototype remains test-only: independent checks passed, but its CPU comparison showed no consistent benefit. Production retains on-demand hashed sets. No gameplay speedup is claimed from the rejected prototype.


## Native IPvGO replay benchmarks

`go.js` retains up to twelve validated Black-to-play board/legality snapshots in `tasks/go-replay.json`, sampling at most once per minute from observations already used for normal play. Duplicate board/legality/opponent states are ignored. Reset changes start a new corpus. Set `--benchmark-samples false` to disable recording. Recording failures are shown in Go status without stopping play.

`npm run bench:go:replay` retrieves the current corpus through the fixed read-only `automation.goReplay` query and compares per-candidate versus batched evaluation using native legality masks. Use `-- --save <file.json>` to export or `-- --input <file.json>` to replay offline. No live moves or board resets are submitted. Results report legal candidates and excluded empty points; these CPU comparisons do not establish reward-per-minute gains. The benchmark does not reconstruct full game history or measure search-tree legality beyond the saved native root mask.

### Replay sample diversity

When the twelve-sample corpus fills, retention prioritizes distinct board sizes, opponents, size/opponent pairs, and density strata, then balances samples across strata. Ties replace the oldest sample. Redundant new samples are skipped if retaining them would reduce coverage. Density is occupied stones divided by non-blocked points: sparse below 25%, developing below 65%, otherwise dense. This is a phase proxy; captures can lower density. The recorder never changes opponents or resets boards to obtain coverage. Existing schema-1 corpora remain compatible. Replay benchmark output now includes coverage and each sample's density stratum.

### Replay benchmark provenance

Replay CLI reports include SHA-256 hashes for the evaluator, replay policy, benchmark core, CLI and provenance helper, plus the parsed corpus hash. Source hashes normalize CRLF/CR to LF; corpus hashes use `JSON.stringify` of the parsed corpus, making input indentation irrelevant while retaining property order and all data. Reports include creation time, Node/V8 versions, OS/architecture, CPU model and logical CPU count. Sources are checked before dynamic evaluator imports and again after measurement; a change rejects the report. Source paths are repository relative. The exported corpus stays schema 1 and is not wrapped in report metadata. Metadata records local benchmark conditions; it does not identify the game's own runtime or measure in-game reward gains.

### HGW warning severity and timing inspection

HGW retains every raw deadline-overrun counter. Misses below the conservative half-leg-spacing threshold are throttled INFO logs without warning toasts. Spacing risks and native errors remain warnings; separate minor/risk throttle keys prevent minor misses hiding later risks. Missing spacing retains conservative warnings labeled as unknown risk. Standalone worker fallback toasts use the same threshold.

`automation.hgwTiming` is a fixed read-only, zero-argument query. It returns reset-wide cumulative counts separately from up to twenty events from the live owner in the last two minutes, including deadlines, launch/unavoidable lateness and the threshold classification. Pacing is included only when fresh and owner/reset matched. Stale, missing and offline data are explicit states. It does not establish actual completion-order inversions. Command protocol version is 24.

### Observed HGW batch order

Ordinary scheduled batches now share an ID built from reset timestamps, daemon PID and a monotonic sequence. Each worker receipt carries the planned steps/deadlines, its step and its actual allocated threads. Split weaken receipts must cover all expected threads before a step is considered complete. Existing metadata and flags are preserved. Looping, manual and untagged legacy work are not certified.

`automation.hgwTiming` adds up to eight batch summaries derived from the bounded recent forty-event buffer, current owner and two-minute age limit. States are ordered, inverted, timestamp-tie, partial, failed or inconsistent. Repeated identical PID receipts are deduplicated; conflicting manifests/PID receipts and excess threads cannot prove ordering. Ordering requires every planned thread to be observed and each step's final completion strictly before the next step's first completion. It does not check cross-batch interference or change backoff settings.

### Hacking target switch payback and income reporting

The daemon now considers up to eight ranked alternatives plus the incumbent every five seconds in ordinary single-target money mode with native Formulas access and fresh complete capacity inventory. Quotes model the existing steal fraction, resident batch RAM, one-core growth, current pacing, and preparation waves. Switching charges full incumbent income during drain, preparation and first-receipt delay; it requires at least 25% projected advantage, repayment within half a horizon capped at thirty minutes, sixty-second candidate confirmation and a three-minute cooldown. A fresh route ETA can shorten the horizon. Running batches are not killed. XP, hack-only, manual, looping, stock-focused and multiple-target modes retain normal selection. Unknown quotes fall back to normal ordering.

`tasks/hacking-target-plan.json` records quotes, comparisons and decisions. Overview adds Hack Plan and Hack Real during ordinary money hacking, and Hack Proj when a quote exists. Missing Formulas access or multiple-target mode is explained without suppressing receipt measurement. Observed income uses gross owner-scoped hack receipts over at least sixty seconds and two completions, independently from model estimates. Wallet, stock and other income cannot inflate it. Reset/owner changes, stale evidence and target-set changes restart sampling. These observations are not causal upgrade measurements or guaranteed realized income. Remote status includes the plan under hackingProcessObservation.targetPlan.

A live pending augmentation-install plan blocks new target switching by shortening its investment horizon. A zero route ETA does likewise. Revenue measurement restarts after five minutes to bound the observation window.

### Remaining target drain estimates

The existing synchronous process inventory now records bounded batch deadlines for all HGW workers affecting each target, including foreign workers as uncertainty. No additional host scan is performed. Fresh, complete, owner/reset-matched snapshots can price a target's remaining drain from its latest future worker deadline plus at least one leg of padding (minimum 250 ms). New launch attempts invalidate the snapshot until the next inventory refresh. Unknown/foreign/manual/looping/legacy/overdue work, incomplete scans and snapshots older than 7.5 seconds retain the full-weaken fallback. Queued deadlines farther away than a weaken duration are allowed to increase the drain estimate. No observed workers yields a zero estimate only from a valid complete snapshot. These are planning estimates, not proof that workers have completed; final launch/capacity guards remain authoritative. Quotes and payback comparisons expose the drain basis.

For mixed known/uncertain workers in an otherwise valid snapshot, the fallback also honors the latest validated future deadline; it cannot shorten already known queued work.

Drain planning padding uses at least five distinct current-owner batch receipts within two minutes, spanning one second, from fresh unblocked reset-matched telemetry. It retains the configured floor and adds 250 ms above the maximum observed completion delay. Split fragments count once per batch. This estimates planning overhead; it does not certify completion or change worker spacing. The plan exposes `drainPadding` evidence.

Workers and the telemetry collector retain up to 64 representative delay receipts from distinct batches for two minutes, independently of the raw event buffer. Only the current owner is retained by the collector. Each batch maximum keeps its original timestamp; smaller later receipts cannot refresh an old maximum. This is delay evidence, not batch-completion certification.

Progress acceleration: Bladeburner can quote bounded combat preparation before its next rank gate. Training must beat rank work's competence growth by 25%, have enough remaining training budget, and leave at least five training durations (minimum two minutes) of measured rank runway. Health, stamina, chaos and Black Op protections remain ahead of preparation. The default helper rank gate remains unchanged unless explicitly opted in.

During gang startup, sleeves can compare free crime conditioning against evolving direct-karma work and measured recovery-first output. Forecasts include own XP at full/quarter success/failure rates, shock attenuation, node and skill multipliers, and karma earned during conditioning. Only one current karma worker can receive a new conditioning assignment, requiring a 10% estimated earlier gang unlock. Unfinished crime assignments are preserved; casino seed, explicit training disable and disabled sleeve XP gates retain priority. Planning has a 20 ms cooperative budget and is advisory, not a promised ETA.

Hacking pacing may recover by a factor of 1.5 rather than 1.25 when a clean counter window also contains at least three distinct, completely observed, strictly ordered HGW batches from the current owner/reset. Existing clean-window counts, two-minute cooldown, configured minimum and the floor justified by current observed delays remain enforced. Partial, tied, inverted, failed, foreign and untagged work cannot accelerate recovery.

Bladeburner Training quota is now scoped to the pending Black Op: --training-limit bounds 30-second equivalents for each milestone, and 0 disables it. The lifetime counter is retained only as an accounting source. Per-target usage survives hot reloads. A new milestone/controller/profile gets a bounded two-equivalent observation probe within the remaining quota. Continued Training requires useful consecutive XP observations, clipped to the model, and at least 10% more competence growth than available mission work. Missing/stale/zero progress can receive another bounded probe only after ten minutes. All probes consume the same quota and rolling two-minute-per-ten-minute budget. The general fallback now checks that time budget too. City baseline and final growth choice share the payoff gate. Sampled player XP can include external gains; clipping prevents it from exceeding the model but does not establish a causal Training gain. The development record exposes trainingMilestone with counts, evidence and reason.

Joined-player combat conditioning can now compare local gyms and fast crimes against Bladeburner's own Training at confirmed action boundaries. Quotes require Formulas.exe, use native per-cycle gym and per-crime work gains, and request full focus. Active Bladeburner bonus time conservatively raises the native comparison fivefold. Candidates must improve modeled competence gain by 25%, fit up to 30 seconds, retain cash/augmentation reserves, and leave five session durations of rank runway when rank is still needed. Gym bursts use a small dedicated training allowance on the Bladeburner route and at most 1% of currently unreserved cash. A held gym budget can fall back to a qualifying free crime; unavailable formulas retain native Training.

Tasks/bladeburner-training.js is a real RAM-accounted worker with parent/lease, route/reset, health, pause, achievement, transition and protected-work checks. It monitors at 200 ms intervals, renews its short lease, and stops only tracked work. Installed The Blade's Simulacrum preserves parallel native Training; queued copies do not count. All bursts charge the same milestone quota and rolling time budget. External XP is kept separate from empirical native Training probes. The parent keeps its heartbeat and home RAM headroom while awaiting the worker. --disable-external-training opts out. Burst receipts retain predicted gains and before/after XP for later calibration; those observations are not causal proof because other XP sources may contribute.

The new worker is compile-only diagnostic and cannot be remotely started/stopped. Command policy version is 25, with preflight still restricted to allowlisted scripts and now bounded to 48 names to accommodate the 33rd entrypoint.

External training keeps a bounded ten-minute calibration history per controller, reset, target, city, multipliers and native quote rates. Only complete 15–31 second sessions with unchanged profiles contribute. At least three distinct sessions totaling 60 seconds are required before an estimate can be reduced; measurements never increase the native model. Unknown sleeve access is not treated as zero background: two zero-shock, fully synchronized observers must agree on shared physical XP deltas, or a successful native query must confirm zero sleeves. Eligibility is checked during the session. Parallel native Training is deducted using a conservative fivefold rate bound plus one completion. Interrupted work, resets, changed profiles and missing background evidence retain the formula estimate. Receipts expose acceptance and background status; they do not establish causal gains from every possible outside XP source. Expiring observations allow later retries after an option is discounted.

Native Bladeburner Training observations now subtract the synchronized-sleeve physical XP pool before estimating payoff. Player and sleeve endpoints are captured in the same synchronous turn. Other Singularity work, unknown sleeve access, mismatched observers and interrupted measurement continuity cannot produce a new sample. Existing uncorrected evidence is discarded while milestone quota and cooldown accounting survive. Corrected evidence remains capped by the native model, retains the existing five-minute freshness limit and does not prove causal gains from every possible outside XP source. The development record exposes evidenceVersion=2 and backgroundStatus.

Native Training measurement windows now end only after a valid observed wrap of the same General Training action clock. A clock wrap is evidence of a completion or restart, not a universal success counter; the public success-counter API does not support General actions. Windows aggregate for at least 15 seconds, retain background correction and continuity guards, and remain capped at 120 seconds. Short bonus-time cycles accumulate before sampling. Missing, unchanged or invalid clocks cannot generate samples. A changed action duration restarts empirical evidence. Evidence version 3 discards older non-aligned samples while preserving quota and probe accounting. Sampling can miss wraps when polling lands at the same phase; that uncertainty retains bounded probes and cooldowns rather than inventing completion evidence. Wall-clock rates remain clipped to the native model.

The existing action-progress monitor now requests native success counters only for contracts and operations. General and Black Op progress still use clock wraps, avoiding repeated calls to an unsupported API.

External gym/crime comparisons now include native Training's permanent stamina bonus (.04 times the Cyber's Edge stamina multiplier before the max-capacity multiplier), plus agility-XP capacity growth on both sides. The model compares terminal effective competence for the pending Black Op at full recovery after its stamina cost. Capacity above twice that action's cost has no additional chance-penalty value in this model. Bonus time retains the conservative fivefold native comparison. Installed Simulacrum only preserves native capacity benefits when native Training is actually active; a changed parallel state defers the start. Unknown native stamina data defers external conditioning. Receipts expose predicted capacities, penalties and the full-recovery assumption. These are marginal planning estimates, not promises about current stamina or future action success, and do not yet price long-term regeneration/duty-cycle benefits.

The parent Bladeburner growth decision now values eligible missions and native Training using the same pending-Black-Op stamina model as external conditioning. It evaluates every eligible mission, credits agility capacity growth on both sides, and credits the permanent bonus only to native Training. The reference rank job receives the same valuation before the early-development runway comparison. Raw XP rates and xpScore remain available; the existing empirical Training payoff, quota and recovery checks still decide whether Training is permitted. Fresh native context includes player, stamina, Cyber's Edge and Training duration. The horizon is at most 30 seconds and bounded by remaining development time; normal-speed marginal full-recovery forecasts are used, retaining raw XP comparisons when the optional quote is unavailable. City and level/team planning remain on their existing XP objective, and long-term regeneration/duty-cycle gains are not yet priced.

City and level/team growth objectives now share the parent's stamina-adjusted evaluator, including native Training baselines. Serialized workers explicitly embed their pure dependencies, quote one city-independent native Training reference, and retain the original post-cost safety, stock, squad, support and restoration guards. Planning horizons match the final growth decision: at most 30 seconds, bounded by remaining development time. Maximum stamina and the horizon participate in cache keys; current-stamina noise alone does not invalidate the city objective cache. Plans expose scoreBasis while retaining the legacy combat-xp objective tag for compatibility. Rank-only phases keep their rank objective, and missing optional stamina data retains XP scoring. Normal-speed marginal full-recovery forecasts are still used; bonus depletion and longer-term regeneration are not yet priced.


Bladeburner growth forecasts now spend a single finite bonus-time budget across the whole mission/recruitment/cleanup/recovery duty cycle. The fluid estimate holds one engine tick of backlog in reserve, runs between normal and fivefold speed, and is limited to the same 30-second development horizon. Native Training XP and permanent stamina capacity share that clock; external gym/crime work receives no Bladeburner acceleration. Cache observations track depletion in engine-tick buckets and saturate when enough backlog exists for the full horizon.

Mission quotes now retain their recovery-time decomposition. One midpoint estimate of agility-driven capacity and regeneration reprices only explicit recovery time, preserving recruitment and chaos maintenance. Improvement is capped by the original combat duty fraction; raw XP rates remain available for empirical gating. This is a marginal planning estimate rather than an exact tick/completion simulation or a measured speed gain. Native calibration continues using its conservative fivefold attribution bound. Existing safety, rank-runway, cash reserve, quota and empirical eligibility checks remain in force.


Short Bladeburner growth forecasts now count whole amortized action cycles, with at most one reward per wall-clock engine tick. Mission cycles retain their recruitment/cleanup/recovery cost, and regeneration repricing preserves the original per-completion XP reward. A cycle that cannot fit receives no XP/capacity credit. Native Training XP and permanent stamina use the same integer completion count; external gym/crime comparisons retain the native whole-completion alternative. The final parent and external worker may credit valid current General Training progress; city/level probes deliberately assume fresh starts, keeping their cache independent of active action phase. Missing or malformed optional progress reads retain zero progress. These remain bounded planning estimates: upkeep is amortized, bonus work uses the conservative fluid clock, and future action-duration or probability changes are not simulated.


The final Bladeburner growth decision can now reuse current repeatable-mission progress from the same fresh synchronous native quote as its stamina and Training context. Reuse requires matching type/name, city, level, team and duration, a snapshot no older than five seconds, disabled autolevel, and a plan that will not restart the action. Missing/unsupported native APIs, malformed clocks or changed/restarting configurations retain zero progress. General Training and Black Ops cannot supply mission progress. City and level/team probes continue to assume fresh starts. Mission XP rates and per-completion rewards remain unchanged; progress only advances the whole-cycle completion budget. The public API reports current estimated duration, not the hidden original start duration, so these are guarded marginal estimates, not exact replay of every manual intervention.


Growth forecasts now cap repeatable-mission completions at currently available whole, unreserved attempts from the controller's existing reserve policy. The cap is applied before regeneration estimates and again to final whole-cycle valuation, including bonus-time and carried-progress scenarios. Parent, city and level/team growth paths receive the same reserve-adjusted stock; relevant stock changes invalidate their caches. Native Training remains unlimited by mission stock. Explicitly unknown or malformed supply receives zero credit, and missing optional stamina data retains a stock-capped XP comparison. Standalone legacy quotes with no supply field retain their prior behavior. Future passive stock generation is not assumed, and runtime availability/reserve guards remain authoritative when other scripts or sleeves consume stock after a quote.

Cache stock budgets saturate at 30 attempts, the maximum completion count in the 30-second forecast. Decreases in abundant stock therefore do not trigger unnecessary city/level probes; depletion below that ceiling still invalidates plans.


The final parent growth ranking now compares a bounded two-mission fallback after a scarce first mission exhausts usable stock. It checks at most eight prefix and eight fallback candidates, searches whole wall-clock seconds for prefix exhaustion, debits one shared bonus budget including the controller's configured update interval (at least one second) as switching time, and starts the fallback with zero carried progress. Both actions retain stock caps. Coupled cleanup/recruitment overhead is excluded from pairs when its independence cannot be established. Combined raw XP is valued once at the full-recovery endpoint, avoiding duplicate capacity benefits; raw first-action rates remain available to live attribution/skill consumers. Native Training is compared as before and cannot enter a forecast pair, preserving its empirical eligibility and quota gates. The existing rank-work opportunity comparison uses the same per-first-action forecast. Only the first mission is selected; the second is advisory and must pass fresh runtime checks when the controller reselects. City/level probes retain their single-mission stock-limited objective. This bounded marginal forecast is not an end-to-end ETA or a measured speed gain.


City growth selection now compares the same bounded two-mission fallback forecasts as the parent. Each synchronous city probe retains its chosen eligible quote per action, then combines only that city's quotes using a shared native Training/stamina reference. The callback adds no native API calls. Stock caps, bonus depletion, whole cycles, switching delay, excluded coupled maintenance and restoration guards remain in force. Rank-only city objectives retain their original behavior. City rows expose optional fallback diagnostics; a winning Training baseline removes mission-pair diagnostics. The city cache includes the configured switching interval. Only the first mission/level is proposed, and runtime reselection revalidates any later fallback. Each action currently contributes the level chosen by the single-mission level objective; a joint level/fallback search is not performed.


Joint level/fallback growth comparisons now retain at most three safe quotes from existing level probes: the best single-job score, fastest probed level, and highest safe probed level. No new native probes are added. City and parent rankings may combine these level variants while preserving per-action stock sharing and the existing eight-by-eight pair budget. Fallback diagnostics include both levels. Parent selection propagates the chosen first level, metrics and chance into the existing guarded action-start plan, and growth skill quotes require the live level to match before using its rates. Operation variants remain within the team already selected by the team planner; unpriced replacement-cost variants are discarded. Rank-only planning retains its previous result shape. This bounded search does not enumerate every level/team/pair combination.

The bounded prefix/fallback pools prioritize distinct mission names before filling remaining slots with alternate levels, preventing one mission's variants from excluding all partners. Selected plans are copied rather than mutating cached single-job plans, and level diagnostics are published once after growth selection.


### Route-aware augmentation reset horizons

Ordinary augmentation reset payback keeps a four-hour default. A current-reset, actionable route forecast no older than 45 seconds can extend this to half its conservative lower remaining-time estimate, capped at twelve hours. Both the default and extended horizons are limited to 75% of the projected remaining route time. Missing or invalid lower bounds cannot extend the default. Autopilot passes the same validated forecast to gain planning and the final reset guard, which recomputes the limit rather than trusting a saved horizon. Install-versus-wait comparisons use this common horizon; the fifteen-minute shared wait deadline, recovery protection, casino accounting, known-rebuild requirements, and milestone exceptions remain in place. The current limit is published as paybackLimitMs in progression-speed diagnostics. These are heuristic economic projections, not guaranteed completion times.


### Measured hacking reset recovery

Autopilot observes the existing route snapshots to time recovery of the pre-install hacking level after normal augmentation installs. It persists a bounded eight-sample history in tasks/hacking-recovery.json. Samples expire after 24 hours and cannot cross BitNodes. Stale observations, route changes, capacity changes and mode changes discard incomplete measurements. No install or player action is triggered to collect data.

The daemon publishes a separate owner-independent recovery signature alongside its existing owner-bound XP capacity signature. Recovery comparisons still include mode, configuration, targets, hardware and looping worker allocations. Planning can replace the fifteen-minute hacking fallback only with comparable samples whose target is at least the current hacking level and whose strongest observed hacking and XP multipliers during recovery are no stronger than the current ones. It uses the slowest matching duration with a one-minute floor. Harder targets and unavailable evidence retain the fallback. Ordinary reset economics waits while a fresh recovery measurement is in progress; milestone exceptions retain their existing behavior. These measurements describe observed wall time and do not guarantee future recovery speed.


### Separate hacking income recovery

Autopilot reads existing qualified managed-hacking income diagnostics and records time to restore a sustained pre-install cash rate, independently from hacking-level recovery. Wallet changes, casino winnings and stock sales are not inputs. A baseline and restored income both require two distinct, non-overlapping qualified windows of at least two minutes each, at least thirty receipts per target, no observed timing risks, and no more than 25% rate variation. Rates must cover the same measured targets, server money/security context, pacing and structural hacking capacity.

Records are scoped to the BitNode and reset, with at most eight completed samples expiring after 24 hours. Owner replacement restarts rate confirmation, while cross-reset structural signatures allow comparable history. Changed mode or context and long observation gaps discard incomplete measurements. Reusing a recovery time requires a recorded rate at least as high as the current baseline and current multipliers no weaker than any observed during the recovery. The slowest matching duration is used; missing income evidence retains a fifteen-minute income-mode fallback. XP-only mode does not impose an income recovery requirement.

Capability and income recover concurrently, so reset economics uses the maximum of their durations, followed by the existing casino allowance. Fresh pending income recovery blocks ordinary economic resets; explicit milestone exceptions remain as before. The progression-speed diagnostics publish separate recoveryComponents. No benchmark reset or player action is triggered. These observations cover qualified managed hacking receipts, not every player income source, and do not guarantee future throughput.


### Hacking-specific income continuity

Income measurement windows now use a versioned continuity signature containing hacking and intelligence skills, every hacking/hacking_* multiplier, server money/security context, daemon arguments and pacing. Combat/social skills and unrelated multipliers no longer restart accumulation. Existing owner, reset, allocation, gap, counter and timing-risk checks remain unchanged. Older rows without the new signature must rewarm rather than reusing an unverified window. The full native signature is still refreshed on every row, preserving existing hash-calibration compatibility and its conservative full-context guards.

The dependency choice was checked against official src/Hacking.ts and src/Server/formulas/grow.ts. A controlled ten-minute replay with strength changing every five seconds produced zero qualified observations before this change and 97 of 121 afterward, including the initial two-minute warmup. This measures diagnostic availability, not a live income or progress speed gain.


### Reputation augmentation economics

Reset planning now values faction reputation through a bounded useful-unlock comparison on both routes, replacing the hacking route's unconditional faction_rep weight. It evaluates at most four useful, reachable targets with the existing shared-reputation/mixed funding planner. It compares keeping current reputation against a post-install plan starting with zero reputation, zero cash and no committed donation credits. Native donation conversion and current eligibility are carried by the faction snapshot. Favor gains, unlocked donation access after reset, and cheaper post-reset augmentation prices are not credited without a quote.

Work-rate credit requires consecutive observations while working for the same faction, and uses the lower observed rate. Repayments still include the existing capability/income/casino recovery allowance. Reputation benefit uses the strongest single useful unlock rather than adding overlapping faction goals; it is combined with route gain using the maximum to avoid assigning the same progress twice. Install-versus-wait planning applies the same model to its prospective basket.

Purchase basket cuts can reuse a current-reset reputation context no older than one minute and matching the exact native ownership signature. They compare the full retained basket's reputation benefit against each possible cut, including dependent losses; a live combat score no longer suppresses reputation-only augmentation value. Missing evidence retains heuristic purchase weights, while unmeasured reputation gains cannot independently authorize an economic reset. The horizon is bounded and all quotes are estimates, not guaranteed unlock times.


### Measured faction rejoining and work recovery

Progression observations retain a faction-specific baseline for the currently observed work assignment. After an ordinary augmentation install, the observer records native joined membership separately from regaining the prior stable reputation-work rate. Invitations never count as membership. It does not force joins, assignments or resets. Records live inside the persistent speed observation, with at most sixteen samples expiring after 24 hours and reset/BitNode checks. Interrupted measurements, changed faction/job and invalid data cannot complete a work sample; a verified earlier join observation may still support a donation estimate.

Reusing measurements requires comparable native faction favor and reputation multiplier, plus the same work type and an adequate recorded target rate for work readiness. The strongest conditions observed during recovery are retained, and the slowest matching delays are used. No additional native worker is launched; existing work snapshots now include job type and native favor/multiplier metadata.

Reputation forecasts price the chosen funding plan using rejoining delay for donations and rejoining/work readiness for work. Only the excess beyond the existing capability/income/casino recovery allowance is added. If measurements could change which method is fastest, the bounded planner also considers donation-only and work-only alternatives. Missing history leaves the prior allowance in place; measurements do not guarantee future unlock times.

### Gang augmentation planning

Gang purchase goals include the complete gang-offered prerequisite closure, including otherwise undesired prerequisites. Missing/cyclic chains are rejected, shared prerequisites count once, native queued prices and the current Source-File-adjusted purchase multiplier determine total cost, and the highest chain reputation requirement determines the unlock. Owned prerequisites contribute neither cost nor a new reputation requirement.

Progression snapshots include native gang identity and its current respect-to-reputation production rate. Consecutive observations cap measured gang reputation at current production and use the lower stable rate for reputation-augmentation valuation. Gang reputation runs alongside sequential player faction work; passive-only waits retain normal income. Funding plans expose passive waits separately and never direct player faction work toward the gang. Reset comparisons still rebuild faction reputation from zero and retain existing recovery and spending guards.

Faction-work startup compares gang offers with alternate suppliers using current native reputation and fresh reset/ownership-matched measured rates. An unlocked alternate always remains available. Unknown alternate rates also remain available; the gang suppresses redundant work only when already unlocked or demonstrably at least as fast. The existing disable-treating-gang-as-sole-provider-of-its-augs flag bypasses this preference entirely. Shared augmentation prices make reputation readiness the provider-specific comparison; the purchase planner still handles cash and prerequisite funding.

These are bounded forecasts, not measured live speed gains. Gang goals still rank completion time, and adaptive task focus retains its existing recruitment safeguards and cash-threshold heuristic.


### Gang augmentation readiness focus

After twelve recruits, adaptive gang focus compares wanted-safe whole-crew money, respect, and three balanced objectives by time until both the current augmentation-chain cash and faction-reputation goals are satisfied. Respect conversion uses current native player multiplier and faction favor. Spendable player cash subtracts the shared reserve; other repeatable cash is credited only from a fresh current-reset progression quote and excludes the observed gang cash rate. The native Formulas rate table reprices the selection when available. Explicit focus flags, pre-twelve-member recruitment priority, training locks, and wanted recovery remain authoritative.

The chosen objective is shared by task allocation, training, and equipment forecasts. Its feasible assignment seeds the regular optimizer, and gang-status exposes the candidate quotes. A freshly repriced incumbent is retained unless another candidate improves the estimated completion time by at least five percent. Missing evidence retains a balanced objective when both resources are short, replacing the arbitrary half-cost cutoff. Forecasts hold quoted production constant and do not simulate future training, ascensions, bonus-time depletion, or a planned mid-course switch.


### Staged gang augmentation production

The purchase focus selector now evaluates ordered pairs of its bounded wanted-safe crew plans. Each quote considers current cash and reputation gaps, credits both rates during each stage, and prices the switch with twenty seconds of zero production. A first stage must last at least twenty seconds. Piecewise-linear breakpoints include each first-stage resource completion, the second-stage bottleneck intersection, and the minimum first-stage duration. Plans that cannot fund both resources, or do not beat either component's fixed assignment, are discarded.

Only the selected first-stage assignments are applied. Ordinary gang cycles reprice the remaining gaps and native rates; no unattended delayed task switch or guaranteed future production is scheduled. Matching staged orders receive the existing five-percent switching margin, using freshly computed costs instead of saved ETAs. Diagnostics expose both task stages and the conservative switch allowance. Recruitment, training locks, wanted limits, explicit focus overrides, and cash reserves remain authoritative. No bonus-time speedup is credited.

This remains a bounded steady-rate projection; future ascensions, equipment purchases, changing reserves, and missed territory-cycle scheduling can change realized readiness. Multiple stages and future changes in training are not simulated.


### Equipment versus near-term augmentation readiness

After recruitment, when a native augmentation focus context exists, equipment selection checks a bounded affordable shortlist against the same fixed/staged augmentation readiness planner. It subtracts the purchase cost and all earlier batch spending, projects the upgraded member and whole crew task rates, and rejects purchases that delay a reachable useful augmentation within the smaller of fifteen minutes or the current growth horizon. Shared cash reserves remain outside the spendable balance. Whole-bundle stat multipliers and costs are assessed together.

Existing equipment return thresholds and category/shared budgets still apply. Recruitment, explicit focus overrides, disabled adaptive growth, unavailable augmentation evidence, and goals beyond the bounded horizon retain their existing growth policy. Guards run at most eight times per batch by default. Sixty-five percent of the soft planning time budget is reserved for initial equipment valuation; remaining time supports readiness checks. Exhausted guard budgets defer purchases rather than bypassing the check. Diagnostics report rejected purchase delays, and rejected offers cannot become new equipment funding opportunities.

These are point-in-time forecasts. Native execution still enforces current prices, shared budgets, reserves, owner validity and pause controls; it does not independently recompute future augmentation readiness.

Adaptive equipment caps now permit up to fifty percent of unreserved cash per batch, with twenty percent for temporary equipment and fifty percent for permanent upgrades, all capped by the shared allowance. Recruitment/progression exceptions remain capped, now at five percent of unreserved cash. Explicit percentage flags still win. Shared funding gives stronger priority to verified cash payback within five minutes and separately recognizes fresh recruitment time savings without reporting them as cash ROI. Guarded execution stops dependent later orders when an earlier purchase fails, and defers if spendable cash has fallen below the approved quote.


### Compare equipment bundles with singles

Each marginal equipment pass now ranks eligible two-item bundles alongside eligible singles, using the same cash return, recruitment, and progression criteria. The augmentation readiness guard runs after the combined ranking, so an inferior single cannot consume a guard check before a superior bundle. Rejected bundles can fall back to a qualifying single within the remaining quote budget.

Pair search remains limited to the twelve cheapest missing items in each permanent/temporary category and member, additionally capped at 128 evaluated bundles per batch (configurable in the pure planner, hard maximum 1,024). Member/category groups take turns so the first member's inventory cannot monopolize the global evaluation cap. Normal category, shared cash, bootstrap, purchase-count, ascension, reserve and native bundle checks remain unchanged. Search uses at most 85% of the soft planning window when readiness checks are enabled, leaving time for purchase approval; a completed single candidate remains usable when pair search reaches its bound. Diagnostics expose evaluated/qualified bundles, per-member counts, and limited searches. All candidates are repriced after accepted purchases.

This is a bounded greedy investment search, not an exhaustive allocation across every member and item.


### Benefit-aware bundle shortlists

Bundle candidates now retain six inexpensive missing items plus up to six additional items selected across cash, progression-objective and respect gains, using both absolute benefit and benefit per dollar. Current marginal single-item valuations are reused; no additional native reads or equipment valuations are needed for the shortlist. Unscored slots fall back to inexpensive items, preserving exploration for combinations whose individual benefits are zero. Duplicate names, invalid prices and items that cannot fit with any missing partner inside the remaining cash/category budget are excluded.

Pair evaluation alternates cheap/benefit, benefit/benefit and cheap/cheap combinations within each member/category group, so a tight evaluation budget can still discover expensive useful combinations. The twelve-item, 66-pair-per-group and global evaluation/time bounds remain, along with shared budgets, native bundle execution and augmentation readiness checks. This is bounded predicted-benefit exploration rather than an exhaustive search or measured live performance gain.


### Fair single-item valuation coverage

Initial and whole-crew refresh equipment valuations now take one missing item per member per round, respecting the existing soft planning deadline and reserved readiness-check window. A partially completed pass records exactly how many queued evaluations were skipped. Diagnostics report evaluations by member, valuation passes and the next member offset.

The gang controller carries that offset into the next management batch, so a budget shorter than one full crew round does not repeatedly favor the same early members. Refreshes continue using the projected crew after all approved purchases; non-crew-aware callers retain untouched members' candidates while refreshing the changed member. Time, item/bundle, spending, native execution, augmentation readiness and explicit user budget limits remain unchanged. The controller cursor is local to the running script and starts over on a restart; per-member equipment order remains unchanged.


### Resume each member's equipment scan

The valuation scheduler now carries a next-equipment name for each current member alongside its next-member offset. Following a short planning window, the next batch starts each member's scan from that item, skipping owned equipment and wrapping around the current catalogue. Cursor names tolerate catalogue reordering; unknown or removed item names restart safely. Dead or removed members do not retain entries in returned cursor state.

Only scheduling positions are reused. All marginal values are recomputed from the current projected crew, balances and policy on each pass; no old purchase approval or production value is cached across management batches. Full scans and crew-aware refreshes still value each missing item at most once per pass. Diagnostics expose next item names. Planning deadlines, bundle limits, native purchase guards, shared budgets and augmentation readiness protection remain unchanged. Both cursor sets are currently local to the running controller and reset on restart.


### Buy cheap missing gang equipment

Adaptive gang management now buys eligible missing equipment priced strictly below one percent of unreserved player cash without requiring a return forecast to qualify. The threshold is per member/item and is recomputed after every planned purchase, including other batch spending. Cheap purchases are considered before forecast-ranked larger investments; unnecessary bundle search is skipped while an affordable cheap purchase is available. Temporary equipment for planned ascensions remains excluded by the existing valuation eligibility check.

Shared and category budgets, explicit user percentages, the bounded purchase count and planning deadline, cash reserves and near-term augmentation readiness checks still apply. Cheap orders have their own reason and do not consume the recruitment/progression exception budget or claim a cash ROI. Larger equipment retains the ordinary return-based planner. Missing items are processed in bounded batches rather than an unlimited spending loop.

Native execution checks current price against one percent of current unreserved cash again for each cheap order, so changed funds or discounts cannot bypass the rule. Existing price-increase, reserve, shared funding and pause/owner checks remain. This is an intentional cheap catch-up policy, not a guarantee that every cheap upgrade has positive measured cash returns.


### Cheap equipment fast path

Cheap-item eligibility now has a separate controller callback, checking the existing planned-ascension restriction without running a marginal production-return forecast. Eligible items below one percent of shrinking unreserved cash receive a cheap-only candidate with no invented return. Shared/category budgets, native threshold checks and the augmentation-readiness guard still decide whether that candidate can actually be bought. Expensive items and bundles keep ordinary return forecasts; callers that do not supply the new callback retain their existing valuation behavior.

If shrinking cash makes a deferred cheap item exceed the threshold, it must acquire a fresh ordinary forecast before entering larger-investment ranking, or be deferred if the time budget is exhausted. Crew-aware refreshes still use the projected crew after purchases. Diagnostics distinguish scanned items, actual return-forecast calls, fast-tracked cheap items, eligibility denials and deferred larger forecasts. This optimizes planning work, not the native purchase price or guaranteed game progression speed.
