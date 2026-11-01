# Hash policy review

Reviewed `hash-spending-policy.js`, the two `spend-hacknet-hashes.js` workers and their tests after
making corporation startup low priority. Live BN11 state at the time: 7,007 purchases, ~194 hashes,
capacity 33,152, both workers restarted onto the new module.

## Fixed

1. **Corporation startup is no longer a hash cash goal.**
   The policy used to build a `$150b + reserve` cash target from
   `corporationGrowthPriority`/`corporationStartup`, so hashes were liquidated for a corporation
   that the spending plan no longer prioritizes. `cashGoal` is now only an augmentation target (or
   the $300k casino bootstrap); otherwise the workers use their configured action. Live receipt
   after the restart: `preferred:null, cashGoal:null`, and the new workers report no corporation
   goal.

2. **A route probe cannot authorize Bladeburner hash spending.**
   `hashSpendingDecision` read `route.selected`, which is the probed route for up to five minutes.
   It now uses `route.committed` (falling back to `selected` for legacy files) for:
   - the rank/SP valuation block,
   - the "World Daemon route selected" block,
   - the corporation-milestone ETA check.
   So a temporary Bladeburner probe no longer unlocks rank/SP purchases while the committed route is
   hacking.

3. **The stock reserve is only relaxed for a funded corporation hold.**
   `autopilot.js` used to zero `reserve.txt` whenever `corporationGrowthPriority` was true, relying on
   a shared-budget hold that no longer exists. It now requires
   `corporationStartupReserve > 0`, so the optional stock reserve is not discarded just because the
   corporation is being saved for at low priority.

## Confirmed correct (no change)

- Sell-for-Money valuation is $250k/hash (4 hashes per $1M); the capacity and quantity checks use the
  same native `hashCost`.
- Augmentation cash goals still outrank discretionary hash uses; `fundHashCashGoal` is bounded to
  10,000 purchases and respects the fresh spending plan, pause flags, achievement denials,
  maintenance windows and owner liveness.
- Server money/security upgrades still require native formulas, owned income workers, a fresh
  profitability analysis and a projection; they cannot spend without all of that.
- Corporation research/funding milestones remain bounded to 16 purchases / 5,000 hashes and 5% of
  unreserved cash, with a per-milestone ledger.
- Hash overflow turns into cash for Hacknet Servers, so not selling below capacity does not waste
  hashes.
- Purchase journaling keeps bounded history (64 events, 32 in the monitor) and survives failed
  purchases, restarts and augmentation installs as designed.

## Remaining observations (not changed)

- `cashPerHash` is hardcoded to 250,000. Deriving it from
  `1e6 / ns.hacknet.hashCost('Sell for Money')` would survive a game balance change, but the current
  value is correct for 3.0.1.
- Corporation funds/research are credited at the Sell-for-Money rate for the 5% opportunity cap,
  even though 100 hashes convert to $1b (about $10m/hash). The cap is therefore conservative in
  player-cash terms; worth revisiting only if corporation hash spending ever looks too eager.
- The cumulative purchase journal intentionally spans augmentation installs (node-reset scoped), so
  `automation.hashPurchases` totals include purchases made before the last aug install.

## Verification

- `node --test tests/hash-spending.test.js`: **77 pass, 0 fail**, including new probe-route coverage.
- Full suite: **3,596 tests, 3,586 pass, 0 fail, 10 skipped**.
- `npm run check`: 562 files syntax-clean, 237 deployable, 0 audit problems.
- Live: the workers restarted onto the new module and now report `preferred:null, cashGoal:null`;
  hashes rose from 194 to 259 instead of being continuously liquidated for the corporation. With the
  no-arg worker in low-priority mode, they will be sold near capacity (33,152), which is the intended
  low-priority behaviour.
- Native preflight: `spend-hacknet-hashes.js` 42.1 GB ready; `autopilot.js` 46.1 GB ready.
