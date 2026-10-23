/** Local marginal competence gain for the pending Black Op, not an end-to-end ETA. */
export function combatXpValue(rates,context) {
 const p=context?.player,m=context?.metadata;
 if(!p?.skills||!p.exp||!m?.weights||!m.decays)return 0;
 let value=0;
 for(const stat of ['hacking','strength','defense','dexterity','agility','charisma','intelligence']) {
  const weight=m.weights[stat],decay=m.decays[stat],xp=p.exp[stat],level=p.skills[stat],rate=rates?.[stat];
  if(!(Number.isFinite(rate)&&rate>0&&Number.isFinite(weight)&&weight>0&&Number.isFinite(decay)&&decay>0&&Number.isFinite(xp)&&xp>=0&&Number.isFinite(level)&&level>1))continue;
  const base=32*Math.log(xp+534.6)-200;
  const mult=stat==='intelligence'?1:context.inferLevels===true?(base>0?level/base:null):(p.mults?.[stat]??1)*(context.levelMultipliers?.[stat]??1);
  const effective=context.effective?.[stat]??1;
  if(!(Number.isFinite(mult)&&mult>0&&Number.isFinite(effective)&&effective>0))continue;
  value+=rate*weight*decay*Math.pow(level,decay-1)*Math.pow(effective,decay)*32*mult/(xp+534.6);
 }
 // Intelligence also multiplies the entire native competence sum. Keep scores
 // in the existing unscaled competence units by using the bonus log derivative.
 const int=p.skills.intelligence,intXp=p.exp.intelligence,intRate=rates?.intelligence;
 if(Number.isFinite(int)&&int>1&&Number.isFinite(intXp)&&intXp>=0&&Number.isFinite(intRate)&&intRate>0){
  let competence=0;
  for(const [stat,weight]of Object.entries(m.weights)){
   const level=p.skills[stat],decay=m.decays[stat],effective=context.effective?.[stat]??1;
   if([weight,level,decay,effective].every(Number.isFinite)&&weight>0&&level>0&&decay>0&&effective>0)competence+=weight*Math.pow(level*effective,decay);
  }
  const bonus=1+.75*Math.pow(int,.8)/600;
  value+=intRate*32/(intXp+534.6)*competence*(.75*.8*Math.pow(int,-.2)/600)/bonus;
 }
 // Discounted marginal action-speed value, in the same competence/sec units.
 // Native action time uses effective dex/agi; suppress this term at its one-second floor.
 if(Number.isFinite(context.speedWeight)&&context.speedWeight>0&&context.speedWeight<=1){
  let competence=0;for(const [stat,w]of Object.entries(m.weights)){const level=p.skills[stat],d=m.decays[stat],e=context.effective?.[stat]??1;if([w,level,d,e].every(Number.isFinite)&&w>0&&level>0&&d>0&&e>0)competence+=w*Math.pow(level*e,d);}
  const dex=p.skills.dexterity*(context.effective?.dexterity??1),agi=p.skills.agility*(context.effective?.agility??1);
  const fac=.5*(Math.pow(dex,.035)+Math.pow(agi,.04)+(dex+agi)/10000);
  if(Number.isFinite(fac)&&fac>0&&m.baseDifficulty/(10*fac)>1)for(const [stat,level,effective,exponent]of [['dexterity',dex,context.effective?.dexterity??1,.035],['agility',agi,context.effective?.agility??1,.04]]){
   const xp=p.exp[stat],rate=rates?.[stat],base=32*Math.log(xp+534.6)-200,mult=context.inferLevels===true?(base>0?p.skills[stat]/base:0):(p.mults?.[stat]??1)*(context.levelMultipliers?.[stat]??1);
   if([xp,rate,mult,level,effective].every(Number.isFinite)&&xp>=0&&rate>0&&mult>0&&level>0&&effective>0)value+=context.speedWeight*competence*.5*(exponent*Math.pow(level,exponent-1)+1/10000)/fac*effective*32*mult*rate/(xp+534.6);
  }
 }
 return Number.isFinite(value)?value:0;
}

/** Relative immediate capability plus a discounted XP-growth preference. Null retains the generic basket policy. */
export function combatAugmentationValue(stats,context) {
 const p=context?.player,m=context?.metadata;
 if(!p?.skills||!m?.weights||!m.decays)return null;
 let before=0,after=0,xpBonus=0;
 for(const [stat,weight]of Object.entries(m.weights)) {
  const decay=m.decays[stat],level=p.skills[stat],effective=context.effective?.[stat]??1;
  if(![weight,decay,level,effective].every(Number.isFinite)||weight<0||decay<0||level<0||effective<=0)return null;
  if(!weight||!decay)continue;
  const boost=stats?.[stat]??1,exp=stats?.[stat+'_exp']??1;
  if(![boost,exp].every(v=>Number.isFinite(v)&&v>0))return null;
  const term=weight*Math.pow(level*effective,decay);
  before+=term;after+=term*Math.pow(boost,decay);xpBonus+=term*decay*Math.log(exp);
 }
 const success=stats?.bladeburner_success_chance??1;
 if(!['bladeburner_max_stamina','bladeburner_stamina_gain'].every(k=>Number.isFinite(stats?.[k]??1)&&(stats?.[k]??1)>0))return null;
 if(!(before>0&&Number.isFinite(after)&&Number.isFinite(success)&&success>0))return null;
 return Math.max(0,Math.log(after/before)+Math.log(success)+.4*xpBonus/before)+
  ['bladeburner_max_stamina','bladeburner_stamina_gain'].reduce((s,k)=>s+Math.max(0,Math.log(stats?.[k]??1)),0);
}

/** Read only fresh evidence owned by the current Bladeburner controller. */
export function readCombatGrowthContext(ns,player,now=Date.now()) {
 try {
  const d=JSON.parse(ns.read('tasks/bladeburner-development.json')),r=ns.getResetInfo();
  if(!(d.chanceBlocked||d.preparingStats===true)||d.nodeReset!==r.lastNodeReset||d.augReset!==r.lastAugReset||!Number.isFinite(d.at)||d.at>now||now-d.at>=30000||
   !ns.ps('home').some(p=>p.pid===d.pid&&p.filename.replace(/^\//,'')==='bladeburner.js'))return null;
  return {metadata:d.metadata,player,effective:d.effective,speedWeight:.25};
 }catch{return null;}
}

/** Optional native formulas; unknown or unavailable quotes simply retain crime work. No travel. */
export function quoteSleeveCombatGyms(ns,sleeves,allowTravel=false) {
 try {
  if(!ns.fileExists('Formulas.exe','home'))return [];
  const gyms={'Sector-12':ns.enums.LocationName.Sector12PowerhouseGym,Aevum:ns.enums.LocationName.AevumSnapFitnessGym,Volhaven:ns.enums.LocationName.VolhavenMilleniumFitnessGym};
  const keys={strength:'strExp',defense:'defExp',dexterity:'dexExp',agility:'agiExp'};
  return sleeves.map(s=>{
   const cities=allowTravel?Object.keys(gyms).filter(city=>typeof gyms[city]==='string'):gyms[s.city]?[s.city]:[];
   return cities.flatMap(city=>Object.keys(keys).map(stat=>{
    const q=ns.formulas.work.gymGains({...s,city},ns.enums.GymType[stat],gyms[city]);
    const cost=-5*q.money;
    const rates=Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,5*q[v]]));
    return [cost,...Object.values(rates)].every(v=>Number.isFinite(v)&&v>=0)?{stat,gymType:ns.enums.GymType[stat],gym:gyms[city],city,fromCity:s.city,travelCost:city===s.city?0:200000,travelMs:city===s.city?0:1000,cost,rates}:null;
   }).filter(Boolean));
  });
 }catch{return [];}
}

/** Require a useful margin, preserve an invested crime, and price one bounded spending interval. */
export function chooseSleeveCombatGym(sleeve,quotes,crime,context,{money,reserve=0,seconds=30,task=null}={}) {
 if(!sleeve||sleeve.shock!==0||!Number.isFinite(sleeve.sync)||sleeve.sync<100||!Number.isFinite(money)||!Number.isFinite(reserve)||reserve<0||!Number.isFinite(seconds)||seconds<=0||seconds>120)return null;
 if(task?.type==='CRIME'&&task.cyclesWorked>0&&task.cyclesWorked<task.cyclesNeeded)return null;
 let best=null;
 for(const q of quotes||[]) {
  if(q.city!==sleeve.city&&q.fromCity!==sleeve.city||!['strength','defense','dexterity','agility'].includes(q.stat)||typeof q.gym!=='string'||!Number.isFinite(q.cost)||q.cost<0)continue;
  const travel=q.city===sleeve.city?0:q.travelCost,delay=q.city===sleeve.city?0:q.travelMs;
  if(![travel,delay].every(Number.isFinite)||travel<0||delay<0||delay>=seconds*1000)continue;
  const local=Math.max(0,crime?.rate||0,...(quotes||[]).filter(p=>p.city===sleeve.city).map(p=>combatXpValue(p.rates,context)));
  const raw=combatXpValue(q.rates,context),score=raw*(seconds-delay/1000)/seconds,cost=q.cost*(seconds+1)+travel;
  if(travel>0&&(score<=local*1.1||cost>Math.max(0,money-reserve)*.01))continue;
  if(score>Math.max(0,crime?.rate||0)*1.1&&cost<=Math.max(0,money-reserve)&&score>(best?.score||0))best={...q,score,budget:cost};
 }
 return best;
}

/** Native repeatable-action XP scales with difficulty, not rank reward or player crime XP multipliers. */
export function bladeburnerGrowthChoice(actions,context,{hyperdrive=0,trainingTime=30000,trainingAllowed=false}={}) {
 let best=null;
 for(const a of actions||[]) {
  if(!a||!Number.isFinite(a.time)||a.time<=0||!Number.isFinite(a.difficulty)||a.difficulty<=0||!Number.isFinite(a.chance)||a.chance<0||a.chance>1||!Number.isFinite(a.duty)||a.duty<=0||a.duty>1||!a.weights)continue;
  const gain=(Math.pow(a.difficulty,.28)+a.difficulty/650)*(.5+.5*a.chance)*(1+.1*hyperdrive)*a.duty;
  const rates=Object.fromEntries(Object.entries(a.weights).map(([stat,weight])=>[stat,weight*gain*(stat==='intelligence'?.003:1)]));
  const score=combatXpValue(rates,context);
  if(score>(best?.score||0))best={name:a.name,level:a.level,score,rates,time:a.time,duty:a.duty,recovery:a.recovery??null,progressMs:a.progressMs??0,supply:a.supply===undefined&&context?.growthSupply?(context.growthSupply[a.name]??null):a.supply,kind:'mission'};
 }
 if(trainingAllowed&&Number.isFinite(trainingTime)&&trainingTime>0) {
  const rates=Object.fromEntries(['strength','defense','dexterity','agility'].map(stat=>[stat,30*(context?.player?.mults?.[stat+'_exp']??1)/(trainingTime/1000)]));
  const score=combatXpValue(rates,context);
  if(score>(best?.score||0))best={name:'Training',score,rates,time:trainingTime,kind:'training'};
 }
 return best;
}

export function combatCrimeCompleted(previous,current) {
 if(current?.type!=='CRIME')return true;
 if(!(current.cyclesWorked>0))return true;
 return previous?.type==='CRIME'&&previous.crimeType===current.crimeType&&(
  Number.isFinite(previous.tasksCompleted)&&Number.isFinite(current.tasksCompleted)&&current.tasksCompleted>previous.tasksCompleted||
  Number.isFinite(previous.cyclesWorked)&&current.cyclesWorked<previous.cyclesWorked);
}

/** Reuse synchronous level/team probes with an XP objective; native mutation guards remain authoritative. */
export function planBladeburnerGrowthLevels(api,actions,threshold,allowed,reservedTeam,cap,supporting,recovery,context,hyperdrive,weights,teams,levels,rankRate,growth,forecast) {
 const plans={};
 for(const [name,type]of actions) {
  if(!allowed())break;
  const data=recovery?.actions?.[name];if(!data||!weights[name])continue;
  const objective=(chance,m)=>{
   const timing={};if(rankRate(chance,m,timing)===null)return null;
   const time=m.nativeTime??m.time;
   const choice=growth([{name,time,difficulty:data.base*Math.pow(data.factor,m.level-1),chance:chance?.[0],weights:weights[name],duty:timing.duty*time/m.time,recovery:timing.regeneration}],context,{hyperdrive});
   return choice?.score??0;
  };
  const result=teams(api,[[name,type]],threshold,objective,allowed,levels,reservedTeam,cap,supporting,{...recovery,retainGrowthVariants:true},forecast);
  if(result[name]?.score>0)plans[name]={...result[name],variants:type==='Contracts'||result[name].team===0||recovery?.maintenance?result[name].variants:undefined,objective:'combat-xp',scoreBasis:growth.staminaAdjusted?'stamina-effective-competence':'xp-competence'};
 }
 return plans;
}

/** Per-action city score in the same competence/sec units as the XP level planner. */
export function bladeburnerCityGrowthScore(chance,metrics,data,weights,context,hyperdrive,rankRate,growth,supply=undefined) {
 if(!data||!weights||!Number.isSafeInteger(metrics?.level)||metrics.level<1)return null;
 const timing={};if(rankRate(chance,metrics,timing)===null)return null;
 const time=metrics.nativeTime??metrics.time;
 const choice=growth([{name:'city-probe',supply,time,difficulty:data.base*Math.pow(data.factor,metrics.level-1),chance:chance?.[0],weights,duty:timing.duty*time/metrics.time,recovery:timing.regeneration}],context,{hyperdrive});
 return choice?.score??0;
}

/** Optional city-independent native Training quote; failures leave ordinary city scoring available. */
export function quoteBladeburnerCityTraining(api,target,context,forecast,growth) {
 try {
  if(typeof target!=='string'||!target||!context?.metadata)return null;
  const stamina=api.getStamina(),rawChance=api.getActionEstimatedSuccessChance('Black Operations',target);
  const chance=forecast(rawChance,stamina,context.metadata.baseDifficulty);
  const time=api.getActionTime('General','Training');
  const training=growth([],context,{trainingTime:time,trainingAllowed:true});
  const hp=context.player?.hp;
  return training?.kind==='training'&&Number.isFinite(training.score)&&training.score>0?
   {...training,staminaForecast:training.stamina??null,chance,rawChance,stamina,hpRatio:Number.isFinite(hp?.current)&&Number.isFinite(hp?.max)&&hp.max>0?hp.current/hp.max:null}:null;
 }catch{return null;}
}

/** Raise only the current city's XP baseline; reassess live budget/option gates outside the city cache. */
export function applyBladeburnerTrainingBaseline(rows,current,training,settings,development) {
 if(!Array.isArray(rows)||!rows.some(r=>r?.city===current)||rows.some(r=>r?.objective!=='combat-xp')||
  training?.kind!=='training'||training.name!=='Training'||!Number.isFinite(training.score)||training.score<=0||!Number.isFinite(training.time)||training.time<=0||
  !Number.isFinite(training.hpRatio)||training.hpRatio<.5||settings?.enabled!==true||!Number.isFinite(settings.remainingMs)||settings.remainingMs<training.time||
  !Array.isArray(training.stamina)||training.stamina.length!==2||!training.stamina.every(Number.isFinite)||training.stamina[1]<=0||training.stamina[0]<0||
  !Number.isFinite(settings.lowStaminaPct)||settings.lowStaminaPct<0||settings.lowStaminaPct>1||training.stamina[0]/training.stamina[1]<settings.lowStaminaPct||typeof development!=='function')return rows;
 const chance=training.chance,raw=training.rawChance;
 if(!Array.isArray(chance)||chance.length!==2||!Array.isArray(raw)||raw.length!==2||![...chance,...raw].every(v=>Number.isFinite(v)&&v>=0&&v<=1))return rows;
 if(training.stamina[0]<training.stamina[1]*.99&&raw[0]>=settings.threshold&&chance[0]<settings.threshold)return rows;
 if(development({...settings,chance})!=='Training')return rows;
 return rows.map(row=>{if(row.city!==current||training.score<=row.score)return row;const {fallback,fallbackPairs,...single}=row;return {...single,score:training.score,action:'Training',level:null,baseline:'Training'};});
}

/** Refresh cached Training safety gates without rerunning city probes or changing cached scores. */
export function refreshBladeburnerTrainingVitals(training,live,target,city,reset,difficulty,forecast,now=Date.now()) {
 if(training?.kind!=='training'||training.name!=='Training'||typeof target!=='string'||!target||live?.target!==target||live.city!==city||
  !Number.isFinite(live.at)||live.at>now||now-live.at>=15000||
  ![live.nodeReset,live.augReset].every(v=>Number.isFinite(v)&&v>=0)||live.nodeReset!==reset?.lastNodeReset||live.augReset!==reset?.lastAugReset||
  !Number.isFinite(live.hp?.current)||!Number.isFinite(live.hp?.max)||live.hp.max<=0||live.hp.current<0||live.hp.current>live.hp.max||
  !Array.isArray(live.stamina)||live.stamina.length!==2||!live.stamina.every(Number.isFinite)||live.stamina[0]<0||live.stamina[1]<=0||live.stamina[0]>live.stamina[1]||
  !Array.isArray(live.rawChance)||live.rawChance.length!==2||!live.rawChance.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||live.rawChance[0]>live.rawChance[1]||
  !Number.isFinite(difficulty)||difficulty<=0||typeof forecast!=='function')return null;
 try {
  const stamina=[...live.stamina],rawChance=[...live.rawChance],chance=forecast(rawChance,stamina,difficulty);
  if(!Array.isArray(chance)||chance.length!==2||!chance.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||chance[0]>chance[1])return null;
  return {...training,hpRatio:live.hp.current/live.hp.max,stamina,rawChance,chance};
 }catch{return null;}
}

/** Early preparation must materially beat rank work and leave substantial rank runway. */
export function earlyBladeburnerGrowth(candidate,rankWork,{rankEtaMs,remainingMs}={}){
 if(!candidate||!Number.isFinite(candidate.score)||candidate.score<=0)return false;
 if(candidate.kind==='mission')return candidate.name===rankWork?.name||candidate.score>(rankWork?.score||0)*1.25;
 return candidate.kind==='training'&&Number.isFinite(candidate.time)&&candidate.time>0&&Number.isFinite(remainingMs)&&candidate.time<=remainingMs&&Number.isFinite(rankEtaMs)&&rankEtaMs>=Math.max(120000,candidate.time*5)&&candidate.score>(rankWork?.score||0)*1.25;
}
