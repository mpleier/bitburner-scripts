import test from 'node:test';
import assert from 'node:assert/strict';
import {productPriceStep,outputBacklog} from '../corporation-policy.js';
import {investmentDecision} from '../corporation-lifecycle.js';
test('zero-production stock with tiny positive sales reduces price and counts as backlog',()=>{
 const item={productionAmount:0,actualSellAmount:.004645,stored:800.174,effectiveRating:47.38};
 const q=productPriceStep(item,{multiplier:1.20043});assert.ok(q.multiplier<1.01);assert.ok(q.multiplier>=1);assert.equal(outputBacklog([item]),true);
 assert.equal(productPriceStep({...item,actualSellAmount:100},{multiplier:1.2}).multiplier,1.2);assert.equal(outputBacklog([{...item,actualSellAmount:100}]),false);
});
test('empty, invalid and developing inventory does not trigger discount feedback',()=>{
 for(const patch of [{stored:0},{stored:NaN},{productionAmount:-1},{actualSellAmount:-1}])assert.equal(productPriceStep({productionAmount:0,actualSellAmount:0,stored:800,...patch},{multiplier:1.2}).multiplier,1.2);
 assert.equal(outputBacklog([{stored:0,productionAmount:0,actualSellAmount:0}]),false);
});
test('settled eligible early offer can unblock an unaffordable stage after bounded waiting',()=>{
 const now=2000000,info={funds:1.6e9,revenue:31671,expenses:27811,public:false,numShares:1e9,totalShares:1e9},offer={round:1,funds:2e9,shares:1e8},history={round:1,since:0,lastGrowthAt:0,growthAnchor:2e9,peak:2e9};
 const opts={now,reserve:1.6e8,stageReady:false,stageCapital:45e9};
 assert.equal(investmentDecision(info,offer,history,.5,opts).accept,true);
 for(const change of [{now:100000},{stageCapital:1e8},{stageCapital:null}])assert.equal(investmentDecision(info,offer,history,.5,{...opts,...change}).accept,false);
 assert.equal(investmentDecision(info,{...offer,funds:365e6},history,.5,opts).accept,false);
 assert.equal(investmentDecision(info,{...offer,shares:9e8},history,.5,opts).accept,false);
 assert.equal(investmentDecision(info,{...offer,funds:3e9},history,.5,opts).accept,false);
});
