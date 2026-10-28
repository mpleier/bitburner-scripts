import test from 'node:test';
import assert from 'node:assert/strict';
import {corporationUpkeepResearchValues,planCorporationResearchBundles,executeCorporationResearchBundle} from '../corporation-policy.js';
import {researchParents} from '../corporation-lifecycle.js';
const pair='AutoBrew + AutoPartyManager';
const office={numEmployees:30,avgEnergy:70,avgMorale:70,maxEnergy:100,maxMorale:100,employeeJobs:{Intern:8}};
const values=(o=office,fundedBudget=0)=>corporationUpkeepResearchValues([{office:o,fundedBudget}],{revenue:0,expenses:0});
const input=(upkeepValues=values())=>({names:['AutoBrew','AutoPartyManager'],owned:['Hi-Tech R&D Laboratory'],costs:{AutoBrew:12000,AutoPartyManager:15000},parents:researchParents,points:40000,context:{valid:true,products:true,scienceFactor:.1,rate:1,upkeepValues}});
test('simultaneous deficits have joint recovery value without attributing the same staff to each single',()=>{
 const v=values();assert.equal(v.AutoBrew.staffingBenefit,0);assert.equal(v.AutoPartyManager.staffingBenefit,0);
 assert.ok(v[pair].staffingBenefit>0);assert.ok(v[pair].staffingBenefit<=.25);
 const p=planCorporationResearchBundles(input())[0];assert.equal(p.target,pair);assert.equal(p.cost,27000);assert.equal(p.retainedPoints,13000);
 assert.deepEqual(p.items.map(i=>i.name),['AutoPartyManager','AutoBrew']);
});
test('funded or healthy recovery never creates an artificial joint opportunity',()=>{
 assert.equal(values(office,1e8)[pair].staffingBenefit,0);
 const healthy=values({...office,avgEnergy:100,avgMorale:100});assert.equal(healthy[pair].benefit,0);
 assert.equal(planCorporationResearchBundles(input(healthy)).length,0);
 const single=planCorporationResearchBundles(input(values({...office,avgMorale:100})));
 assert.ok(single.some(p=>p.target==='AutoBrew'));assert.ok(!single.some(p=>p.target===pair));
});
test('owned automatic upkeep is not charged again and can resolve the other condition for a single upgrade',()=>{
 const data=input(values({...office,autoTea:true}));data.owned.push('AutoBrew');delete data.costs.AutoBrew;
 const plans=planCorporationResearchBundles(data);assert.equal(plans[0].target,'AutoPartyManager');assert.equal(plans[0].cost,15000);
 assert.ok(!plans.some(p=>p.target===pair));
});
test('combined cost, missing quotes and full quality loss can veto the pair',()=>{
 assert.equal(planCorporationResearchBundles({...input(),points:33000}).length,0);
 assert.equal(planCorporationResearchBundles({...input(),costs:{AutoBrew:12000}}).length,0);
 const data=input();data.points=100000;data.context.scienceFactor=1;
 assert.ok(!planCorporationResearchBundles(data).some(p=>p.target===pair));
});
test('pair executes using only native research names and retains the combined RP reserve',()=>{
 const p=planCorporationResearchBundles(input())[0],owned=new Set(['Hi-Tech R&D Laboratory']),bought=[];let points=40000;
 const api={owned:n=>owned.has(n),cost:n=>input().costs[n],points:()=>points,buy:n=>{bought.push(n);points-=input().costs[n];owned.add(n);return true;}};
 const result=executeCorporationResearchBundle(api,p);assert.equal(result.complete,true);assert.equal(points,13000);assert.equal(result.spent,27000);
 assert.deepEqual(bought,['AutoPartyManager','AutoBrew']);assert.ok(!bought.includes(pair));
});
test('an unfunded or rejected second purchase cannot cause extra research spending',()=>{
 const p=planCorporationResearchBundles(input())[0],owned=new Set(['Hi-Tech R&D Laboratory']);let points=40000;const calls=[];
 const api={owned:n=>owned.has(n),cost:n=>input().costs[n],points:()=>points,buy:n=>{calls.push(n);if(n==='AutoBrew')return false;points-=15000;owned.add(n);return true;}};
 const result=executeCorporationResearchBundle(api,p);assert.equal(result.complete,false);assert.equal(result.spent,15000);assert.deepEqual(result.purchased,['AutoPartyManager']);
 assert.deepEqual(calls,['AutoPartyManager','AutoBrew']);
 const blocked=[];api.cost=n=>n==='AutoBrew'?13000:15000;api.buy=n=>{blocked.push(n);return true;};points=40000;owned.clear();owned.add('Hi-Tech R&D Laboratory');
 assert.equal(executeCorporationResearchBundle(api,p).complete,false);assert.deepEqual(blocked,[]);
});


test('paired recovery competes with production rather than taking automatic priority',()=>{
 for(const [level,expected]of [[70,pair],[95.5,'Drones - Assembly']]){
  const data=input(values({...office,avgEnergy:level,avgMorale:level}));
  data.names.push('Drones','Drones - Assembly');data.costs.Drones=5000;data.costs['Drones - Assembly']=25000;
  Object.assign(data.context,{salesReady:true,sellThrough:1,backlog:false});
  assert.equal(planCorporationResearchBundles(data)[0].target,expected);
 }
});
