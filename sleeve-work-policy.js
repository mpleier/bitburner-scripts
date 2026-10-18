/** Forecast native per-cycle work gains without counting existing sleeve XP as disposable. */
export function sleeveWorkOutput(sleeve,stats,seconds,work,resetXp=true,levelMultipliers={}) {
 if(!sleeve||typeof work?.rates!=='function'||!['reputation','money','xp','utility'].includes(work.objective))return null;
 if(!Number.isFinite(seconds)||seconds<=0)return null;
 const person={...sleeve,skills:{...sleeve.skills},exp:{...sleeve.exp},mults:{...sleeve.mults}};
 const keys=['hacking','strength','defense','dexterity','agility','charisma'],xpKeys=['hackExp','strExp','defExp','dexExp','agiExp','chaExp'];
 for(const [key,value]of Object.entries(stats))if(Number.isFinite(value)&&value>0)person.mults[key]=(person.mults[key]??1)*value;
 for(const key of keys){
  if(!Number.isFinite(person.exp[key])||person.exp[key]<0)return null;
  if(resetXp)person.exp[key]=0;
  person.skills[key]=Math.max(1,Math.floor((32*Math.log(person.exp[key]+534.6)-200)*(person.mults[key]??1)*(levelMultipliers[key]??1)));
 }
 const shock=Math.max(0,Math.min(1,1-(person.shock||0)/100)),sync=Math.max(0,Math.min(1,(person.sync??100)/100));
 let total=0,left=Math.min(900,seconds);
 while(left>0){
  const step=Math.min(30,left),incomingSeconds=Math.max(0,Math.min(step,(work.externalXpSeconds??0)-(Math.min(900,seconds)-left))),before=work.rates(person);
  if(!before||xpKeys.some(key=>!Number.isFinite(before[key]??0)||Number(before[key]??0)<0))return null;
  const value=r=>work.objective==='xp'?xpKeys.reduce((sum,key)=>sum+(r[key]??0),0)*sync:r[work.objective];
  const start=value(before);if(!Number.isFinite(start)||start<0)return null;
  for(let i=0;i<keys.length;i++){
   const key=keys[i];person.exp[key]+=(before[xpKeys[i]]??0)*5*step*shock+Math.max(0,Number(work.externalXpPerSecond?.[key])||0)*incomingSeconds;
   person.skills[key]=Math.max(1,Math.floor((32*Math.log(person.exp[key]+534.6)-200)*(person.mults[key]??1)*(levelMultipliers[key]??1)));
  }
  const after=value(work.rates(person));if(!Number.isFinite(after)||after<0)return null;
  total+=(start+after)/2*5*step*shock;left-=step;
 }
 return total;
}

/** Self-contained native bridge. Formula access failures produce a deferral, never a guessed ROI. */
export function planSleeveWorkAugPurchase(ns,index,offers,budget,options,plan,forecast,incoming=()=>({})) {
 const deferred=reason=>({names:[],cost:0,reason});
 try{
  const sleeve=ns.sleeve.getSleeve(index),task=ns.sleeve.getTask(index);
  const key=t=>JSON.stringify([t?.type,t?.factionName,t?.factionWorkType,t?.companyName,t?.classType,t?.location,t?.actionType,t?.actionName]);
  if(key(task)!==key(options.task))return deferred('Task changed while quoting augmentations');
  let work;
  if(task?.type==='FACTION'){
   const favor=ns.singularity.getFactionFavor(task.factionName);
   work={objective:'reputation',rates:p=>ns.formulas.work.factionGains(p,task.factionWorkType,favor)};
  }else if(task?.type==='COMPANY'){
   const job=ns.getPlayer().jobs[task.companyName];if(!job)return deferred('Company job is no longer available');
   const favor=ns.singularity.getCompanyFavor(task.companyName);
   work={objective:'reputation',rates:p=>ns.formulas.work.companyGains(p,task.companyName,job,favor)};
  }else if(task?.type==='CLASS'){
   const gym=Object.values(ns.enums.GymType).includes(task.classType);
   work={objective:'xp',rates:p=>gym?ns.formulas.work.gymGains(p,task.classType,task.location):ns.formulas.work.universityGains(p,task.classType,task.location)};
  }else if(task?.type==='BLADEBURNER'&&task.actionType==='General'){
   const name=task.actionName;
   // General action coefficients verified against the official v3.0.1 source.
   if(name==='Training')work={objective:'xp',rates:p=>Object.fromEntries(['str','def','dex','agi'].map((key,i)=>[key+'Exp',(p.mults[['strength','defense','dexterity','agility'][i]+'_exp']??1)/5]))};
   else if(name==='Field Analysis')work={objective:'utility',rates:p=>({hackExp:20*(p.mults.hacking_exp??1)/150,chaExp:20*(p.mults.charisma_exp??1)/150,
    utility:(.04*Math.pow(p.skills.hacking,.3)+.04*Math.pow(p.skills.intelligence,.9)+.02*Math.pow(p.skills.charisma,.3))*(p.mults.bladeburner_analysis??1)/150})};
   else if(name==='Diplomacy'){
    if(!(ns.bladeburner.getCityChaos(ns.bladeburner.getCity())>0))return deferred('No city chaos to reduce');
    work={objective:'utility',rates:p=>({utility:(Math.pow(p.skills.charisma,.045)+p.skills.charisma/1000)/300})};
   }
  }
  if(!work)return deferred(['SUPPORT','INFILTRATE'].includes(task?.type)?'Current task output does not benefit from sleeve augmentations':'Task-specific post-reset benefit cannot be verified');
  const xpKeys=['hackExp','strExp','defExp','dexExp','agiExp','chaExp'],keys=['hacking','strength','defense','dexterity','agility','charisma'];
  if(options.xpObservation&&ns.isRunning(options.ownerPid)){
   const current=work.rates(sleeve),own=Object.fromEntries(keys.map((k,i)=>[k,Math.max(0,current[xpKeys[i]]??0)*5]));
   work.externalXpPerSecond=incoming(options.xpObservation,sleeve,own,ns.getResetInfo(),options.ownerPid);
   work.externalXpSeconds=Math.max(0,Math.min(90,(options.xpObservation.observedAt+90000-Date.now())/1000));
  }
  const workForecast=(s,stats,seconds,reset)=>forecast(s,stats,seconds,work,reset,options.levelMultipliers);
  const result=plan({sleeve,offers,budget,objective:work.objective,minBatch:options.minBatch,workForecast});
  return {...result,xpSource:Object.values(work.externalXpPerSecond||{}).some(n=>n>0)?'observed-peer-xp':'own-work-only',taskType:task.type,model:task.type==='BLADEBURNER'?'source-general-action':'native-work-formulas'};
 }catch(error){return deferred('Work forecast unavailable; preserving sleeve skills: '+String(error));}
}

/** Read-only native reputation audit; ambiguous producers are excluded. */
export function sampleSleeveReputation(ns) {
 try{
  const count=ns.sleeve.getNumSleeves(),tasks=Array.from({length:count},(_,i)=>ns.sleeve.getTask(i)),player=ns.getPlayer(),current=ns.singularity.getCurrentWork();
  let gang=null;try{if(ns.gang.inGang())gang=ns.gang.getGangInformation().faction;}catch{}
  return tasks.map((task,index)=>{
   const type=task?.type,name=type==='FACTION'?task.factionName:task?.companyName;
   const excluded=reason=>({index,eligible:false,reason});
   if(!['FACTION','COMPANY'].includes(type))return excluded('not-reputation-work');
   if(tasks.some((t,i)=>i!==index&&t?.type===type&&(type==='FACTION'?t.factionName:t.companyName)===name)||current?.type===type&&(type==='FACTION'?current.factionName:current.companyName)===name||type==='FACTION'&&name===gang)return excluded('multiple-reputation-producers');
   const sleeve=ns.sleeve.getSleeve(index);
   if(sleeve.shock!==0||sleeve.sync!==100||!Number.isFinite(sleeve.storedCycles)||sleeve.storedCycles>5)return excluded('shock-sync-or-bonus-cycles');
   const faction=type==='FACTION',favor=faction?ns.singularity.getFactionFavor(name):ns.singularity.getCompanyFavor(name),job=faction?null:player.jobs[name];
   if(!faction&&!job)return excluded('company-job-unavailable');
   const gains=faction?ns.formulas.work.factionGains(sleeve,task.factionWorkType,favor):ns.formulas.work.companyGains(sleeve,name,job,favor);
   const rep=faction?ns.singularity.getFactionRep(name):ns.singularity.getCompanyRep(name),rate=gains.reputation*5;
   if(!Number.isFinite(rep)||!Number.isFinite(rate)||rate<0)return excluded('invalid-native-quote');
   return {index,eligible:true,key:JSON.stringify([type,name,task.factionWorkType,job,favor,sleeve.mults]),rep,rate};
  });
 }catch(error){return [{index:-1,eligible:false,reason:'native-audit-unavailable: '+String(error)}];}
}

/** Integrate quoted native rates, then compare with an isolated thirty-second window. Diagnostic only. */
export function observeSleeveReputation(previous,quotes,now,reset,pid) {
 const valid=previous?.pid===pid&&previous.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&previous.at<=now&&now-previous.at<=15000;
 const windows={},results=[];
 for(const quote of quotes){
  if(!quote.eligible){results.push(quote);continue;}
  const old=valid?previous.windows?.[quote.index]:null;
  const start=()=>({key:quote.key,startAt:now,startRep:quote.rep,lastRep:quote.rep,lastRate:quote.rate,predicted:0});
  if(!old||old.key!==quote.key||quote.rep<old.lastRep){windows[quote.index]=start();results.push({index:quote.index,reason:'calibrating'});continue;}
  const seconds=(now-previous.at)/1000,predicted=old.predicted+(old.lastRate+quote.rate)/2*seconds;
  if(now-old.startAt<30000){windows[quote.index]={...old,lastRep:quote.rep,lastRate:quote.rate,predicted};results.push({index:quote.index,reason:'calibrating'});continue;}
  const observed=quote.rep-old.startRep,relativeError=predicted>0?(observed-predicted)/predicted:null;
  results.push({index:quote.index,reason:relativeError===null?'zero-prediction':Math.abs(relativeError)>.25?'unexplained-reputation-change':'measured',seconds:(now-old.startAt)/1000,predicted,observed,relativeError});
  windows[quote.index]=start();
 }
 return {at:now,pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,windows,results,lastMeasured:results.some(r=>r.reason==='measured'||r.reason==='unexplained-reputation-change')?{at:now,results:results.filter(r=>r.relativeError!==undefined)}:valid?previous.lastMeasured:null};
}
