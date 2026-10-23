import {xpCapacityKey} from './xp-capacity-policy.js';
const minute=60000;
const positive=x=>Number.isFinite(x)&&x>0;
const capacity=s=>s?.xpCapacity!==undefined&&xpCapacityKey(s)!==null&&/^xp-recovery-v1:[a-f0-9]+:[a-f0-9]+:\d+$/.test(s.xpCapacity?.recoverySignature||'')?s.xpCapacity.recoverySignature:null;
const baseline=s=>Number.isSafeInteger(s?.hacking)&&s.hacking>1&&positive(s.hackMult)&&positive(s.xpMultiplier)&&['xp','income'].includes(s.xpMode)&&capacity(s)?
 {targetLevel:s.hacking,hackMult:s.hackMult,xpMultiplier:s.xpMultiplier,mode:s.xpMode,capacity:capacity(s)}:null;

/** Observe ordinary installs without changing the player's action or forcing a reset. */
export function observeHackingRecovery(saved,{reset,route,snapshot,now=Date.now()}={}) {
 if(!reset||![now,reset.lastAugReset,reset.lastNodeReset].every(Number.isFinite)||now<reset.lastAugReset)return null;
 const old=saved?.schemaVersion===1&&saved.nodeReset===reset.lastNodeReset&&Number.isFinite(saved.at)&&saved.at<=now?saved:null;
 const samples=Array.isArray(old?.samples)?old.samples.filter(s=>s&&s.nodeReset===reset.lastNodeReset&&Number.isFinite(s.augReset)&&s.augReset<=reset.lastAugReset&&
  Number.isFinite(s.finishedAt)&&s.finishedAt<=now&&now-s.finishedAt<=24*60*minute&&positive(s.durationMs)&&s.durationMs<=24*60*minute).slice(-8):[];
 let state={schemaVersion:1,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,at:now,samples,baseline:null,pending:null,recovering:false};
 const same=old?.augReset===reset.lastAugReset;
 if(same)state={...state,baseline:old.baseline,pending:old.pending?{...old.pending}:null,recovering:!!old.recovering};
 else if(old&&old.augReset<reset.lastAugReset&&old.baseline&&reset.lastAugReset>=old.at&&reset.lastAugReset-old.at<=90000)
  state={...state,pending:{...old.baseline,startedAt:reset.lastAugReset},recovering:true};
 const fresh=r=>r&&r.nodeReset===reset.lastNodeReset&&r.augReset===reset.lastAugReset&&Number.isFinite(r.at)&&r.at<=now&&now-r.at<=45000;
 const freshRoute=fresh(route),freshSnapshot=fresh(snapshot);
 const cancel=reason=>{state.recovering=false;state.pending=null;state.reason=reason;};
 if(state.recovering){
  if(!state.pending||!Number.isFinite(state.pending.startedAt)||state.pending.startedAt>now||now-state.pending.startedAt>24*60*minute)cancel('Invalid or expired recovery');
  else if(same&&now-old.at>90000)cancel('Recovery observation interrupted');
  else if(freshRoute&&route.selected!=='hacking')cancel('Selected route changed');
  else if(freshRoute&&freshSnapshot){
   const current=baseline(snapshot),target=state.pending;
   if(current&&(current.capacity!==target.capacity||current.mode!==target.mode))cancel('Hacking capacity or mode changed');
   else if(current){
    // A temporary stronger multiplier during the run must not justify a faster weaker forecast.
    target.hackMult=Math.max(target.hackMult,current.hackMult);target.xpMultiplier=Math.max(target.xpMultiplier,current.xpMultiplier);
    if(current.targetLevel>=target.targetLevel){
    const durationMs=now-target.startedAt;
    if(durationMs>0)state.samples=[...samples,{nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,finishedAt:now,durationMs,
     targetLevel:target.targetLevel,capacity:current.capacity,mode:current.mode,hackMult:target.hackMult,xpMultiplier:target.xpMultiplier}].slice(-8);
    cancel('Pre-install hacking level recovered');
    }
   }
  }
 }
 // Never arm a later measurement from stale data or a different selected route.
 state.baseline=freshRoute&&route.selected==='hacking'&&freshSnapshot?baseline(snapshot):null;
 return state;
}

/** Reuse only conservative comparable milestones; a harder target retains the fallback. */
export function hackingRecoveryQuote(record,{nodeReset,augReset,now=Date.now()}={}) {
 const fallback={durationMs:15*minute,blocked:false,basis:'Conservative hacking recovery fallback'};
 if(record?.schemaVersion!==1||record.nodeReset!==nodeReset||record.augReset!==augReset||!Number.isFinite(record.at)||record.at>now||now-record.at>90000)return fallback;
 const b=record.baseline,target=b&&Number.isSafeInteger(b.targetLevel)&&b.targetLevel>1&&positive(b.hackMult)&&positive(b.xpMultiplier)&&
  ['xp','income'].includes(b.mode)&&typeof b.capacity==='string'&&/^xp-recovery-v1:[a-f0-9]+:[a-f0-9]+:\d+$/.test(b.capacity)?b:null;
 const samples=target&&Array.isArray(record.samples)?record.samples.filter(s=>s?.nodeReset===nodeReset&&Number.isFinite(s.augReset)&&s.augReset<=augReset&&
  Number.isFinite(s.finishedAt)&&s.finishedAt<=now&&now-s.finishedAt<=24*60*minute&&positive(s.durationMs)&&s.durationMs<=24*60*minute&&
  Number.isSafeInteger(s.targetLevel)&&s.targetLevel>=target.targetLevel&&s.capacity===target.capacity&&s.mode===target.mode&&
  positive(s.hackMult)&&s.hackMult<=target.hackMult&&positive(s.xpMultiplier)&&s.xpMultiplier<=target.xpMultiplier):[];
 return {durationMs:samples.length?Math.max(minute,...samples.map(s=>s.durationMs)):fallback.durationMs,
  blocked:record.recovering===true,basis:samples.length?'Measured time to regain a comparable pre-install hacking level':fallback.basis};
}
