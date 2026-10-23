# Gang stat development

With the default `--power-focus true`, the controller now evaluates:

- Combat, hacking and charisma training, plus a three-phase schedule that changes tasks according to projected native skill-point gains. Phase switches retain the original deadline.
- A second ascension within the planning horizon. Compound trajectories must beat matching training without a reset, a first reset without a second, and delaying the first reset. Only the first reset is executed; a later reset requires a new quote and fresh checks.
- Equipment's training XP benefit and power earned after planned training. Small benefits still must pass the material power payback gate. Native purchase checks retain the one-percent unreserved-cash limit and confirm the quoted training task for XP-only benefits.
- Concurrent development with the existing trainees and recoveries included in the crew forecast. The candidate's own recovery remains protected, and at least one other member must be doing productive work. Balanced mode retains serialized recovery.
- Longer development windows for established gangs in power mode: 30 minutes after ten minutes of node age with six members, or one hour after one hour with twelve. Known route and augmentation-install deadlines retain their 20-percent buffer; a pending reset prevents new development.

Manual task overrides, reserve limits, recruitment and augmentation milestones, native snapshot validation, and the existing bounded search remain in force. Forecasts use fixed-territory power for authorization; expected territory gains remain conditional diagnostics.

## Further opportunities

1. Persist reset-scoped rival growth samples across controller reloads to avoid repeating the observation warmup.
2. Compare predicted versus observed power and training gains over complete native updates, then use discrepancies to discount optimistic forecasts.
3. Measure search coverage and completion by candidate type. Mixed and two-cycle candidates share the existing time and simulation budget; an incomplete comparison cannot authorize a new action.

These are follow-up opportunities, not measured speed gains from this change.
