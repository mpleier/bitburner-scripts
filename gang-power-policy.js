/** Preparation follows the weakest matchup, including a moving strongest rival. */
export function gangPreparationStatus(gang,snapshot,threshold=.75,now=Date.now(),enabled=true){
 const no=reason=>({enabled,known:false,active:false,ready:false,reason});
 if(!enabled)return no('Training-first preparation disabled');
 const baseTarget=Math.max(.75,threshold);
 const buffered=snapshot?.preparationTarget;
 const target=Number.isFinite(buffered)&&buffered>=baseTarget&&buffered<=Math.min(.999999,baseTarget+.005)+1e-12?buffered:baseTarget;
 if(!Number.isFinite(target)||target>=1||!Number.isFinite(gang?.power)||gang.power<0||!Number.isFinite(gang.territory)||gang.territory<0||gang.territory>1||!snapshot||snapshot.faction!==gang.faction||!Number.isFinite(snapshot.at)||snapshot.at>now||now-snapshot.at>45000)return no('Fresh readiness observations unavailable');
 const rows=Object.entries(snapshot.gangs||{});
 if(!rows.length||rows.some(([,r])=>![r?.power,r?.territory].every(Number.isFinite)||r.power<0||r.territory<0||r.territory>1))return no('Invalid rival observations');
 const rivals=rows.filter(([name,r])=>name!==gang.faction&&r.territory>0);
 if(!rivals.length)return {enabled,known:true,active:false,ready:true,target,reason:'No active rivals'};
 if(rivals.some(([,r])=>gang.power+r.power<=0))return no('Unknown clash probability');
 const strongest=rivals.sort((a,b)=>b[1].power-a[1].power)[0],minimum=gang.power/(gang.power+strongest[1].power),targetPower=strongest[1].power*target/(1-target);
 return {enabled,known:true,active:minimum<target,ready:minimum>=target,objective:minimum<target?'stat-growth':'balanced',target,minimum,strongest:strongest[0],rivalPower:strongest[1].power,targetPower,powerGap:Math.max(0,targetPower-gang.power),reason:minimum<target?'Training-first warfare preparation':'Safe warfare target reached; balanced development'};
}
/** Track confirmed-update chatter; a short, higher preparation target never lowers engagement safety. */
export function gangPreparationPhase(previous,gang,snapshot,threshold=.75,now=Date.now(),enabled=true){
 const raw=gangPreparationStatus(gang,{...snapshot,preparationTarget:undefined},threshold,now,enabled),base=Math.max(.75,threshold);
 if(!raw.known)return {at:now,faction:gang?.faction,baseTarget:base,ready:null,changes:[],bufferUntil:0,effectiveTarget:base,buffered:false};
 const fresh=!!previous&&typeof gang?.faction==='string'&&previous.faction===gang.faction&&previous.baseTarget===base&&Number.isFinite(previous.at)&&previous.at<now&&now-previous.at<=45000;
 const changes=fresh&&Array.isArray(previous.changes)?previous.changes.filter(t=>Number.isFinite(t)&&t<=now&&now-t<=120000).slice(-7):[];
 if(raw.known&&fresh&&typeof previous.ready==='boolean'&&previous.ready!==raw.ready)changes.push(now);
 const until=fresh&&Number.isFinite(previous.bufferUntil)&&previous.bufferUntil>now?previous.bufferUntil:changes.length>=3?now+120000:0;
 return {at:now,faction:gang?.faction,baseTarget:base,ready:raw.known?raw.ready:null,changes:changes.slice(-8),bufferUntil:until,
  effectiveTarget:enabled&&raw.known&&raw.minimum!==undefined&&until>now?Math.min(.999999,base+.005):base,
  buffered:enabled&&raw.known&&raw.minimum!==undefined&&until>now};
}
/** A 20-game-second floor measured at the readiness boundary, retaining the relative savings requirement. */
export function gangReadinessSavingsFloor(beforeSeconds,bonusSeconds=0){
 if(!Number.isFinite(beforeSeconds)||beforeSeconds<0||!Number.isFinite(bonusSeconds)||bonusSeconds<0)return 20;
 const remaining=Math.max(0,bonusSeconds-24*beforeSeconds);
 return remaining>=20*24/25?.8:20-remaining;
}
/** Larger power investments require a material, reachable warfare-readiness improvement. */
export function gangPowerSpendingFraction({powerPriority=false,beforeSeconds,afterSeconds,horizon,clashChance=0}={}){
 return powerPriority===true&&clashChance===0&&[beforeSeconds,afterSeconds,horizon].every(Number.isFinite)&&
  horizon>0&&beforeSeconds>0&&afterSeconds>=0&&afterSeconds<=horizon&&
  beforeSeconds-afterSeconds>=Math.max(20,beforeSeconds*.05) ? .05 : .01;
}

/** Balanced mode targets safe clashes; explicit power priority continues through conquest. */
export function gangPowerFocus(w){
 if(!w?.active||!w.duty||!Number.isFinite(w.power)||w.power<0||!Number.isFinite(w.threshold)||w.threshold<.5||w.threshold>=1||!w.rivals?.length)return false;
 const strongest=[...w.rivals].sort((a,b)=>b.power-a.power)[0];
 return Number.isFinite(strongest.power)&&strongest.power>0&&(w.powerPriority===true||strongest.samples>=3&&w.power/(w.power+strongest.power)<w.threshold);
}

const gangIncomeChannels=['hacking','hacknet','gang','sleeves','work','crime','corporation','bladeburner','darknet'];
/** Rebuild every derived value; saved summaries never establish credit. */
export function restoreGangIncome(saved,{nodeReset,augReset,now=Date.now()}={}){
 const keys=gangIncomeChannels,baseline=saved?.baseline;
 if(!saved||saved.schemaVersion!==2||![nodeReset,augReset,now].every(Number.isFinite)||saved.nodeReset!==nodeReset||saved.augReset!==augReset||
  !baseline||!Number.isFinite(baseline.at)||baseline.at<Math.max(nodeReset,augReset)||baseline.at>now||now-baseline.at>120000||!baseline.sources||
  !keys.every(k=>Number.isFinite(baseline.sources[k]))||!Array.isArray(saved.samples)||saved.samples.length>5)return null;
 const samples=[];let lastAt=null,lastSources=null;
 for(const row of saved.samples){
  if(!row||![row.at,row.seconds].every(Number.isFinite)||row.at>baseline.at||row.seconds<20||row.seconds>120||row.at-row.seconds*1000<Math.max(nodeReset,augReset)||
   lastAt!==null&&Math.abs(row.at-row.seconds*1000-lastAt)>1||!row.startSources||!row.endSources||
   !keys.every(k=>Number.isFinite(row.startSources[k])&&Number.isFinite(row.endSources[k])&&(!lastSources||lastSources[k]===row.startSources[k])&&(k==='sleeves'||row.endSources[k]>=row.startSources[k])))return null;
  const rates=Object.fromEntries(keys.map(k=>[k,Math.max(0,(row.endSources[k]-row.startSources[k])/row.seconds)]));
  if(!keys.every(k=>Number.isFinite(rates[k])))return null;
  lastAt=row.at;lastSources=row.endSources;
  if(now-row.at<=300000)samples.push({at:row.at,seconds:row.seconds,startSources:Object.fromEntries(keys.map(k=>[k,row.startSources[k]])),endSources:Object.fromEntries(keys.map(k=>[k,row.endSources[k]])),rates});
 }
 if(saved.samples.length&&(lastAt!==baseline.at||keys.some(k=>lastSources[k]!==baseline.sources[k])))return null;
 const known=samples.length>=3&&now-samples.at(-1).at<=30000;
 const rates=Object.fromEntries(keys.map(k=>{const values=samples.map(r=>r.rates[k]).sort((a,b)=>a-b);return [k,known?Math.min(samples.at(-1).rates[k],values[Math.floor((values.length-1)/2)]):0];}));
 const gangRate=rates.gang,externalRate=keys.filter(k=>k!=='gang').reduce((v,k)=>v+rates[k],0),totalRate=gangRate+externalRate;
 const seconds=samples.reduce((sum,row)=>sum+row.seconds,0),observedGangRate=known?samples.reduce((sum,row)=>sum+row.rates.gang*row.seconds,0)/seconds:0;
 const observedExternalRate=known?samples.reduce((sum,row)=>sum+keys.filter(k=>k!=='gang').reduce((v,k)=>v+row.rates[k]*row.seconds,0),0)/seconds:0;
 if(![gangRate,externalRate,totalRate,observedGangRate,observedExternalRate].every(Number.isFinite))return null;
 return {schemaVersion:2,nodeReset,augReset,baseline:{at:baseline.at,sources:Object.fromEntries(keys.map(k=>[k,baseline.sources[k]]))},samples,known,
  rateAt:samples.at(-1)?.at??null,rates,gangRate,externalRate,totalRate,gangShare:known&&totalRate>0?gangRate/totalRate:null,
  observedGangRate,observedExternalRate,observedGangShare:known&&observedGangRate+observedExternalRate>0?observedGangRate/(observedGangRate+observedExternalRate):null};
}
/** Persist completed baselines without letting optional storage failures block gang management. */
export async function persistGangIncome(ns,record,state={},now=Date.now()){
 const clean=restoreGangIncome(record,{nodeReset:record?.nodeReset,augReset:record?.augReset,now});
 if(!clean||state.at===clean.baseline.at||state.retryAt>now)return state;
 try{
  const text=JSON.stringify(clean);if(text.length>20000)throw Error('Income history exceeds storage limit');
  await ns.write('tasks/gang-income-observation.json',text,'w');
  return {at:clean.baseline.at,retryAt:0,warningAt:state.warningAt??null,error:null};
 }catch(error){
  const warn=!Number.isFinite(state.warningAt)||now-state.warningAt>=60000;
  if(warn)ns.print?.('WARNING: Gang income history could not be saved; continuing with in-memory observations.');
  return {...state,retryAt:now+5000,warningAt:warn?now:state.warningAt,error:String(error?.message||error).slice(0,256)};
 }
}
/** Independent bounded recurring-income evidence. Windfalls and trading principal are excluded. */
export function observeGangIncome(previous,snapshot,{nodeReset,augReset,now=Date.now()}={}){
 const keys=gangIncomeChannels;
 const valid=s=>s&&Number.isFinite(s.at)&&s.at>=Math.max(nodeReset,augReset)&&s.at<=now&&now-s.at<=30000&&s.sources&&keys.every(k=>Number.isFinite(s.sources[k]));
 const baseline=valid(snapshot)?{at:snapshot.at,sources:Object.fromEntries(keys.map(k=>[k,snapshot.sources[k]]))}:null;
 const empty={schemaVersion:2,nodeReset,augReset,baseline,samples:[],known:false,rateAt:null,gangRate:0,externalRate:0,totalRate:0,gangShare:null,observedGangRate:0,observedExternalRate:0,observedGangShare:null};
 if(!baseline||![nodeReset,augReset,now].every(Number.isFinite))return empty;
 const restored=restoreGangIncome(previous,{nodeReset,augReset,now});
 if(!restored||snapshot.at<restored.baseline.at||keys.some(k=>k!=='sleeves'&&snapshot.sources[k]<restored.baseline.sources[k]))return empty;
 const seconds=(snapshot.at-restored.baseline.at)/1000;
 if(seconds<20)return restored;
 if(seconds>120)return empty;
 const samples=[...restored.samples,{at:snapshot.at,seconds,startSources:restored.baseline.sources,endSources:baseline.sources}].slice(-5);
 return restoreGangIncome({...empty,samples},{nodeReset,augReset,now})||empty;
}
/** Reprice only the planner's current worthwhile opportunity, including all items in a bundle. */
export function gangPlannedEquipmentCash(quote,members,prices,{nodeReset,augReset,faction,now=Date.now()}={}){
 if(!quote||quote.nodeReset!==nodeReset||quote.augReset!==augReset||quote.faction!==faction||!Number.isFinite(quote.at)||quote.at>now||now-quote.at>60000||quote.complete!==true||!Array.isArray(quote.orders)||quote.orders.length>32||!Array.isArray(quote.members)||!members||quote.members.length!==Object.keys(members).length||quote.members.some(n=>!members[n]))return null;
 let target=0;const seen=new Set();
 for(const order of quote.orders){
  const m=members[order.member];if(!m||!Array.isArray(m.upgrades)||!Array.isArray(m.augmentations)||typeof order.equipmentName!=='string')return null;
  const key=JSON.stringify([order.member,order.equipmentName]);if(seen.has(key))continue;seen.add(key);
  if(m.upgrades.includes(order.equipmentName)||m.augmentations.includes(order.equipmentName))continue;
  const cost=prices?.[order.equipmentName];if(!Number.isFinite(cost)||cost<0)return null;target+=cost;
 }
 return Number.isFinite(target)?target:null;
}
/** A small measured income cost may buy a material, finite power-readiness gain.
 * Imminent augmentation/recruitment gates remain separate. No cash value is assigned to power. */
export function gangIncomeDelayAllowance(after,before,funding,horizon,now=Date.now()){
 if(funding?.tradeoff!==true||funding.expiresAt<=now||funding.at>now||now-funding.at>30000||![horizon,funding.measuredExternalRate].every(Number.isFinite)||horizon<=0||funding.measuredExternalRate<=0)return 2;
 const a=after?.powerReady,b=before?.powerReady,rows=after?.cumulative,base=before?.cumulative;
 const earned=Array.isArray(rows)?rows.at(-1)?.gangMoney:NaN,reference=Array.isArray(base)?base.at(-1)?.gangMoney:NaN;
 if(![a,b,earned,reference].every(Number.isFinite)||a<0||b-a<Math.max(20,b*.05)||earned<0||reference<0)return 2;
 const gross=reference+funding.measuredExternalRate*horizon,loss=Math.max(0,reference-earned);
 if(!Number.isFinite(gross)||gross<=0||loss/gross>.05)return 2;
 return Math.max(2,Math.min(120,horizon*.1,(b-a)*.25));
}
/** Near-term concrete development needs, not a percentage of an ever-growing wallet. */
export function gangDevelopmentCashTarget(members,equipment){
 if(!members||!Array.isArray(equipment)||Object.values(members).some(m=>!Array.isArray(m.upgrades)||!Array.isArray(m.augmentations))||equipment.some(e=>!e||typeof e.name!=='string'||!Number.isFinite(e.cost)||e.cost<0||!e.stats||typeof e.stats!=='object'||['hack','str','def','dex','agi','cha'].some(k=>e.stats[k]!==undefined&&(!Number.isFinite(e.stats[k])||e.stats[k]<0))))return null;
 let target=0;
 for(const m of Object.values(members)){
  const owned=new Set([...m.upgrades,...m.augmentations]);
  const costs=equipment.filter(e=>!owned.has(e.name)&&['hack','str','def','dex','agi','cha'].some(k=>Number.isFinite(e.stats?.[k])&&e.stats[k]>1)).map(e=>e.cost);
  if(costs.length)target+=Math.min(...costs);
 }
 return Number.isFinite(target)?target:null;
}
export function gangIncomeFunding({cash,equipmentCash,augmentationCash,augmentationKnown=false,reserveShortfall=0,externalCashRate=0,externalAt=null,at=Date.now(),horizonSeconds=900,forceMoney=false,contribution=null}={}){
 const none={known:false,deprioritize:false,reason:'Development funding unavailable'};
 if(!augmentationKnown||![cash,equipmentCash,augmentationCash,reserveShortfall,at,horizonSeconds].every(Number.isFinite)||Math.min(cash,equipmentCash,augmentationCash,reserveShortfall)<0||horizonSeconds<=0)return none;
 const rate=Number.isFinite(externalAt)&&externalAt<=at&&at-externalAt<=30000&&Number.isFinite(externalCashRate)&&externalCashRate>=0?externalCashRate*.5:0;
 const target=equipmentCash+augmentationCash+reserveShortfall;if(!Number.isFinite(target))return none;
 const gap=Math.max(0,target-cash),covered=gap===0||rate>0&&gap/rate<=Math.min(120,horizonSeconds);
 const measured=contribution?.known===true&&Number.isFinite(contribution.rateAt)&&contribution.rateAt<=at&&at-contribution.rateAt<=30000&&[contribution.gangRate,contribution.externalRate].every(Number.isFinite)&&contribution.gangRate>=0&&contribution.externalRate>0&&contribution.gangRate/(contribution.gangRate+contribution.externalRate)<=.15;
 const tradeoff=!forceMoney&&!covered&&measured&&rate>0;
 return {known:true,deprioritize:!forceMoney&&(covered||tradeoff),tradeoff,gangShare:measured?contribution.gangRate/(contribution.gangRate+contribution.externalRate):null,measuredGangRate:measured?contribution.gangRate:null,measuredExternalRate:measured?contribution.externalRate:null,at,expiresAt:at+30000,cash,target,equipmentCash,augmentationCash,reserveShortfall,externalCashRate:rate,
  reason:forceMoney?'Explicit money focus':covered?'Development funding covered':tradeoff?'Small income contribution; compare development payoff':'Gang income needed for development'};
}
/** Optional income-dependent bursts must be requalified when their funding disappears. */
export function releaseGangIncomeTraining(episodes,funding,now=Date.now()){
 const next={...episodes};let changed=false;
 if(funding?.known===true&&funding.deprioritize===true&&Number.isFinite(funding.at)&&funding.at<=now&&funding.expiresAt>now&&now-funding.at<=30000)return {episodes:next,changed};
 for(const [name,e]of Object.entries(next))if(e?.incomeDependent===true&&!e.developmentCycle){delete next[name];changed=true;}
 return {episodes:next,changed};
}
/** Compare funding deadlines on actual simulated cash paths; external income is credited once, conservatively. */
export function gangFundingPlanCovered(after,before,funding,horizon,now=Date.now()){
 if(funding?.known!==true||funding.deprioritize!==true||![funding.at,funding.expiresAt,funding.cash,funding.target,funding.externalCashRate,horizon,now].every(Number.isFinite)||
  funding.at>now||funding.expiresAt<=now||now-funding.at>30000||Math.min(funding.cash,funding.target,funding.externalCashRate)<0||horizon<=0)return false;
 if(funding.cash>=funding.target)return true;
 const crossing=plan=>{
  let at=0,cash=funding.cash,earned=0,crossed=Infinity;
  if(!Array.isArray(plan?.cumulative)||!plan.cumulative.length)return Infinity;
  for(const row of plan.cumulative){
   if(![row.at,row.gangMoney].every(Number.isFinite)||row.at<=at||row.at>horizon||row.gangMoney<earned)return Infinity;
   const next=funding.cash+row.gangMoney+funding.externalCashRate*row.at;
   if(!Number.isFinite(next))return Infinity;
   if(!Number.isFinite(crossed)&&next>=funding.target)crossed=at+(row.at-at)*(funding.target-cash)/(next-cash);
   at=row.at;cash=next;earned=row.gangMoney;
  }
  return crossed;
 };
 const reference=crossing(before),candidate=crossing(after);
 return Number.isFinite(candidate)&&candidate<=horizon&&(!Number.isFinite(reference)||candidate<=reference+gangIncomeDelayAllowance(after,before,funding,horizon,now));
}
/** Completed power payback permits bounded foregone output, with a funding exception during preparation.
 * Resource milestone and warfare safety gates are enforced separately by the caller. */
export function gangPowerBenefit(after,before,w,horizon,bonusSeconds=0){
 const statPriority=w?.statPriority===true&&w?.preparation?.active===true;
 const none={statPriority,statGain:0,incomeDeprioritized:false,powerPriority:w?.powerPriority===true,powerPreparation:w?.preparation?.active===true,powerObjective:false,powerSecondsSaved:0,powerGain:0,powerPaybackSeconds:null};
 if(w?.powerFocus!==true||!after||!before||!Number.isFinite(horizon)||horizon<=0)return none;
 const a=after.power??after.projectedPower,b=before.power??before.projectedPower;
 const ar=after.powerReady??after.warfareReadySeconds,br=before.powerReady??before.warfareReadySeconds;
 const production=after.total??after.production,baseline=before.total??before.production;
 const funded=w.powerPriority===true&&w.preparation?.active===true&&gangFundingPlanCovered(after,before,w.incomeFunding,horizon);
 if(![a,b,production,baseline].every(Number.isFinite)||a<=b||baseline<0||production<0||!funded&&production<baseline*(w.powerPriority===true?.5:.9))return none;
 const gain=a-b,margin=Math.max(.001,Math.max(0,b-w.power)*.05);
 const measured=w.rivals?.every(r=>r.samples>=3);
 const preparing=w.preparation?.active===true;
 const saved=(w.powerPriority!==true||measured)&&Number.isFinite(ar)&&(preparing||ar<=horizon)?(Number.isFinite(br)?Math.max(0,br-ar):preparing?0:horizon):0;
 const foundation=preparing&&measured&&!Number.isFinite(ar)&&!Number.isFinite(br)&&gain>=Math.max(.01,Math.max(0,b-w.power)*.1);
 const improvesETA=measured&&Number.isFinite(ar)&&(!Number.isFinite(br)||saved>=Math.max(gangReadinessSavingsFloor(br,bonusSeconds),br*.05));
 if(preparing&&!foundation&&!improvesETA)return none;
 const paid=after.cumulative?.find((p,i)=>Number.isFinite(p.power)&&p.power>(before.cumulative?.[i]?.power??Infinity)+margin&&after.cumulative.slice(i).every((q,j)=>q.power>(before.cumulative?.[i+j]?.power??Infinity)+margin))?.at;
 if(!Number.isFinite(paid)||paid>horizon||gain<margin||saved<Math.max(2,Number.isFinite(br)?br*.02:2)&&gain<Math.max(.01,Math.max(0,b-w.power)*.1))return none;
 const statGain=statPriority&&Number.isFinite(after.stats)&&Number.isFinite(before.stats)?Math.max(0,after.stats-before.stats):0;
 return {stats:after.stats,statPriority,statGain,incomeDeprioritized:funded&&production<baseline*.5,powerPriority:w.powerPriority===true,powerPreparation:preparing,powerFoundation:foundation,readinessExtrapolated:preparing&&Number.isFinite(ar)&&ar>horizon,powerObjective:true,powerSecondsSaved:saved,powerGain:gain,powerPaybackSeconds:paid};
}

/** Conditional expected path. Fixed-territory evidence remains the authorization baseline.
 * Opponent trajectories retain observed power growth; NPC-vs-NPC territory changes are unknown. */
export function gangTerritoryProjection(w,cumulative,bonusSeconds=0){
 if(!w?.active||!Number.isFinite(w.territory)||w.territory<=0||w.territory>=1||!Number.isFinite(w.power)||!w.rivals?.length||
  w.rivals.some(r=>![r.power,r.rate,r.territory].every(Number.isFinite)||r.power<=0||r.rate<0||r.territory<=0)||!Array.isArray(cumulative))return null;
 let power=w.power,territory=w.territory,at=0,fixedPower=w.power,ticks=0;
 const rivals=w.rivals.map(r=>({...r})),game=t=>t+Math.min(Math.max(0,bonusSeconds),24*t);
 for(const point of cumulative){
  if(![point.at,point.power].every(Number.isFinite)||point.at<at)return null;
  const seconds=game(point.at)-game(at),baseGain=Math.max(0,point.power-fixedPower),steps=Math.max(1,Math.ceil(seconds/20));
  if(ticks+steps>1800)return {model:'Expected territory; observed rival power',limited:true,power,territory};
  for(let i=0;i<steps;i++){
   const dt=seconds/steps;for(const r of rivals)r.power+=r.rate*dt;
   const opponents=rivals.filter(r=>r.territory>0);
   power+=baseGain/steps*Math.max(.002,territory)/Math.max(.002,w.territory);
   if(opponents.length&&opponents.every(r=>power/(power+r.power)>=w.threshold)){
    let change=0,losses=0;
    for(const rival of opponents){
     const other=rival.power,chance=power/(power+other),encounters=2/opponents.length*dt/20;
     const win=Math.min(rival.territory,.0001*Math.max(1,1+Math.log(power/other)/Math.log(50)))*chance*encounters;
     const lose=Math.min(territory,.0001*Math.max(1,1+Math.log(other/power)/Math.log(50)))*(1-chance)*encounters;
     change+=win-lose;rival.territory=Math.max(0,rival.territory-win+lose);rival.power*=Math.pow(1/1.01,chance*encounters);losses+=(1-chance)*encounters;
    }
    territory=Math.max(0,Math.min(1,territory+change));power*=Math.pow(1/1.008,losses);
   }
   ticks++;
  }
  fixedPower=point.power;at=point.at;
 }
 return {model:'Expected territory; observed rival growth and clash attrition',power,territory,ticks,limited:false,rivals:rivals.map(r=>({name:r.name,power:r.power,territory:r.territory}))};
}

/** Compare pulse power with foregone training; exposed optional trainees share one slot. */
export function assessGangTraineePulse(member,task,warfare,horizon,bonusSeconds,project){
 const no=reason=>({allowed:false,reason});
 if(!warfare?.active||!Number.isFinite(warfare.clashChance)||warfare.clashChance<0||warfare.clashChance>1||!warfare.duty||!task?.name?.startsWith('Train ')||!Number.isFinite(horizon)||horizon<=0||horizon>21600||!Number.isFinite(bonusSeconds)||bonusSeconds<0||typeof project!=='function')return no('missing-evidence');
 const keys=['hack','str','def','dex','agi','cha'];if(keys.some(k=>!Number.isFinite(member?.[k])||member[k]<1))return no('invalid-member');
 const game=horizon+Math.min(bonusSeconds,horizon*24),threshold=Math.max(.75,warfare.threshold??.75),riskGameSeconds=Math.max(3750,game,warfare.pulseRiskGameSeconds??0);
 if(!Number.isFinite(riskGameSeconds)||riskGameSeconds>540000)return no('invalid-risk-horizon');
 let expectedDeaths=0;
 if(warfare.clashChance>0){
  if(warfare.powerPriority!==true||warfare.powerFocus!==true||!Number.isFinite(warfare.power)||warfare.power<=0||!Number.isFinite(threshold)||threshold>=1||!warfare.rivals?.length||warfare.rivals.some(r=>!Number.isFinite(r.power)||r.power<0||!Number.isFinite(r.territory)||r.territory<=0||warfare.power/(warfare.power+r.power)<threshold))return no('unsafe-odds');
  // Two expected player encounters per native update; use losing-clash mortality
  // even for wins. The 3,750-game-second floor covers a stalled owner lease,
  // supervisor latency at maximum bonus speed, and a full residual clash tail.
  expectedDeaths=2*Math.ceil(riskGameSeconds/20)*.35*.01/Math.pow(member.def,.6);
  if(member.def<1000||!Number.isFinite(expectedDeaths)||expectedDeaths>.005)return no('extra-death-budget');
 }
 const modes=[];
 if(bonusSeconds<horizon*24)modes.push({batch:2,fraction:warfare.duty.normalFraction});
 if(bonusSeconds>0)modes.push({batch:5,fraction:warfare.duty.bonusFraction});
 if(modes.some(m=>!Number.isFinite(m.fraction)||m.fraction<0||m.fraction>.5))return no('pulse-duty');
 const total=keys.reduce((v,k)=>v+member[k],0),missed=project(member,null,0);
 if(!missed)return no('missing-training-projection');
 let loss=0,missedBatches=0;
 for(const mode of modes){
  const full=project(member,task,mode.batch);if(!full)return no('missing-training-projection');
  const perBatch=keys.reduce((v,k)=>{const before=missed[k+'_exp'],after=full[k+'_exp'],mult=missed[k+'_mult'],asc=missed[k+'_asc_mult']??1;
   if(![before,after,mult,asc].every(Number.isFinite)||after<before)return Infinity;
   return v+Math.max(0,Math.ceil(mult*asc*32*Math.log((after+534.5)/(before+534.5))-1e-12));},0);
  const count=Math.max(1,Math.ceil(mode.fraction*20/mode.batch-1e-12));
  loss=Math.max(loss,perBatch*count);missedBatches=Math.max(missedBatches,count);
 }
 // Price every displaced batch and use the more expensive mode across bonus exhaustion.
 const pulses=Math.max(1,Math.ceil(game/20));
 const trainingLoss=loss*pulses;
 return {allowed:Number.isFinite(total)&&Number.isFinite(trainingLoss)&&total>trainingLoss*1.25,reason:'power-versus-training',stats:total,trainingLoss,expectedDeaths,threshold,horizon,bonusSeconds,riskGameSeconds,fraction:Math.max(...modes.map(m=>m.fraction)),missedBatches};
}
export function gangTraineePulse(member,task,warfare,horizon,bonusSeconds,project){
 return assessGangTraineePulse(member,task,warfare,horizon,bonusSeconds,project).allowed;
}
/** At positive exposure one optional trainee owns the entire extra-risk budget. */
export function selectGangTraineePulses(eligible,members,warfare){
 if(warfare?.clashChance===0)return {...eligible};
 const score=n=>{const m=members[n],total=['hack','str','def','dex','agi','cha'].reduce((s,k)=>s+m[k],0);return Math.log(total)+.6*Math.log(m.def);};
 const names=Object.keys(eligible).filter(n=>eligible[n]&&members[n]).sort((a,b)=>score(b)-score(a)||a.localeCompare(b));
 return Object.fromEntries(Object.keys(eligible).map(n=>[n,n===names[0]]));
}

/** Fresh native validation for purchases justified by power instead of cash return. Self-contained. */
export function gangPowerPurchaseAllowed(ns,order){
 const q=order.powerQuote,now=Date.now();
 if(!q||!Number.isFinite(q.horizon)||q.horizon<=0||!Number.isFinite(q.power)||!Number.isFinite(q.territory)||!Number.isFinite(q.rivalPower)||q.rivalPower<=0||!Number.isFinite(q.at)||q.at>now||now-q.at>5000||!Number.isFinite(q.threshold)||q.threshold<.5||q.threshold>=1||
  !Number.isFinite(order.powerPaybackSeconds)||order.powerPaybackSeconds<0||order.powerPaybackSeconds>q.horizon)return false;
 const g=ns.gang.getGangInformation(),reset=ns.getResetInfo();
 if(q.nodeReset!==reset.lastNodeReset||q.augReset!==reset.lastAugReset||q.at<reset.lastAugReset||g.faction!==q.faction||Math.abs(g.territory-q.territory)>.001||
  !Number.isFinite(g.power)||Math.abs(g.power-q.power)>Math.max(1,g.power*.02))return false;
 const rivals=Object.entries(ns.gang.getAllGangInformation()).filter(([name,r])=>name!==g.faction&&r.territory>0);
 if(q.powerPreparation===true&&rivals.length&&rivals.every(([,r])=>g.power/(g.power+r.power)>=q.threshold))return false;
 if(!rivals.length||q.powerPriority!==true&&rivals.every(([,r])=>g.power/(g.power+r.power)>=q.threshold)||rivals.some(([,r])=>!Number.isFinite(r.power)||r.power>q.rivalPower*1.02))return false;
 const cash=ns.getPlayer().money-Math.max(0,Number(ns.read('reserve.txt'))||0,Number(q.reserve)||0);
 const larger=order.cost>cash*.01;
 if(!Number.isFinite(cash)||cash<=0||!Number.isFinite(order.cost)||order.cost<=0||order.cost>cash*.05)return false;
 if(larger){
  const e=q.largerPurchase;
  if(q.powerPriority!==true||g.territoryWarfareEngaged===true||g.territoryClashChance!==0||!e||
   ![e.beforeSeconds,e.afterSeconds,e.powerGainPerTick].every(Number.isFinite)||e.beforeSeconds<=0||e.afterSeconds<0||e.afterSeconds>q.horizon||
   e.beforeSeconds-e.afterSeconds<Math.max(20,e.beforeSeconds*.05)||e.powerGainPerTick<=0||q.trainingTask)return false;
 }
 const m=ns.gang.getMemberInformation(order.member),stats=ns.gang.getEquipmentStats(order.equipmentName);
 if([...m.upgrades,...m.augmentations].includes(order.equipmentName))return false;
 let gain=0,xpGain=0;const task=q.trainingTask&&['Train Combat','Train Hacking','Train Charisma'].includes(q.trainingTask)&&m.task===q.trainingTask?ns.gang.getTaskStats(q.trainingTask):null;
 for(const k of ['hack','str','def','dex','agi','cha']){
  const mult=m[k+'_mult'],asc=m[k+'_asc_mult'],exp=m[k+'_exp'],factor=stats[k]??1;
  if(![mult,asc,exp,factor].every(Number.isFinite)||mult<1||asc<1||exp<0||factor<1)return false;
  const skill=f=>Math.max(1,Math.floor(mult*asc*f*(32*Math.log(exp+534.5)-200)));
  gain+=skill(factor)-skill(1);
  if(task)xpGain+=Math.max(0,Number(task[k+'Weight'])||0)*Math.pow(Math.max(0,Number(task.difficulty)||0),.9)*(mult*(factor-1)/4)*asc;
 }
 if(larger){
  // Reprice the candidate's immediate power gain from current native stats. Do not
  // use future training or defense-eligibility changes to justify a larger bill.
  const nativeGain=.015*Math.max(.002,g.territory)*gain/95;
  if(!(nativeGain>0)||q.largerPurchase.powerGainPerTick>nativeGain*1.02)return false;
 }
 return gain>0||xpGain>0;
}

/** Equal contribution per skill point, weighted by the member's current six-stat power contribution. */
export function gangPowerAscensionWeights(members,fallback,active){
 if(!active)return fallback;
 return Object.fromEntries(Object.entries(members).map(([name,m])=>[name,Object.fromEntries(['hack','str','def','dex','agi','cha'].map(k=>[k,Math.max(1,Number(m[k])||1)]))]));
}

/** Release only optional preparation episodes; mandatory recovery/development and manual assignments are separate. */
export function releaseGangPreparationTraining(episodes,preparation){
 if(preparation?.enabled!==false&&preparation?.ready!==true)return {episodes,changed:false};
 const retained=Object.fromEntries(Object.entries(episodes).filter(([,e])=>!e?.preparation||e.developmentCycle));
 return {episodes:retained,changed:Object.keys(retained).length!==Object.keys(episodes).length};
}

/** Earlier finite readiness wins; only compare power growth when neither ETA is available. */
export function gangPreparationComparison(a,b){
 const ar=a?.powerReady??a?.warfareReadySeconds,br=b?.powerReady??b?.warfareReadySeconds;
 if(Number.isFinite(ar)!==Number.isFinite(br))return Number.isFinite(ar)?-1:1;
 // Prefer stronger skill foundations while preparing, after finite readiness is established.
 if(a?.statPriority===true&&b?.statPriority===true&&[a.statGain,b.statGain].every(Number.isFinite)&&Math.abs(a.statGain-b.statGain)>Math.max(1,Math.abs(b.statGain)*.01))return b.statGain-a.statGain;
 if(Number.isFinite(ar)&&Number.isFinite(br))return Math.abs(ar-br)>2?ar-br:0;
 for(const key of ['power','projectedPower','powerGain'])if(Number.isFinite(a?.[key])&&Number.isFinite(b?.[key])){const ap=a[key],bp=b[key];return Math.abs(ap-bp)>Math.max(.001,Math.abs(bp)*.01)?bp-ap:0;}
 return 0;
}
