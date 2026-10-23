export function intelligenceUnlocked(reset) {
 const level=Number(reset.ownedSF?.get?.(5)??reset.ownedSF?.[5])||0;
 return reset.currentNode===5||level>0;
}
export function intelligenceSessionDecision({state,reset,intelligence,target,maxResets,maxMinutes,now=Date.now(),invites=0,queued=false,busy=false,economics=null}) {
 if(!Number.isFinite(target)||target<=0||!Number.isInteger(maxResets)||maxResets<1||!Number.isFinite(maxMinutes)||maxMinutes<=0)return 'invalid-options';
 if(state?.nodeReset===reset.lastNodeReset&&state.status==='complete')return 'complete';
 if(intelligence>=target||(state?.nodeReset===reset.lastNodeReset&&(state.resets>=maxResets||now-state.startedAt>=maxMinutes*60000)))return 'complete';
 if(queued||busy)return 'protected-progress';
 if(now-reset.lastAugReset>60000)return 'requires-fresh-reset';
 if(invites<10)return 'requires-faction-invitations';
 if(economics&&economics.allow!==true)return economics.reason||'unmeasured-payback';
 return 'farm';
}

/** Native Intelligence uses the ordinary skill curve with no augmentation multiplier. */
export function intelligenceProgress(previous,{xp,intelligence,reset,pid,at=Date.now(),target=200}){
 const valid=Number.isFinite(xp)&&xp>=0&&Number.isFinite(intelligence)&&intelligence>=0&&Number.isFinite(at);
 if(!valid||!Number.isFinite(target)||target<=0||!Number.isFinite(Math.exp((target+200)/32)))return null;
 const same=previous?.pid===pid&&previous.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&
  previous.at<=at&&at-previous.at<=120000&&xp>=previous.xp;
 const samples=(same&&Array.isArray(previous.samples)?previous.samples:[]).filter(s=>Number.isFinite(s.at)&&s.at<=at&&at-s.at<=600000&&Number.isFinite(s.xp)&&s.xp>=0&&s.xp<=xp).slice(-120);
 if(!samples.length||at-samples[samples.length-1].at>=5000)samples.push({at,xp});
 const seconds=samples.length?(at-samples[0].at)/1000:0,rate=seconds>=60?(xp-samples[0].xp)/seconds:null;
 const required=Number.isFinite(target)&&target>0?Math.max(0,Math.exp((target+200)/32)-534.6-xp):null;
 const bonus=(n,w)=>1+w*Math.pow(Math.max(0,n),.8)/600;
 return {schemaVersion:1,at,pid,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,unlocked:intelligenceUnlocked(reset),
  intelligence,xp,target,samples,windowSeconds:seconds,xpPerSecond:rate,remainingXp:required,
  etaSeconds:required===0?0:rate>0?required/rate:null,generalBonusGain:target>=intelligence?bonus(target,1)/bonus(intelligence,1)-1:0,
  bladeburnerBonusGain:target>=intelligence?bonus(target,.75)/bonus(intelligence,.75)-1:0};
}

/** Observe complete faction/reset cycles, including their actual elapsed time and failed joins. */
export function observeIntelligenceFarm(state,xp,now=Date.now(),augReset=null){
 const pending=state?.lastCycle;if(!pending||pending.resetNumber<=Number(state.sampledResets||0))return state;
 if(pending.augReset!==undefined&&!(Number.isFinite(augReset)&&augReset>pending.augReset))return {...state,sampledResets:pending.resetNumber,measurementError:'Reset was not confirmed'};
 const seconds=(now-pending.at)/1000,gain=xp-pending.xp;
 if(![seconds,gain].every(Number.isFinite)||seconds<=0||seconds>120||gain<0)return {...state,sampledResets:pending.resetNumber,measurementError:'Invalid or interrupted reset sample'};
 const measurements=[...(Array.isArray(state.measurements)?state.measurements:[]),{seconds,xp:gain,joins:pending.joins}].slice(-10);
 return {...state,measurements,sampledResets:pending.resetNumber,measurementError:null};
}

/** Estimated payback in future time affected by the Intelligence bonus, not a node ETA.
 * Unknown yield permits only the caller's small, explicit opt-in probe allowance. */
export function intelligenceFarmPlan({state,xp,intelligence,target=200,maxResets=100,maxMinutes=10,paybackHours=24,probeResets=2,now=Date.now(),weight=.75}){
 const invalid={allow:false,reason:'invalid-economics'};
 if(![xp,intelligence,target,maxResets,maxMinutes,paybackHours,probeResets,now,weight].every(Number.isFinite)||xp<0||intelligence<0||target<=0||maxResets<1||maxMinutes<=0||paybackHours<=0||probeResets<0||weight<=0)return invalid;
 const samples=(Array.isArray(state?.measurements)?state.measurements:[]).filter(s=>s&&Number.isFinite(s.seconds)&&s.seconds>0&&Number.isFinite(s.xp)&&s.xp>=0);
 if(!samples.length)return {allow:(state?.resets||0)<Math.min(2,probeResets,maxResets),reason:'bounded-yield-probe'};
 const yieldPerReset=samples.reduce((n,s)=>n+s.xp,0)/samples.length,secondsPerReset=samples.reduce((n,s)=>n+s.seconds,0)/samples.length;
 const rate=yieldPerReset/secondsPerReset;
 if(!(rate>0))return {allow:false,reason:'no-measured-intelligence-gain',xpPerSecond:0};
 const passive=Number.isFinite(state.passiveXpPerSecond)&&state.passiveXpPerSecond>0?state.passiveXpPerSecond:0;
 if(rate<=passive)return {allow:false,reason:'ordinary-progression-is-faster',xpPerSecond:rate};
 const secondsLeft=Math.max(0,maxMinutes*60-(now-state.startedAt)/1000),resetsLeft=Math.max(0,maxResets-(state.resets||0));
 let best=null;
 for(let level=Math.floor(intelligence)+1;level<=Math.min(target,Math.floor(intelligence)+20);level++){
  const need=Math.max(0,Math.exp((level+200)/32)-534.6-xp),cycles=Math.max(1,Math.ceil(need/yieldPerReset)),seconds=cycles*secondsPerReset;
  if(cycles>resetsLeft||seconds>secondsLeft)continue;
  const baselineLevel=Math.max(intelligence,Math.floor(32*Math.log(xp+passive*seconds+534.6)-200));
  const bonus=n=>1+weight*Math.pow(Math.max(0,n),.8)/600,benefit=bonus(level)/bonus(baselineLevel)-1;
  const payback=benefit>0?seconds/(benefit/(1+benefit)):Infinity;
  if(Number.isFinite(payback)&&payback<=paybackHours*3600&&(!best||payback<best.paybackSeconds))best={allow:true,reason:'measured-bonus-payback',level,cycles,seconds,paybackSeconds:payback,xpPerSecond:rate,benefit};
 }
 return best||{allow:false,reason:'no-reachable-milestone-repays',xpPerSecond:rate};
}
