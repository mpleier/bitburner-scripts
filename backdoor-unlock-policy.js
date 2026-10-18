export const factionBackdoorServers=['CSEC','avmnite-02h','I.I.I.I','run4theh111z','fulcrumassets'];
/** Dispatch each faction unlock once per reset; ordinary polling still retries incomplete installs. */
export function observeBackdoorUnlocks(previous,targets,hacking,reset) {
 const key=String(reset.lastNodeReset)+':'+String(reset.lastAugReset);
 const dispatched=previous?.key===key&&Array.isArray(previous.dispatched)?previous.dispatched.filter(h=>factionBackdoorServers.includes(h)):[];
 const eligible=new Set(targets.filter(s=>factionBackdoorServers.includes(s.name)&&s.hasAdminRights===true&&
  s.backdoorInstalled!==true&&Number.isFinite(s.requiredHackLevel)&&Number.isFinite(hacking)&&hacking>=s.requiredHackLevel).map(s=>s.name));
 return {key,dispatched,pending:factionBackdoorServers.filter(h=>eligible.has(h)&&!dispatched.includes(h))};
}
export function acknowledgeBackdoorUnlocks(state,targets) {
 const dispatched=[...new Set([...state.dispatched,...targets.filter(h=>state.pending.includes(h))])];
 return {...state,dispatched,pending:state.pending.filter(h=>!dispatched.includes(h))};
}

/** Each faction server owns its completion file, avoiding concurrent read/modify/write races. */
export async function publishBackdoorCompletion(ns,target,startedReset) {
 if(!factionBackdoorServers.includes(target))return false;
 const reset=ns.getResetInfo();
 if(reset.lastNodeReset!==startedReset.lastNodeReset||reset.lastAugReset!==startedReset.lastAugReset)return false;
 const at=Date.now();
 await ns.write('tasks/backdoor-completed-'+target+'.json',JSON.stringify({target,token:ns.pid+':'+at,at,state:'completed',
  nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset}),'w');
 return true;
}
export function observeBackdoorCompletions(previous,records,reset,now=Date.now()) {
 const key=String(reset.lastNodeReset)+':'+String(reset.lastAugReset),seen=previous?.key===key?{...previous.seen}:{};
 const pending=records.filter(r=>r&&factionBackdoorServers.includes(r.target)&&r.state==='completed'&&typeof r.token==='string'&&r.token&&
  r.nodeReset===reset.lastNodeReset&&r.augReset===reset.lastAugReset&&Number.isFinite(r.at)&&r.at>0&&r.at<=now&&seen[r.target]!==r.token);
 return {key,seen,pending};
}
export function acknowledgeBackdoorCompletions(state,events) {
 const seen={...state.seen};for(const event of events)seen[event.target]=event.token;
 return {...state,seen,pending:state.pending.filter(event=>seen[event.target]!==event.token)};
}
