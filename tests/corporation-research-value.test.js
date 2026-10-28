import test from 'node:test';
import assert from 'node:assert/strict';
import {corporationResearchRate,corporationResearchDecision,corporationResearchGoal} from '../corporation-policy.js';
const context={valid:true,products:true,scienceFactor:.1,rate:1,salesReady:true,sellThrough:1,backlog:false};
test('lab can unlock below twice cost with evidence and a retained pool',()=>{
 const d=corporationResearchDecision({name:'Hi-Tech R&D Laboratory',points:15000,cost:10000,context});
 assert.equal(d.ready,true);assert.equal(d.early,true);assert.ok(d.qualityLoss<d.estimatedBenefit);
 assert.equal(corporationResearchDecision({name:'Hi-Tech R&D Laboratory',points:12000,cost:10000,context}).ready,false);
 const goal=corporationResearchGoal({points:15000,laboratoryCost:10000},true,context);assert.equal(goal.progress,1);assert.equal(goal.target,15000);
});
test('unknown rate, incomplete context and nearly completed legacy waits do not justify early spending',()=>{
 for(const patch of [{valid:false},{rate:null},{rate:0},{rate:Infinity},{rate:1e9},{scienceFactor:NaN}]){
  assert.equal(corporationResearchDecision({name:'Hi-Tech R&D Laboratory',points:15000,cost:10000,context:{...context,...patch}}).ready,false);
 }
 assert.equal(corporationResearchDecision({name:'Hi-Tech R&D Laboratory',points:20000,cost:10000}).ready,true);
 for(const cost of [NaN,Infinity,-1])assert.equal(corporationResearchDecision({name:'Hi-Tech R&D Laboratory',points:15000,cost,context}).ready,false);
});
test('high retained-pool quality value can outweigh the research unlock',()=>{
 const material={...context,products:false,scienceFactor:1,qualityRows:[{engineering:0,aiStored:0,aiFactor:0,inputQuality:1}]};
 const d=corporationResearchDecision({name:'Hi-Tech R&D Laboratory',points:15000,cost:10000,context:material});assert.equal(d.ready,false);assert.ok(d.qualityLoss>.1);
 const missing={...material,qualityRows:[{engineering:NaN,aiStored:0,aiFactor:0,inputQuality:1}]};
 assert.equal(corporationResearchDecision({name:'Hi-Tech R&D Laboratory',points:15000,cost:10000,context:missing}).ready,false);
});
test('early automated pricing requires complete sales evidence and prices the entire prerequisite pair',()=>{
 const input={name:'Market-TA.II',points:100000,cost:70000,context:{...context,pricingGap:.5}};
 assert.equal(corporationResearchDecision(input).ready,true);
 assert.equal(corporationResearchDecision({...input,context:{...input.context,salesReady:false}}).ready,false);
 assert.equal(corporationResearchDecision({...input,points:60000}).ready,false);
 assert.equal(corporationResearchDecision({...input,context:{...input.context,pricingGap:0}}).ready,false);
});
test('optional production research depends on sell-through and known source effects',()=>{
 const input={name:'Self-Correcting Assemblers',points:40000,cost:25000,context};
 assert.equal(corporationResearchDecision(input).ready,true);
 assert.equal(corporationResearchDecision({...input,context:{...context,backlog:true}}).ready,false);
 assert.equal(corporationResearchDecision({...input,name:'Unknown Research'}).ready,false);
 const capacity={...input,name:'uPgrade: Capacity.I',cost:20000,context:{...context,maxProducts:3,matureProducts:3,canFundProduct:true}};
 assert.equal(corporationResearchDecision(capacity).ready,true);
 assert.equal(corporationResearchDecision({...capacity,context:{...capacity.context,canFundProduct:false}}).ready,false);
});


test('research production samples correct own spending and reject stale or inconsistent observations',()=>{
 const previous={at:1000,points:15000,spent:10000};
 assert.equal(corporationResearchRate(previous,5010,11000),1);
 assert.equal(corporationResearchRate(previous,5000,11000),0);
 assert.equal(corporationResearchRate(previous,4999,11000),null);
 assert.equal(corporationResearchRate(previous,5010,1000),null);
 assert.equal(corporationResearchRate(previous,5010,122000),null);
 assert.equal(corporationResearchRate({...previous,spent:20000},5010,11000),null);
 assert.equal(corporationResearchRate(null,5010,11000),null);
});
