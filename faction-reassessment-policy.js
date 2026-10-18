/** Membership changes stay latched until the top-level work planner acknowledges them. */
export function observeFactionMembership(previous,names) {
 if(!Array.isArray(names))return previous;
 const current=[...new Set(names.filter(n=>typeof n==='string'&&n.length>0))].sort();
 const baseline=previous?.baseline??current;
 return {baseline:[...baseline],current,changed:previous?.changed===true||JSON.stringify(baseline)!==JSON.stringify(current),
  added:current.filter(n=>!baseline.includes(n))};
}
export function acknowledgeFactionMembership(state) {
 return state?{baseline:[...state.current],current:[...state.current],changed:false,added:[]}:state;
}


/** Only a fresh, live, reset-scoped autopilot wait may redirect ordinary faction work. */
export function augmentationFundingWorkTargets(record,{now=Date.now(),reset,ownerAlive=false,joined=[],skip=[],first=[],
 gangFaction=null,crimeFocus=false,invitesOnly=false}={}) {
 const plan=record?.plan,funding=plan?.funding;
 if(!Number.isFinite(now)||!reset||!Number.isFinite(reset.lastAugReset)||!Number.isFinite(reset.lastNodeReset)||!ownerAlive||crimeFocus||invitesOnly||first.length||
  record?.schemaVersion!==1||record.active!==true||record.augReset!==reset.lastAugReset||record.nodeReset!==reset.lastNodeReset||
  !Number.isSafeInteger(record.ownerPid)||record.ownerPid<=0||
  !Number.isFinite(record.at)||record.at>now||now-record.at>120000||
  !Number.isFinite(record.startedAt)||record.startedAt<reset.lastAugReset||record.startedAt>now||
  !Number.isFinite(record.expiresAt)||record.expiresAt<=now||record.expiresAt-record.startedAt>15*60000||
  plan?.worthWaiting!==true||typeof plan.name!=='string'||!Number.isFinite(plan.at)||plan.at>now||now-plan.at>120000||
  !Number.isFinite(plan.deadline)||plan.deadline<=now||plan.deadline>record.expiresAt||
  !funding||!Number.isFinite(funding.seconds)||funding.seconds<0||
  !funding.workTargets||!funding.workByFaction)return [];
 const cannotWork=new Set([gangFaction,'Bladeburners','Church of the Machine God','Shadows of Anarchy']);
 return Object.entries(funding.workTargets).filter(([faction,target])=>
  joined.includes(faction)&&!skip.includes(faction)&&!cannotWork.has(faction)&&Number.isFinite(target)&&target>0&&
  Number.isFinite(funding.workByFaction[faction])&&funding.workByFaction[faction]>0)
  .sort(([a],[b])=>funding.workByFaction[a]-funding.workByFaction[b]||a.localeCompare(b))
  .map(([faction,targetRep])=>({faction,targetRep,deadline:plan.deadline,
   key:JSON.stringify([record.ownerPid,record.nodeReset,record.augReset,record.startedAt,plan.name,faction,targetRep])}));
}
