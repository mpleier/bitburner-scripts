import test from 'node:test';
import assert from 'node:assert/strict';
import {observeCorporationUpkeep,corporationUpkeepResearchValues,planCorporationResearchBundles} from '../corporation-policy.js';
import {researchParents} from '../corporation-lifecycle.js';
const now=40000,samples=[10000,20000,30000].map(at=>({at,tea:10000,party:0}));
const office={numEmployees:30,avgEnergy:70,maxEnergy:100,avgMorale:100,maxMorale:100,employeeJobs:{Intern:8}};
test('history includes zero-spend cycles and rejects stale or malformed charges',()=>{
 let history=observeCorporationUpkeep([], {tea:10000,party:0},10000);
 history=observeCorporationUpkeep(history,{tea:0,party:0},20000);history=observeCorporationUpkeep(history,{tea:0,party:0},30000);
 const value=corporationUpkeepResearchValues([],{samples:history,revenue:10000,expenses:10000,cycleSeconds:10,now});
 assert.ok(Math.abs(value.AutoBrew.savingsPerSecond-10000/30)<1e-8);
 assert.equal(observeCorporationUpkeep(history,{tea:-1,party:0},now).length,0);
 assert.equal(corporationUpkeepResearchValues([],{samples:history,revenue:10000,expenses:10000,now:200000}).AutoBrew.known,false);
 assert.equal(corporationUpkeepResearchValues([],{samples:[samples[0],samples[0],samples[0]],revenue:10000,expenses:10000,now}).AutoBrew.known,false);
});
test('unfunded recovery has value but funded workers and unresolved second deficits are not counted twice',()=>{
 const data={revenue:0,expenses:0,now};
 const free=corporationUpkeepResearchValues([{office,fundedBudget:0}],data);
 assert.ok(free.AutoBrew.staffingBenefit>0);assert.equal(free.AutoPartyManager.benefit,0);
 assert.equal(corporationUpkeepResearchValues([{office,fundedBudget:1e8}],data).AutoBrew.staffingBenefit,0);
 assert.equal(corporationUpkeepResearchValues([{office:{...office,avgMorale:70},fundedBudget:0}],data).AutoBrew.staffingBenefit,0);
});
test('zero savings or missing observations never buy unused upkeep research',()=>{
 const context={valid:true,products:true,scienceFactor:.1,rate:1};
 for(const upkeepValues of [{},corporationUpkeepResearchValues([],{samples:samples.map(s=>({...s,tea:0})),revenue:10000,expenses:10000,now})]){
  const plans=planCorporationResearchBundles({names:['AutoBrew'],owned:['Hi-Tech R&D Laboratory'],costs:{AutoBrew:12000},parents:researchParents,points:100000,context:{...context,upkeepValues}});
  assert.equal(plans.length,0);
 }
});
test('cost savings and production packages share a single benefit comparison',()=>{
 const input={names:['AutoBrew','Drones','Drones - Assembly'],owned:['Hi-Tech R&D Laboratory'],costs:{AutoBrew:12000,Drones:5000,'Drones - Assembly':25000},parents:researchParents,points:40000};
 const context={valid:true,products:true,scienceFactor:.1,rate:1,salesReady:true,sellThrough:1,backlog:false};
 const value=amount=>corporationUpkeepResearchValues([],{samples:samples.map(s=>({...s,tea:amount})),revenue:1e6,expenses:1e5,cycleSeconds:10,now});
 assert.equal(planCorporationResearchBundles({...input,context:{...context,upkeepValues:value(30000)}})[0].target,'Drones - Assembly');
 assert.equal(planCorporationResearchBundles({...input,context:{...context,upkeepValues:value(2000000)}})[0].target,'AutoBrew');
});


test('a legacy point threshold does not override known negative upkeep value',()=>{
 const upkeepValues=corporationUpkeepResearchValues([],{samples,revenue:1e6,expenses:1e5,cycleSeconds:10,now});
 const plans=planCorporationResearchBundles({names:['AutoBrew'],owned:['Hi-Tech R&D Laboratory'],costs:{AutoBrew:12000},parents:researchParents,points:100000,context:{valid:true,products:true,scienceFactor:1,rate:0,upkeepValues}});
 assert.equal(plans.length,0);
});
