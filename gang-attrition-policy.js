/** Expected-value attrition planning; never a guarantee of territory or member survival. */
export function gangAttritionSignature(members){
 return JSON.stringify(Object.values(members).map(m=>[m.name,m.def,...['hack','str','def','dex','agi','cha'].map(k=>m[k+'_exp']),m.upgrades,m.augmentations]).sort((a,b)=>a[0].localeCompare(b[0])));
}
export function simulateGangAttrition({w,cumulative,members,powerFraction=1,attrition=false,bonusSeconds=0,rivalGrowthScale=1}={}){
 if(!w?.active||!Array.isArray(cumulative)||!cumulative.length||cumulative.length>256||!Array.isArray(w.rivals)||!w.rivals.length||w.rivals.length>12||!Array.isArray(members)||!members.length||members.length>12||members.some(m=>!Number.isFinite(m.def)||m.def<=0)||
  ![w.power,w.territory,w.threshold,powerFraction,bonusSeconds,rivalGrowthScale].every(Number.isFinite)||w.power<=0||w.territory<=0||w.territory>=1||w.threshold<.65||w.threshold>=1||powerFraction<0||powerFraction>1||bonusSeconds<0||rivalGrowthScale<.5||rivalGrowthScale>2||
  w.rivals.some(r=>![r.power,r.territory,r.highRate].every(Number.isFinite)||r.power<=0||r.territory<=0||r.highRate<0))return null;
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
   const chance=r=>power/(power+r.power),safe=n>0&&active.every(r=>chance(r)>=w.threshold);
   if(safe){if(readyStart===null)readyStart=elapsed;readyGameSeconds+=dt;if(readyGameSeconds>=60)ready=readyStart;}else{ready=null;readyStart=null;readyGameSeconds=0;}
   const engaged=safe||attrition&&game(at)+dt*step<60;
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
     // Conservatively expose every member throughout the clash tail, including non-pulse work.
     deaths+=members.reduce((sum,m)=>sum+.35*(p*.005+(1-p)*.01)/Math.pow(m.def,.6),0)*e;
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
 return {power,territory,minTerritory,minPower,deaths,readySeconds:ready,ticks,clashChance:probability,rivals:rivals.map(r=>({name:r.name,power:r.power,territory:r.territory}))};
}
export function planGangAttrition(input){
 const no=reason=>({engage:false,reason});const {w,cumulative,members}=input||{};
 if(!w?.powerPriority||members?.length!==12||!Array.isArray(cumulative)||!cumulative.length||cumulative.at(-1)?.at<2060||w.rivals?.some(r=>!Number.isFinite(r.samples)||r.samples<3)||w.rivals?.some(r=>w.power/(w.power+r.power)<.65))return no('Attrition needs fresh strong observations and a full development horizon');
 const scenarios=[.5,1,2].map(rivalGrowthScale=>{
  const wait=simulateGangAttrition({...input,rivalGrowthScale,attrition:false}),fight=simulateGangAttrition({...input,rivalGrowthScale,attrition:true});
  if(!wait||!fight)return {rivalGrowthScale,engage:false,reason:'Forecast incomplete'};
  const extraDeaths=Math.max(0,fight.deaths-wait.deaths),casualtyCost=extraDeaths*21600;
  const before=wait.readySeconds??cumulative.at(-1).at,after=fight.readySeconds;
  const saved=after===null?0:before-after,required=Math.max(60,before*.2)+casualtyCost;
  const engage=after!==null&&saved>=required&&fight.deaths<=.02&&extraDeaths<=.005&&fight.minTerritory>=w.territory-.001&&fight.territory>=wait.territory-.001&&fight.minPower>=w.power*.9&&fight.power>=wait.power*.85;
  return {rivalGrowthScale,engage,wait,fight,extraDeaths,casualtyCostSeconds:casualtyCost,savedSeconds:saved};
 });
 const base=scenarios[1],engage=scenarios.every(s=>s.engage);
 // Only the next complete native interval is scored; keep its forecast small and bounded.
 const bonus=Math.max(0,input.bonusSeconds||0),wallSeconds=Math.max(.8,20-bonus);
 const point=cumulative.find(p=>p.at>=wallSeconds),previous=[{at:0,power:w.power},...cumulative].filter(p=>p.at<wallSeconds).at(-1);
 const power=point&&previous?previous.power+(point.power-previous.power)*(wallSeconds-previous.at)/(point.at-previous.at):NaN;
 const nextTick=scenarios.map(s=>simulateGangAttrition({...input,rivalGrowthScale:s.rivalGrowthScale,attrition:true,cumulative:[{at:wallSeconds,power}]}));
 const observationForecast=nextTick.every(Boolean)?{wallSeconds,expected:nextTick.map((v,i)=>({rivalGrowthScale:scenarios[i].rivalGrowthScale,power:v.power,territory:v.territory,rivals:v.rivals}))}:null;
 return {...base,engage,reason:engage?'Attrition passes slow, baseline and fast rival-growth scenarios':'Waiting or training is preferable in at least one rival-growth scenario',scenarios,observationForecast};
}
/** Diagnostic only: net changes include random NPC clashes and do not establish causation. */
export function observeGangAttrition(lease,cycle,scope,history=[]){
 const forecast=lease?.observationForecast;
 if(!forecast||lease.ownerPid!==scope.ownerPid||lease.nodeReset!==scope.nodeReset||lease.augReset!==scope.augReset||lease.faction!==cycle?.info?.faction)return null;
 if(!Number.isFinite(lease.startedAt)||!Number.isFinite(cycle.at)||cycle.at<=lease.startedAt||!Number.isFinite(forecast.wallSeconds)||forecast.wallSeconds<=0||!Array.isArray(forecast.expected)||forecast.expected.length!==3)return null;
 const key=[lease.ownerPid,lease.nodeReset,lease.augReset,lease.startedAt].join(':');
 const previous=Array.isArray(history)?history.filter(r=>r&&r.nodeReset===scope.nodeReset&&r.augReset===scope.augReset).slice(-63):[];
 if(previous.some(r=>r.key===key))return null;
 const elapsed=(cycle.at-lease.startedAt)/1000,matched=Math.abs(elapsed-forecast.wallSeconds)<=Math.max(.2,forecast.wallSeconds*.2);
 const valid=v=>v&&Number.isFinite(v.power)&&v.power>0&&Number.isFinite(v.territory)&&v.territory>=0&&v.territory<=1;
 if(!valid(cycle.info)||forecast.expected.some(v=>!valid(v)||!Array.isArray(v.rivals)||v.rivals.some(r=>!valid(r))))return null;
 const range=values=>({min:Math.min(...values),max:Math.max(...values)});
 const compare=(actual,expected)=>({actual,expected:range(expected),errorFromBaseline:actual-expected[1],insideRange:actual>=Math.min(...expected)&&actual<=Math.max(...expected)});
 const expected=forecast.expected,actualRivals=Object.entries(cycle.others||{}).filter(([n,v])=>n!==cycle.info.faction&&v.territory>0);
 const sameRivals=expected.every(v=>v.rivals.length===actualRivals.length&&actualRivals.every(([name,r])=>valid(r)&&v.rivals.some(x=>x.name===name)));
 const scored=matched&&sameRivals;
 const row={key,...scope,at:cycle.at,elapsedSeconds:elapsed,scored,reason:scored?'Net outcome; stochastic clashes, not causal attribution':!matched?'Partial, missed or delayed native interval':'Active rival set changed',
  ...(scored?{power:compare(cycle.info.power,expected.map(v=>v.power)),territory:compare(cycle.info.territory,expected.map(v=>v.territory)),rivals:actualRivals.map(([name,r])=>({name,power:compare(r.power,expected.map(v=>v.rivals.find(x=>x.name===name).power)),territory:compare(r.territory,expected.map(v=>v.rivals.find(x=>x.name===name).territory))}))}:{})};
 return [...previous,row];
}

/** Native gate. This guard and the state write run synchronously immediately before engagement. */
export function startGangAttrition(ns,q,allowed){
 try{
  const now=Date.now(),r=ns.getResetInfo(),g=ns.gang.getGangInformation();
  if(!q?.engage||![q.power,q.territory].every(Number.isFinite)||q.power<=0||q.territory<=0||q.territory>=1||typeof q.signature!=='string'||!q.signature||typeof allowed!=='function'||!allowed()||q.ownerPid!==ns.args[0]||!ns.isRunning(q.ownerPid)||q.nodeReset!==r.lastNodeReset||q.augReset!==r.lastAugReset||!Number.isFinite(q.at)||q.at>now||now-q.at>2000||!Number.isFinite(q.deadline)||q.deadline<=now||q.deadline>now+22000||g.faction!==q.faction||g.territoryWarfareEngaged||g.territoryClashChance!==0||!Number.isFinite(g.power)||g.power<q.power*.99||g.power>q.power*1.01||Math.abs(g.territory-q.territory)>.0001)return false;
  let old;try{old=JSON.parse(ns.read('tasks/gang-attrition.json'));}catch{}
  if(old?.nodeReset===r.lastNodeReset&&old.augReset===r.lastAugReset&&(old.state==='active'||!Number.isFinite(old.cooldownUntil)||old.cooldownUntil>now))return false;
  const names=ns.gang.getMemberNames();if(names.length!==12)return false;
  const members=names.map(name=>ns.gang.getMemberInformation(name));
  const signature=JSON.stringify(members.map(m=>[m.name,m.def,...['hack','str','def','dex','agi','cha'].map(k=>m[k+'_exp']),m.upgrades,m.augmentations]).sort((a,b)=>a[0].localeCompare(b[0])));
  if(signature!==q.signature||!Array.isArray(q.rivals)||!q.rivals.length||q.rivals.some(r=>typeof r.name!=='string'||!Number.isFinite(r.power)||r.power<=0))return false;
  const rivals=Object.entries(ns.gang.getAllGangInformation()).filter(([name,v])=>name!==g.faction&&v.territory>0);
  if(rivals.length!==q.rivals.length||rivals.some(([name,v])=>{const before=q.rivals.find(x=>x.name===name);return !before||!Number.isFinite(v.power)||v.power>before.power*1.01||v.power<before.power*.99||g.power/(g.power+v.power)<.65;}))return false;
  const state={schemaVersion:1,faction:g.faction,observationForecast:q.observationForecast,state:'active',ownerPid:q.ownerPid,nodeReset:r.lastNodeReset,augReset:r.lastAugReset,startedAt:now,deadline:q.deadline,cooldownUntil:now+45*60000};
  ns.write('tasks/gang-attrition.json',JSON.stringify(state),'w');ns.gang.setTerritoryWarfare(true);return true;
 }catch{return false;}
}
/** Stop on the first observed territory update or lease expiry; disabling leaves a residual clash tail. */
export function stopGangAttrition(ns,observed,disabled=false){
 try{const q=JSON.parse(ns.read('tasks/gang-attrition.json')),r=ns.getResetInfo();
  if(q.state!=='active'||q.nodeReset!==r.lastNodeReset||q.augReset!==r.lastAugReset)return false;
  if(!disabled&&!observed&&Date.now()<q.deadline&&ns.isRunning(q.ownerPid))return false;
  ns.gang.setTerritoryWarfare(false);ns.write('tasks/gang-attrition.json',JSON.stringify({...q,state:'cooldown',stoppedAt:Date.now()}),'w');return true;
 }catch{return false;}
}
