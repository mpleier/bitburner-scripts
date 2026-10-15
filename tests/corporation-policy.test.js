import test from 'node:test';
import assert from 'node:assert/strict';
import { treasuryPolicy,recoveryJobCounts,priorSaleMultiplier,partySpendPerEmployee,materialSalePrice,outputBacklog,boostPurchaseBudget,productPriceStep,researchAffordable,salesPotential,formulaSalePrice,inferProductMarkup,supportAdvertLimit } from '../corporation-policy.js';
test('boost purchases stop during losses and consume at most half of cycle profit',()=>{
 assert.equal(boostPurchaseBudget({funds:1e9,revenue:4.5e6,expenses:5.1e6},1e8),0);
 assert.equal(boostPurchaseBudget({funds:1e9,revenue:5e6,expenses:1e6},1e8),20e6);
 assert.equal(boostPurchaseBudget({funds:1e9,revenue:0,expenses:0},1e8),10e6);
 assert.equal(boostPurchaseBudget({funds:1e6,revenue:5e6,expenses:1e6},2e6),0);
});
test('material pricing uses the quality-based additive markup without a percentage premium',()=>{
 assert.equal(materialSalePrice({quality:9.075},{baseMarkup:3.75}),'MP+2.42');
 assert.equal(materialSalePrice({quality:0},{baseMarkup:3.75}),'MP+0');
 assert.equal(materialSalePrice({quality:9},{}),'MP');
 assert.equal(materialSalePrice({quality:Infinity},{baseMarkup:1}),'MP');
});
test('warehouse sales backlogs block expansion until sell-through recovers',()=>{
 assert.equal(outputBacklog([{stored:5314,productionAmount:133,actualSellAmount:0.06}]),true);
 assert.equal(outputBacklog([{stored:5314,productionAmount:133,actualSellAmount:133}]),false);
 assert.equal(outputBacklog([{stored:0,productionAmount:133,actualSellAmount:0}]),false);
 assert.equal(outputBacklog([{stored:100,productionAmount:0,actualSellAmount:0}]),true);
});
test('cash-starved corporation reserves operating cash and disables upkeep',()=>{
 const policy=treasuryPolicy({funds:438596,expenses:214491});
 assert.equal(policy.recovering,true);assert.equal(policy.upkeepBudget,0);assert.equal(policy.reserve,4289820);
});
test('healthy corporation budgets upkeep within cash after its operating reserve',()=>{
 const p=treasuryPolicy({funds:1e9,expenses:1e6,revenue:9e6});
 assert.equal(p.recovering,false);assert.ok(p.upkeepBudget<=1e9-p.reserve);assert.equal(p.upkeepBudget,20e6);
});
test('recovery staffing preserves production roles and total headcount',()=>{
 for(let n=0;n<=120;n++)for(const products of [false,true]){
  const jobs=recoveryJobCounts(n,products,true);assert.equal(jobs.reduce((s,v)=>s+v,0),n);
  assert.ok(jobs.every(v=>Number.isInteger(v)&&v>=0));if(n<6)assert.equal(jobs[5],0);else assert.ok(jobs.slice(0,5).every(v=>v>0));
 }
 assert.equal(recoveryJobCounts(15,false,true)[5],4);assert.equal(recoveryJobCounts(15,false,false)[5],0);
});
test('existing market multipliers survive manager restarts',()=>{
 assert.equal(priorSaleMultiplier('MP*3.5'),3.5);assert.equal(priorSaleMultiplier('MP'),1);
 assert.equal(priorSaleMultiplier('bad'),1);assert.equal(priorSaleMultiplier('MP*999999999'),1e6);
});
test('party spending is calculated from morale and respects the total allowance',()=>{
 const spend=partySpendPerEmployee(75,100,15,3000000);assert.equal(spend,200000);
 assert.ok(spend*15<=3000000);assert.equal(partySpendPerEmployee(75,100,15,10000),0);
 assert.equal(partySpendPerEmployee(100,100,15,1e9),0);
 const needed=partySpendPerEmployee(75,100,15,1e9),multiplier=1+needed/1e7;
 assert.ok(Math.abs((75+(multiplier-1)*10)*multiplier-100)<1e-8);
});

test('upkeep cannot consume more than a quarter of operating profit',()=>{
 assert.equal(treasuryPolicy({funds:1e9,revenue:1.5e6,expenses:1e6}).upkeepBudget,1.25e6);
 assert.equal(treasuryPolicy({funds:1e9,revenue:1e6,expenses:2e6}).upkeepBudget,0);
});


test('product prices discover profitable boundaries quickly and refine without oscillating',()=>{
 const clear={productionAmount:10,actualSellAmount:10,stored:0,effectiveRating:10};
 let state=productPriceStep(clear,{multiplier:1});assert.equal(state.multiplier,2);
 state=productPriceStep(clear,state);assert.equal(state.multiplier,4);
 state=productPriceStep({...clear,actualSellAmount:2,stored:200},state);assert.equal(state.low,2);assert.equal(state.high,4);assert.ok(state.multiplier>2&&state.multiplier<4);
 assert.equal(productPriceStep({productionAmount:0},{multiplier:7}).multiplier,7);
 assert.equal(productPriceStep({...clear,actualSellAmount:0,stored:100},{multiplier:1}).multiplier,1);
});
test('research purchases preserve quality reserves and require finite costs',()=>{
 assert.equal(researchAffordable(100,50,.5),true);assert.equal(researchAffordable(99,50,.5),false);
 assert.equal(researchAffordable(100,21),false);assert.equal(researchAffordable(100,20),true);assert.equal(researchAffordable(100,Infinity),false);
});


test('source-derived sales potential reproduces public business, market and advertising factors',()=>{
 const item={quality:10,demand:20,competition:40},d={awareness:100,popularity:50},industry={advertisingFactor:.2},office={employeeProductionByJob:{Business:99}};
 const expected=10.001*(100**.26+.01)*((101**.2*51**.2*(50.001/100))**.85)*12*1.1;
 assert.ok(Math.abs(salesPotential(item,d,industry,office,10)-expected)<1e-8);
 assert.equal(salesPotential({...item,demand:undefined},d,industry,office),null);
 assert.ok(Number.isFinite(salesPotential(item,{awareness:Number.MAX_VALUE,popularity:Number.MAX_VALUE},{advertisingFactor:.25},office)));
});
test('formula pricing respects per-second sales and remaining inventory',()=>{
 const result=formulaSalePrice({marketPrice:100,productionAmount:10,stored:100},80,5,10);
 assert.equal(result.target,20);assert.equal(result.price,'MP+10');
 assert.equal(formulaSalePrice({marketPrice:100,productionAmount:0,stored:0},80,5),null);
 assert.equal(formulaSalePrice({productionCost:50,productionAmount:10,stored:0},40,5).price,'MP+10');
});
test('product markup inference rejects capped sales and uses the inverse sale formula',()=>{
 const prev={rating:100,premium:20,potential:100,target:50};
 assert.equal(inferProductMarkup({actualSellAmount:25},prev),10);
 assert.equal(inferProductMarkup({actualSellAmount:50},prev),null);
 assert.equal(inferProductMarkup({actualSellAmount:0},prev),null);
});
test('support advertising stops after eight levels while products and achievement goals remain eligible',()=>{
 assert.equal(supportAdvertLimit({makesProducts:false,numAdVerts:8}),true);
 assert.equal(supportAdvertLimit({makesProducts:true,numAdVerts:100}),false);
 assert.equal(supportAdvertLimit({makesProducts:false,numAdVerts:8},true),false);
});

import {clearCorporationBuyRates} from '../corporation-policy.js';

test('persistent buy cleanup reaches recipe inputs after irrelevant boost materials reject',()=>{
 const cleared=[];const c={getCorporation:()=>({divisions:['Agri']}),getDivision:()=>({industry:'Agriculture',cities:['A']}),getIndustryData:()=>({requiredMaterials:{Water:1,Chemicals:.2}}),hasWarehouse:()=>true,buyMaterial:(_d,_c,m,rate)=>{if(m==='Real Estate')throw Error('irrelevant');cleared.push([m,rate]);}};
 clearCorporationBuyRates(c);assert.ok(cleared.some(([m,r])=>m==='Water'&&r===0));assert.ok(cleared.some(([m,r])=>m==='Chemicals'&&r===0));
});

import {optimizedOfficeJobs,corporationOfficeScore,corporationDevelopmentCity,executeCorporationGrowth,usefulUpkeepResearch,productReplacementReady,corporationAdvertBenefit} from '../corporation-policy.js';
test('optimized offices preserve headcount, recovery interns, and separate development staffing',()=>{
 for(let n=0;n<=90;n++)for(const recovering of [false,true]){
  const office={numEmployees:n,avgEnergy:75,avgMorale:75};
  for(const developing of [false,true]){const jobs=optimizedOfficeJobs(office,true,developing,recovering);assert.equal(jobs.reduce((a,b)=>a+b,0),n);assert.ok(jobs.every(x=>Number.isInteger(x)&&x>=0));assert.equal(jobs[5],recoveryJobCounts(n,true,recovering)[5]);}
 }
 const office={numEmployees:60,avgEnergy:100,avgMorale:100};
 assert.notDeepEqual(optimizedOfficeJobs(office,true,true),optimizedOfficeJobs(office,true,false));
});
test('development office selection keeps a known active project in its creation city',()=>{
 const offices=[{city:'A',numEmployees:10},{city:'B',numEmployees:100}];
 assert.equal(corporationDevelopmentCity(offices),'B');assert.equal(corporationDevelopmentCity(offices,{creationCity:'A'}),'A');
});
test('one capital budget ranks affordable alternatives and accounts for deferred input commitments',()=>{
 let money=100;const calls=[];
 const plan=(label,cost,score,commit=0)=>({label,cost,score,priority:0,commit,run:()=>{calls.push(label);if(!commit)money-=cost;return true;}});
 const result=executeCorporationGrowth([plan('too expensive',200,100),plan('weak',40,1),plan('boost',30,3,30),plan('strong',30,2)],60,()=>money,10);
 assert.deepEqual(calls,['boost','strong']);assert.equal(result.remaining,0);assert.equal(money,70);assert.equal(result.spent,60);
 assert.equal(result.decisions.find(d=>d.label==='boost').state,'ordered');
});
test('capital planner accounts for rejected partial spending and stops on control loss',()=>{
 let money=100,allowed=true;
 const result=executeCorporationGrowth([{label:'partial',cost:20,priority:0,score:2,run:()=>{money-=5;allowed=false;return false;}},{label:'other',cost:10,priority:0,score:1,run:()=>{throw Error('must not run');}}],50,()=>money,0,()=>allowed);
 assert.equal(result.remaining,45);assert.equal(result.decisions.length,1);
});
test('automatic upkeep research requires useful offices and retains research reserves',()=>{
 const offices=[{numEmployees:30,avgEnergy:75,avgMorale:75}];
 assert.equal(usefulUpkeepResearch('AutoBrew',offices,100,20),true);
 assert.equal(usefulUpkeepResearch('AutoPartyManager',offices,100,30),false);
 assert.equal(usefulUpkeepResearch('AutoBrew',[{numEmployees:3,avgEnergy:75}],100,10),false);
});
test('product replacement waits for observed development and improvement instead of a fixed timer',()=>{
 const input={product:{designInvestment:1e9},investment:2e9,at:100,developmentMs:120000,research:100,now:180101};
 assert.equal(productReplacementReady(input),true);assert.equal(productReplacementReady({...input,now:100000}),false);
 assert.equal(productReplacementReady({...input,investment:1e9}),false);
 assert.equal(productReplacementReady({...input,investment:1e9,baselineResearch:50}),true);
});
test('advert benefit uses actual advertising growth and decreases near saturation',()=>{
 assert.ok(corporationAdvertBenefit({awareness:0,popularity:0},{advertisingFactor:.2})>0);
 assert.equal(corporationAdvertBenefit({awareness:1,popularity:1},{advertisingFactor:.2}),0);
 assert.equal(corporationAdvertBenefit({awareness:1,popularity:1},{advertisingFactor:0}),0);
 assert.equal(corporationAdvertBenefit({awareness:Number.MAX_VALUE,popularity:Number.MAX_VALUE},{advertisingFactor:.2}),0);
});

test('invalid growth budgets and cash never authorize purchases',()=>{
 const plan={label:'unsafe',cost:1,score:1,priority:0,run:()=>{throw Error('must not execute');}};
 for(const budget of [NaN,Infinity,-1])assert.equal(executeCorporationGrowth([plan],budget,()=>100,0).decisions[0].state,'budget-wait');
 assert.equal(executeCorporationGrowth([plan],100,()=>NaN,0).decisions[0].state,'budget-wait');
});

import {estimatedMaterialQuality,corporationResearchGoal} from '../corporation-policy.js';
test('early research staffing retains at least the baseline R&D headcount, including recovery',()=>{
 for(const products of [false,true])for(const recovering of [false,true])for(let n=6;n<=120;n++){
  const office={numEmployees:n,avgEnergy:100,avgMorale:100},baseline=recoveryJobCounts(n,products,recovering);
  const jobs=optimizedOfficeJobs(office,products,false,recovering,{protectResearch:true,protectEngineering:!products,researchWeight:.2});
  assert.ok(jobs[4]>=baseline[4]);assert.equal(jobs[5],baseline[5]);assert.equal(jobs.reduce((a,b)=>a+b,0),n);
 }
});
test('research milestones preserve the laboratory and TA pair research pools',()=>{
 const lab=corporationResearchGoal({points:50,laboratoryCost:100});assert.equal(lab.stage,'laboratory');assert.equal(lab.target,200);assert.equal(lab.progress,.25);assert.equal(lab.protectResearch,true);
 const pricing=corporationResearchGoal({laboratory:true,ta1:true,ta1Cost:10,ta2Cost:200,points:100});assert.equal(pricing.target,400);assert.equal(pricing.stage,'pricing');
 const done=corporationResearchGoal({laboratory:true,ta2:true},true);assert.equal(done.protectResearch,false);assert.equal(done.protectEngineering,false);
 assert.equal(corporationResearchGoal({laboratoryCost:Infinity}).target,null);
});
test('material quality estimates follow engineering and input-quality limits without invalid scores',()=>{
 assert.equal(estimatedMaterialQuality(900,{points:100,researchFactor:.5,aiStored:0,aiFactor:.3,inputQuality:1}),Math.sqrt(20));
 assert.equal(estimatedMaterialQuality(900,{points:100,researchFactor:.5,aiStored:0,aiFactor:.3,inputQuality:10}),20);
 assert.equal(estimatedMaterialQuality(NaN),1);
 const worker=[165,157.5,105,217.5,225],context={materialQuality:{points:0,researchFactor:.5,aiStored:0,aiFactor:.3,inputQuality:1}};
 assert.ok(corporationOfficeScore([5,4,1,2,3],worker,false,context)>0);
});

test('growth planning observes increased reserves from earlier deferred purchases',()=>{
 let cash=100,reserve=10;const calls=[];
 const result=executeCorporationGrowth([{label:'inputs',cost:20,score:2,priority:0,commit:20,run:()=>{reserve=90;calls.push('inputs');return true;}},{label:'upgrade',cost:20,score:1,priority:0,run:()=>{cash-=20;calls.push('upgrade');return true;}}],100,()=>cash,()=>reserve);
 assert.deepEqual(calls,['inputs']);assert.equal(result.decisions[1].state,'budget-wait');assert.equal(result.remaining,80);
});

import {corporationCoreFunding,corporationScienceFactor} from '../corporation-policy.js';
test('core launches can use retained cash without waiting for the profit-only ledger',()=>{
 assert.deepEqual(corporationCoreFunding(30e9,2e9,20e9,1e6),{ready:true,budget:25e9});
 assert.equal(corporationCoreFunding(27e9,2e9,20e9,1e6).ready,false);
 assert.equal(corporationCoreFunding(NaN,0,20e9,1).ready,false);
});
test('material scoring uses the public scienceFactor field',()=>{
 assert.equal(corporationScienceFactor({scienceFactor:.5,researchFactor:.1}),.5);
 assert.equal(corporationScienceFactor({researchFactor:.75}),.75);assert.equal(corporationScienceFactor({scienceFactor:NaN}),0);
});
test('speed-focused development raises source progress while retaining research and recovery floors',()=>{
 const office={numEmployees:60,avgEnergy:100,avgMorale:100},per=[165,157.5,105,217.5,225],context={protectResearch:true,researchWeight:.2};
 const normal=optimizedOfficeJobs(office,true,true,false,context),fast=optimizedOfficeJobs(office,true,true,false,{...context,developmentSpeed:true});
 const speed=c=>{const op=c[0]*per[0],en=c[1]*per[1],mg=c[3]*per[3];return(en**.34+op**.2)*(1+mg/(1.2*(op+en+mg)));};
 assert.ok(speed(fast)>speed(normal));assert.ok(fast[4]>=recoveryJobCounts(60,true,false)[4]);
 assert.equal(fast.reduce((a,b)=>a+b,0),60);
});
