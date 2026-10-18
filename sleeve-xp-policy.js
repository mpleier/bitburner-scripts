/** Healthy synchronized sleeves see the shared XP pool, including their own contribution. */
export function observeSleeveXp(previous,sleeves,tasks,now,reset,pid) {
 const keys=['hacking','strength','defense','dexterity','agility','charisma'];
 const taskKey=JSON.stringify(tasks.map(t=>[t?.type,t?.crimeType,t?.factionName,t?.factionWorkType,t?.companyName,t?.classType,t?.location,t?.actionType,t?.actionName]));
 const capture=()=>sleeves.map(s=>({shock:s.shock,sync:s.sync,exp:{...s.exp}}));
 const base={at:now,pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,taskKey,samples:[],pool:null,observedAt:null};
 const start=reason=>({...base,baselineAt:now,baseline:capture(),reason});
 if(!Number.isFinite(now)||!Number.isSafeInteger(pid)||pid<=0)return start('invalid-observation');
 if(sleeves.some(s=>!Number.isFinite(s.storedCycles)||s.storedCycles>5))return start('bonus-cycles-or-unknown');
 const valid=previous?.pid===pid&&previous.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&previous.taskKey===taskKey&&
  Number.isFinite(previous.at)&&previous.at<=now&&now-previous.at<=10000&&Number.isFinite(previous.baselineAt)&&previous.baselineAt<=now&&now-previous.baselineAt<=90000&&previous.baseline?.length===sleeves.length;
 if(!valid)return start('calibrating');
 const healthy=sleeves.map((s,i)=>({s,old:previous.baseline[i]})).filter(({s,old})=>s.shock===0&&s.sync===100&&old?.shock===0&&old.sync===100);
 if(healthy.length<2)return start('needs-two-healthy-observers');
 if(healthy.some(({s,old})=>keys.some(k=>!Number.isFinite(s.exp?.[k])||!Number.isFinite(old.exp?.[k])||s.exp[k]<old.exp[k])))return start('xp-reset-or-invalid');
 if(now-previous.baselineAt<30000)return {...previous,at:now};
 const seconds=(now-previous.baselineAt)/1000;
 const rates=Object.fromEntries(keys.map(k=>[k,Math.min(...healthy.map(({s,old})=>(s.exp[k]-old.exp[k])/seconds))]));
 const samples=[...(previous.samples||[]).filter(s=>Number.isFinite(s.at)&&s.at<=now&&now-s.at<=90000),{at:now,seconds,rates}].slice(-3);
 const pool=samples.length>=2?Object.fromEntries(keys.map(k=>[k,Math.min(...samples.map(s=>s.rates[k]))])):null;
 return {...base,baselineAt:now,baseline:capture(),samples,pool,observedAt:pool?now:null,reason:pool?'measured':'calibrating'};
}

/** Subtract the candidate's current own XP once; never multiply incoming XP by its aug multipliers. */
export function incomingSleeveXp(observation,sleeve,ownPerSecond,reset,pid,now=Date.now()) {
 if(sleeve?.shock!==0||sleeve?.sync!==100||!ownPerSecond||observation?.pid!==pid||observation.nodeReset!==reset.lastNodeReset||observation.augReset!==reset.lastAugReset||
  !Number.isFinite(observation.observedAt)||observation.observedAt>now||now-observation.observedAt>90000||!observation.pool||!Array.isArray(observation.samples)||observation.samples.length<2)return {};
 const keys=['hacking','strength','defense','dexterity','agility','charisma'];
 if(keys.some(k=>!Number.isFinite(observation.pool[k])||observation.pool[k]<0||!Number.isFinite(ownPerSecond[k])||ownPerSecond[k]<0))return {};
 return Object.fromEntries(keys.map(k=>[k,Math.max(0,observation.pool[k]-ownPerSecond[k]*1.1)]));
}
