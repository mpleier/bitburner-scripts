/** Starting preferences, not calibrated completion forecasts. Native availability always wins. */
export function bitNodeRoutePreference(node) {
 const bb=[6,7,9,10,13,14].includes(node),compare=[2,4,11,12].includes(node);
 return {selected:bb?'bladeburner':'hacking',confidence:node===8?'required':compare?'low':'prior',
  reason:node===8?'BN8 has no Bladeburner rank gain':compare?'BN'+node+' needs measured progression; WD is a weak starting preference':
   bb?'BN'+node+' starting preference: Bladeburner avoids the node’s hacking bottlenecks':'BN'+node+' starting preference: World Daemon'};
}

export function nodeRouteAvailability(reset,sources,options={},state={}) {
 const bb=reset.currentNode!==8&&reset.bitNodeOptions?.disableBladeburner!==true&&
  !!(sources[6]||sources[7])&&!!sources[4]&&!options['disable-bladeburner']&&!state.paused&&state.allowed!==false;
 return {hacking:true,bladeburner:bb,
  bladeburnerReason:bb?null:reset.currentNode===8?'BN8 disables Bladeburner progression':
   !sources[6]&&!sources[7]?'Bladeburner Source File/API unavailable':!sources[4]?'Singularity needed for unattended Bladeburner work':
   'Bladeburner disabled, paused, or restricted'};
}

/** Unknown forecasts do not win a race. Use a labelled prior until both complete ranges are usable. */
export function chooseNodeRoute(routes,previous,{now=Date.now(),augReset,nodeReset,node=1,override='auto',adaptive=true,availability={hacking:true,bladeburner:true}}={}) {
 const preference=bitNodeRoutePreference(node),available=r=>availability[r]!==false;
 const forced=override==='wd'||override==='hacking'?'hacking':override==='bb'||override==='bladeburner'?'bladeburner':!adaptive?'hacking':null;
 const base={at:now,augReset,nodeReset,routes,preference,availability,candidate:null,candidateSince:null};
 if(forced)return {...base,selected:available(forced)?forced:null,policy:available(forced)?'explicit':'unavailable',
  reason:available(forced)?'Explicit '+(forced==='hacking'?'World Daemon':'Bladeburner')+' route':availability.bladeburnerReason||'Explicit route unavailable'};
 const initial=available(preference.selected)?preference.selected:available('hacking')?'hacking':available('bladeburner')?'bladeburner':null;
 const same=previous?.augReset===augReset&&previous?.nodeReset===nodeReset&&Number.isFinite(previous.at)&&previous.at<=now&&now-previous.at<=45000;
 const known=r=>r?.actionable===true&&Number.isFinite(r.lowerMs)&&r.lowerMs>=0&&Number.isFinite(r.upperMs)&&r.upperMs>=r.lowerMs;
 const comparable=available('hacking')&&available('bladeburner')&&known(routes.hacking)&&known(routes.bladeburner);
 const incumbent=same&&['measured','measured-hold'].includes(previous.policy)&&['hacking','bladeburner'].includes(previous.selected)&&available(previous.selected);
 const lastComparableAt=incumbent?(comparable?now:Number.isFinite(previous.lastComparableAt)?previous.lastComparableAt:previous.policy==='measured'?previous.at:null):null;
 const holding=incumbent&&!comparable&&Number.isFinite(lastComparableAt)&&lastComparableAt<=now&&now-lastComparableAt<=120000;
 let selected=incumbent&&(comparable||holding)?previous.selected:initial;
 let policy=holding?'measured-hold':incumbent&&comparable?'measured':'bn-default';
 let winner=null;
 if(comparable) {
  if(routes.hacking.upperMs<routes.bladeburner.lowerMs*.75)winner='hacking';
  if(routes.bladeburner.upperMs<routes.hacking.lowerMs*.75)winner='bladeburner';
 }
 const candidate=winner&&winner!==selected?winner:null;
 const candidateSince=candidate&&same&&previous.candidate===candidate&&Number.isFinite(previous.candidateSince)&&previous.candidateSince>=0&&previous.candidateSince<=previous.at?previous.candidateSince:now;
 if(candidate&&now-candidateSince>=120000){selected=candidate;policy='measured';}
 return {...base,selected,policy,lastComparableAt:policy==='measured'?now:holding?lastComparableAt:null,candidate:policy==='measured'&&selected===candidate?null:candidate,
  candidateSince:candidate?candidateSince:null,
  reason:holding?'Retaining measured '+selected+' route through a brief forecast gap (up to two minutes)':policy==='measured'?'Measured completion ranges favor '+selected:
   candidate?'Confirming '+candidate+' advantage for two minutes; '+preference.reason:
   initial!==preference.selected?(availability.bladeburnerReason||'Preferred route unavailable')+'; using World Daemon':preference.reason+'; full completion comparison is not decisive'};
}

export function routeContinuousXp(options={},plan=null) {
 return !!options['force-xp']||!options['disable-continuous-xp']&&plan?.selected!=='bladeburner';
}

/** Read-only entry and rank milestones; partial estimates never become full completion times. */
export function routeDevelopment(snapshot,observation={}) {
 const s=snapshot,first=observation.samples?.[0],elapsed=first?(s.at-first.at)/1000:0;
 const entry=[];
 for(const key of ['strength','defense','dexterity','agility']) {
  const current=s.combat?.[key];if(!current||!Number.isFinite(current.level))continue;
  const gap=Number.isFinite(current.requiredExp)&&Number.isFinite(current.exp)?Math.max(0,current.requiredExp-current.exp):null,old=first?.combat?.[key];
  const rate=elapsed>=60&&old&&old.mult===current.mult?Math.max(0,(current.exp-old.exp)/elapsed):0;
  entry.push({stat:key,level:current.level,target:100,etaMs:current.level>=100?0:rate>0&&Number.isFinite(gap)?gap/rate*1000:null});
 }
 const needsTraining=entry.length===4&&entry.some(r=>r.level<100);
 const entryEtaMs=entry.length===4&&entry.every(r=>Number.isFinite(r.etaMs))?Math.max(...entry.map(r=>r.etaMs)):null;
 const rankRate=elapsed>=60&&Number.isFinite(s.bb?.rank)&&Number.isFinite(first?.bb?.rank)?Math.max(0,(s.bb.rank-first.bb.rank)/elapsed):null;
 const next=s.bb?.ops?.[0],rankGap=next?Math.max(0,next.required-s.bb.rank):null;
 const oldOp=first?.bb?.ops?.[0],chance=next?.chance?.[0];
 const projected=!!s.bb?.chanceModel;
 const capability=projected?next?.capabilityChance?.[0]:chance,oldChance=projected?oldOp?.capabilityChance?.[0]:oldOp?.chance?.[0];
 const sameModel=s.bb?.chanceModel===first?.bb?.chanceModel;
 const chanceRate=elapsed>=60&&sameModel&&next?.name===oldOp?.name&&typeof s.bb?.city==='string'&&s.bb.city===first?.bb?.city&&Number.isFinite(capability)&&Number.isFinite(oldChance)?Math.max(0,(capability-oldChance)/elapsed):0;
 const staminaBlocked=projected&&Number.isFinite(capability)&&capability>=.99&&!(chance>=.99);
 return {entry:{joined:!!s.bb?.joined||!!s.bb?.ops,needsTraining,etaMs:entryEtaMs,stats:entry},
  rankRate,nextBlackOp:next?{name:next.name,requiredRank:next.required,rankGap,rankEtaMs:rankGap===0?0:rankRate>0?rankGap/rankRate*1000:null,
   chanceEtaMs:chance>=.99?0:!staminaBlocked&&chanceRate>0?(.99-capability)/chanceRate*1000:null,
   staminaBlocked,capabilityChance:Number.isFinite(capability)?capability:null,
   safe:next.chance?.[0]>=.99,reason:next.chance?.[0]>=.99?'Rank and action availability still apply':staminaBlocked?'Recover stamina; capability is sufficient at full stamina':'Needs combat, skills, maximum stamina, team or population analysis'}:null,
  confidence:'Partial current-rate milestones; future upgrades and post-reset throughput remain unknown'};
}

/** Serialized worker: entry crimes only, under a live BB controller activity lease. */
export const trainBladeburnerEntrySource = String.raw`function trainBladeburnerEntry(ns,parent,ownedCrime='') {
 const now=Date.now(),r=ns.getResetInfo();let plan,lock;
 try{plan=JSON.parse(ns.read('tasks/node-route-plan.json'));lock=JSON.parse(ns.read('tasks/activity-lock.json'));}catch{return {state:'waiting'};}
 const allowed=()=>ns.isRunning(parent)&&ns.isRunning(plan.ownerPid)&&plan.selected==='bladeburner'&&
  plan.augReset===r.lastAugReset&&plan.nodeReset===r.lastNodeReset&&plan.at<=Date.now()&&Date.now()-plan.at<=45000&&
  lock.ownerPid===parent&&lock.expiresAt>Date.now()&&
  !ns.ps('home').some(p=>/(^|\/)(casino|ascend)\.js$/.test(p.filename))&&ns.read('remote-control/paused/bladeburner.js.txt').trim()!=='true'&&ns.read('remote-control/paused/crime.js.txt').trim()!=='true'&&
  (()=>{try{const m=JSON.parse(ns.read('tasks/automation-maintenance.json'));if(m.expiresAt>Date.now()&&ns.isRunning(m.ownerPid))return false;}catch{}
   try{const g=JSON.parse(ns.read('tasks/achievement-profile.json'));if(g.active&&g.nodeReset===r.lastNodeReset&&g.deniedActions?.some(a=>['bladeburner','crime'].includes(a)))return false;}catch{}
   return true;})();
 if(!allowed())return {state:'waiting'};
 const p=ns.getPlayer(),missing=['strength','defense','dexterity','agility'].filter(k=>p.skills[k]<100),work=ns.singularity.getCurrentWork();
 if(!missing.length){if(ownedCrime&&work?.type==='CRIME'&&work.crimeType===ownedCrime&&allowed())ns.singularity.stopAction();return {state:'ready'};}
 if(work?.type==='GRAFTING'||work?.type==='CREATE_PROGRAM')return {state:'protected-work'};
 if(work&&!(ownedCrime&&work.type==='CRIME'&&work.crimeType===ownedCrime)&&
  !ns.ps('home').some(p=>p.filename.replace(/^\//,'')==='work-for-factions.js'))return {state:'protected-work'};
 if(ownedCrime&&work?.type==='CRIME'&&work.crimeType===ownedCrime)return {state:'training',crime:ownedCrime};
 const choices=['Shoplift','Mug','Homicide'].map(name=>{
  const stats=ns.singularity.getCrimeStats(name),chance=ns.singularity.getCrimeChance(name);
  const gain=missing.reduce((sum,key)=>sum+Math.max(0,Number(stats[key+'_exp'])||0),0);
  return {name,score:gain*(.25+.75*chance)/stats.time,time:stats.time};
 }).filter(c=>Number.isFinite(c.score)&&c.score>0&&c.time>0&&c.time<=5000).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
 if(!choices.length||!allowed())return {state:'waiting'};
 const result=ns.singularity.commitCrime(choices[0].name,false);
 return result?{state:'training',crime:choices[0].name,at:now}:{state:'waiting'};
}`;

/** Stop only the tracked entry crime; never change replacement work during route handoff. */
export const stopBladeburnerEntrySource = String.raw`function stopBladeburnerEntry(ns,parent,crime) {
 if(!crime||!ns.isRunning(parent))return false;
 const work=ns.singularity.getCurrentWork();
 if(work?.type!=='CRIME'||work.crimeType!==crime)return false;
 return ns.singularity.stopAction();
}`;
