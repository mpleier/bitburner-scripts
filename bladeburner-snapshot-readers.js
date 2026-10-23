/** Native read-only readers. Production imports their generated source strings, never this module. */
export function readBladeburnerIdentity(ns,cities,trainingTarget=null) {
 const b=ns.bladeburner;let capabilities,planningStats=null;
 try {
  const r=ns.getResetInfo(),p=ns.getPlayer(),stats=['hacking','strength','defense','dexterity','agility','charisma'];
  planningStats=Object.fromEntries([...stats,'intelligence'].map(name=>[name,p.skills?.[name]]));
  const keys=[...stats.flatMap(k=>[k,k+'_exp']),'bladeburner_success_chance','bladeburner_max_stamina','bladeburner_stamina_gain','bladeburner_analysis'];
  if(!r.ownedAugs||typeof r.ownedAugs!=='object')throw Error('Augmentation ownership unavailable');
  const owned=typeof r.ownedAugs.entries==='function'?[...r.ownedAugs.entries()]:Object.entries(r.ownedAugs);
  capabilities={complete:true,at:Date.now(),nodeReset:r.lastNodeReset,augReset:r.lastAugReset,entropy:p.entropy,owned,
   skills:b.getSkillNames().map(name=>[name,b.getSkillLevel(name)]),multipliers:keys.map(k=>[k,p.mults[k]])};
 }catch(error){capabilities={complete:false,reason:String(error).slice(0,160)};}
 return {capabilities,stats:planningStats};
}

export function readBladeburnerMaintenance(ns,cities,trainingTarget=null) {
 const b=ns.bladeburner;
 let maintenance;
 try {
  const bonus=b.getBonusTime();
  const stock=[['Tracking','Contracts'],['Investigation','Operations'],['Undercover Operation','Operations'],['Stealth Retirement Operation','Operations']].map(([name,type])=>[name,Math.floor(b.getActionCountRemaining(type,name))]);
  let sleeves=null;
  try {
   const count=ns.sleeve.getNumSleeves();
   if(!Number.isInteger(count)||count<0||count>8)throw Error('Unknown sleeve count');
   const entries=[];
   for(let i=0;i<count;i++){
    const task=ns.sleeve.getTask(i);
    if(task?.type==='SUPPORT')entries.push([i,'support']);
    else if(task?.type==='BLADEBURNER'&&task.actionType==='General'&&task.actionName==='Diplomacy'){
     const person=ns.sleeve.getSleeve(i);
     entries.push([i,'diplomacy',person.shock,person.sync,person.skills?.charisma,task.cyclesNeeded]);
    }
   }
   sleeves={count,entries};
  }catch{} // Optional sleeves unavailable: discard all partial support evidence.
  maintenance={complete:true,stock,sleeves,bonusMs:Number.isFinite(bonus)&&bonus>=0?bonus:0,accelerated:Number.isFinite(bonus)&&bonus>=0?bonus>=1000:null};
 }catch{maintenance={complete:false};}
 return {maintenance};
}

export function readBladeburnerSquads(ns,cities,trainingTarget=null) {
 const b=ns.bladeburner;
 let squads;
 try {
  const names=b.getOperationNames();
  if(!Array.isArray(names)||!names.length||names.length>64||new Set(names).size!==names.length||names.some(name=>typeof name!=='string'||!name))throw Error('Unknown operation list');
  squads={complete:true,total:b.getTeamSize(),operations:names.map(name=>[name,b.getTeamSize('Operations',name)]),
   blackOp:typeof trainingTarget==='string'&&trainingTarget?[trainingTarget,b.getTeamSize('Black Operations',trainingTarget)]:null};
 }catch{squads={complete:false};}
 return {squads};
}

export function readBladeburnerTrainingVitals(ns,cities,trainingTarget=null) {
 const b=ns.bladeburner;
 let trainingVitals=null;
 if(typeof trainingTarget==='string'&&trainingTarget)try {
  const p=ns.getPlayer(),reset=ns.getResetInfo();
  trainingVitals={at:Date.now(),target:trainingTarget,city:b.getCity(),nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,
   hp:p.hp,stamina:b.getStamina(),rawChance:b.getActionEstimatedSuccessChance('Black Operations',trainingTarget)};
 }catch{} // Unknown vitals cannot authorize the cached Training baseline.
 return {trainingVitals};
}

export function readBladeburnerCities(ns,cities,trainingTarget=null) {
 if(!Array.isArray(cities)||!cities.length||cities.length>6||cities.some(c=>typeof c!=='string'||!c))throw Error('Invalid Bladeburner city list');
 const b=ns.bladeburner;
 return {currentCity:b.getCity(),population:Object.fromEntries(cities.map(c=>[c,b.getCityEstimatedPopulation(c)])),
  communities:Object.fromEntries(cities.map(c=>[c,b.getCityCommunities(c)])),chaos:Object.fromEntries(cities.map(c=>[c,b.getCityChaos(c)]))};
}

export function captureBladeburnerPlanningState(ns,cities,trainingTarget=null) {
 return Object.assign({},readBladeburnerIdentity(ns,cities,trainingTarget),readBladeburnerMaintenance(ns,cities,trainingTarget),readBladeburnerSquads(ns,cities,trainingTarget),readBladeburnerTrainingVitals(ns,cities,trainingTarget),readBladeburnerCities(ns,cities,trainingTarget));
}
