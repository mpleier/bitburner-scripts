import test from 'node:test';
import assert from 'node:assert/strict';
import {productInvestment,acceptVentureOffer,rescueShareIssue,shareSale,shareBuyback,recipeInputPlan,researchParents,investmentDecision,estimateShareProceeds,corporationDividendRate,corporationLiquidityTarget} from '../corporation-lifecycle.js';
test('venture funding preserves the configured ownership floor across all rounds',()=>{
 const info={public:false,funds:1e9,numShares:900e6,totalShares:1e9};
 assert.equal(acceptVentureOffer(info,{round:2,funds:2e9,shares:350e6}),true);
 assert.equal(acceptVentureOffer({...info,numShares:550e6},{round:3,funds:2e9,shares:250e6}),false);
 assert.equal(acceptVentureOffer({...info,public:true},{round:1,funds:2e9,shares:100e6}),false);
});
test('emergency share issuance respects dilution, profitability and cooldown',()=>{
 const info={public:true,funds:1e6,revenue:0,expenses:1e6,sharePrice:100,totalShares:1e9,numShares:550e6};
 assert.equal(rescueShareIssue(info,1e9),20e6);
 assert.equal(rescueShareIssue({...info,issueNewSharesCooldown:1},1e9),0);
 assert.equal(rescueShareIssue({...info,revenue:2e6},1e9),0);
 assert.equal(rescueShareIssue({...info,numShares:500e6},1e9),0);
});
test('share sales and buybacks preserve reserved cash and ownership',()=>{
 const info={public:true,revenue:0,expenses:1,sharePrice:100,numShares:500e6,totalShares:1e9,issuedShares:100e6};
 assert.equal(shareSale(info,0,0),0);
 assert.equal(shareSale({...info,numShares:600e6},0,0),10e6);
 assert.equal(shareSale({...info,numShares:600e6,shareSaleCooldown:1},0,0),0);
 assert.equal(shareBuyback(info,1e9,1e9),0);
 assert.equal(shareBuyback(info,2e9,1e9),0);
});
test('product investment scales with capital and obeys its growth allocation',()=>{
 assert.equal(productInvestment(20e6,0),0);
 assert.equal(productInvestment(1e9,0),10e6);
 assert.equal(productInvestment(3e12,5e9),14.975e9);
 assert.equal(productInvestment(3e12,5e9,100e6),25e6);
});
test('recipe input rates deduct existing stock and share one purchase allowance',()=>{
 const plan=recipeInputPlan({Water:.5,Plants:1},{Water:{stored:20,marketPrice:2},Plants:{stored:0,marketPrice:4}},10,100);
 assert.ok(plan.cost<=100);
 assert.ok(Math.abs(plan.orders.reduce((sum,item)=>sum+item.rate*10*({Water:2,Plants:4}[item.name]),0)-100)<1e-8);
 assert.ok(recipeInputPlan({Water:1},{Water:{stored:1000,marketPrice:2}},1,100).orders.every(item=>item.rate===0));
 assert.ok(recipeInputPlan({Water:1},{Water:{marketPrice:2}},10,0).orders.every(item=>item.rate===0));
 assert.equal(researchParents['Go-Juice'],'Automatic Drug Administration');
});


test('private funding settles improving offers, blocks premature IPO and honors ownership',()=>{
 const info={public:false,funds:1e9,numShares:900e6,totalShares:1e9,revenue:1e6,expenses:0},offer={round:1,funds:10e9,shares:100e6};
 const initial=investmentDecision(info,offer,null,.5,{now:1000,reserve:1e8});assert.equal(initial.accept,false);assert.equal(initial.holdIPO,true);
 assert.equal(investmentDecision(info,offer,initial.history,.5,{now:102000,reserve:1e8}).accept,true);
 const growing=investmentDecision(info,{...offer,funds:12e9},initial.history,.5,{now:102000,reserve:1e8});assert.equal(growing.accept,false);
 assert.equal(investmentDecision(info,offer,initial.history,.5,{now:1801000,stageReady:false}).accept,true);
 assert.equal(investmentDecision({...info,numShares:550e6},offer,null,.5).holdIPO,false);
});
test('profitable corporations can fund real cash deficits while small dividend waits avoid sales',()=>{
 const info={public:true,sharePrice:100,numShares:900e6,totalShares:1e9,revenue:10e6,expenses:0,dividendRate:.2,tributeModifier:.15};
 assert.equal(shareSale(info,0,0,.5,1e6),0);
 const count=shareSale(info,0,0,.5,200e6);assert.ok(count>0);
 const sale=shareSale(info,0,0,.5,1e9);assert.ok(sale>0&&sale<=10e6);
 assert.equal(shareSale({...info,shareSaleCooldown:1},0,0,.5,1e9),0);
 assert.ok(estimateShareProceeds(info,1e6)<1e6*100);
});
test('share actions reject invalid fields and buybacks preserve liquidity',()=>{
 assert.equal(shareSale({public:true,sharePrice:NaN,numShares:1e9,totalShares:1e9},0,0),0);
 const info={public:true,sharePrice:100,numShares:500e6,totalShares:1e9,issuedShares:1e8};
 assert.equal(shareBuyback(info,1e9,0),0);assert.equal(shareBuyback(info,2e9,0),80000);
});

test('dividend waiting uses source tribute exponent over the full market cycle',()=>{
 const info={revenue:10e6,expenses:0,dividendRate:.2,numShares:900e6,totalShares:1e9,tributeModifier:.15};
 assert.equal(corporationDividendRate(info),(18e6)**.85/10);
 assert.equal(corporationDividendRate({...info,tributeModifier:0}),1.8e6);
 assert.equal(corporationDividendRate({...info,expenses:20e6}),0);
 assert.equal(corporationDividendRate({...info,tributeModifier:NaN}),0);
});
test('invalid buyback inputs cannot produce a NaN or spend reserved funds',()=>{
 const info={public:true,sharePrice:100,numShares:500e6,totalShares:1e9,issuedShares:1e8};
 assert.equal(shareBuyback(info,NaN,0),0);assert.equal(shareBuyback(info,2e9,0,NaN),0);
});

test('product capital rejects invalid or negative cash and reserve inputs',()=>{
 for(const args of [[NaN,0],[Infinity,0],[100,-1],[100,0,NaN],[100,0,-1]])assert.equal(productInvestment(...args),0);
});

test('liquidity targets reject invalid, mismatched or expired augmentation snapshots',()=>{
 const fallback=corporationLiquidityTarget(null,{augReset:1,wallet:1e9,reserve:1e8,maxProceeds:1e10});
 assert.equal(fallback.targetCash,1.1e9);assert.deepEqual(fallback.priorityShortfalls,[]);
 const expired=corporationLiquidityTarget({augReset:1,at:1000,worth:1e9},{now:70000,augReset:1,wallet:1e9,reserve:1e9,maxProceeds:1e10});
 assert.equal(expired.targetCash,2e9);assert.deepEqual(expired.priorityShortfalls,[]);
 const mismatched=corporationLiquidityTarget({augReset:2,at:1000,worth:1e9},{now:2000,augReset:1,wallet:1e9,reserve:1e9,maxProceeds:1e10});
 assert.equal(mismatched.targetCash,2e9);assert.deepEqual(mismatched.priorityShortfalls,[]);
});

test('liquidity target selects affordable priority milestone and respects standalone pricing',()=>{
 const snapshot={augReset:1,at:1000,worth:10e9,reputation:{Bladeburners:5000},targets:[
  {name:"The Blade's Simulacrum",priority:0,cost:500e9,standaloneCost:400e9,rep:3750,factions:['Bladeburners'],donationCost:0},
  {name:"Neuroreceptor Management Implant",priority:1,cost:100e9,standaloneCost:50e9,rep:1000,factions:['Bladeburners'],donationCost:0}
 ]};
 const decision=corporationLiquidityTarget(snapshot,{now:2000,augReset:1,wallet:10e9,reserve:0,maxProceeds:500e9});
 assert.equal(decision.augmentation,"The Blade's Simulacrum");
 assert.equal(decision.targetCash,10e9+390e9);
 assert.ok(Array.isArray(decision.priorityShortfalls));
 assert.equal(decision.priorityShortfalls[0].name,"The Blade's Simulacrum");
 assert.equal(decision.priorityShortfalls[0].reputationReady,true);

 const partial=corporationLiquidityTarget(snapshot,{now:2000,augReset:1,wallet:10e9,reserve:0,maxProceeds:100e9});
 assert.equal(partial.augmentation,"Neuroreceptor Management Implant");
 assert.equal(partial.targetCash,10e9+40e9);
 assert.ok(Array.isArray(partial.priorityShortfalls));

 const unfundable=corporationLiquidityTarget(snapshot,{now:2000,augReset:1,wallet:10e9,reserve:1e9,maxProceeds:10e9});
 assert.equal(unfundable.targetCash,2e9);
 assert.equal(unfundable.augmentation,undefined);
 assert.equal(unfundable.priorityShortfalls.length,2);
});

