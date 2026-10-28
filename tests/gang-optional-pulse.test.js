import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessGangTraineePulse,gangTraineePulse,selectGangTraineePulses} from '../gang-power-policy.js';
import {applyGangWorkOrders,gangPulseObservation,warfareDecision,projectGangMember,gangWarfareContext,gangWarfareMemberEligible} from '../gang-policy.js';
import {validateGangTraineePulse} from '../gang-pulse-policy.js';
const keys=['hack','str','def','dex','agi','cha'];
const task={name:'Train Combat',difficulty:100,strWeight:25,defWeight:25,dexWeight:25,agiWeight:25,hackWeight:0,chaWeight:0};
const strong=(name='M')=>projectGangMember({name,task:'Train Combat',...Object.fromEntries(keys.flatMap(k=>[[k+'_exp',1e8],[k+'_mult',10],[k+'_asc_mult',1000]])),upgrades:[],augmentations:[]},null,0);
const w={active:true,power:10000,territory:.3,threshold:.75,clashChance:1,powerPriority:true,powerFocus:true,rivals:[{name:'R',power:100,territory:.7}],duty:{normalFraction:.1,bonusFraction:.25}};

test('exposed optional pulse pays for lost training and bounds expected deaths independently',()=>{
 const m=strong(),r=assessGangTraineePulse(m,task,w,3600,0,projectGangMember);
 assert.equal(r.allowed,true);assert.equal(gangTraineePulse(m,task,w,3600,0,projectGangMember),true);
 const deaths=188*2*.35*.01/Math.pow(m.def,.6);assert.ok(Math.abs(r.expectedDeaths-deaths)<1e-14);assert.ok(r.expectedDeaths<=.005);
 // Native normal batch is ten 200ms cycles. Count a full missed batch per pulse.
 const loss=keys.reduce((sum,k)=>{const delta=(task[k+'Weight']/1500)*Math.pow(100,.9)*10*((m[k+'_mult']-1)/4+1)*m[k+'_asc_mult'];return sum+Math.ceil(m[k+'_mult']*m[k+'_asc_mult']*32*Math.log((m[k+'_exp']+delta+534.5)/(m[k+'_exp']+534.5))-1e-12);},0)*180;
 assert.equal(r.trainingLoss,loss);assert.ok(r.stats>loss*1.25);
});
test('weak defense, weak odds, invalid data, excessive duty and expensive training reject pulses',()=>{
 const m=strong();
 for(const patch of [{power:100},{powerPriority:false},{powerFocus:false},{rivals:[]},{rivals:[{power:NaN,territory:.7}]},{clashChance:NaN},{duty:{normalFraction:.51,bonusFraction:.8}}])assert.equal(gangTraineePulse(m,task,{...w,...patch},3600,0,projectGangMember),false);
 assert.equal(gangTraineePulse({...m,def:1000},task,w,3600,0,projectGangMember),false);
 for(const [h,b] of [[0,0],[Infinity,0],[3600,NaN],[3600,-1]])assert.equal(gangTraineePulse(m,task,w,h,b,projectGangMember),false);
 const expensive=projectGangMember({name:'M',...Object.fromEntries(keys.flatMap(k=>[[k+'_exp',0],[k+'_mult',1],[k+'_asc_mult',1]]))},null,0);
 assert.equal(gangTraineePulse(expensive,task,{...w,clashChance:0},3600,0,projectGangMember),false);
});
test('pulse costs count all displaced batches and retain normal costs after bonus exhaustion',()=>{
 const m=strong(),base=assessGangTraineePulse(m,task,w,3600,0,projectGangMember);
 const slow={...w,duty:{normalFraction:.3,bonusFraction:.25}};
 const normal=assessGangTraineePulse(m,task,slow,3600,0,projectGangMember);
 assert.equal(normal.missedBatches,3);assert.equal(normal.trainingLoss,base.trainingLoss*3);
 const transition=assessGangTraineePulse(m,task,slow,3600,1,projectGangMember);
 const allBonus=assessGangTraineePulse(m,task,slow,3600,1e6,projectGangMember);
 assert.equal(transition.missedBatches,3);assert.ok(transition.trainingLoss>=normal.trainingLoss);assert.equal(allBonus.missedBatches,1);
});
test('one exposed slot shares the full risk allowance; zero exposure keeps useful candidates',()=>{
 const members={A:strong('A'),B:strong('B')};members.B.def*=2;
 assert.deepEqual(selectGangTraineePulses({A:true,B:true},members,w),{A:false,B:true});
 assert.deepEqual(selectGangTraineePulses({A:true,B:true},members,{...w,clashChance:0}),{A:true,B:true});
 assert.deepEqual(selectGangTraineePulses({A:false,B:false},members,w),{A:false,B:false});
 const earlier=assessGangTraineePulse(members.B,task,{...w,pulseRiskGameSeconds:90000},60,0,projectGangMember);
 assert.equal(earlier.riskGameSeconds,90000);assert.ok(earlier.expectedDeaths>assessGangTraineePulse(members.B,task,w,60,0,projectGangMember).expectedDeaths);
});

function fixture(){
 const now=Date.now(),m=strong(),other=strong('N'),g={faction:'Own',power:10000,territory:.3,territoryWarfareEngaged:true,territoryClashChance:1},events=[];
 other.task='Work';
 const episode={growthFirst:true,startedAt:now-1000,until:now+60000,resetAt:0,task:'Train Combat'};
 const files={'tasks/gang-training.json':{ownerPid:7,at:now,nodeReset:1,augReset:2,members:{M:0},episodes:{M:episode},ascensionRecoveries:{}},
  'tasks/gang-warfare-lease.json':{ownerPid:7,at:now,expiresAt:now+60000,nodeReset:1,augReset:2,faction:'Own',tasks:{M:'Train Combat'}},
  'tasks/gang-aggression-guard.json':{ownerPid:8,at:now,nodeReset:1,augReset:2},'gangs.js.config.txt':[]};
 const assessment=assessGangTraineePulse(m,task,w,3600,0,projectGangMember);
 const quote={version:1,ownerPid:7,at:now,expiresAt:now+1000,targetTickAt:now+1000,nodeReset:1,augReset:2,name:'M',task:'Train Combat',episodeUntil:episode.until,faction:'Own',power:g.power,territory:g.territory,member:{...m},...assessment};
 const order={name:'M',task:'Territory Warfare',trainingPulse:true,pulseQuote:quote};
 const ns={read:p=>JSON.stringify(files[p]??null),getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),isRunning:p=>[7,8].includes(p),gang:{
  getGangInformation:()=>({...g}),getAllGangInformation:()=>({Own:{power:g.power,territory:.3},R:{power:100,territory:.7}}),getMemberNames:()=>['M','N'],getMemberInformation:n=>n==='M'?m:other,
  setMemberTask:(n,t)=>{events.push([n,t]);(n==='M'?m:other).task=t;return true;}}};
 const native=Function('return ('+validateGangTraineePulse.toString()+')')();
 return {ns,now,m,other,g,files,quote,order,events,check:()=>native(ns,order,7,now),native};
}
test('serialized native guard admits a fresh optional pulse under independent supervision',()=>{
 const f=fixture(),r=f.check();assert.equal(r.valid,true);assert.ok(r.expectedDeaths<=.005);
 const native=Function('return ('+applyGangWorkOrders.toString()+')')();
 const applied=native(f.ns,[f.order],()=>true,7,f.native);assert.equal(applied.assigned,1);assert.deepEqual(f.events,[['M','Territory Warfare']]);
});
test('native execution rejects stale, malformed, foreign, unavailable and unsupervised evidence',()=>{
 for(const change of [f=>f.quote.at=f.now+1,f=>f.quote.expiresAt=f.now,f=>f.quote.targetTickAt=f.now+4000,f=>f.quote.nodeReset=9,f=>f.quote.ownerPid=9,f=>f.quote.power=100,f=>f.quote.territory=.1,
  f=>delete f.files['tasks/gang-training.json'],f=>f.files['tasks/gang-training.json'].ownerPid=9,f=>f.files['tasks/gang-warfare-lease.json'].expiresAt=f.now,f=>f.files['tasks/gang-aggression-guard.json'].at=f.now-15001,
  f=>f.ns.gang.getAllGangInformation=()=>{throw Error('API unavailable');},f=>f.ns.gang.getAllGangInformation=()=>({R:{power:100000,territory:.7}}),f=>f.quote.riskGameSeconds=1,f=>f.quote.riskGameSeconds=Infinity,f=>f.quote.trainingLoss=Infinity]){
  const f=fixture();change(f);assert.equal(f.check().valid,false);assert.deepEqual(f.events,[]);
 }
});
test('manual work, mandatory training, recovery, changed tasks and another exposed trainee remain protected',()=>{
 for(const change of [f=>f.files['gangs.js.config.txt']={'manual-task-overrides':'{"M":"Train Combat"}'},f=>f.files['gangs.js.config.txt']={'disable-adaptive-growth':true},f=>f.files['gangs.js.config.txt']={'warfare-win-chance':.99999},
  f=>f.files['tasks/gang-training.json'].episodes.M.developmentCycle=true,f=>f.files['tasks/gang-training.json'].ascensionRecoveries.M={until:f.now+10000},f=>f.files['tasks/gang-training.json'].wantedPreparation={until:f.now+10000},
  f=>f.files['tasks/gang-training.json'].members.M=5,f=>f.m.task='Train Hacking',f=>f.m.def/=2,f=>{f.other.task='Territory Warfare';f.files['tasks/gang-training.json'].episodes.N={growthFirst:true};}]){
  const f=fixture();change(f);assert.equal(f.check().valid,false);
 }
});
test('rejecting an optional pulse does not prevent ordinary members from gaining power',()=>{
 const f=fixture();f.files['tasks/gang-training.json'].episodes.M.developmentCycle=true;
 const result=applyGangWorkOrders(f.ns,[f.order,{name:'N',task:'Territory Warfare'}],()=>true,7,f.native);
 assert.equal(result.deferred,false);assert.equal(result.assigned,1);assert.equal(result.skippedPulses[0].name,'M');assert.equal(f.m.task,'Train Combat');assert.deepEqual(f.events,[['N','Territory Warfare']]);
 const pulse={at:f.now-100,faction:'Own',power:100,territory:.3,predicted:1,expectedMembers:['M','N'],members:['N'],skippedPulses:result.skippedPulses};
 assert.equal(gangPulseObservation(pulse,{faction:'Own',power:101,territory:.3},{changed:true,at:f.now,faction:'Own'},f.now).state,'guard-declined');
 const another={...f.order,name:'X'};assert.equal(applyGangWorkOrders(f.ns,[f.order,another],()=>true,7,f.native).reason,'optional-pulse-slot');
});
test('the actual controller worker embeds the exposed-pulse validator and captures the resulting crew',async()=>{
 const f=fixture(),s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),a=s.indexOf('async function updateMemberActivities('),b=s.indexOf('\n/** @param {NS} ns',a);
 f.ns.pid=7;f.ns.print=()=>{};
 const run=Function('applyGangWorkOrders','validateGangTraineePulse','gangWarfareMemberEligible','getNsDataThroughFile',`let pendingPowerPulse=null;const assignedTasks={M:'Train Combat',N:'Work'},memberProtectedTask=n=>n==='M'?'Train Combat':null,gangMutationAllowed=()=>true,isHackGang=false,log=()=>{};${s.slice(a,b)};return async(ns,crew,g)=>{await updateMemberActivities(ns,crew,'Territory Warfare',g);return pendingPowerPulse;};`)(applyGangWorkOrders,validateGangTraineePulse,gangWarfareMemberEligible,async(ns,code,path,args)=>{ns.args=args;return Function('ns','return '+code)(ns);});
 const pulse=await run(f.ns,{M:f.m,N:f.other},{...f.g,pulseTraining:{M:true},traineePulseQuote:f.quote});
 assert.deepEqual(pulse.members,['M','N']);assert.deepEqual(pulse.expectedMembers,['M','N']);assert.ok(pulse.predicted>0);
});
test('live preparation uses an atomic fresh snapshot and excludes mandatory or manually assigned trainees',async()=>{
 const f=fixture(),s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),a=s.indexOf('async function prepareGangPowerPulse('),b=s.indexOf('\n}',a)+2;
 const create=Function('getNsDataThroughFile','updateMemberActivities','gangWarfareContext','gangTraineePulse','assessGangTraineePulse','selectGangTraineePulses','projectGangMember','episodes','recovery','manual',`const myGangMembers=['M','N'],resetInfo={lastNodeReset:1,lastAugReset:2},options={'power-focus':true,manualTasks:manual},activeWantedPreparation=()=>false,ascensionRecoveries=recovery,lastMemberReset={M:0,N:0},trainingEpisodes=episodes,allTaskStats={'Train Combat':${JSON.stringify(task)}},growthHorizon={seconds:3600,bonusSeconds:0},gangWarfareThreshold=()=>.7,gangTrainingFirst=()=>true,territoryTickDetected=true,territoryTickWaitPadding=200,updateInterval=200,postTickRestoreMs=0,territoryTickTime=20000,incomeFunding=null;let territoryNextTick=Date.now()+1000;${s.slice(a,b)};return prepareGangPowerPulse;`);
 for(const mode of ['optional','development','recovery','manual']){
  let applied;const written={},episode={...f.files['tasks/gang-training.json'].episodes.M,...(mode==='development'?{developmentCycle:true}:{})};
  const ns={...f.ns,pid:7,write:async(p,v)=>written[p]=JSON.parse(v)};
  const fn=create(async(ns,code,path,args)=>{assert.equal(path,'/Temp/gang-pulse-snapshot.txt');ns.args=args;return Function('ns','return '+code)(ns);},async(ns,crew,task,g)=>applied=g,gangWarfareContext,gangTraineePulse,assessGangTraineePulse,selectGangTraineePulses,projectGangMember,{M:episode},mode==='recovery'?{M:{until:f.now+10000}}:{},mode==='manual'?{M:'Train Combat'}:{});
  await fn(ns,{...f.g,power:1,territoryWarfareEngaged:false});
  assert.equal(applied.power,10000);assert.equal(applied.territoryWarfareEngaged,true);
  assert.equal(applied.pulseTraining.M,mode==='optional');assert.ok(written['tasks/gang-trainee-pulse.json']);
  if(mode==='optional'){assert.equal(applied.traineePulseQuote.name,'M');assert.equal(applied.traineePulseQuote.power,10000);}else assert.equal(applied.traineePulseQuote,null);
 }
});
test('positive cohort return cannot bypass a weak-opponent engagement floor',()=>{
 const rivals=Object.fromEntries([10,10,10,10,10,2/3].map((ratio,i)=>['R'+i,{power:100/ratio,territory:.8/6}]));
 const d=warfareDecision({faction:'Own',power:100,territory:.2},rivals,.7);
 assert.equal(d.minimum,.4);assert.equal(d.engage,false);assert.equal(d.cohortProfitable,true);assert.equal(d.blockedByWorstOpponent,true);
 const expected=(5*((10/11)*.0001*(1+Math.log(10)/Math.log(50))-(1/11)*.0001)+(.4*.0001-.6*.0001*(1+Math.log(1.5)/Math.log(50))))/3;
 assert.ok(Math.abs(d.expectedTerritoryPerUpdate-expected)<1e-15);
});
test('capped transfer mean matches independent numerical integration at the last sliver',()=>{
 const power=300,other=100,tiny=.0001,own=.9999;
 const d=warfareDecision({faction:'Own',power,territory:own},{R:{power:other,territory:tiny}},.7);
 let mean=0;const n=100000;for(let i=0;i<n;i++){const u=.5+(i+.5)/n;mean+=.75*Math.min(tiny,.0001*(1+Math.log(3)/Math.log(50))*u)-.25*Math.min(own,.0001*u);}
 assert.ok(Math.abs(d.expectedTerritoryPerUpdate-2*mean/n)<1e-13);
});
