import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {observeGangIncome,gangPlannedEquipmentCash,gangIncomeFunding,gangIncomeDelayAllowance,gangFundingPlanCovered,gangPowerBenefit} from '../gang-power-policy.js';
import {planMarginalGangEquipment} from '../gang-policy.js';
const keys=['hacking','hacknet','gang','sleeves','work','crime','corporation','bladeburner','darknet'];
function snapshot(at,gang=10,darknet=90){return {at,sources:{...Object.fromEntries(keys.map(k=>[k,k==='gang'?at/1000*gang:k==='darknet'?at/1000*darknet:0])),casino:at*1000,stock:at*1000,codingcontract:at*1000}};}
const scope=at=>({nodeReset:1,augReset:2,now:at});
function observed(){let p;for(let i=0;i<=3;i++)p=observeGangIncome(p,snapshot(1000+i*20000),scope(1000+i*20000));return p;}
test('three independent windows establish source contribution and include repeated Dark Net earnings',()=>{
 let p;for(let i=0;i<=3;i++){const at=1000+i*20000;p=observeGangIncome(p,snapshot(at),scope(at));assert.equal(p.known,i===3);}
 assert.equal(p.gangRate,10);assert.equal(p.externalRate,90);assert.equal(p.totalRate,100);assert.equal(p.gangShare,.1);assert.equal(p.rates.darknet,90);
});
test('windfalls, stock principal and contract rewards never become recurring external rates',()=>{
 let p;for(let i=0;i<=3;i++){const at=1000+i*20000;p=observeGangIncome(p,snapshot(at,10,0),scope(at));}
 assert.equal(p.externalRate,0);assert.equal(p.gangShare,1);
});
test('fast and duplicate samples cannot manufacture observation windows',()=>{
 const p=observed(),same=observeGangIncome(p,p.baseline,scope(p.baseline.at));assert.deepEqual(same,p);
 const q=observeGangIncome(p,snapshot(61500),scope(61500));assert.equal(q.samples.length,3);assert.equal(q.baseline.at,61000);
});
test('a single Dark Net burst and a stopped channel do not sustain income credit',()=>{
 let p;for(let i=0;i<=4;i++){const at=1000+i*20000,s=snapshot(at,10,0);s.sources.darknet=i?10000:0;p=observeGangIncome(p,s,scope(at));}
 assert.equal(p.known,true);assert.equal(p.externalRate,0);
});
test('resets, missing counters, reversals, long gaps and corrupt histories restart measurement',()=>{
 const p=observed();
 for(const [s,ctx] of [[snapshot(81000),{...scope(81000),augReset:3}],[snapshot(61000-1),scope(61000)],[snapshot(200000),scope(200000)],[{at:81000,sources:{}},scope(81000)],[snapshot(81000),scope(200000)]])assert.equal(observeGangIncome(p,s,ctx).known,false);
 const s=snapshot(81000);s.sources.gang=0;assert.equal(observeGangIncome(p,s,scope(81000)).known,false);
 const r=observeGangIncome({...p,samples:[{at:60000,rates:{}}]},snapshot(81000),scope(81000));assert.equal(r.known,false);
});
test('income history remains bounded and the latest low rate limits optimistic credit',()=>{
 let p;for(let i=0;i<20;i++){const at=1000+i*20000;p=observeGangIncome(p,snapshot(at),scope(at));}
 assert.ok(p.samples.length<=5);const s=snapshot(401000);s.sources.darknet=p.baseline.sources.darknet;const r=observeGangIncome(p,s,scope(401000));assert.equal(r.externalRate,0);
});
const now=Date.now(),members={A:{upgrades:[],augmentations:[]}},quote={at:now,nodeReset:1,augReset:2,faction:'Own',members:['A'],complete:true,orders:[{member:'A',equipmentName:'Bat'},{member:'A',equipmentName:'Implant'}]},qscope={nodeReset:1,augReset:2,faction:'Own',now};
test('worthwhile equipment quotes reprice bundles and exclude already owned or duplicate items',()=>{
 assert.equal(gangPlannedEquipmentCash(quote,members,{Bat:10,Implant:20},qscope),30);
 assert.equal(gangPlannedEquipmentCash({...quote,orders:[...quote.orders,quote.orders[0]]},{A:{upgrades:['Bat'],augmentations:[]}},{Bat:10,Implant:20},qscope),20);
 assert.equal(gangPlannedEquipmentCash({...quote,orders:[]},members,{},qscope),0);
});
test('incomplete, stale, wrong-reset, wrong-faction and changed-crew valuations retain the fallback',()=>{
 for(const patch of [{complete:false},{at:now-60001},{at:now+1},{augReset:9},{faction:'Other'},{members:['B']},{orders:[{member:'A',equipmentName:'Unknown'}]}])assert.equal(gangPlannedEquipmentCash({...quote,...patch},members,{Bat:10,Implant:20},qscope),null);
});
const contribution={known:true,rateAt:now,gangRate:10,externalRate:90,gangShare:.1};
const funding=patch=>gangIncomeFunding({cash:0,equipmentCash:10000,augmentationCash:0,augmentationKnown:true,externalCashRate:90,externalAt:now,at:now,horizonSeconds:1000,contribution,...patch});
const path=(powerReady,money)=>({powerReady,cumulative:[{at:1000,gangMoney:money}]});
test('a small measured gang contribution permits bounded payoff comparison beyond the short funding window',()=>{
 const f=funding();assert.equal(f.tradeoff,true);assert.equal(f.deprioritize,true);assert.equal(f.externalCashRate,45);
 assert.equal(funding({forceMoney:true}).deprioritize,false);assert.equal(funding({contribution:{...contribution,gangRate:1000}}).deprioritize,false);
 assert.equal(funding({contribution:{...contribution,rateAt:now-30001}}).deprioritize,false);
});
test('foregone income is capped at five percent of total projected gross income and a quarter of readiness savings',()=>{
 const f=funding(),base=path(800,10000),after=path(400,6000);
 assert.equal(gangIncomeDelayAllowance(after,base,f,1000,now),100);
 assert.equal(gangIncomeDelayAllowance(path(400,0),base,f,1000,now),2);
 assert.equal(gangIncomeDelayAllowance(path(790,6000),base,f,1000,now),2);
 assert.equal(gangIncomeDelayAllowance(path(Infinity,6000),base,f,1000,now),2);
 assert.equal(gangIncomeDelayAllowance(after,base,{...f,expiresAt:now},1000,now),2);
});
test('cash paths must still reach funding and fit the bounded opportunity cost',()=>{
 const f=funding(),base=path(800,10000),after=path(400,6000);
 assert.equal(gangFundingPlanCovered(after,base,f,1000,now),true);
 assert.equal(gangFundingPlanCovered(path(790,6000),base,f,1000,now),false);
 assert.equal(gangFundingPlanCovered(after,base,{...f,target:1000000},1000,now),false);
});
test('poor ROI upgrades do not produce a funding opportunity while worthwhile unaffordable ones do',()=>{
 const equipment=[{name:'Bat',type:'Weapon',cost:100,stats:{str:2}}],budgets={available:1,equipmentLimit:1,augLimit:1,bootstrapBudget:0};
 const input={members,equipment,budgets,horizon:100,maxBundleEvaluations:0,cheapCash:0,evaluate:()=>({moneyGain:0,objectiveGain:0,respectGain:0})};
 const bad=planMarginalGangEquipment(input);assert.equal(bad.fundingOpportunity,null);assert.equal(bad.diagnostics.qualified,0);
 const good=planMarginalGangEquipment({...input,evaluate:()=>({moneyGain:10,objectiveGain:10,respectGain:0})});assert.equal(good.orders.length,0);assert.equal(good.fundingOpportunity.equipmentName,'Bat');
});
test('controller wires scoped source evidence and worthwhile equipment valuations without bypassing imminent goals',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),policy=readFileSync(new URL('../gang-policy.js',import.meta.url),'utf8');
 assert.match(source,/getMoneySources\(\).sinceInstall/);assert.match(source,/contribution:incomeObservation/);assert.match(source,/fundingOpportunity=plan.fundingOpportunity/);assert.match(source,/plannedCash\?\?gangDevelopmentCashTarget/);
 assert.match(policy,/augmentation&&a>120&&!equipmentDevelopment/);assert.match(policy,/return !Number.isFinite\(a\)\|\|b<=a\+delay/);
});

test('executed milestone guard relaxes only distant augmentation goals',()=>{
 const source=readFileSync(new URL('../gang-policy.js',import.meta.url),'utf8').replaceAll('\r','');
 const start=source.indexOf(' const safetyFor=(after,reference=baseline)=>{'),end=source.indexOf(' if(equipmentDevelopment){',start);
 const make=Function('gangIncomeDelayAllowance','f','kind','eta','equipmentDevelopment',`const baseline={eta:{goal:eta},...${JSON.stringify(path(800,10000))}},groups=[['goal']],targets=[{name:'goal',group:kind}],warfare={incomeFunding:f},horizonSeconds=1000,powerEnabled=false;${source.slice(start,end)}return after=>safetyFor(after);`);
 const run=(kind,eta,equip=null)=>make(gangIncomeDelayAllowance,funding(),kind,eta,equip)({...path(400,6000),eta:{goal:eta+10}}).goalsSafe;
 assert.equal(run('augmentation',1000),true);assert.equal(run('augmentation',100),false);assert.equal(run('recruit',1000),false);assert.equal(run('augmentation',1000,{}),false);
});
