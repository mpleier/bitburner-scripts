# Optional trainee power pulses

Power priority can briefly move one optional trainee to Territory Warfare at a confirmed power update even while clashes are active. This adds power without replacing the trainee's entire training episode.

The planner keeps its existing conservative training-loss comparison: immediate skill total must exceed 125% of the accumulated estimated skill loss from missed training batches over the planning horizon. Pulse duty must be no greater than 50%. At positive exposure it additionally requires explicit power priority, fresh odds of at least 75% against every active rival, defense eligibility, and expected extra deaths no greater than 0.005.

The mortality estimate uses two expected player encounters per update, the losing-clash death rate for every encounter, and the member's current defense. Its exposure horizon is at least 3,750 game seconds, or the longer planned game-time horizon. This includes a stalled owner's lease/supervisor delay at maximum bonus speed and a full residual-clash tail. The forecast retains its initial risk horizon while simulating later steps. This is an expected-value bound, not a guarantee against death.

At positive exposure, all optional trainees share one slot and one risk allowance. The eligible candidate with the highest skill-total and defense score receives it. At zero exposure, the existing useful-pulse behavior remains available to multiple trainees. Productive crew members keep their ordinary eligibility checks.

Manual assignments, mandatory development cycles, post-ascension recovery, wanted preparation, and newly reset members stay protected. No new engagement threshold was introduced.

## Native validation

Before the temporary assignment, a self-contained native guard rechecks the short quote, target tick, owner/reset, current gang and rival state, member stats/task, saved optional episode, settings/manual overrides, supervisor heartbeat and lease-backed restoration task. Missing APIs, stale records or changed conditions keep the trainee training. A rejected optional pulse does not block ordinary crew power assignments.

The preparation snapshot reads gang, rival and member information in one native job, avoiding mixed pre/post-engagement observations. The normal post-tick restore and independent lease guard retain their existing roles. No controller is restarted to test an actual clash.

`tasks/gang-trainee-pulse.json` records eligibility, selected names and the current quote. `tasks/gang-power-pulses.json` distinguishes `guard-declined` from assignment or timing failure. Rejection reasons go to the script log with bounded repetition. These records do not authorize gameplay actions.

## Rival-cohort diagnostics

`warfareDecision` also estimates net territory per native update across all active rivals at the current power snapshot. It averages the game's random transfer before capping it by remaining rival territory, including the final tiny holdings. `cohortProfitable` and `blockedByWorstOpponent` appear in native decision records. This estimate assumes current powers and does not include future NPC growth, NPC-versus-NPC transfers or a guaranteed completion time. Positive aggregate return does not bypass the ordinary or conditional worst-opponent safety floors.

Source: https://github.com/bitburner-official/bitburner-src/blob/dev/src/Gang/Gang.ts
