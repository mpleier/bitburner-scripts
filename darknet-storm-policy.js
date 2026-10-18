export const stormStateFile = 'tasks/dnet-storm-state.json';
export const stormRequestFile = 'tasks/dnet-storm-request.json';
export const stormResultFile = 'tasks/dnet-storm-result.json';
export const surveyPrefix = 'tasks/dnet-survey-';
export const surveyFile = host => `${surveyPrefix}${encodeURIComponent(host)}.json`;

/** Fail closed: a quiet network is useful only after every reachable scout completed its work. */
export function stormReadiness(reports, roots, now = Date.now()) {
  const byHost = new Map(reports.map(report => [report.host, report]));
  const pending = [...roots], visited = new Set(), rows = [];
  if (!pending.length) return { ready: false, reason: 'No reachable network' };
  while (pending.length) {
    const host = pending.pop();
    if (visited.has(host)) continue;
    visited.add(host);
    const report = byHost.get(host);
    if (!report || report.version !== 1 || !Number.isFinite(report.at) || report.at > now || now - report.at > 90000 || report.live !== true)
      return { ready: false, reason: `Missing fresh scout survey: ${host}` };
    if (report.busy !== false || report.blockedRam !== 0 || report.caches !== 0 || report.contracts !== 0 || !Array.isArray(report.neighbours))
      return { ready: false, reason: `Work or rewards remain: ${host}` };
    rows.push([host, [...report.neighbours].sort(), report.seed === true]);
    pending.push(...report.neighbours);
  }
  rows.sort((a,b) => a[0].localeCompare(b[0]));
  const seedHost = rows.find(row => row[2])?.[0];
  if (!seedHost) return { ready: false, reason: 'No StormSeed in surveyed network' };
  return { ready: true, seedHost, signature: JSON.stringify(rows) };
}

/** Only a receipt matching the pending dispatch can establish a successful storm cooldown. */
export function applyStormReceipt(state, receipt, reset, now = Date.now()) {
  const pending = state?.pending;
  if (state?.reset !== reset || !pending || receipt?.id !== pending.id || receipt.host !== pending.host ||
      receipt.reset !== reset || typeof receipt.success !== 'boolean' || !Number.isFinite(receipt.at) ||
      receipt.at < pending.at || receipt.at > pending.at + 30000 || receipt.at > now) return state;
  const next = { ...state, lastResult: { success: receipt.success, at: receipt.at, reason: receipt.reason } };
  delete next.pending;
  if (receipt.success) next.lastSuccess = receipt.at;
  return next;
}

/** Persist quiet time; retry failed dispatches in one minute, cool successful storms for thirty. */
export function planStorm(reports, roots, state = {}, now = Date.now(), reset = 0) {
  const prior = state.reset === reset ? state : {};
  const decision = stormReadiness(reports, roots, now);
  const validTime = value => Number.isFinite(value) && value > 0 && value <= now ? value : 0;
  const next = { reset, lastAttempt: validTime(prior.lastAttempt), lastSuccess: validTime(prior.lastSuccess), pending: prior.pending, lastResult: prior.lastResult };
  if (!decision.ready) return { ...decision, state: next, launch: false };
  next.signature = decision.signature;
  next.quietSince = prior.signature === decision.signature && Number.isFinite(prior.quietSince) && prior.quietSince <= now ? prior.quietSince : now;
  const launch = now - next.quietSince >= 300000 && (!next.lastAttempt || now - next.lastAttempt >= 60000) && (!next.lastSuccess || now - next.lastSuccess >= 1800000);
  return { ...decision, state: next, launch, reason: launch ? 'Rewards exhausted; network quiet for five minutes' : 'Waiting for quiet period or cooldown' };
}
