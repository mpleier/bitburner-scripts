import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {guardGangWarfare,gangManualTasks,gangTerritoryRecovery,gangCorporationCapital} from '../gang-safety-policy.js';
import {gangWarfareReadyDelay,forecastGangCrewTraining,projectGangMember} from '../gang-policy.js';
import {spendingPlan,adaptiveBudgetSignals} from '../spending-policy.js';
function fixture(){
 const reset={lastNodeReset:1,lastAugReset:2},now=100000,files={},events=[];
 const lease={ownerPid:10,at:50000,expiresAt:110000,nodeReset:1,augReset:2,faction:'Slum Snakes',tasks:{A:'Work',B:'Train Combat'}};
 files['tasks/gang-warfare-lease.json']=lease;
 const tasks={A:'Territory Warfare',B:'Train Combat'},gang={faction:'Slum Snakes',territoryWarfareEngaged:true,territoryClashChance:1};
 let processes=[{pid:10,filename:'gangs.js'}];
 const ns={read:f=>typeof files[f]==='string'?files[f]:JSON.stringify(files[f]??null),getResetInfo:()=>reset,ps:()=>processes,isRunning:pid=>processes.some(p=>p.pid===pid),gang:{
  inGang:()=>true,getGangInformation:()=>gang,setTerritoryWarfare:v=>{events.push(['war',v]);gang.territoryWarfareEngaged=v;},getMemberNames:()=>Object.keys(tasks),
  getTaskNames:()=>['Work','Train Combat','Territory Warfare'],getMemberInformation:n=>({task:tasks[n]}),setMemberTask:(n,t)=>{tasks[n]=t;events.push([n,t]);return true;}}};
 return {ns,reset,now,files,lease,events,tasks,gang,setProcesses:p=>processes=p};
}
test('healthy lease is untouched, including serialized native guard',()=>{
 const f=fixture();assert.equal(guardGangWarfare(f.ns,0,f.now).state,'healthy');assert.deepEqual(f.events,[]);
 const native=Function('return ('+guardGangWarfare.toString()+')')();assert.equal(native(f.ns,0,f.now).state,'healthy');
});
test('expired lease disables warfare and restores only exposed members',()=>{
 const f=fixture(),r=guardGangWarfare(f.ns,0,120000);assert.equal(r.reason,'lease-expired');assert.equal(r.restored,1);
 assert.deepEqual(f.events,[['war',false],['A','Work']]);assert.equal(r.residualClashChance,1);
});
test('exited owner is protected immediately without waiting for lease expiration',()=>{
 const f=fixture();f.setProcesses([]);assert.equal(guardGangWarfare(f.ns,99000,f.now).reason,'owner-exited');assert.equal(f.gang.territoryWarfareEngaged,false);
});
test('unmanaged manual warfare and old-reset leases are not claimed',()=>{
 const f=fixture();f.setProcesses([]);f.lease.augReset=1;assert.equal(guardGangWarfare(f.ns,0,f.now).state,'unmanaged');assert.deepEqual(f.events,[]);
});
test('replacement owner has bounded startup grace; old owner lease cannot renew it',()=>{
 const f=fixture();f.setProcesses([{pid:11,filename:'/gangs.js'}]);assert.equal(guardGangWarfare(f.ns,99000,f.now).state,'starting');
 assert.equal(guardGangWarfare(f.ns,10000,f.now).state,'suspended');
});
test('future, malformed, and overlong leases cannot authorize warfare',()=>{
 for(const patch of [{at:100001,expiresAt:160001},{at:50000,expiresAt:999999},{ownerPid:null}]){
  const f=fixture();Object.assign(f.lease,patch);assert.equal(guardGangWarfare(f.ns,0,f.now).state,'suspended');
 }
});
test('pause and active gang maintenance revoke healthy leases',()=>{
 for(const kind of ['paused','maintenance']){
  const f=fixture();if(kind==='paused')f.files['remote-control/paused/gangs.js.txt']='true';
  else f.files['tasks/automation-maintenance.json']={ownerPid:10,expiresAt:101000,scripts:['/gangs.js']};
  assert.equal(guardGangWarfare(f.ns,0,f.now).reason,kind);
 }
});
test('other controller maintenance does not revoke a healthy gang lease',()=>{
 const f=fixture();f.files['tasks/automation-maintenance.json']={ownerPid:10,expiresAt:101000,scripts:['go.js']};assert.equal(guardGangWarfare(f.ns,0,f.now).state,'healthy');
});
test('malformed maintenance cannot prevent an expired lease from being revoked',()=>{
 const f=fixture();f.files['tasks/automation-maintenance.json']={ownerPid:10,expiresAt:200000,scripts:'gangs.js'};
 assert.equal(guardGangWarfare(f.ns,0,120000).reason,'lease-expired');
});
test('foreign faction and invalid stored tasks cannot restore assignments',()=>{
 const f=fixture();f.lease.faction='Tetrads';assert.equal(guardGangWarfare(f.ns,0,120000).restored,0);
 const g=fixture();g.lease.tasks.A='Unknown';assert.equal(guardGangWarfare(g.ns,0,120000).restored,0);
});
test('explicit manual tasks validate strictly and default to full automation',()=>{
 assert.deepEqual(gangManualTasks('{}',['Work']),{});assert.deepEqual(gangManualTasks('{"A":"Work"}',['Work']),{A:'Work'});
 for(const text of ['null','[]','bad','{"A":3}','{"A":"Missing"}','{"A":"Territory Warfare"}','{"A":"Unassigned"}'])
  assert.throws(()=>gangManualTasks(text,['Work','Territory Warfare','Unassigned']));
});
const warfare={active:true,power:100,territory:.1,threshold:.75,rivals:[{power:100,rate:0,samples:3}]};
test('territory readiness distinguishes missing samples, no closing, ready and beyond-horizon',()=>{
 assert.equal(gangTerritoryRecovery({...warfare,active:false},20,gangWarfareReadyDelay,900).state,'sampling');
 assert.equal(gangTerritoryRecovery({...warfare,rivals:[{power:100,rate:0,samples:2}]},20,gangWarfareReadyDelay,900).state,'sampling');
 assert.equal(gangTerritoryRecovery(warfare,0,gangWarfareReadyDelay,900).state,'not-closing');
 assert.equal(gangTerritoryRecovery(warfare,20,gangWarfareReadyDelay,100).state,'beyond-horizon');
 assert.equal(gangTerritoryRecovery({...warfare,power:300},20,gangWarfareReadyDelay,900).state,'ready');
});
test('territory readiness incorporates finite bonus time and reports conditional estimates',()=>{
 const normal=gangTerritoryRecovery(warfare,20,gangWarfareReadyDelay,900),bonus=gangTerritoryRecovery(warfare,20,gangWarfareReadyDelay,900,1000);
 assert.equal(normal.etaSeconds,200);assert.equal(bonus.etaSeconds,8);assert.equal(bonus.state,'within-horizon');assert.match(bonus.model,/fixed territory/);
});
test('capital protection requires a small quote repaying inside the actual horizon',()=>{
 const signals={corporationStartup:true,gangCapitalHorizon:900,gangCapitalQuote:{cost:1e9,reason:'production',cashPaybackSeconds:300}};
 assert.equal(gangCorporationCapital(signals,150e9).protectedGangCash,1e9);
 for(const patch of [{gangCapitalHorizon:100},{corporationStartup:false},{gangCapitalQuote:{cost:2e9,reason:'production',cashPaybackSeconds:300}},{gangCapitalQuote:{cost:1e9,reason:'recruitment',cashPaybackSeconds:300}}])
  assert.equal(gangCorporationCapital({...signals,...patch},150e9).protectedGangCash,0);
 assert.equal(gangCorporationCapital(signals,150e9).corporationPaybackSeconds,null);
});
test('corporation startup and gang allowance share one budget without overspending',()=>{
 const signals={corporationStartup:true,gangCapitalHorizon:900,gangCapitalQuote:{cost:1e9,reason:'production',cashPaybackSeconds:300}};
 const p=spendingPlan({money:150e9,reserve:0,homeRam:1024,signals});assert.ok(p.allowances.gang>=1e9);assert.ok(p.allowances.corporation<=149e9);
 assert.ok(Object.values(p.allowances).reduce((a,b)=>a+b,0)<=150e9+.001);
 const normal=spendingPlan({money:150e9,signals:{corporationStartup:true}});assert.equal(normal.allowances.corporation,150e9);
});
test('manual tasks participate in shared protection and are excluded from ascension candidates',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 const start=s.indexOf('function memberProtectedTask('),end=s.indexOf('function expectedAscensionAt(',start);
 const fn=Function(`const options={manualTasks:{A:'Work'}},activeWantedPreparation=()=>true,memberNeedsTraining=()=>true;${s.slice(start,end)};return memberProtectedTask;`)();
 assert.equal(fn('A'),'Work');assert.match(s,/filter\(c=>!options.manualTasks\?\.\[c.name\]\)/);
 assert.match(s,/try \{ await mainLoop\(ns\); await renewWarfareLease\(ns\); \}/);
});
test('crew forecasts preserve fixed jobs and never select those members for optional training',()=>{
 const members=Object.fromEntries(['A','B'].map(name=>[name,projectGangMember({name,str_exp:1000,str_mult:1,str_asc_mult:1,task:'Work'},null,0)]));
 const training={name:'Train Combat',difficulty:100,strWeight:100},work={name:'Work',difficulty:1,strWeight:100},fixed={name:'Fixed',difficulty:1,chaWeight:100},calls=[];
 const r=forecastGangCrewTraining({members,gang:{respect:1000,wantedLevel:1},tasks:{'Train Combat':training,Work:work,Fixed:fixed},training,fixedTasks:{A:'Fixed'},names:['A','B'],horizonSeconds:120,windows:[20],
  evaluate:(m,g,task)=>{calls.push([m.name,task]);return {value:task==='Work'?m.str:0,money:task==='Work'?m.str:0,respect:0,wanted:0};}});
 assert.equal(r.forecasts.A,undefined);assert.ok(r.diagnostics.baselineReady);assert.ok(calls.some(([n,t])=>n==='A'&&t==='Fixed'));
 assert.ok(calls.filter(([n])=>n==='A').every(([,t])=>t==='Fixed'));
});
test('disabled gang spending does not reserve a quote ahead of corporation startup',()=>{
 const signals={corporationStartup:true,activeCategories:{gang:false},gangCapitalHorizon:900,gangCapitalQuote:{cost:1e9,reason:'production',cashPaybackSeconds:300}};
 const p=spendingPlan({money:150e9,signals});assert.equal(p.gangCapital.protectedGangCash,0);assert.equal(p.allowances.corporation,150e9);
});
test('capital quotes require fresh reset-scoped telemetry from the named live gang owner',()=>{
 const now=Date.now();let name='gangs.js',alive=true;
 const growth={schemaVersion:2,at:now,pid:10,nodeReset:1,augReset:2,horizon:{seconds:900},equipmentOpportunity:{reason:'production',cost:1e9,cashPaybackSeconds:300}};
 const ns={read:f=>f==='tasks/gang-growth.json'?JSON.stringify(growth):'',write(){},getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),isRunning:()=>alive,ps:()=>alive?[{pid:10,filename:name}]:[]};
 assert.deepEqual(adaptiveBudgetSignals(ns,true).gangCapitalQuote,growth.equipmentOpportunity);
 name='stats.js';assert.equal(adaptiveBudgetSignals(ns,true).gangCapitalQuote,null);name='gangs.js';
 growth.at=now-31000;assert.equal(adaptiveBudgetSignals(ns,true).gangCapitalQuote,null);
 growth.at=now+10000;assert.equal(adaptiveBudgetSignals(ns,true).gangCapitalQuote,null);
 growth.at=now;growth.augReset=1;assert.equal(adaptiveBudgetSignals(ns,true).gangCapitalQuote,null);
 growth.augReset=2;alive=false;assert.equal(adaptiveBudgetSignals(ns,true).gangCapitalQuote,null);
});
