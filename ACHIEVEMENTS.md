# Achievement automation

Autopilot launches `achievement-manager.js` when Singularity and enough RAM are available. Run it alone using `run achievement-manager.js`. No tail opens automatically. `--disable-achievements` on autopilot stops the manager and campaign supervision. The existing pause control can also stop the manager. Progress is in `tasks/achievement-status.json` and the Remote API's `automation.status` response.

The source catalog contains 109 achievements. The manager can read the running game's achievement-panel metadata to reconcile version differences. Unlocks are confirmed using `ns.singularity.getUnlockedAchievements()`, never by setting achievement flags or guessing that a threshold was reached.

## What runs automatically

- Normal progression: faction memberships, programs/TOR/4S, Source Files, augmentation installs, hospital/travel, gang/sleeve/Dark Net achievements, stock and Hacknet income.
- Infrastructure: home RAM and cores, all Hacknet nodes/servers, and a fully upgraded node/server. These completion purchases obey cash reserves and shared spending allowances rather than ROI alone.
- Special coordination: hold hashes until the native full-cache unlock; bank 100,000 Bladeburner points after max Overclock; play Illuminati for a ten-game winning streak; attempt a legal Go cheat for the anticheat achievement.
- Script count: idle workers are launched in bounded batches on spare rooted RAM, expire after 45 seconds, and are removed after success or controller exit. Ordinary workers are preserved.
- Intended exploit puzzles: undocumented function, document RAM bypass, hidden unclickable handler, selective Number prototype change, selective timer-probe compression, developer menu visit, bounded rainbow-password probes, and noodles/Void visits. Temporary hooks are restored on exit. The freeze achievement uses its native noScripts URL condition temporarily and restores the URL without deliberately freezing or reloading the game.
- BitVerse dwell: at a hacking completion, open the BitVerse by backdooring the daemon and remain there until the native one-hour achievement is awarded, with a 65-minute attempt limit. UI activity is leased during the hold. A timed-out attempt is retried on another completed node. Bladeburner-only victories continue until a hacking route is available for this goal.

## Dedicated campaigns

Campaigns begin after SF1–11 and SF13–15 reach level 3, plus SF12 level 1. This keeps early automation unlocks and normal progression available first. Explicit `--next-bn` overrides are preserved.

Missing challenge achievements schedule fresh runs of BN1, 2, 3, 6, 7, 8, 9, 10, 13, 14, and 15. Constraints are set before ordinary managers launch and persist through augmentation resets. Existing runs that already violated a challenge are preserved and retried on a fresh node. Guards prevent home upgrades, gang/corporation/Bladeburner creation, 4S buying, Hacknet money/expenses, sleeve use, Stanek acceptance, Go moves, or Heartbleed as appropriate. BN9 suppresses the Dark Net manager because its cache rewards can also sell hashes for money.

After challenges, BN3 finance runs pursue a 40-augmentation queue, NFG255, $1Q cash, $1q stock profits, corporation milestones, and a 3,000-employee division. BN1 character runs pursue 100 installed augmentations, hacking100000, combat3000, intelligence255, karma−1m, and faction reputation10m. University study supplies intelligence without forcing the optional soft-reset farmer. Gang members continue their regular training and territorial progression. BN12 then repeats to level 50.

Debt uses a separate late BN8 run after the other financial/character milestones and the BN8 challenge. Cash is retained in recoverable long-stock assets while a real paid university course accumulates expense. BN8 suppresses ordinary cash income. The manager waits for the native −$1b unlock, then stops its course and sells the retained longs. This can take days; market movements affect the retained assets. Quitting the manager stops its owned course. Disabling achievement automation during a campaign releases its restrictions.

## Limits that scripts report honestly

`REALITYALTERATION` requires changing game code in the supplied source version. `EDITSAVEFILE` requires editing/importing a real save. `UNACHIEVABLE` has an always-false condition intended for source modification. `TRUE_RECURSION` requires beating the external arcade minigame; its completion message must originate from that game's real frame. These four are reported as requiring source/save modification or external minigame automation. The manager does not forge these unlocks or patch the installed application.

Rainbow and some UI puzzles are version dependent; bounded attempts can remain unresolved. The report retains them as pending rather than claiming success. Platform-specific Steam syncing is controlled by the game; a native unlock does not guarantee an offline Steam client has synchronized yet.

Large financial/stat targets, repeated nodes, and uninterrupted BitVerse dwell can take a long time. Locked Source Files and unavailable APIs wait gracefully. Casino remains the first startup priority, active grafts and Black Ops are protected during ordinary training, and all native achievement state survives resets.

Worker action code is generated with `node scripts/generate-achievement-workers.js`. Regression tests check that its serialized bodies match the tested functions. Lightweight supervision reserves room for temporary queries; challenge profiles defer nonessential completion purchases.
