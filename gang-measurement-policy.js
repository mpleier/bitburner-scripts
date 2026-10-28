export const gangMeasurementFile='tasks/gang-measurements.json';
const keys=['hack','str','def','dex','agi','cha'];
const vector=v=>v&&keys.every(k=>Number.isFinite(v[k])&&v[k]>=1);
const finite=n=>Number.isFinite(n)&&n>=0;
const increment=n=>Math.min(Number.MAX_SAFE_INTEGER,(Number.isSafeInteger(n)&&n>=0?n:0)+1);
const gear=v=>JSON.stringify([...(v||[])].sort());
/** Bounded observational ledger. It never authorizes mutations or changes recovery deadlines. */
export function updateGangMeasurements(previous,input){
 const {reset,ownerPid,at:now,faction,members,lastReset={},metrics={},cohort=''}=input,diagnostics=input.diagnostics||{};
 if(![reset?.lastNodeReset,reset?.lastAugReset,now].every(finite)||!Number.isSafeInteger(ownerPid)||ownerPid<=0||typeof faction!=='string'||!members||Object.keys(members).length>12)return null;
 const same=previous?.version===1&&previous.nodeReset===reset.lastNodeReset&&previous.augReset===reset.lastAugReset&&previous.faction===faction&&finite(previous.at)&&previous.at<=now&&now-previous.at<=3600000;
 const old=same?previous:{},recoveries=(Array.isArray(old.recoveries)?old.recoveries:[]).slice(-12).filter(r=>r&&typeof r.name==='string'&&finite(r.resetAt)&&r.resetAt<=now&&finite(r.until)&&r.until>r.resetAt&&r.until-r.resetAt<=900000&&vector(r.expected)&&vector(r.original)&&vector(r.ascMults)&&Array.isArray(r.augmentations)).map(r=>({...r}));
 const roster=input.partial?old.roster??null:Object.keys(members).sort(),recruitments=(Array.isArray(old.recruitments)?old.recruitments:[]).filter(r=>r&&finite(r.at)&&r.at<=now&&Array.isArray(r.joined)&&Array.isArray(r.lost)).slice(-12);
 if(!input.partial&&Array.isArray(old.roster)&&old.roster.length<=12&&old.roster.every(n=>typeof n==='string')){
  const joined=roster.filter(n=>!old.roster.includes(n)),lost=old.roster.filter(n=>!roster.includes(n));if(joined.length||lost.length)recruitments.push({at:now,joined,lost});
 }
 const completed=(Array.isArray(old.completed)?old.completed:[]).slice(-24).filter(r=>r&&finite(r.at)&&r.at<=now&&typeof r.state==='string');
 const seen=new Set((Array.isArray(old.seen)?old.seen:[]).filter(k=>typeof k==='string'&&k.length<=200).slice(-32));
 const reasons=new Map(Object.entries(old.reasons||{}).filter(([k,v])=>/^[a-z-]{1,64}$/.test(k)&&Number.isSafeInteger(v)&&v>=0).slice(0,32));
 let attempts=Number.isSafeInteger(old.attempts)&&old.attempts>=0?old.attempts:0,rejected=Number.isSafeInteger(old.rejected)&&old.rejected>=0?old.rejected:0,unknownOutcomes=Number.isSafeInteger(old.unknownOutcomes)&&old.unknownOutcomes>=0?old.unknownOutcomes:0;
 for(const a of (Array.isArray(diagnostics.nativeAttempts)?diagnostics.nativeAttempts:[]).slice(0,12)){
  if(!a||typeof a.name!=='string'||a.name.length>100||!finite(a.at)||a.at>now||now-a.at>120000||typeof a.success!=='boolean')continue;
  const id=JSON.stringify([ownerPid,a.name,a.at]);if(seen.has(id))continue;seen.add(id);attempts=increment(attempts);
  if(!a.success){const reason=/^[a-z-]{1,64}$/.test(a.reason)?a.reason:'unknown';if(['worker-outcome-unknown','invalid-worker-reply','unknown'].includes(reason))unknownOutcomes=increment(unknownOutcomes);else rejected=increment(rejected);if(reasons.has(reason)||reasons.size<32)reasons.set(reason,increment(reasons.get(reason)));}
  const r=a.recovery;
  if(a.success&&r&&r.resetAt===lastReset[a.name]&&finite(r.until)&&r.until>r.resetAt&&r.until-r.resetAt<=900000&&vector(r.expected)&&vector(r.original)&&vector(r.ascMults)&&Array.isArray(r.augmentations)&&r.augmentations.length<=100){
   const index=recoveries.findIndex(v=>v.name===a.name);if(index>=0)recoveries.splice(index,1);
   recoveries.push({...r,name:a.name,lastAt:r.resetAt,confounded:false});
  }
 }
 const retained=[];
 for(const r of recoveries){
  if(input.partial&&!Object.hasOwn(members,r.name)){retained.push(r);continue;}
  const m=members[r.name],finish=(state,extra={})=>completed.push({name:r.name,resetAt:r.resetAt,until:r.until,at:now,state,...extra});
  if(!m||lastReset[r.name]!==r.resetAt||!vector(m)||keys.some(k=>!Number.isFinite(m[k+'_asc_mult'])||Math.abs(m[k+'_asc_mult']-r.ascMults[k])>1e-6)){finish('interrupted');continue;}
  const lastAt=finite(r.lastAt)&&r.lastAt>=r.resetAt&&r.lastAt<=now?r.lastAt:r.resetAt;
  r.confounded ||= now-lastAt>30000||gear(m.augmentations)!==gear(r.augmentations)||(m.upgrades?.length??0)>0||now<r.until&&!String(m.task).startsWith('Train ');
  const regained=keys.every(k=>m[k]>=r.original[k]);
  if(regained&&!r.regained)r.regained={lowerSeconds:(lastAt-r.resetAt)/1000,upperSeconds:(now-r.resetAt)/1000};
  if(now>=r.until){
   const delayMs=now-r.until,precise=!r.confounded&&delayMs<=2000;
   finish(precise?'measured':'inconclusive',{sampleDelayMs:delayMs,regained:r.regained??null,forecastSeconds:(r.until-r.resetAt)/1000,observed:Object.fromEntries(keys.map(k=>[k,m[k]])),expected:r.expected,
    statRatio:precise?keys.reduce((s,k)=>s+m[k]/6,0)/keys.reduce((s,k)=>s+r.expected[k]/6,0):null,reason:r.confounded?'Interrupted coverage, task or equipment changed':precise?'Observed within two seconds of forecast deadline':'First observation was too late for forecast calibration'});
  }else{r.lastAt=now;retained.push(r);}
 }
 const budget={...old.budget},passKey=finite(diagnostics.passAt)&&diagnostics.passAt<=now&&now-diagnostics.passAt<=120000?ownerPid+':'+diagnostics.passAt:null;
 if(passKey&&passKey!==old.passKey){budget.passes=increment(budget.passes);if(Number.isSafeInteger(diagnostics.simulations)&&diagnostics.simulations>0){budget.searches=increment(budget.searches);if(diagnostics.timeLimited)budget.timeLimited=increment(budget.timeLimited);if(diagnostics.simulationLimited)budget.simulationLimited=increment(budget.simulationLimited);}}
 const metric={at:now,power:metrics.power,respect:metrics.respect,memberCount:Object.keys(members).length,stats:keys.reduce((s,k)=>s+Object.values(members).reduce((v,m)=>v+(finite(m[k])?m[k]:0),0),0),
  money:finite(metrics.money)&&finite(metrics.moneyAt)&&metrics.moneyAt<=now&&now-metrics.moneyAt<=5000?metrics.money:null,
  factionRep:finite(metrics.factionRep)&&finite(metrics.repAt)&&metrics.repAt<=now&&now-metrics.repAt<=5000?metrics.factionRep:null};
 const signature=JSON.stringify([ownerPid,cohort]),prior=old.progress?.signature===signature?old.progress:null;
 const validPoint=p=>p&&finite(p.at)&&p.at<=now&&['power','respect','memberCount','stats'].every(k=>finite(p[k]));
 let baseline=validPoint(prior?.baseline)?prior.baseline:null,windows=(Array.isArray(prior?.windows)?prior.windows:[]).filter(w=>w&&finite(w.at)&&w.at<=now&&finite(w.seconds)&&w.seconds>=60&&w.seconds<=120&&['powerPerSecond','respectPerSecond','statsPerSecond'].every(k=>Number.isFinite(w[k]))&&Number.isSafeInteger(w.recruits)).slice(-5);
 if(!validPoint(metric)){baseline=null;windows=[];}
 else if(!baseline||now-baseline.at>120000){baseline=metric;windows=[];}
 else if(now-baseline.at>=60000){
  const seconds=(now-baseline.at)/1000,rate=k=>finite(metric[k])&&finite(baseline[k])&&(!['money','factionRep'].includes(k)||metric[k]>=baseline[k])?(metric[k]-baseline[k])/seconds:null;
  windows.push({at:now,seconds,powerPerSecond:rate('power'),respectPerSecond:rate('respect'),statsPerSecond:rate('stats'),recruits:metric.memberCount-baseline.memberCount,gangCashPerSecond:rate('money'),factionRepPerSecond:rate('factionRep')});windows=windows.slice(-5);baseline=metric;
 }
 const pair=windows.slice(-2),matched=pair.length===2&&Math.abs(pair[0].seconds-pair[1].seconds)<=2;
 const comparison=matched?{state:'observed',powerRateChange:pair[1].powerPerSecond-pair[0].powerPerSecond,gangCashRateChange:pair.every(w=>finite(w.gangCashPerSecond))?pair[1].gangCashPerSecond-pair[0].gangCashPerSecond:null,causalSpeedGainKnown:false}: {state:'sampling',causalSpeedGainKnown:false};
 return {version:1,nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,faction,ownerPid,at:now,roster,recruitments:recruitments.slice(-12),attempts,rejected,unknownOutcomes,reasons:Object.fromEntries(reasons),seen:[...seen].slice(-32),passKey:passKey??old.passKey??null,budget,recoveries:retained.slice(-12),completed:completed.slice(-24),progress:input.partial?old.progress??null:{signature,baseline,windows,comparison},limitations:'Sparse recovery samples are inconclusive. Gang respect is a stock and can fall on ascension; faction reputation is separate. Comparable windows describe observed growth, not causal policy speed gains.'};
}
export async function publishGangMeasurements(ns,input){
 try{let old=null;const raw=ns.read(gangMeasurementFile);if(raw&&raw.length<=100000)try{old=JSON.parse(raw);}catch{}
  const next=updateGangMeasurements(old,input);if(next)await ns.write(gangMeasurementFile,JSON.stringify(next),'w');return next;
 }catch(error){if(input.at-(publishGangMeasurements.warningAt??-Infinity)>=60000){ns.print('Gang measurements deferred: '+String(error));publishGangMeasurements.warningAt=input.at;}return null;}
}
