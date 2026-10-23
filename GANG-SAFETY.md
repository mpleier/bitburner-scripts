# Gang safety and planning

## Warfare supervision
A completed gang-controller pass renews a 60-second warfare lease, at most once every two seconds. The reliability manager checks it on its normal ten-second loop. A paused, exited or stalled owner has warfare disabled independently of controller exit cleanup. Valid saved ordinary assignments replace remaining warfare assignments. Manual gang play with no automation lease in the current reset is left alone. A replacement owner receives up to 60 seconds of startup grace.

This requires the reliability manager, the game engine and enough worker RAM to remain responsive. It cannot run while the game is closed. Disabling warfare does not instantly eliminate the game's residual clash probability. Restoration and existing defense protection address that exposure.

## Territory recovery
`tasks/gang-status.json` includes `territoryRecovery`: sampling, ready, within-horizon, beyond-horizon or not-closing. Estimates require at least three rival-growth observations and incorporate finite bonus time. These estimate readiness for safe clashes under fixed territory and current crew, not time to conquer all territory. Productive jobs and brief power pulses continue; an uncertain estimate does not disable long-term development.

## Optional protected tasks
Full automation remains the default. Set the `manual-task-overrides` option in `gangs.js.config.txt` to a JSON string mapping exact member names to valid tasks. For example the configuration entry is:

```json
["manual-task-overrides", "{\"Thug 1\":\"Train Combat\"}"]
```

The map protects task assignment, excludes named members from automatic ascension and optional training, and is respected in crew forecasts and power estimates. Unknown member names remain dormant until that member exists. Task names must be valid for the current gang. Territory Warfare and Unassigned are rejected. Clear the map to `{}` and restart the controller to resume full automation. This uses explicit overrides; changing the game UI alone does not create an override.

## Gang versus corporation capital
When corporation startup would consume available cash, the budget can keep one small gang equipment quote affordable: at most 1% of unreserved cash, cash payback within 15 minutes and within the gang's actual planning horizon. The quote requires current-reset telemetry, a live gang-controller owner and an observation less than 30 seconds old. Purchase, cash reserve, augmentation saving and native price checks still apply. Disabled gang spending cannot reserve this money.

The spending board includes `gangCapital` diagnostics. Corporation startup payback is reported as unknown; internal corporation profit is not assumed to be spendable player income.
