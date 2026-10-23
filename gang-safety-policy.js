/** Independent supervisor guard. This function is also serialized into a native worker. */
export function guardGangWarfare(ns,observedAt,now=Date.now()){
 const read=file=>{try{return JSON.parse(ns.read(file));}catch{return null;}};
 const reset=ns.getResetInfo(),lease=read('tasks/gang-warfare-lease.json');
 const owners=ns.ps('home').filter(p=>p.filename.replace(/^\//,'')==='gangs.js');
 const scoped=lease?.nodeReset===reset.lastNodeReset&&lease?.augReset===reset.lastAugReset;
 const valid=scoped&&Number.isSafeInteger(lease.ownerPid)&&lease.ownerPid>0&&Number.isFinite(lease.at)&&lease.at<=now&&lease.at>=reset.lastAugReset&&lease.expiresAt===lease.at+60000;
 const owner=valid&&owners.some(p=>p.pid===lease.ownerPid);
 const paused=ns.read('remote-control/paused/gangs.js.txt').trim()==='true';
 const maintenance=read('tasks/automation-maintenance.json');
 const maintaining=maintenance?.expiresAt>now&&ns.isRunning(maintenance.ownerPid)&&Array.isArray(maintenance.scripts)&&maintenance.scripts.some(s=>typeof s==='string'&&s.replace(/^\//,'')==='gangs.js');
 // Preserve manual gang play when this automation has never owned warfare in this reset.
 if(!owners.length&&!scoped)return {state:'unmanaged'};
 const starting=owners.length&&!owner&&Number.isFinite(observedAt)&&now>=observedAt&&now-observedAt<60000;
 const reason=paused?'paused':maintaining?'maintenance':owner&&lease.expiresAt>now?'healthy':starting?'starting':!owners.length?'owner-exited':'lease-expired';
 if(['healthy','starting'].includes(reason))return {state:reason};
 if(!ns.gang.inGang())return {state:'no-gang'};
 const gang=ns.gang.getGangInformation();
 if(gang.territoryWarfareEngaged)ns.gang.setTerritoryWarfare(false);
 // A stale saved ordinary task is less risky than leaving a weak member exposed to residual clashes.
 let restored=0;
 if(valid&&lease.faction===gang.faction&&lease.tasks&&typeof lease.tasks==='object'&&!Array.isArray(lease.tasks)){
  const tasks=new Set(ns.gang.getTaskNames()),names=new Set(ns.gang.getMemberNames());
  for(const [name,task]of Object.entries(lease.tasks).slice(0,12)){
   if(names.has(name)&&task!=='Territory Warfare'&&task!=='Unassigned'&&tasks.has(task)&&ns.gang.getMemberInformation(name).task==='Territory Warfare'){
    if(ns.gang.setMemberTask(name,task))restored++;
   }
  }
 }
 return {state:'suspended',reason,restored,residualClashChance:gang.territoryClashChance};
}

/** Read an explicit optional map; never infer manual intent from our own temporary task switches. */
export function gangManualTasks(text,allowed){
 let value;try{value=JSON.parse(text);}catch{throw new Error('manual-task-overrides must be a JSON object mapping member names to tasks');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([name,task])=>!name||typeof task!=='string'||!allowed.includes(task)||task==='Territory Warfare'||task==='Unassigned'))
  throw new Error('manual-task-overrides contains an invalid member or task; warfare and Unassigned overrides are not supported');
 return value;
}

/** Conditional fixed-territory readiness, not a promise of conquering the map. */
export function gangTerritoryRecovery(warfare,powerPerTick,readyDelay,horizonSeconds,bonusSeconds=0){
 if(!warfare?.active||!Number.isFinite(powerPerTick)||powerPerTick<0||!Number.isFinite(horizonSeconds)||horizonSeconds<0||!Number.isFinite(bonusSeconds)||bonusSeconds<0)
  return {state:'sampling',reason:'Fresh power and rival observations required'};
 if(warfare.rivals?.some(r=>!Number.isFinite(r.samples)||r.samples<3)||!warfare.rivals?.length)return {state:'sampling',reason:'Collecting rival power growth'};
 const gameSeconds=readyDelay(warfare.power,powerPerTick/20,warfare),etaSeconds=Number.isFinite(gameSeconds)?gameSeconds-Math.min(bonusSeconds,gameSeconds*24/25):null;
 const state=etaSeconds===null?'not-closing':etaSeconds===0?'ready':etaSeconds<=horizonSeconds?'within-horizon':'beyond-horizon';
 return {state,etaSeconds,horizonSeconds,powerPerTick,territory:warfare.territory,model:'Observed rivals; fixed territory and current crew',
  reason:state==='not-closing'?'Current power growth cannot reach the safe clash threshold':state==='beyond-horizon'?'Safe clashes are projected after the current planning window':'Continue productive work and timed power pulses'};
}

/** Protect one verified small gang quote from consuming corporation startup cash.
 * Corporation profit is not player income; an unknown startup payoff is reported as unknown. */
export function gangCorporationCapital(signals,free){
 const q=signals.gangCapitalQuote,horizon=signals.gangCapitalHorizon;
 const valid=q?.reason==='production'&&Number.isFinite(q.cost)&&q.cost>0&&q.cost<=free*.01&&Number.isFinite(q.cashPaybackSeconds)&&q.cashPaybackSeconds>0&&
  Number.isFinite(horizon)&&horizon>0&&q.cashPaybackSeconds<=Math.min(900,horizon);
 const protectedGangCash=signals.corporationStartup&&signals.activeCategories?.gang!==false&&free>=150e9&&valid?Math.min(q.cost,free):0;
 return {protectedGangCash,priority:protectedGangCash?'gang-quote':'normal',gangPaybackSeconds:valid?q.cashPaybackSeconds:null,corporationPaybackSeconds:null,
  reason:protectedGangCash?'Keep one small gang upgrade with verified short cash payback affordable before corporation startup':'No verified short-payback gang quote to protect'};
}
