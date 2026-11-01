export const stormStateFile = 'tasks/dnet-storm-state.json';
export const stormRequestFile = 'tasks/dnet-storm-request.json';
export const stormResultFile = 'tasks/dnet-storm-result.json';
export const surveyPrefix = 'tasks/dnet-survey-';
export const surveyFile = host => `${surveyPrefix}${encodeURIComponent(host)}.json`;

/** Diagnostics only: these details never relax StormSeed's readiness checks. */
export function stormBlockerDetails(host,report,now=Date.now()){
 const reasons=[];
 if(!report)reasons.push('missing survey');
 else{
  if(report.live!==true)reasons.push('scout offline');
  if(!Number.isFinite(report.at)||report.at>now||now-report.at>90000)reasons.push('stale or invalid survey');
  if(report.busy!==false){
   const work=(Array.isArray(report.workReasons)?report.workReasons:[]).filter(r=>['cracking','cache collection','anchor/stasis','migration','maintenance hold','priority RAM handoff','RAM recovery','maze navigation'].includes(r));
   reasons.push(...(work.length?work:['exploration or active work']));
  }
  if(report.blockedRam!==0)reasons.push(Number.isFinite(report.blockedRam)?`blocked RAM ${report.blockedRam} GB`:'blocked RAM unknown');
  if(report.caches!==0)reasons.push(Number.isInteger(report.caches)?`${report.caches} caches`:'cache count unknown');
  if(report.contracts!==0)reasons.push(Number.isInteger(report.contracts)?`${report.contracts} contracts`:'contract count unknown');
  if(!Array.isArray(report.neighbours))reasons.push('neighbor survey incomplete');
 }
 return {host,reasons:[...new Set(reasons)],reportAgeMs:Number.isFinite(report?.at)&&report.at<=now?now-report.at:null};
}
export function stormBlockerCategories(reasons){
 return [...new Set((reasons||[]).map(reason=>/^blocked RAM\b/.test(reason)?'blocked RAM':/^(?:-?\d+ caches|cache count unknown)$/.test(reason)?'caches':/^(?:-?\d+ contracts|contract count unknown)$/.test(reason)?'contracts':reason))];
}
export function observeStormBlocker(previous,current,now){
 if(!current)return null;
 const continuous=previous?.host===current.host&&Number.isFinite(previous.since)&&previous.since<=now&&Number.isFinite(previous.observedAt)&&previous.observedAt<=now&&now-previous.observedAt<=90000;
 const oldCategories=continuous?stormBlockerCategories(previous.reasons):[];
 const categorySince=Object.fromEntries(stormBlockerCategories(current.reasons).map(category=>{
  const prior=previous?.categorySince?.[category]??previous?.since;
  return [category,oldCategories.includes(category)&&Number.isFinite(prior)&&prior<=now?prior:now];
 }));
 return {...current,categorySince,since:Math.min(now,...Object.values(categorySince)),observedAt:now};
}

/** Fresh idle scouts are mandatory; stalled mode can explicitly include native-confirmed locked frontiers. */
export function stormReadiness(reports, roots, now = Date.now(), options = {}) {
  const byHost = new Map(reports.map(report => [report.host, report]));
  const pending = [...roots], visited = new Set(), rows = [], frontier = [], unresolved = [], progress = [];
  if (!pending.length) return { ready: false, reason: 'No reachable network' };
  while (pending.length) {
    const host = pending.pop();
    if (visited.has(host)) continue;
    visited.add(host);
    const report = byHost.get(host);
    if (options.stalled === true && options.frontier?.includes(host) && !report) { frontier.push(host); continue; }
    if (!report || report.version !== 1 || !Number.isFinite(report.at) || report.at > now || now - report.at > 90000 || report.live !== true)
      return { ready: false, reason: `Missing fresh scout survey: ${host}`,blocker:stormBlockerDetails(host,report,now) };
    if (report.busy !== false || report.blockedRam !== 0 || report.caches !== 0 || !Number.isInteger(report.contracts) || report.contracts < 0 || (report.contracts > 0 && (options.stalled !== true || !Array.isArray(report.contractFiles) || report.contractFiles.length !== report.contracts || report.contractFiles.some(f=>typeof f!=='string'||!f.endsWith('.cct')))) || !Array.isArray(report.neighbours))
      return { ready: false, reason: `Work or rewards remain: ${host}`,blocker:stormBlockerDetails(host,report,now) };
    progress.push([host,report.pid,report.solverProgress??null]);
    rows.push([host, [...report.neighbours].sort(), report.seed === true]);
    if(report.contracts)unresolved.push([host,[...report.contractFiles].sort()]);
    pending.push(...report.neighbours);
  }
  rows.sort((a,b) => a[0].localeCompare(b[0]));
  const seedHost = rows.find(row => row[2])?.[0];
  if (!seedHost) return { ready: false, reason: 'No StormSeed in surveyed network' };
  const stalled=frontier.length>0||unresolved.length>0;
  if(stalled&&options.stalled!==true)return {ready:false,reason:'Unfinished exploration'};
  return { ready: true, seedHost, mode:stalled?'stalled':'cleared', frontier:frontier.sort(), signature: JSON.stringify(rows), progressSignature:JSON.stringify([rows,frontier.sort(),unresolved.sort((a,b)=>a[0].localeCompare(b[0])),progress.sort((a,b)=>a[0].localeCompare(b[0]))]) };
}

/** Only a receipt matching the pending dispatch can establish a successful storm cooldown. */
export function applyStormReceipt(state, receipt, reset, now = Date.now()) {
  const pending = state?.pending;
  if (state?.reset !== reset || !pending || receipt?.id !== pending.id || receipt.host !== pending.host ||
      receipt.reset !== reset || typeof receipt.success !== 'boolean' || !Number.isFinite(receipt.at) ||
      receipt.at < pending.at || receipt.at > pending.at + 30000 || receipt.at > now) return state;
  const next = { ...state, lastResult: { id: receipt.id, success: receipt.success, at: receipt.at, reason: receipt.reason } };
  delete next.pending;
  if (receipt.success) next.lastSuccess = receipt.at;
  return next;
}

/** Persist quiet time; retry failed dispatches in one minute, cool successful storms for thirty. */
export function planStorm(reports, roots, state = {}, now = Date.now(), reset = 0, options = {}) {
  const prior = state.reset === reset ? state : {};
  const decision = stormReadiness(reports, roots, now, options);
  const validTime = value => Number.isFinite(value) && value > 0 && value <= now ? value : 0;
  const next = { reset, lastAttempt: validTime(prior.lastAttempt), lastSuccess: validTime(prior.lastSuccess), pending: prior.pending, lastResult: prior.lastResult, refresh:prior.refresh };
  if (!decision.ready) return { ...decision, state: next, launch: false };
  next.signature = decision.signature;
  next.quietSince = prior.progressSignature === decision.progressSignature && Number.isFinite(prior.observedAt) && prior.observedAt<=now && now-prior.observedAt<=90000 && Number.isFinite(prior.quietSince) && prior.quietSince <= now ? prior.quietSince : now;
  next.progressSignature=decision.progressSignature;next.observedAt=now;next.mode=decision.mode;
  const quietMs=decision.mode==='stalled'?180000:30000;
  const launch = now - next.quietSince >= quietMs && (!next.lastAttempt || now - next.lastAttempt >= 60000) && (!next.lastSuccess || now - next.lastSuccess >= 1800000);
  return { ...decision, state: next, launch, quietMs, reason: launch ? (decision.mode==='stalled'?'Exploration stalled for three minutes; refreshing remaining opportunities':'Cleared network quiet for thirty seconds') : 'Waiting for quiet period or cooldown' };
}
