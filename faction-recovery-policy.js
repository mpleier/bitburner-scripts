const minute=60000,positive=n=>Number.isFinite(n)&&n>0;
const valid=b=>b&&typeof b.faction==='string'&&b.faction&&positive(b.rate)&&positive(b.multiplier)&&Number.isFinite(b.favor)&&b.favor>=0&&typeof b.workType==='string'&&b.workType;

/** Observe normal installs only. Membership is native joined-faction reputation, not an invitation. */
export function observeFactionRecovery(saved,{snapshot,reset,rates={},now=Date.now()}={}) {
 if(!reset||!snapshot||snapshot.nodeReset!==reset.lastNodeReset||snapshot.augReset!==reset.lastAugReset||
  ![now,snapshot.at,reset.lastAugReset,reset.lastNodeReset].every(Number.isFinite)||snapshot.at<reset.lastAugReset||snapshot.at>now||now-snapshot.at>60000)return saved??null;
 const at=snapshot.at,old=saved?.schemaVersion===1&&saved.nodeReset===reset.lastNodeReset&&Number.isFinite(saved.at)&&saved.at<=at?saved:null;
 const samples=Array.isArray(old?.samples)?old.samples.filter(s=>s&&s.nodeReset===reset.lastNodeReset&&Number.isFinite(s.augReset)&&s.augReset<=reset.lastAugReset&&
  Number.isFinite(s.observedAt)&&s.observedAt<=at&&at-s.observedAt<=24*60*minute).slice(-16):[];
 const same=old?.augReset===reset.lastAugReset;
 let state={schemaVersion:1,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,at,samples,baseline:null,pending:null};
 if(same)state.pending=old.pending?{...old.pending}:null;
 else if(old&&old.augReset<reset.lastAugReset&&valid(old.baseline)&&old.at<=reset.lastAugReset&&reset.lastAugReset-old.at<=120000)
  state.pending={...old.baseline,startedAt:reset.lastAugReset,joinedAt:null};
 const joined=f=>Object.prototype.hasOwnProperty.call(snapshot.reputation||{},f)&&Number.isFinite(snapshot.reputation[f])&&snapshot.reputation[f]>=0;
 const f=snapshot.workFaction,b={faction:f,rate:rates[f],multiplier:snapshot.repMultiplier,favor:snapshot.factionFavor?.[f],workType:snapshot.workType};
 if(valid(b)&&joined(f))state.baseline=b;
 const p=state.pending;
 if(p){
  const id=p.startedAt+':'+p.faction;
  const record=(workMs=null)=>{
   const sample={...p,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,id,observedAt:at,joinedMs:p.joinedAt-p.startedAt,workMs};
   state.samples=[...state.samples.filter(s=>s.id!==id),sample].slice(-16);
  };
  if(!valid(p)||!Number.isFinite(p.startedAt)||p.startedAt>at||at-p.startedAt>24*60*minute||
   !(p.joinedAt===null||Number.isFinite(p.joinedAt)&&p.joinedAt>=p.startedAt&&p.joinedAt<=at)||(same&&at-old.at>120000)){
   state.pending=null;state.reason='Faction recovery expired or observation interrupted';
  }else{
   if(positive(snapshot.repMultiplier))p.multiplier=Math.max(p.multiplier,snapshot.repMultiplier);
   if(Number.isFinite(snapshot.factionFavor?.[p.faction]))p.favor=Math.max(p.favor,snapshot.factionFavor[p.faction]);
   if(p.joinedAt===null&&joined(p.faction)){p.joinedAt=at;record();}
   if(valid(state.baseline)&&f===p.faction&&state.baseline.workType===p.workType&&rates[f]>=p.rate&&p.joinedAt!==null){
    record(at-p.startedAt);state.pending=null;state.reason='Faction membership and prior work rate recovered';
   }else if(typeof f==='string'&&f&&(f!==p.faction||snapshot.workType!==p.workType)){
    state.pending=null;state.reason='Faction work target changed; incomplete work recovery discarded';
   }
  }
 }
 return state;
}

/** Keep rejoining and work-readiness bounds separate. Unknown histories add no claimed measurement. */
export function factionRecoveryDelays(record,{snapshot,rates={},now=Date.now()}={}) {
 const result={};
 if(record?.schemaVersion!==1||!snapshot||record.nodeReset!==snapshot.nodeReset||record.augReset!==snapshot.augReset||
  !Number.isFinite(record.at)||record.at>now||now-record.at>120000||!Number.isFinite(snapshot.at)||snapshot.at>now||now-snapshot.at>60000||!positive(snapshot.repMultiplier))return result;
 for(const s of Array.isArray(record.samples)?record.samples:[]){
  if(!s||s.nodeReset!==snapshot.nodeReset||!Number.isFinite(s.augReset)||s.augReset>snapshot.augReset||!valid(s)||
   !Number.isFinite(s.observedAt)||s.observedAt>now||now-s.observedAt>24*60*minute||s.multiplier>snapshot.repMultiplier||
   !Number.isFinite(snapshot.factionFavor?.[s.faction])||s.favor>snapshot.factionFavor[s.faction]||
   !Number.isFinite(s.joinedMs)||s.joinedMs<0||s.joinedMs>24*60*minute)continue;
  const row=result[s.faction]??={joinedMs:0,workMs:null};row.joinedMs=Math.max(row.joinedMs,s.joinedMs);
  if(s.workType===snapshot.workType&&snapshot.workFaction===s.faction&&positive(rates[s.faction])&&s.rate>=rates[s.faction]&&
   Number.isFinite(s.workMs)&&s.workMs>=s.joinedMs&&s.workMs<=24*60*minute)row.workMs=Math.max(row.workMs??0,s.workMs);
 }
 return result;
}
