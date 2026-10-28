/** Expected-value attrition planning; never a guarantee of territory or member survival. */
export function gangAttritionSignature(members){
 return JSON.stringify(Object.values(members).map(m=>[m.name,m.def,...['hack','str','def','dex','agi','cha'].map(k=>m[k+'_exp']),m.upgrades,m.augmentations]).sort((a,b)=>a[0].localeCompare(b[0])));
}
/** One-update joint prediction envelope, conditional on forecast own power.
 * Gang.ts chooses one random counterpart per active gang. Each gang therefore
 * participates in 1 + Binomial(N-1, 1/(N-1)) potential clashes. A union bound
 * controls all gangs together at 99%; all outcomes and transfer magnitudes
 * within that count are bounded, without assuming independent wins or losses.
 * NPC gains use the source maximum multiplier (5). This is an outcome envelope,
 * not a guarantee that the development forecast or game version is correct. */
export function gangClashUncertainty(w,ownPower){
 if(!w||!Number.isFinite(ownPower)||ownPower<=0||!Number.isFinite(w.power)||w.power<=0||ownPower<w.power||!Number.isFinite(w.territory)||w.territory<=0||w.territory>=1||!Array.isArray(w.rivals)||w.rivals.length<1||w.rivals.length>6||new Set(w.rivals.map(r=>r?.name)).size!==w.rivals.length||w.rivals.some(r=>typeof r?.name!=='string'||!r.name||!Number.isFinite(r.power)||r.power<=0||!Number.isFinite(r.territory)||r.territory<=0||r.territory>1))return null;
 const total=w.territory+w.rivals.reduce((sum,r)=>sum+r.territory,0);
 if(Math.abs(total-1)>1e-9)return null;
 const n=w.rivals.length,N=n+1,p=1/n,confidence=.99;
 let distribution=[1];
 for(let i=0;i<n;i++){
  const next=Array(distribution.length+1).fill(0);
  distribution.forEach((v,k)=>{next[k]+=v*(1-p);next[k+1]+=v*p;});
  distribution=next;
 }
 let cumulative=0,maxClashes=N,tail=0;
 for(let k=0;k<distribution.length;k++){
  cumulative+=distribution[k];
  if(cumulative>=1-(1-confidence)/N){maxClashes=1+k;tail=Math.max(0,1-cumulative);break;}
 }
 const gangs=[{territory:w.territory,min:ownPower,max:ownPower,divisor:1.008},...w.rivals.map(r=>({name:r.name,territory:r.territory,min:r.power,max:r.power+Math.max(.85,.75*r.territory*5),divisor:1.01}))];
 for(const g of gangs)g.min/=Math.pow(g.divisor,maxClashes);
 if(gangs.some(g=>!Number.isFinite(g.min)||g.min<=0||!Number.isFinite(g.max)))return null;
 const gain=(winner,loser)=>.00015*Math.max(1,1+(Math.log(winner.max)-Math.log(loser.min))/Math.log(50));
 const bounds=gangs.map((g,i)=>{
  const others=gangs.filter((_,j)=>j!==i),epsilon=Math.abs(total-1)+1e-12;
  const maxGain=Math.max(...others.map(r=>gain(g,r))),maxLoss=Math.max(...others.map(r=>gain(r,g)));
  return {power:{min:g.min,max:g.max},territory:{min:Math.max(0,g.territory-maxClashes*maxLoss-epsilon),max:Math.min(1,g.territory+maxClashes*maxGain+epsilon)}};
 });
 return {model:'native-pairing-v1',confidence,coverageLowerBound:Math.max(confidence,Math.min(1,1-N*tail)),maxClashes,power:bounds[0].power,territory:bounds[0].territory,rivals:w.rivals.map((r,i)=>({name:r.name,...bounds[i+1]}))};
}
export function simulateGangAttrition({w,cumulative,members,participants=null,powerFraction=1,attrition=false,attritionGameSeconds=60,bonusSeconds=0,rivalGrowthScale=1}={}){
 if(!w?.active||!Array.isArray(cumulative)||!cumulative.length||cumulative.length>256||!Array.isArray(w.rivals)||!w.rivals.length||w.rivals.length>12||!Array.isArray(members)||!members.length||members.length>12||members.some(m=>!Number.isFinite(m.def)||m.def<=0)||
  ![w.power,w.territory,w.threshold,powerFraction,bonusSeconds,rivalGrowthScale].every(Number.isFinite)||w.power<=0||w.territory<=0||w.territory>=1||w.threshold<.65||w.threshold>=1||powerFraction<0||powerFraction>1||bonusSeconds<0||rivalGrowthScale<.5||rivalGrowthScale>2||
  w.rivals.some(r=>![r.power,r.territory,r.highRate].every(Number.isFinite)||r.power<=0||r.territory<=0||r.highRate<0))return null;
 if(!Number.isFinite(attritionGameSeconds)||attritionGameSeconds<0||attritionGameSeconds>600)return null;
 const engageThreshold=w.engageThreshold??w.threshold;
 if(!Number.isFinite(engageThreshold)||engageThreshold<.65||engageThreshold>=1)return null;
 if(participants!==null&&(!Array.isArray(participants)||new Set(participants).size!==participants.length||participants.some(n=>typeof n!=='string'||!members.some(m=>m.name===n))))return null;
 const exposed=participants===null?members:members.filter(m=>participants.includes(m.name));
 const rivals=w.rivals.map(r=>({...r,power:r.power,rate:Math.max(.85/20,r.highRate*1.25)*rivalGrowthScale}));
 let power=w.power,territory=w.territory,minTerritory=territory,minPower=power,probability=0,at=0,fixed=w.power,ticks=0,deaths=0,ready=null,readyStart=null,readyGameSeconds=0;
 const game=t=>t+Math.min(bonusSeconds,24*t),factor=w.threshold/(1-w.threshold);
 for(const point of cumulative){
  if(![point.at,point.power].every(Number.isFinite)||point.at<=at||point.power<fixed)return null;
  const seconds=game(point.at)-game(at),steps=Math.max(1,Math.ceil(seconds/20)),gain=Math.max(0,point.power-fixed);
  if(ticks+steps>1800)return null;
  for(let step=0;step<steps;step++){
   const dt=seconds/steps,elapsed=at+(point.at-at)*(step+1)/steps;
   power+=gain/steps*(attrition?powerFraction:1)*Math.max(.002,territory)/Math.max(.002,w.territory);
   for(const r of rivals)r.power+=r.rate*dt;
   const active=rivals.filter(r=>r.territory>0),n=active.length;
   const chance=r=>power/(power+r.power),safe=n>0&&active.every(r=>chance(r)>=engageThreshold);
   if(safe){if(readyStart===null)readyStart=elapsed;readyGameSeconds+=dt;if(readyGameSeconds>=60)ready=readyStart;}else{ready=null;readyStart=null;readyGameSeconds=0;}
   const engaged=safe||attrition&&game(at)+dt*step<attritionGameSeconds;
   probability=engaged?1:Math.max(0,probability-.01*dt/20);
   if(n){
    const changes=new Map(active.map(r=>[r,0])),losses=new Map(active.map(r=>[r,0]));let ownChange=0,ownLosses=0;
    // NPC-vs-NPC clashes also weaken rivals while the player waits.
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
     const a=active[i],b=active[j],p=a.power/(a.power+b.power),e=2/n*dt/20;
     const ab=Math.min(b.territory,.0001*Math.max(1,1+Math.log(a.power/b.power)/Math.log(50)))*p*e;
     const ba=Math.min(a.territory,.0001*Math.max(1,1+Math.log(b.power/a.power)/Math.log(50)))*(1-p)*e;
     changes.set(a,changes.get(a)+ab-ba);changes.set(b,changes.get(b)+ba-ab);
     losses.set(a,losses.get(a)+(1-p)*e);losses.set(b,losses.get(b)+p*e);
    }
    for(const r of active){const p=chance(r),e=2/n*dt/20*probability;
     const win=Math.min(r.territory,.0001*Math.max(1,1+Math.log(power/r.power)/Math.log(50)))*p*e;
     const lose=Math.min(territory,.0001*Math.max(1,1+Math.log(r.power/power)/Math.log(50)))*(1-p)*e;
     ownChange+=win-lose;changes.set(r,changes.get(r)-win+lose);losses.set(r,losses.get(r)+p*e);ownLosses+=(1-p)*e;
     // Expose the eligible warfare crew at every forecast clash, including the full tail.
     deaths+=exposed.reduce((sum,m)=>sum+.35*(p*.005+(1-p)*.01)/Math.pow(m.def,.6),0)*e;
    }
    power*=Math.pow(1/1.008,ownLosses);territory=Math.max(0,territory+ownChange);
    for(const r of active){r.power*=Math.pow(1/1.01,losses.get(r));r.territory=Math.max(0,r.territory+changes.get(r));}
    const total=territory+rivals.reduce((sum,r)=>sum+r.territory,0);if(!(total>0))return null;
    territory/=total;for(const r of rivals)r.territory/=total;
   }
   minTerritory=Math.min(minTerritory,territory);minPower=Math.min(minPower,power);ticks++;
  }
  at=point.at;fixed=point.power;
 }
 return {power,territory,minTerritory,minPower,deaths,participantCount:exposed.length,readySeconds:ready,ticks,clashChance:probability,rivals:rivals.map(r=>({name:r.name,power:r.power,territory:r.territory}))};
}
export function planGangAttrition(input){
 const no=reason=>({engage:false,reason});const {w,cumulative,members}=input||{};
 if(input?.monitorHealth?.known===false||input?.monitorHealth?.suspended===true)return no('Early clashes paused by monitor reliability backoff');
 if(input?.calibration?.known===false||input?.calibration?.suspended===true)return no('Early clashes paused by forecast calibration');
 if(w?.preparation?.enabled===true&&input?.allowTrainingFirst!==true)return no('Training-first policy preserves the safe warfare threshold');
 if(!w?.powerPriority||members?.length!==12||!Array.isArray(cumulative)||!cumulative.length||cumulative.at(-1)?.at<2060||w.rivals?.some(r=>!Number.isFinite(r.samples)||r.samples<3)||w.rivals?.some(r=>w.power/(w.power+r.power)<.65))return no('Attrition needs fresh strong observations and a full development horizon');
 if(Array.isArray(input.participants)&&!input.participants.length)return no('No eligible warfare participants');
 if(input.allowTrainingFirst===true&&w.rivals.every(r=>w.power/(w.power+r.power)>=.7))return no('Routine warfare odds reached; no early attempt required');
 const scenarios=[.5,1,2].map(rivalGrowthScale=>{
  const wait=simulateGangAttrition({...input,rivalGrowthScale,attrition:false}),fight=simulateGangAttrition({...input,rivalGrowthScale,attrition:true});
  if(!wait||!fight)return {rivalGrowthScale,engage:false,reason:'Forecast incomplete'};
  const extraDeaths=Math.max(0,fight.deaths-wait.deaths),casualtyCost=extraDeaths*21600;
  const before=wait.readySeconds??cumulative.at(-1).at,after=fight.readySeconds;
  const saved=after===null?0:before-after,required=Math.max(60,before*.2)+casualtyCost;
  const engage=after!==null&&saved>=required&&fight.deaths<=.02&&extraDeaths<=.005&&fight.minTerritory>=w.territory-.001&&fight.territory>wait.territory&&fight.minPower>=w.power*.9&&fight.power>=wait.power*.85;
  return {rivalGrowthScale,engage,wait,fight,extraDeaths,casualtyCostSeconds:casualtyCost,savedSeconds:saved};
 });
 const base=scenarios[1],engage=scenarios.every(s=>s.engage);
 // Only the next complete native interval is scored; keep its forecast small and bounded.
 const bonus=Math.max(0,input.bonusSeconds||0),wallSeconds=Math.max(.8,20-bonus);
 const point=cumulative.find(p=>p.at>=wallSeconds),previous=[{at:0,power:w.power},...cumulative].filter(p=>p.at<wallSeconds).at(-1);
 const power=point&&previous?previous.power+(point.power-previous.power)*(wallSeconds-previous.at)/(point.at-previous.at):NaN;
 const nextTick=scenarios.map(s=>simulateGangAttrition({...input,rivalGrowthScale:s.rivalGrowthScale,attrition:true,cumulative:[{at:wallSeconds,power}]}));
 const uncertainty=gangClashUncertainty(w,w.power+(power-w.power)*(input.powerFraction??1));
 const observationForecast=nextTick.every(Boolean)&&uncertainty?{wallSeconds,expected:nextTick.map((v,i)=>({rivalGrowthScale:scenarios[i].rivalGrowthScale,power:v.power,territory:v.territory,rivals:v.rivals})),uncertainty}:null;
 return {...base,engage:engage&&observationForecast!==null,reason:engage?(observationForecast?'Attrition passes slow, baseline and fast rival-growth scenarios':'One-update uncertainty forecast unavailable'):'Waiting or training is preferable in at least one rival-growth scenario',scenarios,observationForecast};
}
/** Net observations inform cautious calibration; random NPC clashes prevent causal attribution. */
export function observeGangAttrition(lease,cycle,scope,history=[],receipt=null){
 let nativeEvent=false;
 if(lease?.monitorRequired===true){
  if(!receipt||receipt.kind!=='native-update-v1'||receipt.state!=='observed'||receipt.ownerPid!==lease.ownerPid||receipt.nodeReset!==lease.nodeReset||receipt.augReset!==lease.augReset||receipt.startedAt!==lease.startedAt||receipt.observerPid!==lease.monitorPid||receipt.baselineSignature!==lease.observationSignature||typeof receipt.baselineSignature!=='string'||!receipt.baselineSignature||!Number.isFinite(receipt.at)||receipt.at<=lease.startedAt||receipt.at>cycle?.at||receipt.at>lease.deadline||!Number.isFinite(receipt.processedMs)||receipt.processedMs<=0||receipt.processedMs>20000||!Number.isInteger(receipt.updates)||receipt.updates<1||receipt.updates>100||!Number.isFinite(receipt.largestUpdateMs)||receipt.largestUpdateMs<=0||receipt.largestUpdateMs>5000||receipt.largestUpdateMs>receipt.processedMs||typeof receipt.observedSignature!=='string'||receipt.observedSignature===receipt.baselineSignature)return null;
  const signature=JSON.stringify(Object.entries(receipt.others||{}).sort(([a],[b])=>a.localeCompare(b)).map(([name,g])=>[name,g?.power,g?.territory]));
  if(signature!==receipt.observedSignature||receipt.info?.faction!==lease.faction||receipt.others?.[lease.faction]?.power!==receipt.info?.power||receipt.others?.[lease.faction]?.territory!==receipt.info?.territory)return null;
  cycle={at:receipt.at,info:receipt.info,others:receipt.others};nativeEvent=true;
 }
 const forecast=lease?.observationForecast;
 if(!forecast||lease.ownerPid!==scope.ownerPid||lease.nodeReset!==scope.nodeReset||lease.augReset!==scope.augReset||lease.faction!==cycle?.info?.faction)return null;
 if(!Number.isFinite(lease.startedAt)||!Number.isFinite(cycle.at)||cycle.at<=lease.startedAt||!Number.isFinite(forecast.wallSeconds)||forecast.wallSeconds<=0||!Array.isArray(forecast.expected)||forecast.expected.length!==3)return null;
 const key=[lease.ownerPid,lease.nodeReset,lease.augReset,lease.startedAt].join(':');
 const previous=Array.isArray(history)?history.filter(r=>r&&r.nodeReset===scope.nodeReset&&r.augReset===scope.augReset).slice(-63):[];
 if(previous.some(r=>r.key===key))return null;
 const elapsed=(cycle.at-lease.startedAt)/1000;
 // Score the scheduled event, not a fresh full interval after engagement. Forecast
 // values still describe one complete native update; never prorate clash outcomes.
 const scheduled=lease.expectedTickAt!==undefined;
 const tolerance=Math.max(200,Math.min(500,forecast.wallSeconds*200));
 const validSchedule=Number.isFinite(lease.expectedTickAt)&&lease.expectedTickAt>lease.startedAt&&lease.expectedTickAt<=lease.startedAt+forecast.wallSeconds*1000+1000;
 const exposed=lease.stoppedAt===undefined||lease.stopReason==='observed-tick';
 const matched=nativeEvent?exposed:scheduled?validSchedule&&exposed&&Math.abs(cycle.at-lease.expectedTickAt)<=tolerance:Math.abs(elapsed-forecast.wallSeconds)<=Math.max(.2,forecast.wallSeconds*.2);
 const valid=v=>v&&Number.isFinite(v.power)&&v.power>0&&Number.isFinite(v.territory)&&v.territory>=0&&v.territory<=1;
 if(!valid(cycle.info)||forecast.expected.some(v=>!valid(v)||!Array.isArray(v.rivals)||v.rivals.some(r=>!valid(r))))return null;
 const expected=forecast.expected,names=expected[0].rivals.map(r=>r.name);
 // Preserve the forecast cohort through elimination; missing data is not zero territory.
 if(!names.length||names.length>6||names.some(name=>typeof name!=='string'||!name||name===lease.faction)||new Set(names).size!==names.length||expected.some(v=>v.rivals.length!==names.length||new Set(v.rivals.map(r=>r.name)).size!==names.length||v.rivals.some(r=>!names.includes(r.name))))return null;
 const range=values=>({min:Math.min(...values),max:Math.max(...values)});
 const uncertainty=forecast.uncertainty;
 const interval=(v,territory=false)=>v&&Number.isFinite(v.min)&&Number.isFinite(v.max)&&v.min>=0&&v.max>=v.min&&(!territory||v.max<=1);
 const validUncertainty=uncertainty?.model==='native-pairing-v1'&&uncertainty.confidence===.99&&Number.isFinite(uncertainty.coverageLowerBound)&&uncertainty.coverageLowerBound>=.99&&uncertainty.coverageLowerBound<=1&&interval(uncertainty.power)&&interval(uncertainty.territory,true)&&Array.isArray(uncertainty.rivals)&&uncertainty.rivals.length===forecast.expected[0].rivals.length&&new Set(uncertainty.rivals.map(r=>r.name)).size===uncertainty.rivals.length&&uncertainty.rivals.every(r=>forecast.expected[0].rivals.some(v=>v.name===r.name)&&interval(r.power)&&interval(r.territory,true));
 if(uncertainty!==undefined&&!validUncertainty)return null;
 const compare=(actual,expected,band)=>{
  const result={actual,expected:range(expected),errorFromBaseline:actual-expected[1],insideRange:actual>=Math.min(...expected)&&actual<=Math.max(...expected)};
  if(band){result.predictive={min:Math.min(result.expected.min,band.min),max:Math.max(result.expected.max,band.max)};result.insidePredictiveRange=actual>=result.predictive.min&&actual<=result.predictive.max;}
  return result;
 };
 const actualRivals=names.map(name=>[name,Object.hasOwn(cycle.others||{},name)?cycle.others[name]:undefined]);
 const dormant=v=>v&&Number.isFinite(v.power)&&v.power>=0&&v.territory===0;
 const sameRivals=actualRivals.every(([,r])=>valid(r))&&Object.entries(cycle.others||{}).every(([name,r])=>name===cycle.info.faction?valid(r)&&r.power===cycle.info.power&&r.territory===cycle.info.territory:names.includes(name)||dormant(r));
 const scored=matched&&sameRivals;
 const row={key,...scope,faction:lease.faction,at:cycle.at,elapsedSeconds:elapsed,expectedTickAt:lease.expectedTickAt,timingBasis:nativeEvent?'native-update':scheduled?'scheduled-tick':'legacy-interval',...(nativeEvent?{processedMs:receipt.processedMs,timingErrorMs:cycle.at-lease.expectedTickAt,updates:receipt.updates}:{}),scored,reason:scored?'Net outcome; stochastic clashes, not causal attribution':!matched?'Partial, missed, interrupted or delayed native interval':'Rival snapshot missing, invalid or changed',...(scored?{eliminatedRivals:actualRivals.filter(([,r])=>r.territory===0).map(([name])=>name)}:{}),
  ...(scored?{...(validUncertainty?{uncertaintyModel:uncertainty.model,confidence:uncertainty.confidence,coverageLowerBound:uncertainty.coverageLowerBound}:{}),power:compare(cycle.info.power,expected.map(v=>v.power),uncertainty?.power),territory:compare(cycle.info.territory,expected.map(v=>v.territory),uncertainty?.territory),rivals:actualRivals.map(([name,r])=>({name,power:compare(r.power,expected.map(v=>v.rivals.find(x=>x.name===name).power),uncertainty?.rivals.find(v=>v.name===name)?.power),territory:compare(r.territory,expected.map(v=>v.rivals.find(x=>x.name===name).territory),uncertainty?.rivals.find(v=>v.name===name)?.territory)}))}:{})};
 return [...previous,row];
}

/** Diagnostic ledger only. Never used as evidence by forecast calibration. */
export function reconcileGangAttempts(history,lease,receipt,scope,now=Date.now()){
 if(!Number.isFinite(now)||!Number.isFinite(scope?.nodeReset)||!Number.isFinite(scope?.augReset)||scope.augReset<scope.nodeReset||typeof scope.faction!=='string'||!scope.faction)return [];
 const terminal=['observed','timeout','interrupted','ambiguous-start','ambiguous-interval','invalid-update','invalid-snapshot','update-limit','error','missing-receipt'];
 const identity=q=>q&&q.nodeReset===scope.nodeReset&&q.augReset===scope.augReset&&q.faction===scope.faction&&Number.isInteger(q.ownerPid)&&q.ownerPid>0&&Number.isInteger(q.observerPid)&&q.observerPid>0&&Number.isFinite(q.startedAt)&&q.startedAt>=scope.augReset&&q.startedAt<=now&&now-q.startedAt<=21600000&&Number.isFinite(q.deadline)&&q.deadline>q.startedAt&&q.deadline<=q.startedAt+22000;
 const key=q=>[q.ownerPid,q.nodeReset,q.augReset,q.startedAt,q.observerPid].join(':');
 const clean=q=>({key:key(q),observationKey:[q.ownerPid,q.nodeReset,q.augReset,q.startedAt].join(':'),ownerPid:q.ownerPid,observerPid:q.observerPid,nodeReset:q.nodeReset,augReset:q.augReset,faction:q.faction,startedAt:q.startedAt,deadline:q.deadline,state:q.state,source:q.source,...(q.state!=='pending'?{finishedAt:q.finishedAt}:{})});
 const byKey=new Map();
 for(const q of (Array.isArray(history)?history:[]).slice(-128)){
  if(!identity(q)||q.key!==key(q)||!['lease','receipt','expired'].includes(q.source)||q.state!=='pending'&&!terminal.includes(q.state)||q.state!=='pending'&&(!Number.isFinite(q.finishedAt)||q.finishedAt<q.startedAt||q.finishedAt>now))continue;
  if(q.source==='lease'&&!['pending','interrupted'].includes(q.state)||q.source==='receipt'&&['pending','missing-receipt'].includes(q.state)||q.source==='expired'&&q.state!=='missing-receipt')continue;
  const previous=byKey.get(q.key);
  if(!previous||q.source==='receipt'&&previous.source!=='receipt'||q.source===previous.source&&(q.finishedAt||0)>(previous.finishedAt||0))byKey.set(q.key,clean(q));
 }
 const candidate=lease&&{...lease,observerPid:lease.monitorPid};
 if(lease?.monitorRequired===true&&identity(candidate)&&['active','cooldown'].includes(lease.state)){
  const id=key(candidate),old=byKey.get(id);
  let row=old||clean({...candidate,state:'pending',source:'lease'});
  const actual=receipt?.kind==='native-update-v1'&&terminal.includes(receipt.state)&&receipt.state!=='missing-receipt'&&receipt.ownerPid===lease.ownerPid&&receipt.nodeReset===lease.nodeReset&&receipt.augReset===lease.augReset&&receipt.startedAt===lease.startedAt&&receipt.observerPid===lease.monitorPid&&receipt.baselineSignature===lease.observationSignature&&typeof lease.observationSignature==='string'&&lease.observationSignature.length>0&&Number.isFinite(receipt.at)&&receipt.at>=lease.startedAt&&receipt.at<=now;
  if(actual&&(row.source!=='receipt'||receipt.at>row.finishedAt))row=clean({...candidate,state:receipt.state,source:'receipt',finishedAt:receipt.at});
  else if(row.state==='pending'&&lease.state==='cooldown'&&typeof lease.stopReason==='string'&&lease.stopReason!=='observed-tick'&&Number.isFinite(lease.stoppedAt)&&lease.stoppedAt>=lease.startedAt&&lease.stoppedAt<=now)row=clean({...candidate,state:'interrupted',source:'lease',finishedAt:lease.stoppedAt});
  byKey.set(id,row);
 }
 for(const [id,row]of byKey)if(row.state==='pending'&&now>row.deadline+2000)byKey.set(id,clean({...row,state:'missing-receipt',source:'expired',finishedAt:row.deadline+2000}));
 return [...byKey.values()].sort((a,b)=>a.startedAt-b.startedAt||a.key.localeCompare(b.key)).slice(-64);
}

/** Bounded timing coverage for this run; retain signed event delay in raw rows. */
export function gangAttritionTimingStatus(history,lease,receipt,scope,now=Date.now(),attempts=[]){
 const rows=(Array.isArray(history)?history:[]).slice(-64).filter(r=>r&&r.nodeReset===scope.nodeReset&&r.augReset===scope.augReset&&r.faction===scope.faction&&Number.isFinite(r.at)&&r.at<=now&&now-r.at<=21600000);
 const errors=rows.filter(r=>r.scored&&Number.isFinite(r.timingErrorMs)).map(r=>Math.abs(r.timingErrorMs)).sort((a,b)=>a-b);
 const active=lease?.ownerPid===scope.ownerPid&&lease.nodeReset===scope.nodeReset&&lease.augReset===scope.augReset&&lease.faction===scope.faction;
 const current=active&&receipt?.ownerPid===lease.ownerPid&&receipt.nodeReset===lease.nodeReset&&receipt.augReset===lease.augReset&&receipt.startedAt===lease.startedAt&&receipt.observerPid===lease.monitorPid&&Number.isFinite(receipt.at)&&receipt.at<=now;
 const ledger=reconcileGangAttempts(attempts,lease,receipt,scope,now),completed=ledger.filter(a=>a.state!=='pending'),scored=completed.filter(a=>a.state==='observed'&&rows.some(r=>r.scored===true&&r.key===a.observationKey&&r.ownerPid===a.ownerPid&&(r.observerPid===undefined||r.observerPid===a.observerPid)&&r.at>=a.startedAt&&r.at<=a.deadline));
 const outcomeCounts=Object.fromEntries([...new Set(ledger.map(a=>a.state))].sort().map(state=>[state,ledger.filter(a=>a.state===state).length]));
 return {schemaVersion:2,...scope,at:now,samples:rows.length,scored:rows.filter(r=>r.scored).length,unscored:rows.filter(r=>!r.scored).length,nativeScored:rows.filter(r=>r.scored&&r.timingBasis==='native-update').length,delayedScored:rows.filter(r=>r.scored&&r.timingErrorMs>500).length,absoluteErrorMedianMs:errors.length?errors[Math.floor((errors.length-1)*.5)]:null,absoluteErrorP95Ms:errors.length?errors[Math.ceil(errors.length*.95)-1]:null,monitor:current?receipt.state:active&&lease.monitorRequired?'waiting':'inactive',deadline:active?lease.deadline:null,attemptCount:ledger.length,completedAttempts:completed.length,pendingAttempts:ledger.length-completed.length,observedAttempts:completed.filter(a=>a.state==='observed').length,failedAttempts:completed.filter(a=>a.state!=='observed').length,scoredAttempts:scored.length,unscoredCompletedAttempts:completed.length-scored.length,attemptCoverage:ledger.length?scored.length/ledger.length:null,completedCoverage:completed.length?scored.length/completed.length:null,attemptWindowStart:ledger[0]?.startedAt??null,outcomeCounts};
}

/** Single controller owns this ledger; monitor workers write receipts only. */
export async function publishGangAttemptCoverage(ns,scope,now=Date.now()){
 const read=(path,fallback)=>{try{return JSON.parse(ns.read(path));}catch{return fallback;}};
 const lease=read('tasks/gang-attrition.json',null),receipt=read('tasks/gang-attrition-event.json',null),history=read('tasks/gang-attrition-observations.json',[]),old=read('tasks/gang-attrition-attempts.json',[]);
 const ledger=reconcileGangAttempts(old,lease,receipt,scope,now),encoded=JSON.stringify(ledger);
 if(encoded!==JSON.stringify(old))await ns.write('tasks/gang-attrition-attempts.json',encoded,'w');
 await ns.write('tasks/gang-attrition-timing.json',JSON.stringify(gangAttritionTimingStatus(history,lease,receipt,scope,now,ledger)),'w');
 return ledger;
}
/** Self-contained monitor health guard. Capture failures are never forecast misses.
 * Two consecutive failures pause 90 minutes, three pause 3 hours, four or more
 * pause 6 hours. An observed receipt clears the streak; manual interruptions do
 * not extend it. Normal warfare does not call this guard. */
export function gangMonitorBackoff(history,scope,now=Date.now()){
 const unknown={known:false,suspended:true,failures:0,resumeAt:null,reason:'Waiting for valid monitor attempt history'};
 if(!Array.isArray(history)||!Number.isFinite(now)||!Number.isFinite(scope?.nodeReset)||!Number.isFinite(scope?.augReset)||scope.augReset<scope.nodeReset||typeof scope.faction!=='string'||!scope.faction)return unknown;
 const failures=['timeout','ambiguous-start','ambiguous-interval','invalid-update','invalid-snapshot','update-limit','error','missing-receipt'];
 const byKey=new Map();
 for(const q of history.slice(-128)){
  if(!q||q.nodeReset!==scope.nodeReset||q.augReset!==scope.augReset||q.faction!==scope.faction||!Number.isInteger(q.ownerPid)||q.ownerPid<=0||!Number.isInteger(q.observerPid)||q.observerPid<=0||!Number.isFinite(q.startedAt)||q.startedAt<scope.augReset||q.startedAt>now||now-q.startedAt>21600000||!Number.isFinite(q.deadline)||q.deadline<=q.startedAt||q.deadline>q.startedAt+22000||q.key!==[q.ownerPid,q.nodeReset,q.augReset,q.startedAt,q.observerPid].join(':'))continue;
  let state=q.state,at=q.finishedAt;
  if(state==='pending'&&q.source==='lease'&&now>q.deadline+2000){state='missing-receipt';at=q.deadline+2000;}
  else if(q.source==='receipt'&&state!=='missing-receipt'&&[...failures,'observed','interrupted'].includes(state)||q.source==='expired'&&state==='missing-receipt'||q.source==='lease'&&state==='interrupted'){}
  else continue;
  if(!Number.isFinite(at)||at<q.startedAt||at>now)continue;
  const previous=byKey.get(q.key);
  if(!previous||q.source==='receipt'&&previous.source!=='receipt'||q.source===previous.source&&at>previous.at)byKey.set(q.key,{key:q.key,state,at,source:q.source});
 }
 const rows=[...byKey.values()].filter(q=>q.state!=='interrupted').sort((a,b)=>a.at-b.at||a.key.localeCompare(b.key));
 let count=0,lastFailureAt=null;
 for(let i=rows.length-1;i>=0;i--){if(rows[i].state==='observed')break;count++;lastFailureAt??=rows[i].at;}
 const delayMs=count>=2?5400000*2**Math.min(2,count-2):0,resumeAt=delayMs?lastFailureAt+delayMs:null,suspended=resumeAt!==null&&now<resumeAt;
 return {known:true,suspended,failures:count,resumeAt,delayMs,lastFailureAt,reason:suspended?'Early clashes paused after repeated monitor capture failures':delayMs?'Monitor retry backoff expired; fresh native checks required':'No repeated monitor capture failures'};
}

/** Thirty-five game minutes, converted from fresh bonus time; no residual-risk bypass. */
export function gangAttritionCooldown(bonusMs){
 if(!Number.isFinite(bonusMs)||bonusMs<0)return NaN;
 const excess=Math.max(0,bonusMs/1000-2);
 return 1000*Math.max(120,2100-Math.min(excess,2100*24/25));
}

/** Native gate. Guard, monitor launch and state write precede engagement synchronously. */
export function startGangAttrition(ns,q,allowed,calibrate=null,headroom=null,monitorHealth=null,cooldown=null){
 try{
  const now=Date.now(),r=ns.getResetInfo(),g=ns.gang.getGangInformation();
  if(!q?.engage||![q.power,q.territory].every(Number.isFinite)||q.power<=0||q.territory<=0||q.territory>=1||typeof q.signature!=='string'||!q.signature||typeof allowed!=='function'||!allowed()||q.ownerPid!==ns.args[0]||!ns.isRunning(q.ownerPid)||q.nodeReset!==r.lastNodeReset||q.augReset!==r.lastAugReset||!Number.isFinite(q.at)||q.at>now||now-q.at>2000||!Number.isFinite(q.deadline)||q.deadline<=now||q.deadline>now+22000||g.faction!==q.faction||g.territoryWarfareEngaged||g.territoryClashChance!==0||!Number.isFinite(g.power)||g.power<q.power*.99||g.power>q.power*1.01||Math.abs(g.territory-q.territory)>.0001)return false;
  if(q.calibrationRequired===true){
    if(typeof calibrate!=='function')return false;
    let history;try{history=JSON.parse(ns.read('tasks/gang-attrition-observations.json')||'[]');}catch{return false;}
    const check=calibrate(history,{nodeReset:r.lastNodeReset,augReset:r.lastAugReset,faction:g.faction},now);
    if(check.known!==true||check.suspended)return false;
  }
  if(q.monitorHealthRequired===true){
    if(typeof monitorHealth!=='function')return false;
    let attempts;try{attempts=JSON.parse(ns.read('tasks/gang-attrition-attempts.json')||'[]');}catch{return false;}
    const health=monitorHealth(attempts,{nodeReset:r.lastNodeReset,augReset:r.lastAugReset,faction:g.faction},now);
    if(health.known!==true||health.suspended)return false;
  }
  if(q.eventTimingRequired===true||q.expectedTickAt!==undefined){
    if(!Number.isFinite(q.expectedTickAt)||q.expectedTickAt<=now||q.expectedTickAt>q.deadline||!Number.isFinite(q.observationForecast?.wallSeconds)||q.observationForecast.wallSeconds<=0||q.observationForecast.wallSeconds>20||q.expectedTickAt>now+q.observationForecast.wallSeconds*1000+1000)return false;
  }
  let old;try{old=JSON.parse(ns.read('tasks/gang-attrition.json'));}catch{}
  if(old?.nodeReset===r.lastNodeReset&&old.augReset===r.lastAugReset&&(old.state==='active'||!Number.isFinite(old.cooldownUntil)||old.cooldownUntil>now))return false;
  const names=ns.gang.getMemberNames();if(names.length!==12)return false;
  const members=names.map(name=>ns.gang.getMemberInformation(name));
  const signature=JSON.stringify(members.map(m=>[m.name,m.def,...['hack','str','def','dex','agi','cha'].map(k=>m[k+'_exp']),m.upgrades,m.augmentations]).sort((a,b)=>a[0].localeCompare(b[0])));
  if(signature!==q.signature||!Array.isArray(q.rivals)||!q.rivals.length||q.rivals.some(r=>typeof r.name!=='string'||!Number.isFinite(r.power)||r.power<=0))return false;
  const allGangs=ns.gang.getAllGangInformation(),rivals=Object.entries(allGangs).filter(([name,v])=>name!==g.faction&&v.territory>0);
  if(rivals.length!==q.rivals.length||rivals.some(([name,v])=>{const before=q.rivals.find(x=>x.name===name);return !before||!Number.isFinite(v.power)||v.power>before.power*1.01||v.power<before.power*.99||v.power<0||g.power/(g.power+v.power)<.65;}))return false;
  if(q.participants!==undefined){
    if(rivals.every(([,v])=>g.power/(g.power+v.power)>=.7))return false;
    if(!Array.isArray(q.participants)||!q.participants.length||new Set(q.participants).size!==q.participants.length||!Array.isArray(q.excluded)||q.excluded.some(n=>!names.includes(n)))return false;
    const maxDefense=Math.max(...members.map(m=>m.def));
    const expected=members.filter(m=>!q.excluded.includes(m.name)&&m.def>=100&&m.def>=Math.min(10000,maxDefense*.1)).map(m=>m.name).sort();
    if(JSON.stringify([...q.participants].sort())!==JSON.stringify(expected))return false;
  }
  let cooldownMs=45*60000;
  if(q.adaptiveCooldownRequired===true){
    if(typeof cooldown!=='function'||typeof ns.gang.getBonusTime!=='function')return false;
    cooldownMs=cooldown(ns.gang.getBonusTime());
    if(!Number.isFinite(cooldownMs)||cooldownMs<120000||cooldownMs>2700000)return false;
  }
  const state={schemaVersion:1,power:g.power,territory:g.territory,memberNames:names,participants:q.participants,excluded:q.excluded,faction:g.faction,observationForecast:q.observationForecast,expectedTickAt:q.expectedTickAt,state:'active',ownerPid:q.ownerPid,nodeReset:r.lastNodeReset,augReset:r.lastAugReset,startedAt:now,deadline:q.deadline,cooldownMs,cooldownUntil:now+cooldownMs};
  if(q.monitorRequired===true){
    if(typeof headroom!=='function'||typeof ns.gang.nextUpdate!=='function'||q.eventTimingRequired!==true)return false;
    const maximum=ns.getServerMaxRam('home'),used=ns.getServerUsedRam('home'),ram=ns.getScriptRam('gang-event-monitor.js','home'),reserve=headroom(maximum,Number(ns.read('home-ram-reserve.txt'))||0);
    if(![maximum,used,ram,reserve].every(Number.isFinite)||ram<=0||reserve<0||maximum-used<ram+reserve)return false;
    state.monitorRequired=true;
    state.observationSignature=JSON.stringify(Object.entries(allGangs).sort(([a],[b])=>a.localeCompare(b)).map(([name,v])=>[name,v.power,v.territory]));
    state.monitorPid=ns.run('gang-event-monitor.js',1,JSON.stringify({ownerPid:q.ownerPid,nodeReset:r.lastNodeReset,augReset:r.lastAugReset,startedAt:now}));
    if(!state.monitorPid)return false;
  }
  ns.write('tasks/gang-attrition.json',JSON.stringify(state),'w');ns.gang.setTerritoryWarfare(true);return true;
 }catch{return false;}
}
/** Stop on the first observed territory update or lease expiry; disabling leaves a residual clash tail. */
export function stopGangAttrition(ns,observed,disabled=false){
 try{const q=JSON.parse(ns.read('tasks/gang-attrition.json')),r=ns.getResetInfo();
  if(q.state!=='active'||q.nodeReset!==r.lastNodeReset||q.augReset!==r.lastAugReset)return false;
  let risk=false,reason=null;
  if(!disabled&&!observed&&Number.isFinite(q.power)&&Number.isFinite(q.territory)){
    const g=ns.gang.getGangInformation(),names=ns.gang.getMemberNames(),rivals=Object.entries(ns.gang.getAllGangInformation()).filter(([name,v])=>name!==g.faction&&v.territory>0);
    if(!Number.isFinite(g.power)||!Number.isFinite(g.territory)||g.power<q.power*.95||g.territory<q.territory-.001||q.memberNames?.some(n=>!names.includes(n))||rivals.some(([,v])=>!Number.isFinite(v.power)||g.power/(g.power+v.power)<.65)){risk=true;reason='Power, territory, roster or win probability safety limit';}
  }
  if(!disabled&&!observed&&!risk&&Array.isArray(q.participants)){
    const crew=ns.gang.getMemberNames().map(n=>ns.gang.getMemberInformation(n)),maxDefense=Math.max(...crew.map(m=>m.def));
    const current=crew.filter(m=>!(q.excluded||[]).includes(m.name)&&m.def>=100&&m.def>=Math.min(10000,maxDefense*.1)).map(m=>m.name).sort();
    if(JSON.stringify(current)!==JSON.stringify([...q.participants].sort())){risk=true;reason='Participant set changed';}
  }
  if(!disabled&&!observed&&!risk&&Date.now()<q.deadline&&ns.isRunning(q.ownerPid))return false;
  ns.gang.setTerritoryWarfare(false);ns.write('tasks/gang-attrition.json',JSON.stringify({...q,state:'cooldown',stoppedAt:Date.now(),stopReason:reason??(disabled?'disabled':observed?'observed-tick':'expired-or-orphaned')}),'w');return true;
 }catch{return false;}
}

/** Self-contained calibration guard for native dispatch. Misses are net observations,
 * not causal attribution to warfare. Routine engagement remains independent. */
export function gangAttritionCalibration(history,scope,now=Date.now()){
 const unknown={known:false,suspended:true,reason:'Waiting for valid early-clash observation history',samples:0,misses:0};
 if(!Array.isArray(history)||!Number.isFinite(now)||!Number.isFinite(scope?.nodeReset)||!Number.isFinite(scope?.augReset)||scope.augReset<scope.nodeReset||typeof scope.faction!=='string'||!scope.faction)return unknown;
 const metric=(m,territory=false)=>m&&[m.actual,m.expected?.min,m.expected?.max].every(Number.isFinite)&&m.actual>=0&&m.expected.min>=0&&m.expected.max>=m.expected.min&&(!territory||m.actual<=1&&m.expected.max<=1);
 const predictiveMetric=(m,territory=false)=>metric(m,territory)&&[m.predictive?.min,m.predictive?.max].every(Number.isFinite)&&m.predictive.min>=0&&m.predictive.min<=m.expected.min&&m.predictive.max>=m.expected.max&&(!territory||m.predictive.max<=1);
 const byKey=new Map();
 for(const row of history.slice(-128)){
  if(!row||row.scored!==true||typeof row.key!=='string'||!row.key||row.nodeReset!==scope.nodeReset||row.augReset!==scope.augReset||row.faction!==scope.faction||!Number.isFinite(row.at)||row.at<scope.augReset||row.at>now||now-row.at>21600000||
   !Number.isFinite(row.elapsedSeconds)||row.elapsedSeconds<=0||row.elapsedSeconds>120||!metric(row.power)||!metric(row.territory,true)||!Array.isArray(row.rivals)||row.rivals.some(r=>typeof r?.name!=='string'||!metric(r.power)||!metric(r.territory,true)))continue;
  if(row.uncertaintyModel!==undefined&&(row.uncertaintyModel!=='native-pairing-v1'||row.confidence!==.99||!Number.isFinite(row.coverageLowerBound)||row.coverageLowerBound<.99||row.coverageLowerBound>1||!predictiveMetric(row.power)||!predictiveMetric(row.territory,true)||row.rivals.some(r=>!predictiveMetric(r.power)||!predictiveMetric(r.territory,true))))continue;
  if(!byKey.has(row.key)||byKey.get(row.key).at<row.at)byKey.set(row.key,row);
 }
 const rows=[...byKey.values()].sort((a,b)=>a.at-b.at||a.key.localeCompare(b.key)).slice(-3);
 const band=(row,m)=>row.uncertaintyModel==='native-pairing-v1'?m.predictive:m.expected;
 const misses=rows.filter(row=>row.power.actual<band(row,row.power).min-Math.max(1e-6,band(row,row.power).min*.01)||row.territory.actual<band(row,row.territory).min-.0001||
  row.rivals.some(r=>r.power.actual>band(row,r.power).max+Math.max(1e-6,band(row,r.power).max*.01)||r.territory.actual>band(row,r.territory).max+.0001));
 const resumeAt=misses.length>=2?Math.max(...misses.map(r=>r.at))+5400000:null;
 const suspended=resumeAt!==null&&now<resumeAt;
 return {known:true,suspended,samples:rows.length,misses:misses.length,resumeAt,keys:rows.map(r=>r.key),missKeys:misses.map(r=>r.key),reason:suspended?'Early clashes paused for ninety minutes after repeated optimistic forecast misses':resumeAt!==null?'Calibration pause expired; require a fresh bounded forecast':'No repeated optimistic forecast misses'};
}
