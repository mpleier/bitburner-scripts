import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planGangAggression,validateGangAggression,gangAggressionGuardSource} from '../gang-aggression-policy.js';
import {gangAttritionCalibration,gangMonitorBackoff,gangAttritionCooldown,startGangAttrition,gangAttritionSignature,simulateGangAttrition} from '../gang-attrition-policy.js';
import {guardGangWarfare} from '../gang-safety-policy.js';
import {gangWarfarePowerPerTick,gangWarfareMemberEligible,warfareDecision} from '../gang-policy.js';
const now=100000;
function input(){const members=Array.from({length:12},(_,i)=>({name:'M'+i,def:1e6,task:'Train Combat',upgrades:[],augmentations:[]}));return {w:{active:true,powerPriority:true,power:32000,territory:1/7,threshold:.75,engageThreshold:.7,rivals:[.3,.45,.6,.7,.85,1].map((x,i)=>({name:'R'+i,power:14647*x,territory:1/7,highRate:.05,samples:0}))},members,participants:members.map(m=>m.name),excluded:[],powerPerTick:80,powerFraction:1,bonusSeconds:0,calibration:{known:true,suspended:false},monitorHealth:{known:true,suspended:false}};}
function fixture(){
 const data=input(),q={schemaVersion:1,ownerPid:7,nodeReset:1,augReset:2,faction:'Own',at:now,expiresAt:now+5000,...planGangAggression(data)},g={faction:'Own',power:data.w.power,territory:data.w.territory,territoryWarfareEngaged:true,territoryClashChance:1};
 const files={'tasks/gang-aggression.json':q,'tasks/gang-aggression-guard.json':{schemaVersion:1,available:true,ownerPid:5,nodeReset:1,augReset:2,at:now},'tasks/gang-attrition-observations.json':[],'tasks/gang-attrition-attempts.json':[],'tasks/gang-warfare-lease.json':{ownerPid:7,nodeReset:1,augReset:2,faction:'Own',at:now-1000,expiresAt:now+59000,conditionalAggression:true,tasks:{}}},calls=[];
 const ns={args:[7],pid:9,read:p=>typeof files[p]==='string'?files[p]:JSON.stringify(files[p]??null),write:(p,v)=>files[p]=v,isRunning:pid=>[5,7,11].includes(pid),getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),ps:()=>[{pid:7,filename:'gangs.js'},{pid:5,filename:'reliability-manager.js'}],gang:{inGang:()=>true,getGangInformation:()=>g,getAllGangInformation:()=>({Own:g,...Object.fromEntries(data.w.rivals.map(r=>[r.name,r]))}),getMemberNames:()=>data.members.map(m=>m.name),getMemberInformation:n=>data.members.find(m=>m.name===n),setTerritoryWarfare:v=>{calls.push(v);g.territoryWarfareEngaged=v;},getTaskNames:()=>['Train Combat','Territory Warfare'],setMemberTask:()=>{throw Error('No manual tasks to restore');}}};
 return {data,q,g,files,ns,calls};
}
const validate=(f,t=now)=>validateGangAggression(f.ns,7,t,gangAttritionCalibration,gangMonitorBackoff);
test('strong crew may enter at 68% while the 75% preparation threshold stays intact',()=>{
 const data=input(),q=planGangAggression(data);assert.equal(q.engage,true);assert.equal(q.targetThreshold,.68);assert.equal(data.w.threshold,.75);
 assert.deepEqual(q.scenarios.map(s=>s.rivalGrowthScale),[.5,1,2]);assert.ok(q.scenarios.every(s=>s.engage&&s.fight.deaths<=.02&&s.extraDeaths<=.005&&s.fight.minPower>=data.w.power*.9));
});
test('weak crews, low odds, missing context and explicit higher thresholds retain normal entry',()=>{
 for(const mutate of [x=>x.members.forEach(m=>m.def=100),x=>x.w.power=28000,x=>x.w.active=false,x=>x.w.engageThreshold=.8,x=>x.calibration.suspended=true,x=>x.monitorHealth.known=false,x=>x.participants=[],x=>x.powerPerTick=NaN,x=>x.members.pop()]){
  const data=input();mutate(data);assert.equal(planGangAggression(data).engage,false);
 }
 assert.equal(planGangAggression({...input(),powerPerTick:0}).engage,false);
});
test('source-bounded NPC growth supports missing clean samples and includes a full residual tail',()=>{
 const a=input(),b=input();b.w.rivals.forEach(r=>{r.samples=3;r.highRate=0;});
 const first=planGangAggression(a),second=planGangAggression(b);assert.equal(first.engage,true);assert.equal(second.engage,true);
 assert.equal(first.scenarios[0].fight.ticks>=135,true);assert.equal(first.scenarios[0].fight.territory>first.scenarios[0].wait.territory,true);
 const f={...a,cumulative:[{at:20,power:a.w.power+80}],attrition:true};
 for(const attritionGameSeconds of [-1,601,NaN])assert.equal(simulateGangAttrition({...f,attritionGameSeconds}),null);
});
test('native quote validation and generated guard are self-contained and accept fresh evidence',()=>{
 const f=fixture();assert.equal(validate(f).valid,true);
 const check=Function('return ('+gangAggressionGuardSource()+')')();assert.equal(check(f.ns,7,now).valid,true);
 assert.deepEqual(f.calls,[]);
});
test('stale, foreign, malformed, and incomplete risk quotes cannot authorize lower entry',()=>{
 for(const patch of [{at:now+1},{expiresAt:now},{expiresAt:now+30000},{ownerPid:99},{nodeReset:3},{augReset:3},{faction:'Other'},{targetThreshold:.65},{engage:false},{scenarios:[]}]){
  const f=fixture();Object.assign(f.q,patch);assert.equal(validate(f).valid,false);
 }
 const f=fixture();f.q.scenarios[0].fight.deaths=.03;assert.equal(validate(f).valid,false);
 const bad=fixture();bad.q.scenarios[0].wait.power=-1;assert.equal(validate(bad).valid,false);
});
test('native checks reject changed power, cohorts, odds, weaker members and unquoted exposure',()=>{
 for(const mutate of [f=>f.g.power*=.98,f=>f.g.territory+=.002,f=>f.data.w.rivals[0].power*=.98,f=>f.data.w.rivals[0].territory=0,f=>f.data.members.pop(),f=>f.data.members[0].def--,f=>f.q.participants.pop(),f=>f.q.excluded.push('unknown')]){
  const f=fixture();mutate(f);assert.equal(validate(f).valid,false);
 }
 const f=fixture();f.data.members[0].def+=100;assert.equal(validate(f).valid,true);
});
test('missing supervisor capability and newly suspended health fail closed',()=>{
 for(const patch of [null,{schemaVersion:1,available:true,ownerPid:5,nodeReset:1,augReset:2,at:now-15001},{schemaVersion:1,available:false,ownerPid:5,nodeReset:1,augReset:2,at:now}]){const f=fixture();f.files['tasks/gang-aggression-guard.json']=patch;assert.equal(validate(f).valid,false);}
 const f=fixture();f.files['tasks/gang-attrition-attempts.json']='{bad';assert.equal(validate(f).valid,false);
 const g=fixture();assert.equal(validateGangAggression(g.ns,7,now,()=>({known:true,suspended:true}),gangMonitorBackoff).valid,false);
 assert.equal(validateGangAggression(g.ns,7,now,gangAttritionCalibration,()=>({known:true,suspended:true})).valid,false);
});
test('independent supervisor revokes expired or unavailable lower-threshold evidence',()=>{
 const f=fixture(),check=Function('return ('+gangAggressionGuardSource()+')')();
 assert.equal(guardGangWarfare(f.ns,now-1000,now,check).state,'healthy');assert.deepEqual(f.calls,[]);
 assert.equal(guardGangWarfare(f.ns,now-1000,now+20000,check).state,'suspended');assert.deepEqual(f.calls,[false]);
 const g=fixture();delete g.files['tasks/gang-aggression.json'];assert.equal(guardGangWarfare(g.ns,now-1000,now,check).state,'suspended');assert.deepEqual(g.calls,[false]);
});
test('ordinary 70% warfare remains available without an aggressive quote',()=>{
 const f=fixture();f.g.power=40000;delete f.files['tasks/gang-aggression.json'];assert.equal(guardGangWarfare(f.ns,now-1000,now).state,'healthy');assert.deepEqual(f.calls,[]);
});
test('a genuine monitored bounded attempt remains independent of continuous-entry proof',()=>{
 const f=fixture();f.files['tasks/gang-attrition.json']={state:'active',ownerPid:7,nodeReset:1,augReset:2,faction:'Own',startedAt:now-1000,deadline:now+21000,monitorRequired:true,monitorPid:11};
 assert.equal(guardGangWarfare(f.ns,now-1000,now).earlyAttempt,true);assert.deepEqual(f.calls,[]);
 f.files['tasks/gang-attrition.json'].monitorPid=12;assert.equal(guardGangWarfare(f.ns,now-1000,now).state,'suspended');
});
test('adaptive cooldown uses fresh bonus time with a two-minute floor',()=>{
 assert.equal(gangAttritionCooldown(0),2100000);assert.equal(gangAttritionCooldown(2000),2100000);assert.equal(gangAttritionCooldown(602000),1500000);assert.equal(gangAttritionCooldown(2102000),120000);assert.equal(gangAttritionCooldown(1e10),120000);
 for(const value of [-1,NaN,Infinity,'1000'])assert.equal(Number.isNaN(gangAttritionCooldown(value)),true);
});
test('native adaptive retries cannot bypass residual risk and preserve saved cooldowns',()=>{
 const f=fixture(),list=f.data.members,g=f.g;g.territoryWarfareEngaged=false;g.territoryClashChance=0;f.ns.gang.getBonusTime=()=>2102000;
 const at=Date.now(),q={engage:true,adaptiveCooldownRequired:true,ownerPid:7,nodeReset:1,augReset:2,faction:'Own',power:g.power,territory:g.territory,signature:gangAttritionSignature(list),at,deadline:at+20000,rivals:f.data.w.rivals};
 assert.equal(startGangAttrition(f.ns,q,()=>true,null,null,null,gangAttritionCooldown),true);
 const saved=JSON.parse(f.files['tasks/gang-attrition.json']);assert.equal(saved.cooldownMs,120000);
 g.territoryWarfareEngaged=false;g.territoryClashChance=.01;assert.equal(startGangAttrition(f.ns,q,()=>true,null,null,null,gangAttritionCooldown),false);
 assert.equal(JSON.parse(f.files['tasks/gang-attrition.json']).cooldownUntil,saved.cooldownUntil);
});
test('an expired cooldown still cannot bypass residual chance and invalid bonus APIs fail gracefully',()=>{
 const f=fixture();f.g.territoryWarfareEngaged=false;f.g.territoryClashChance=.01;
 f.files['tasks/gang-attrition.json']={ownerPid:7,nodeReset:1,augReset:2,state:'cooldown',cooldownUntil:0};
 const at=Date.now(),q={engage:true,adaptiveCooldownRequired:true,ownerPid:7,nodeReset:1,augReset:2,faction:'Own',power:f.g.power,territory:f.g.territory,signature:gangAttritionSignature(f.data.members),at,deadline:at+20000,rivals:f.data.w.rivals};
 f.ns.gang.getBonusTime=()=>2102000;assert.equal(startGangAttrition(f.ns,q,()=>true,null,null,null,gangAttritionCooldown),false);assert.deepEqual(f.calls,[]);
 f.g.territoryClashChance=0;f.ns.gang.getBonusTime=()=>NaN;assert.equal(startGangAttrition(f.ns,q,()=>true,null,null,null,gangAttritionCooldown),false);assert.deepEqual(f.calls,[]);
 f.ns.gang.getBonusTime=()=>{throw Error('Source File unavailable');};assert.equal(startGangAttrition(f.ns,q,()=>true,null,null,null,gangAttritionCooldown),false);assert.deepEqual(f.calls,[]);
});
test('the actual controller transaction can enable a freshly approved conditional quote',async t=>{
 t.mock.method(Date,'now',()=>now);const f=fixture();f.ns.pid=7;f.ns.print=()=>{};f.g.territoryWarfareEngaged=false;
 f.data.members.forEach(m=>Object.assign(m,{hack:10,str:10,dex:10,agi:10,cha:10}));
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('async function enableOrDisableWarfare('),end=source.indexOf('\n// Ram-dodging helper',start);
 const names=f.data.members.map(m=>m.name),members=Object.fromEntries(f.data.members.map(m=>[m.name,m]));
 const run=Function('gangMonitorBackoff','gangAttritionCalibration','warfareDecision','getNsDataThroughFile','planGangAggression','gangAggressionGuardSource','getGangInfoDict','gangWarfareContext','gangWarfarePowerPerTick','gangWarfareMemberEligible',`const resetInfo={lastNodeReset:1,lastAugReset:2},myGangFaction='Own',options={'aggressive-warfare':true,'power-focus':true,manualTasks:{}},myGangMembers=${JSON.stringify(names)},growthHorizon={bonusSeconds:0,seconds:3600};let warfareFinished=false,aggressionQuote=null,nextAggressionQuote=0,nextAttritionQuote=0;const gangWarfareThreshold=()=>.7,gangTrainingFirst=()=>true,memberProtectedTask=()=>null,gangMutationAllowed=()=>true,formatNumberShort=String,log=()=>{},territoryTickDetected=true,lastOtherGangInfo={},territoryTickWaitPadding=200,updateInterval=200,postTickRestoreMs=0,territoryTickTime=20000,territoryNextTick=now+500,incomeFunding=null;const now=100000;return (${source.slice(start,end)});`.replace('territoryNextTick=now+500','territoryNextTick=100500'))(gangMonitorBackoff,gangAttritionCalibration,warfareDecision,async(ns,code,_path,args)=>{
  if(code==='ns.gang.getAllGangInformation()')return ns.gang.getAllGangInformation();
  const old=ns.args;ns.args=args;try{return Function('ns','return '+code)(ns);}finally{ns.args=old;}
 },planGangAggression,gangAggressionGuardSource,async()=>members,()=>f.data.w,gangWarfarePowerPerTick,gangWarfareMemberEligible);
 await run(f.ns,f.g);assert.deepEqual(f.calls,[true]);assert.equal(f.g.territoryWarfareEngaged,true);
 const q=JSON.parse(f.files['tasks/gang-aggression.json']);assert.equal(q.engage,true);assert.equal(q.targetThreshold,.68);assert.equal(q.expiresAt,now+5000);
});
test('supervisor allocation failure withdraws capability and falls back to a lightweight guard',async t=>{
 t.mock.method(Date,'now',()=>now);const f=fixture();f.ns.pid=5;
 const source=readFileSync(new URL('../reliability-manager.js',import.meta.url),'utf8'),start=source.indexOf('   if(access[2]||reset.currentNode===2)try{'),end=source.indexOf('   const readStatus=',start),codes=[];
 const run=Function('getNsDataThroughFile','guardGangWarfare','gangAggressionGuardSource',`return async function(ns,read){const access={2:1},reset={currentNode:7,lastNodeReset:1,lastAugReset:2},gangObservedAt=99000;let gangSafety;${source.slice(start,end)}return gangSafety;}`)(async(ns,code,_path,args)=>{
  codes.push(code);if(codes.length===1)throw Error('Insufficient RAM');const old=ns.args;ns.args=args;try{return Function('ns','return '+code)(ns);}finally{ns.args=old;}
 },guardGangWarfare,gangAggressionGuardSource);
 const result=await run(f.ns,p=>JSON.parse(f.ns.read(p)));assert.equal(codes.length,2);assert.equal(result.state,'suspended');assert.deepEqual(f.calls,[false]);
 assert.equal(JSON.parse(f.files['tasks/gang-aggression-guard.json']).available,false);assert.equal(codes[1].includes('supervisor-not-ready'),false);
});
test('ordinary supervisor passes omit the larger aggressive validator',async t=>{
 t.mock.method(Date,'now',()=>now);const f=fixture();f.ns.pid=5;f.g.power=40000;f.files['tasks/gang-warfare-lease.json'].conditionalAggression=false;
 const source=readFileSync(new URL('../reliability-manager.js',import.meta.url),'utf8'),start=source.indexOf('   if(access[2]||reset.currentNode===2)try{'),end=source.indexOf('   const readStatus=',start),codes=[];
 const run=Function('getNsDataThroughFile','guardGangWarfare','gangAggressionGuardSource',`return async function(ns,read){const access={2:1},reset={currentNode:7,lastNodeReset:1,lastAugReset:2},gangObservedAt=99000;let gangSafety;${source.slice(start,end)}return gangSafety;}`)(async(ns,code,_path,args)=>{codes.push(code);const old=ns.args;ns.args=args;try{return Function('ns','return '+code)(ns);}finally{ns.args=old;}},guardGangWarfare,gangAggressionGuardSource);
 assert.equal((await run(f.ns,p=>JSON.parse(f.ns.read(p)))).state,'healthy');assert.equal(codes.length,1);assert.equal(codes[0].includes('supervisor-not-ready'),false);assert.deepEqual(f.calls,[]);
});
test('controller and supervisor wire independent proof validation and preserve default threshold',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),supervisor=readFileSync(new URL('../reliability-manager.js',import.meta.url),'utf8');
 assert.match(source,/warfare-win-chance', 0.70/);assert.match(source,/aggressive-warfare', true/);assert.match(source,/expiresAt:at\+5000/);assert.match(source,/adaptiveCooldownRequired:true/);assert.match(source,/routine\|\|aggressive/);assert.match(source,/conditionalAggression:options/);
 assert.match(supervisor,/gangAggressionGuardSource\(\)/);assert.match(supervisor,/gang-aggression-guard.json/);
});
