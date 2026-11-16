/** Consecutive-failure tracker for optional API calls.
 *
 * A manager wraps every optional read/write in try/catch so one bad call cannot stop the cycle, but that also
 * made a persistently failing operation look exactly like a quiet one. This keeps the per-operation count so
 * the first genuine outage is announced to the terminal and then repeated sparingly instead of never or forever.
 */
export function failureEscalation(prev, now, {threshold = 3, repeatMs = 600000} = {}) {
  const count = Math.max(0, Number(prev?.count) || 0) + 1;
  const announcedAt = Number(prev?.announcedAt) || 0;
  const announce = count === threshold || (count > threshold && now - announcedAt >= repeatMs);
  return {count, at: now, announcedAt: announce ? now : announcedAt, announce};
}

/** Success clears the streak; the last announcement time is kept so a flapping call is not re-announced. */
export function failureCleared(prev, now) {
  return prev ? {count: 0, at: now, announcedAt: Number(prev.announcedAt) || 0} : null;
}

/** Operations that are still failing past the escalation threshold, for status output. */
export function persistentFailures(state) {
  const entries = state instanceof Map ? [...state.entries()] : Object.entries(state || {});
  return entries.filter(([, value]) => Number(value?.count) >= 3).map(([label, value]) => ({label, count: Number(value.count)}));
}
