import {sleeveFactionRepScore} from './sleeve-policy.js';
export const sleeveRepHandoffFile='tasks/sleeve-rep-handoffs.json';

/** Borrow only idle sleeves or those that just completed recovery/synchronization.
 * Never interrupt a crime, class, another faction/company, or Bladeburner action. */
export function planSleeveRepHandoff(sleeves,tasks,assignments,state,context,now=Date.now()) {
 if(!Number.isFinite(context?.nodeReset)||!Number.isFinite(context?.augReset)||context.augReset<context.nodeReset||!Number.isFinite(now)||!Number.isSafeInteger(context?.ownerPid)||context.ownerPid<=0)return null;
 const same=state?.nodeReset===context.nodeReset&&state.augReset===context.augReset;
 if(same&&(state.version!==1||!state.entries||typeof state.entries!=='object'||Array.isArray(state.entries)))return null;
 const entries=same?state.entries:{},reserved=new Set(context.reservedSleeves||[]);
 const ready=i=>sleeves[i]?.shock===0&&sleeves[i]?.sync===100&&!reserved.has(i);
 const proposals=[];
 for(const [key,target]of Object.entries(assignments||{})){
  const from=Number(key),entry=entries[target.name];
  if(target.type!=='FACTION'||target.priority!==0||!ready(from)||tasks[from]?.type!=='FACTION'||tasks[from].factionName!==target.name||!Number.isFinite(target.requiredRep)||target.requiredRep<=0)continue;
  if(entry&&(entry.blocked||entry.pending||![entry.lastAttempt??0,entry.lastSuccess??0].every(t=>Number.isFinite(t)&&t>=0&&t<=now)||entry.lastAttempt>0&&now-entry.lastAttempt<60000||entry.lastSuccess>0&&now-entry.lastSuccess<600000))continue;
  const old=sleeveFactionRepScore(sleeves[from],target.workTypes||[],context);if(!old)continue;
  for(let to=0;to<sleeves.length;to++){
   if(to===from||!ready(to)||tasks[to]&&!['RECOVERY','SYNCHRO'].includes(tasks[to].type)||assignments[to]?.priority===0)continue;
   const next=sleeveFactionRepScore(sleeves[to],target.workTypes||[],context);
   if(!next||next.score<=old.score||next.score<old.score*1.5)continue;
   proposals.push({id:`${context.ownerPid}:${now}:${target.name}:${from}:${to}`,at:now,nodeReset:context.nodeReset,augReset:context.augReset,ownerPid:context.ownerPid,
    faction:target.name,requiredRep:target.requiredRep,from,to,fromWorkType:tasks[from].factionWorkType,toTaskType:tasks[to]?.type??null,
    oldScore:old.score,newScore:next.score,ratio:old.score>0?next.score/old.score:null});
  }
 }
 return proposals.sort((a,b)=>(b.ratio??Number.MAX_VALUE)-(a.ratio??Number.MAX_VALUE)||b.newScore-a.newScore||a.to-b.to)[0]||null;
}

/** Self-contained native transaction; serialize with an injected scoring function.
 * Attempt state is saved before mutation; all task mutations are synchronous. */
export async function executeSleeveRepHandoff(ns,p,score,allowed) {
 const file='tasks/sleeve-rep-handoffs.json',now=Date.now(),reset=ns.getResetInfo();
 const receipt={id:p?.id,success:false,blocked:false,reason:'Handoff deferred'};
 if(!p||typeof p.id!=='string'||!Number.isFinite(p.at)||p.at>now||now-p.at>10000||p.nodeReset!==reset.lastNodeReset||p.augReset!==reset.lastAugReset||
  !Number.isSafeInteger(p.from)||!Number.isSafeInteger(p.to)||p.from<0||p.to<0||p.from===p.to||typeof p.faction!=='string'||!Number.isFinite(p.requiredRep)||p.requiredRep<=0||!allowed())return receipt;
 if(typeof ns.sleeve?.setToFactionWork!=='function'||typeof ns.sleeve?.setToShockRecovery!=='function')return {...receipt,reason:'Sleeve assignment API unavailable'};
 let state;
 try{state=JSON.parse(ns.read(file)||'null');}catch{return {...receipt,reason:'Invalid handoff ledger'};}
 if(state?.nodeReset!==p.nodeReset||state.augReset!==p.augReset)state={version:1,nodeReset:p.nodeReset,augReset:p.augReset,entries:{}};
 if(state.version!==1||!state.entries||typeof state.entries!=='object'||Array.isArray(state.entries)||Object.keys(state.entries).length>32)return {...receipt,reason:'Invalid handoff ledger'};
 const old=state.entries[p.faction]||{};
 if(old.blocked||old.pending||![old.lastAttempt??0,old.lastSuccess??0].every(t=>Number.isFinite(t)&&t>=0&&t<=now)||old.lastAttempt>0&&now-old.lastAttempt<60000||old.lastSuccess>0&&now-old.lastSuccess<600000)return {...receipt,reason:'Handoff cooldown or unresolved rollback'};
 if(!state.entries[p.faction]&&Object.keys(state.entries).length>=32)return {...receipt,reason:'Handoff ledger full'};
 state.entries[p.faction]={...old,lastAttempt:now,id:p.id,pending:true};
 // If this write fails no task has been touched.
 await ns.write(file,JSON.stringify(state),'w');
 let released=false;
 const owns=(i)=>{const t=ns.sleeve.getTask(i);return t?.type==='FACTION'&&t.factionName===p.faction;};
 try{
  const current=ns.getResetInfo();
  if(!allowed()||Date.now()-p.at>10000||current.lastNodeReset!==p.nodeReset||current.lastAugReset!==p.augReset)throw Error('Controls, reset or dispatch changed');
  const count=ns.sleeve.getNumSleeves();if(p.from>=count||p.to>=count)throw Error('Sleeve no longer available');
  const a=ns.sleeve.getSleeve(p.from),b=ns.sleeve.getSleeve(p.to),from=ns.sleeve.getTask(p.from),to=ns.sleeve.getTask(p.to);
  if(a.shock!==0||a.sync!==100||b.shock!==0||b.sync!==100||from?.type!=='FACTION'||from.factionName!==p.faction||from.factionWorkType!==p.fromWorkType||
   (to?.type??null)!==p.toTaskType||to&&!['RECOVERY','SYNCHRO'].includes(to.type))throw Error('Sleeve state changed');
  for(let i=0;i<count;i++)if(i!==p.from&&owns(i))throw Error('Faction owner changed');
  const reputation=ns.singularity.getFactionRep(p.faction);
  if(!Number.isFinite(reputation)||reputation<0||!ns.getPlayer().factions.includes(p.faction)||reputation>=p.requiredRep)throw Error('Faction target no longer needed');
  const types=ns.singularity.getFactionWorkTypes(p.faction),shareBonus=ns.getSharePower(),r=ns.getResetInfo();
  const level=value=>value instanceof Map?value.get(15)??value.get('15'):value?.[15];
  let sf15Level=Math.max(r.currentNode===15?1:0,Number(level(r.ownedSF))||0);
  const override=level(r.bitNodeOptions?.sourceFileOverrides);
  if(override!==undefined)sf15Level=Number.isFinite(Number(override))&&Number(override)>0?Number(override):0;
  const context={shareBonus,sf15Level},oldQuote=score(a,types,context),next=score(b,types,context);
  if(!Number.isFinite(shareBonus)||shareBonus<1||!oldQuote||!next||next.score<=oldQuote.score||next.score<oldQuote.score*1.5)throw Error('Reputation advantage no longer qualifies');
  if(!allowed())throw Error('Controls changed');
  released=true;
  if(!ns.sleeve.setToShockRecovery(p.from)||owns(p.from))throw Error('Old owner release failed');
  if(!allowed())throw Error('Controls changed after release');
  if(!ns.sleeve.setToFactionWork(p.to,p.faction,next.workType)||!owns(p.to))throw Error('New owner assignment failed');
  receipt.success=true;receipt.reason='Higher reputation worker assigned';receipt.oldScore=oldQuote.score;receipt.newScore=next.score;
 }catch(error){
  receipt.reason=String(error);
  if(released){
   try{
    if(owns(p.to)&&!owns(p.from)){receipt.success=true;receipt.reason='Native state confirms completed handoff';}
    else if(!owns(p.from)){
     if(!allowed()||!ns.sleeve.setToFactionWork(p.from,p.faction,p.fromWorkType)||!owns(p.from))receipt.blocked=true;
    }
   }catch{receipt.blocked=true;}
  }
 }
 state.entries[p.faction]={...state.entries[p.faction],lastSuccess:receipt.success?Date.now():old.lastSuccess??0,blocked:receipt.blocked,pending:false,lastResult:{...receipt,at:Date.now(),from:p.from,to:p.to}};
 await ns.write(file,JSON.stringify(state),'w');
 return receipt;
}
