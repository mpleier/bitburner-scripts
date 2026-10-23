import test from 'node:test';
import assert from 'node:assert/strict';
import {selectGangAugmentationGoal,gangProviderPreferred} from '../faction-policy.js';
import {estimateMixedAugmentationWait,progressionSpeed} from '../progression-speed-policy.js';
import {augmentationReputationForecast} from '../augmentation-reputation-policy.js';
const a=(name,cost,rep,prereqs=[],desired=true)=>({name,cost,rep,prereqs,desired});
const req=(f,rep)=>({rep,factions:[f],providers:[{faction:f,canDonate:false,requiredDonation:null}]});
const quote=extra=>estimateMixedAugmentationWait({requirements:[req('Gang',100)],cost:0,worth:0,cashRate:10,factionCashRate:1,reputation:{Gang:0,A:0,B:0},repRates:{Gang:1,A:1,B:1},passiveFactions:['Gang'],...extra});

test('gang target includes undesired prerequisites and native purchase inflation',()=>{
 const q=selectGangAugmentationGoal([a('Root',10,200,[],false),a('Goal',100,100,['Root'])],{multiplier:2,repRate:10,cashRate:10});
 assert.deepEqual(q.chain,['Root','Goal']);assert.equal(q.cost,210);assert.equal(q.rep,200);assert.equal(q.etaSeconds,21);
 const owned=selectGangAugmentationGoal([a('Root',10,200,[],false),a('Goal',100,100,['Root'])],{owned:['Root']});
 assert.deepEqual(owned.chain,['Goal']);assert.equal(owned.cost,100);assert.equal(owned.rep,100);
});
test('gang prerequisite closure deduplicates shared roots and rejects unavailable cycles',()=>{
 const items=[a('R',1,1,[],false),a('L',2,2,['R'],false),a('T',3,3,['R'],false),a('Goal',4,4,['L','T'])];
 const q=selectGangAugmentationGoal(items);assert.equal(q.chain.length,4);assert.equal(new Set(q.chain).size,4);
 assert.equal(selectGangAugmentationGoal([a('A',1,1,['B']),a('B',1,1,['A'])]),null);
 assert.equal(selectGangAugmentationGoal([a('A',1,1,['Missing'])]),null);
 assert.equal(selectGangAugmentationGoal([a('A',Infinity,1)]),null);
 assert.equal(selectGangAugmentationGoal(items,{multiplier:NaN}),null);
});
test('provider comparison retains unlocked faster and unmeasured alternatives',()=>{
 assert.equal(gangProviderPreferred(100,{gangRep:0,gangRate:10,otherRep:0,otherRate:1}),true);
 assert.equal(gangProviderPreferred(100,{gangRep:100,gangRate:0,otherRep:100}),false);
 assert.equal(gangProviderPreferred(100,{gangRep:0,gangRate:10,otherRep:99,otherRate:1}),false);
 assert.equal(gangProviderPreferred(100,{gangRep:0,gangRate:10,otherRep:0}),false);
 assert.equal(gangProviderPreferred(100,{gangRep:100,otherRep:0}),true);
 assert.equal(gangProviderPreferred(100,{gangRep:NaN}),false);
});
test('gang rep runs alongside sequential player faction work',()=>{
 const q=quote({requirements:[req('Gang',100),req('A',60),req('B',60)]});
 assert.equal(q.seconds,120);assert.equal(q.reputationSeconds,120);
 assert.deepEqual(q.workByFaction,{A:60,B:60});assert.deepEqual(q.workTargets,{A:60,B:60});assert.deepEqual(q.passiveByFaction,{Gang:100});
 assert.equal(quote({requirements:[req('Gang',100),req('Gang',60)]}).seconds,100);
});
test('passive reputation keeps normal cash earning while active work uses its measured rate',()=>{
 assert.equal(quote({cost:1000}).seconds,100);
 assert.equal(quote({cost:1000,requirements:[req('Gang',100),req('A',10)]}).seconds,1000);
 assert.equal(quote({repRates:{}}),null);
});
test('gang reputation augmentation value charges lost reputation after install',()=>{
 const c={horizonMs:1e6,worth:0,cashRate:1,factionCashRate:0,reputation:{Gang:0},repRates:{Gang:1},passiveFactions:['Gang'],targets:[{name:'Target',useful:true,cost:0,requirements:[req('Gang',100)]}]};
 const forecast=()=>augmentationReputationForecast([{name:'Rep',stats:{faction_rep:2}}],c,estimateMixedAugmentationWait);
 assert.equal(forecast().netSavingsMs,50000);
 c.reputation.Gang=90;assert.equal(forecast().netSavingsMs,0);assert.equal(forecast().resetWithBoostMs,50000);
});
test('stable gang observations publish a passive channel without claiming player work',()=>{
 let previous;
 const run=(at,rep,patch={})=>{
  const result=progressionSpeed({now:at,augReset:2,nodeReset:1,previous,snapshot:{at,augReset:2,nodeReset:1,worth:0,reputation:{Gang:rep},gangFaction:'Gang',gangRepRate:1,...patch}});
  previous=result.observation;return result;
 };
 assert.deepEqual(run(100000,0).reputationPlanningContext.passiveFactions,[]);
 assert.deepEqual(run(130000,30).reputationPlanningContext.passiveFactions,[]);
 const q=run(160000,60);assert.deepEqual(q.reputationPlanningContext.passiveFactions,['Gang']);assert.equal(q.reputationPlanningContext.repRates.Gang,1);assert.deepEqual(q.observation.reputationWorkRates,{});
 assert.equal(run(190000,3060).reputationPlanningContext.repRates.Gang,1);
 assert.deepEqual(run(220000,3060,{gangRepRate:0}).reputationPlanningContext.passiveFactions,[]);
});
