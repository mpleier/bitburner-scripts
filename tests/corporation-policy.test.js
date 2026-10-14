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
