import {simulateGangAttrition,gangAttritionCalibration,gangMonitorBackoff} from './gang-attrition-policy.js';

/** Authorize a short 68% interval only against conservative 70% counterfactuals.
 * 600 forced game seconds cover a five-second proof at maximum bonus processing
 * plus the ten-second supervisor cadence and processing margin. 2700 game seconds include its full decay tail.
 * Holding current crew power gain fixed avoids assuming future training wins. */
export function planGangAggression({w,members,participants,excluded=[],powerPerTick,powerFraction=1,bonusSeconds=0,calibration,monitorHealth}={}){
 const no=reason=>({engage:false,reason});
 if(calibration?.known!==true||calibration.suspended||monitorHealth?.known!==true||monitorHealth.suspended)return no('Calibration or monitor health not ready');
 if(!w?.active||!w.powerPriority||w.engageThreshold!==.7||!Array.isArray(members)||members.length!==12||!Array.isArray(participants)||!participants.length||!Array.isArray(excluded)||!Number.isFinite(powerPerTick)||powerPerTick<0||!Number.isFinite(powerFraction)||powerFraction<0||powerFraction>1||!Number.isFinite(bonusSeconds)||bonusSeconds<0||!Array.isArray(w.rivals)||!w.rivals.length||w.rivals.some(r=>!Number.isFinite(r.samples)||r.samples<0||w.power/(w.power+r.power)<.68))return no('Fresh full-crew evidence and 68% odds required');
 const names=members.map(m=>m.name),maxDefense=Math.max(...members.map(m=>m.def));
 if(new Set(names).size!==12||members.some(m=>typeof m.name!=='string'||!m.name||!Number.isFinite(m.def)||m.def<=0)||new Set(excluded).size!==excluded.length||excluded.some(n=>!names.includes(n))||w.rivals.length>6||new Set(w.rivals.map(r=>r.name)).size!==w.rivals.length||w.rivals.some(r=>typeof r.name!=='string'||!r.name||!Number.isFinite(r.power)||r.power<=0||!Number.isFinite(r.territory)||r.territory<=0)||Math.abs(w.territory+w.rivals.reduce((sum,r)=>sum+r.territory,0)-1)>1e-9)return no('Inconsistent crew or territory snapshot');
 const eligible=members.filter(m=>!excluded.includes(m.name)&&m.def>=100&&m.def>=Math.min(10000,maxDefense*.1)).map(m=>m.name).sort();
 if(JSON.stringify(eligible)!==JSON.stringify([...participants].sort()))return no('Incomplete eligible exposure set');
 const wall=seconds=>seconds-Math.min(bonusSeconds,seconds*24/25);
 const cumulative=Array.from({length:135},(_,i)=>({at:wall((i+1)*20),power:w.power+(i+1)*powerPerTick}));
 // Clash losses can erase clean growth samples. Use native NPC gain bounds too,
 // rather than mistaking a missing clean sample for zero growth.
 const bounded={...w,rivals:w.rivals.map(r=>({...r,highRate:Math.max(Number.isFinite(r.highRate)?r.highRate:0,Math.max(.85,.75*5*r.territory)/20)}))};
 const input={w:bounded,cumulative,members,participants,powerFraction,bonusSeconds};
 const scenarios=[.5,1,2].map(rivalGrowthScale=>{
  const wait=simulateGangAttrition({...input,rivalGrowthScale,attrition:false}),fight=simulateGangAttrition({...input,rivalGrowthScale,attrition:true,attritionGameSeconds:600});
  if(!wait||!fight)return {rivalGrowthScale,engage:false};
  const extraDeaths=Math.max(0,fight.deaths-wait.deaths);
  const engage=fight.deaths<=.02&&extraDeaths<=.005&&fight.minTerritory>=w.territory-.001&&fight.territory>wait.territory&&fight.minPower>=w.power*.9&&fight.power>=wait.power*.85;
  return {rivalGrowthScale,engage,wait,fight,extraDeaths};
 });
 return {engage:scenarios.every(s=>s.engage),reason:scenarios.every(s=>s.engage)?'68% interval and full residual tail pass every scenario':'Retaining ordinary threshold; aggression fails a risk scenario',targetThreshold:.68,baselineThreshold:.7,power:w.power,territory:w.territory,rivals:w.rivals.map(r=>({name:r.name,power:r.power,territory:r.territory})),members:members.map(m=>({name:m.name,def:m.def})),participants,excluded,scenarios};
}

/** Self-contained native validation of producer evidence and current live state. */
export function validateGangAggression(ns,ownerPid,now=Date.now(),calibrate=null,health=null){
 const no=reason=>({valid:false,reason});
 try{
  const read=path=>JSON.parse(ns.read(path)||'null'),q=read('tasks/gang-aggression.json'),r=ns.getResetInfo(),g=ns.gang.getGangInformation();
  if(!q?.engage||q.schemaVersion!==1||q.ownerPid!==ownerPid||!ns.isRunning(ownerPid)||q.nodeReset!==r.lastNodeReset||q.augReset!==r.lastAugReset||q.faction!==g.faction||q.targetThreshold!==.68||q.baselineThreshold!==.7||!Number.isFinite(q.at)||q.at>now||q.at<r.lastAugReset||q.expiresAt!==q.at+5000||q.expiresAt<=now)return no('expired-or-foreign-proof');
  const supervisor=read('tasks/gang-aggression-guard.json');
  if(supervisor?.schemaVersion!==1||supervisor.available!==true||supervisor.nodeReset!==r.lastNodeReset||supervisor.augReset!==r.lastAugReset||!Number.isFinite(supervisor.at)||supervisor.at>now||now-supervisor.at>15000||!ns.isRunning(supervisor.ownerPid))return no('supervisor-not-ready');
  if(typeof calibrate!=='function'||typeof health!=='function')return no('guards-unavailable');
  const scope={nodeReset:r.lastNodeReset,augReset:r.lastAugReset,faction:g.faction};
  const observations=ns.read('tasks/gang-attrition-observations.json'),attempts=ns.read('tasks/gang-attrition-attempts.json');
  const a=calibrate(observations?JSON.parse(observations):[],scope,now),b=health(attempts?JSON.parse(attempts):[],scope,now);
  if(a.known!==true||a.suspended||b.known!==true||b.suspended)return no('health-or-calibration');
  if(![q.power,q.territory,g.power,g.territory].every(Number.isFinite)||q.power<=0||g.power<q.power*.99||g.power>q.power*1.01||q.territory<=0||q.territory>=1||Math.abs(g.territory-q.territory)>.001)return no('gang-state-changed');
  if(!Array.isArray(q.scenarios)||q.scenarios.length!==3)return no('incomplete-risk-proof');
  for(let i=0;i<3;i++){
   const s=q.scenarios[i],f=s?.fight,w=s?.wait;
   if(s?.rivalGrowthScale!==[.5,1,2][i]||s.engage!==true||![f?.deaths,f?.minTerritory,f?.territory,f?.minPower,f?.power,w?.deaths,w?.territory,w?.power,s?.extraDeaths].every(Number.isFinite)||f.deaths<0||w.deaths<0||f.deaths>.02||f.power<=0||w.power<=0||f.territory>1||w.territory<0||w.territory>1||f.minTerritory<0||f.minPower<=0||s.extraDeaths<Math.max(0,f.deaths-w.deaths)||s.extraDeaths>.005||f.minTerritory<q.territory-.001||f.territory<=w.territory||f.minPower<q.power*.9||f.power<w.power*.85)return no('risk-limit');
  }
  const rivals=Object.entries(ns.gang.getAllGangInformation()).filter(([name,v])=>name!==g.faction&&v.territory>0);
  if(!Array.isArray(q.rivals)||!q.rivals.length||new Set(q.rivals.map(v=>v.name)).size!==q.rivals.length||rivals.length!==q.rivals.length||rivals.some(([name,v])=>{const before=q.rivals.find(p=>p.name===name);return !before||!Number.isFinite(v.power)||v.power<=0||!Number.isFinite(before.power)||before.power<=0||v.power<before.power*.99||v.power>before.power*1.01||g.power/(g.power+v.power)<.68;}))return no('rival-state-changed');
  const names=ns.gang.getMemberNames();
  if(names.length!==12||!Array.isArray(q.members)||q.members.length!==12||new Set(q.members.map(m=>m.name)).size!==12||!Array.isArray(q.participants)||!q.participants.length||new Set(q.participants).size!==q.participants.length||!Array.isArray(q.excluded)||q.excluded.some(n=>!names.includes(n)))return no('crew-changed');
  const crew=names.map(n=>ns.gang.getMemberInformation(n));
  if(crew.some(m=>{const before=q.members.find(v=>v.name===m.name);return !before||!Number.isFinite(before.def)||before.def<=0||!Number.isFinite(m.def)||m.def<before.def;}))return no('crew-weakened');
  const maxDefense=Math.max(...crew.map(m=>m.def)),eligible=crew.filter(m=>!q.excluded.includes(m.name)&&m.def>=100&&m.def>=Math.min(10000,maxDefense*.1)).map(m=>m.name).sort();
  if(JSON.stringify(eligible)!==JSON.stringify([...q.participants].sort())||crew.some(m=>m.task==='Territory Warfare'&&!q.participants.includes(m.name)))return no('participant-set-changed');
  return {valid:true,reason:'fresh-68-percent-proof',threshold:.68,expiresAt:q.expiresAt};
 }catch{return no('unavailable-or-malformed-proof');}
}

export function gangAggressionGuardSource(){
 return `(ns,owner,now)=>(${validateGangAggression.toString()})(ns,owner,now,(${gangAttritionCalibration.toString()}),(${gangMonitorBackoff.toString()}))`;
}
