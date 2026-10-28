import test from 'node:test';
import assert from 'node:assert/strict';
import {planCorporationResearchBundles,executeCorporationResearchBundle} from '../corporation-policy.js';
import {researchParents} from '../corporation-lifecycle.js';
const context={valid:true,products:true,scienceFactor:.1,rate:1,salesReady:true,sellThrough:1,backlog:false};
const input={names:['Drones','Drones - Assembly','Self-Correcting Assemblers'],owned:['Hi-Tech R&D Laboratory'],costs:{Drones:5000,'Drones - Assembly':25000,'Self-Correcting Assemblers':25000},parents:researchParents,points:40000,context};
const plan=()=>planCorporationResearchBundles(input)[0];
function market({balance=40000,costs=input.costs,owned=['Hi-Tech R&D Laboratory'],fail=null}={}){
 const have=new Set(owned),bought=[],quotes=[];let points=balance;
 const api={owned:n=>have.has(n),cost:n=>{quotes.push(n);return costs[n];},points:()=>points,buy:n=>{bought.push(n);if(n===fail)return false;points-=costs[n];have.add(n);return true;}};
 return {api,bought,quotes,balance:()=>points};
}
test('complete prerequisite cost competes fairly with a direct research alternative',()=>{
 const before=JSON.stringify(input),plans=planCorporationResearchBundles(input),p=plans[0];
 assert.equal(p.target,'Drones - Assembly');assert.equal(p.cost,30000);assert.equal(p.retainedPoints,10000);
 assert.deepEqual(p.items.map(i=>i.name),['Drones','Drones - Assembly']);assert.equal(JSON.stringify(input),before);
 assert.ok(plans.some(p=>p.target==='Self-Correcting Assemblers'));assert.ok(!plans.some(p=>p.target==='Drones'));
});
test('owned prerequisites are neither charged nor purchased twice',()=>{
 const p=planCorporationResearchBundles({...input,owned:[...input.owned,'Drones']}).find(p=>p.target==='Drones - Assembly');
 assert.equal(p.cost,25000);assert.deepEqual(p.items.map(i=>i.name),['Drones - Assembly']);
 const m=market({owned:[...input.owned,'Drones']});const r=executeCorporationResearchBundle(m.api,plan());
 assert.equal(r.complete,true);assert.deepEqual(m.bought,['Drones - Assembly']);assert.equal(m.balance(),15000);
});
test('legacy bundle threshold prices the sequential retained pools rather than multiplying the total bill',()=>{
 const base={...input,names:['Drones','Drones - Assembly'],context:null};
 assert.equal(planCorporationResearchBundles({...base,points:129999}).length,0);
 const p=planCorporationResearchBundles({...base,points:130000})[0];assert.equal(p.decision.early,false);assert.equal(p.decision.target,130000);
 assert.equal(planCorporationResearchBundles({...base,points:30000}).length,0);
});
test('missing, cyclic, invalid and oversized catalogs never authorize an incomplete package',()=>{
 for(const patch of [{names:['Drones - Assembly']},{parents:{Drones:'Drones - Assembly','Drones - Assembly':'Drones'}},{costs:{Drones:5000,'Drones - Assembly':NaN}},{costs:{Drones:5000,'Drones - Assembly':Infinity}},{names:Array(257).fill('Drones')},{points:NaN}])
  assert.equal(planCorporationResearchBundles({...input,names:['Drones','Drones - Assembly'],...patch}).length,0);
});
test('executor retains the quoted research pool and obeys dependency order',()=>{
 const m=market(),r=executeCorporationResearchBundle(m.api,plan());assert.equal(r.complete,true);
 assert.deepEqual(m.bought,['Drones','Drones - Assembly']);assert.equal(m.balance(),10000);assert.equal(r.spent,30000);
});
test('changed child price or insufficient total balance stops before paying for the parent',()=>{
 for(const options of [{costs:{...input.costs,'Drones - Assembly':26000}},{balance:39999}]){
  const m=market(options),r=executeCorporationResearchBundle(m.api,plan());assert.equal(r.complete,false);assert.deepEqual(m.bought,[]);
 }
 const m=market();assert.equal(executeCorporationResearchBundle(m.api,plan(),()=>false).complete,false);assert.deepEqual(m.bought,[]);
});
test('native rejection and later quote changes never continue into another research purchase',()=>{
 const parent=market({fail:'Drones'});assert.equal(executeCorporationResearchBundle(parent.api,plan()).complete,false);assert.deepEqual(parent.bought,['Drones']);
 const child=market({fail:'Drones - Assembly'}),r=executeCorporationResearchBundle(child.api,plan());assert.equal(r.complete,false);assert.deepEqual(r.purchased,['Drones']);assert.equal(r.spent,5000);
 const changed=market(),buy=changed.api.buy;changed.api.buy=n=>{const ok=buy(n);changed.api.cost=()=>999999;return ok;};
 assert.equal(executeCorporationResearchBundle(changed.api,plan()).complete,false);assert.deepEqual(changed.bought,['Drones']);
});
test('malformed dependencies and missing native ownership fail before the first spend',()=>{
 for(const p of [{...plan(),retainedPoints:NaN},{...plan(),items:[{name:'Drones',cost:5000,parent:'Missing'}]}, {...plan(),items:[plan().items[0],plan().items[0]]}]){
  const m=market();assert.equal(executeCorporationResearchBundle(m.api,p).complete,false);assert.deepEqual(m.bought,[]);
 }
 const m=market();m.api.owned=()=>undefined;assert.equal(executeCorporationResearchBundle(m.api,plan()).complete,false);assert.deepEqual(m.bought,[]);
});


test('a fully funded single upgrade still competes on benefit against an early multi-step package',()=>{
 const plans=planCorporationResearchBundles({names:['uPgrade: Capacity.II','uPgrade: Capacity.I','uPgrade: Fulcrum','Drones - Assembly'],owned:['Hi-Tech R&D Laboratory','Drones'],costs:{'uPgrade: Capacity.II':30000,'uPgrade: Capacity.I':50000,'uPgrade: Fulcrum':10000,'Drones - Assembly':25000},parents:researchParents,points:150000,context:{...context,maxProducts:3,matureProducts:3,canFundProduct:true}});
 assert.equal(plans[0].target,'Drones - Assembly');
 const packagePlan=plans.find(p=>p.target==='uPgrade: Capacity.II');assert.equal(packagePlan.cost,90000);
 assert.deepEqual(packagePlan.items.map(i=>i.name),['uPgrade: Fulcrum','uPgrade: Capacity.I','uPgrade: Capacity.II']);
});
