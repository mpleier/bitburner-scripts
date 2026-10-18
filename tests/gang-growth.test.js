import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {applyGangWorkOrders,projectGangMember,gangTrainingDecision,gangAscensionEconomics,rankGangEquipment,gangFocus,chooseGangAscensions,ascendGangMemberSafely} from '../gang-policy.js';
import {augmentationCountCandidates,selectGangAugmentationGoal} from '../faction-policy.js';
import {spendingPlan,adaptiveBudgetSignals} from '../spending-policy.js';
import {progressionSpeed} from '../progression-speed-policy.js';

const member=extra=>({name:'M',str_exp:1000,str_mult:2,str_asc_mult:3,...extra});
test('member projection follows native XP weights, ascension and skill rounding without mutation',()=>{
 const m=member(),task={difficulty:100,strWeight:100};
 const next=projectGangMember(m,task,20),xp=1000+20*5*Math.pow(100,.9)*100/1500*1.25*3;
 assert.equal(next.str_exp,xp);assert.equal(next.str,Math.max(1,Math.floor(6*(32*Math.log(xp+534.5)-200))));assert.equal(m.str_exp,1000);
 assert.ok(projectGangMember(m,null,0,{str:1.5}).str>projectGangMember(m,null).str);
});
test('productive recruits can leave training before the old 200-second window',()=>{
 assert.equal(gangTrainingDecision({elapsed:20000,current:100,trained:101,working:101}),false);
 assert.equal(gangTrainingDecision({elapsed:20000,current:100,trained:150,working:101,horizon:900}),true);
 assert.equal(gangTrainingDecision({elapsed:1000,current:1000,trained:1000,working:1000}),true);
 assert.equal(gangTrainingDecision({elapsed:200000,current:1,trained:1e9,allowExtended:false}),false);
});
test('nonproductive recruits train and invalid forecasts cannot prolong productive training',()=>{
 assert.equal(gangTrainingDecision({elapsed:2000,current:0}),true);
 assert.equal(gangTrainingDecision({elapsed:10000,current:5,trained:NaN,working:1}),false);
});
test('ascensions account for production downtime, equipment and a bounded payback horizon',()=>{
 assert.equal(gangAscensionEconomics({before:100,after:100,trainingSeconds:20}),null);
 const plan=gangAscensionEconomics({before:100,after:200,trainingSeconds:20,replacementCost:1000,moneyPerSecond:100});
 assert.equal(plan.paybackSeconds,50);
 assert.equal(gangAscensionEconomics({before:100,after:101,trainingSeconds:200}),null);
 assert.equal(gangAscensionEconomics({before:0,after:100,trainingSeconds:20,replacementCost:1000,moneyPerSecond:0}),null);
});
test('recruitment and respect loss guards remain authoritative with multiple ascension candidates',()=>{
 const names=Array.from({length:12},(_,i)=>'M'+i),results=Object.fromEntries(names.map(n=>[n,{str:2,respect:1}]));
 assert.equal(chooseGangAscensions(results,{respect:10000},names,['str']).length,1);
 assert.equal(chooseGangAscensions(results,{respect:10000},names,['str'],1.05,.05,12).length,12);
 assert.deepEqual(chooseGangAscensions(results,{respect:900,respectForNextRecruit:1000},names.slice(0,10),['str'],1.05,.05,12),[]);
});
test('native ascension rejects stale economic evidence or changed stats before any mutation',()=>{
 const names=Array.from({length:12},(_,i)=>'M'+i),calls=[];
 const ns={gang:{getMemberNames:()=>names,getGangInformation:()=>({respect:10000}),getAscensionResult:()=>({str:2,respect:1}),
  getMemberInformation:()=>({str:100}),setTerritoryWarfare:()=>calls.push('warfare'),ascendMember:()=>{calls.push('ascend');return {};},setMemberTask:()=>calls.push('train')}};
 const plan={name:'M0',expiresAt:Date.now()+10000,paybackSeconds:60,horizonSeconds:900,member:{str:100},ascension:{str:2}};
 const execute=p=>ascendGangMemberSafely(ns,'M0',['str'],1.05,.05,chooseGangAscensions,()=>true,p);
 for(const p of [{...plan,expiresAt:0},{...plan,paybackSeconds:1000},{...plan,member:{str:50}},{...plan,ascension:{str:1.5}}])assert.equal(execute(p),null);
 assert.deepEqual(calls,[]);assert.ok(execute(plan));assert.deepEqual(calls,['warfare','ascend','train']);
});
test('equipment ranking prefers marginal production return rather than sticker price',()=>{
 const orders=[{equipmentName:'Cheap',cost:100,moneyGain:1},{equipmentName:'Productive',cost:1000,moneyGain:100},{equipmentName:'Useless',cost:1,moneyGain:0},{cost:10000,moneyGain:1}];
 assert.deepEqual(rankGangEquipment(orders).map(o=>o.equipmentName),['Productive','Cheap']);
});
test('purchase milestones stop unnecessary rep grinding while recruitment and explicit focus win',()=>{
 const base={members:12,factionRep:100,requiredRep:1e9,money:10000,respect:1e6,goal:{rep:100,cost:1e5}};
 assert.equal(gangFocus(base),'money');assert.equal(gangFocus({...base,factionRep:0}),'money');
 assert.equal(gangFocus({...base,factionRep:0,money:100000}),'respect');
 assert.equal(gangFocus({...base,members:11}),'respect');assert.equal(gangFocus({...base,reputationFocus:true}),'respect');
 assert.equal(gangFocus({...base,moneyFocus:true}),'money');
});
const aug=(name,price,prereqs=[],extra={})=>({name,price,rep:1,prereqs,available:true,...extra});
test('count-building includes cheap unique prerequisites in a bounded budget and ignores NeuroFlux',()=>{
 const a=[aug('B',20,['A']),aug('A',10),aug('NeuroFlux Governor',1),aug('Expensive',1000),aug('Locked',1,[],{available:false})];
 assert.deepEqual(augmentationCountCandidates(a,['Base'],30,1000),['A','B']);
 assert.deepEqual(augmentationCountCandidates(a,['Base'],2,1000),['A']);
 assert.deepEqual(augmentationCountCandidates(a,['Base','Base','NeuroFlux Governor'],30,1000),['A','B']);
});
test('count-building does not select inaccessible chains or spend beyond its allocation',()=>{
 assert.deepEqual(augmentationCountCandidates([aug('B',1,['Missing'])],[],30,1000),[]);
 assert.deepEqual(augmentationCountCandidates([aug('A',60),aug('B',60)],[],30,1000),['A']);
 assert.deepEqual(augmentationCountCandidates([aug('A',1)],['Base'],1,1000),[]);
});
test('gang augmentation target compares purchase ETA and skips owned or inaccessible prerequisites',()=>{
 const a=[{name:'Large',cost:1000,rep:1000,desired:true,prereqs:[]},{name:'Next',cost:100,rep:10,desired:true,prereqs:[]},
  {name:'Missing',cost:1,rep:1,desired:true,prereqs:['Unavailable']}];
 assert.equal(selectGangAugmentationGoal(a,{money:100,rep:0,repRate:10,cashRate:10}).name,'Next');
 assert.equal(selectGangAugmentationGoal(a,{owned:['Next'],money:100,rep:0,repRate:10,cashRate:10}).name,'Large');
 assert.equal(selectGangAugmentationGoal(a,{money:0,rep:0}).name,'Next');
});
test('short-payback gang equipment receives more shared funding without exceeding the wallet',()=>{
 const input={money:1e9,reserve:1e8,homeRam:1024,node:9,ownerPid:1,reset:20};
 const ordinary=spendingPlan(input),growth=spendingPlan({...input,signals:{gangEquipmentPayback:60}});
 assert.ok(growth.allowances.gang>ordinary.allowances.gang);
 assert.ok(Object.values(growth.allowances).reduce((a,b)=>a+b,0)<=9e8+1);
 assert.equal(spendingPlan({...input,signals:{gangEquipmentPayback:100000}}).allowances.gang,ordinary.allowances.gang);
});
test('growth budget signals expire with the owner, reset and observation age',()=>{
 const now=Date.now(),files={'tasks/gang-growth.json':JSON.stringify({at:now,pid:1,nodeReset:10,augReset:20,schemaVersion:2,equipmentOpportunity:{reason:'production',cashPaybackSeconds:60}})};
 let alive=true;const ns={read:f=>files[f]||'',write(){},getResetInfo:()=>({lastNodeReset:10,lastAugReset:20}),isRunning:()=>alive};
 assert.equal(adaptiveBudgetSignals(ns).gangEquipmentPayback,60);alive=false;assert.equal(adaptiveBudgetSignals(ns).gangEquipmentPayback,null);
 alive=true;files['tasks/gang-growth.json']=JSON.stringify({at:now,pid:1,nodeReset:10,augReset:19,schemaVersion:2,equipmentOpportunity:{reason:'production',cashPaybackSeconds:60}});
 assert.equal(adaptiveBudgetSignals(ns).gangEquipmentPayback,null);
});
function speedCase(economics,extra={}){
 const now=2e7,augReset=1,ready=[{name:'Useful',stats:{hacking:4,hacking_exp:4}}];
 const snapshot={at:now,augReset,worth:1e9,ready,targets:[],reputation:{},resetEconomics:economics};
 const previous={augReset,at:now-60000,worth:9e8,reputation:{},fingerprint:JSON.stringify(['Useful']),lastGrowthAt:now-20*60000};
 return progressionSpeed({snapshot,previous,now,augReset,elapsed:2*3600000,homeRam:1024,node:9,firstBn9:true,...extra});
}
test('measured affordable rebuilding can authorize an early first-BN9 augmentation reset',()=>{
 const p=speedCase({known:true,replacementCost:1e6,gangLossPerSecond:0});assert.equal(p.resetPaysBack,true);assert.equal(p.earlyInstall,true);
});
test('large rebuilding or gang losses hold first-BN9 resets and unknown evidence stays conservative',()=>{
 for(const e of [{known:true,replacementCost:1e12,gangLossPerSecond:0},{known:true,replacementCost:0,gangLossPerSecond:1e9},{known:false,replacementCost:null}]){
  const p=speedCase(e);assert.equal(p.resetPaysBack,false);assert.equal(p.earlyInstall,false);
 }
});
test('native generated reset-cost query includes the free BN9 server in rebuilding cost',async()=>{
 const source=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8');
 const start=source.indexOf('resetEconomics=await getNsDataThroughFile(ns,`')+'resetEconomics=await getNsDataThroughFile(ns,`'.length;
 const query=source.slice(start,source.indexOf('`',start)),calls=[];
 const f={hacknetServerCost:(...a)=>{calls.push(a);return 10;},levelUpgradeCost:()=>99,ramUpgradeCost:()=>0,coreUpgradeCost:()=>90,cacheUpgradeCost:()=>5};
 const ns={getPlayer:()=>({mults:{hacknet_node_purchase_cost:1,hacknet_node_ram_cost:1,hacknet_node_core_cost:1}}),formulas:{hacknetServers:f},hacknet:{numNodes:()=>1,getNodeStats:()=>({level:100,ram:1,cores:10,cache:5})}};
 const r=vm.runInNewContext(query,{ns});assert.equal(r.known,true);assert.equal(r.replacementCost,204);assert.deepEqual(calls,[[1,1]]);
});
test('integration retains explicit overrides, native checks and reset-scoped purchase goals',async()=>{
 const gang=await readFile(new URL('../gangs.js',import.meta.url),'utf8'),faction=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8');
 assert.match(gang,/disable-adaptive-growth/);assert.match(gang,/plannedAscensions.has\(member.name\)/);assert.match(gang,/resetInfo.currentNode!==8/);
 assert.match(gang,/p.nodeReset===resetInfo.lastNodeReset&&p.augReset===resetInfo.lastAugReset/);
 assert.match(faction,/!options\['disable-count-building'\]&&!options\['stat-desired'\].length/);
 assert.match(faction,/filter\(a=>!omitAugs.includes\(a.name\)\)/);
});

test('nonfinite rebuild costs cannot become a free known reset after JSON serialization',()=>{
 for(const replacementCost of [null,Infinity,NaN,-1]){
  const p=speedCase({known:true,replacementCost,gangLossPerSecond:0});
  assert.equal(p.resetPaysBack,false);assert.equal(p.resetEconomics.known,false);
 }
});


test('older members can resume training when incremental gains repay the lost work',()=>{
 assert.equal(gangTrainingDecision({elapsed:3600000,current:100,trained:150,working:101,horizon:900}),true);
 assert.equal(gangTrainingDecision({elapsed:3600000,current:100,trained:101,working:101,horizon:900}),false);
 assert.equal(gangTrainingDecision({elapsed:3600000,current:0,trained:0,working:0}),false);
 assert.equal(gangTrainingDecision({elapsed:3600000,current:0,trained:5,working:0}),true);
 assert.equal(gangTrainingDecision({elapsed:3600000,current:100,trained:150,working:101,horizon:900,allowExtended:false}),false);
 assert.equal(gangTrainingDecision({elapsed:3600000,current:100,trained:150,working:101,horizon:NaN}),false);
});

test('gang task orders report maintenance deferrals without claiming native assignment failure',()=>{
 const calls=[],ns={gang:{getMemberInformation:()=>({task:'Mug People'}),setMemberTask:()=>calls.push('set')}};
 const result=applyGangWorkOrders(ns,[{name:'M',task:'Train Combat'}],()=>false,1);
 assert.equal(result.deferred,true);assert.deepEqual(result.failed,[]);assert.deepEqual(calls,[]);
});
test('gang task orders recognize applied state and preserve genuine native failures',()=>{
 let task='Train Combat',calls=0;const ns={gang:{getMemberInformation:()=>({task}),setMemberTask:()=>{calls++;return false;}}};
 const orders=[{name:'M',task:'Train Combat'}];
 assert.equal(applyGangWorkOrders(ns,orders,()=>true,1).assigned,1);assert.equal(calls,0);
 task='Mug People';const result=applyGangWorkOrders(ns,orders,()=>true,1);assert.equal(result.deferred,false);assert.equal(result.failed.length,1);
});
