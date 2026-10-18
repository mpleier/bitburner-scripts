import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pruneAugmentationPrerequisites,optimizeAugmentationOrder,futureAugmentationBasketCost,neuroFluxLevels} from '../faction-policy.js';
const aug=(name,price,prereqs=[])=>({name,price,prereqs});
const cost=(items,m=1.9)=>items.reduce((s,a,i)=>s+a.price*m**i,0);
function valid(items,owned=[]){const seen=new Set(owned);for(const a of items){if(!a.prereqs.every(n=>seen.has(n)))return false;seen.add(a.name);}return true;}
test('dropping a prerequisite removes its dependent chain while retaining installed prerequisites',()=>{
 const items=[aug('Child',200,['Parent']),aug('Leaf',100,['Child']),aug('Safe',20,['Installed'])];
 assert.deepEqual(pruneAugmentationPrerequisites(items,['Installed']).map(a=>a.name),['Safe']);assert.equal(items.length,3);
});
test('small purchase baskets use a cheaper valid order than dependency bubbling',()=>{
 const A=aug('A',100,['B']),B=aug('B',1),C=aug('C',90),items=[A,C,B];
 const ordered=optimizeAugmentationOrder(items);
 assert.deepEqual(ordered.map(a=>a.name),['C','B','A']);assert.ok(valid(ordered));assert.ok(cost(ordered)<cost([B,A,C]));
 assert.equal(ordered[0],C);assert.deepEqual(items,[A,C,B]);
});
function exhaustive(items,m){let best=Infinity;function walk(order,left){if(!left.length){if(valid(order))best=Math.min(best,cost(order,m));return;}for(let i=0;i<left.length;i++)walk([...order,left[i]],left.filter((_,j)=>j!==i));}walk([],items);return best;}
test('exact planner matches exhaustive search across shared roots and SF11 price multipliers',()=>{
 for(const m of [1,1.9,1.9*.93]){
  const items=[aug('Root',2),aug('A',100,['Root']),aug('B',80,['Root']),aug('C',90),aug('D',20,['C'])];
  const ordered=optimizeAugmentationOrder(items,m);assert.ok(valid(ordered));assert.ok(Math.abs(cost(ordered,m)-exhaustive(items,m))<1e-7);
 }
});
test('large baskets retain valid prerequisites and improve or preserve a dependency-first baseline',()=>{
 const items=[aug('Root',1),...Array.from({length:19},(_,i)=>aug('A'+i,100-i,i%3===0?['Root']:[]))];
 const sorted=items.slice().sort((a,b)=>b.price-a.price),baseline=[],done=new Set();
 const visit=a=>{if(done.has(a.name))return;for(const n of a.prereqs)visit(items.find(x=>x.name===n));done.add(a.name);baseline.push(a);};sorted.forEach(visit);
 const ordered=optimizeAugmentationOrder(items);assert.ok(valid(ordered));assert.equal(new Set(ordered).size,items.length);assert.ok(cost(ordered)<=cost(baseline));
});
test('cycles, duplicate ordinary names and malformed prices fail rather than looping',()=>{
 assert.throws(()=>optimizeAugmentationOrder([aug('A',1,['B']),aug('B',2,['A'])]),/Cyclic/);
 assert.throws(()=>optimizeAugmentationOrder([aug('A',1),aug('A',2)]),/Duplicate/);
 assert.throws(()=>optimizeAugmentationOrder([aug('A',NaN)]),/Invalid/);
 assert.throws(()=>optimizeAugmentationOrder([],NaN),/Invalid/);assert.deepEqual(optimizeAugmentationOrder([]),[]);
});
test('repeatable NeuroFlux levels remain ordered from lower to higher levels',()=>{
 const items=[aug('NeuroFlux Governor',114),aug('Ordinary',200),aug('NeuroFlux Governor',100)];
 assert.deepEqual(optimizeAugmentationOrder(items).filter(a=>a.name==='NeuroFlux Governor').map(a=>a.price),[100,114]);
});
test('NeuroFlux counts come from native ownership and explicit queue entries, independent of SoA or prices',()=>{
 const queued=['SoA - Beauty of Aphrodite','Other','NeuroFlux Governor','SoA - Hunt of Artemis','NeuroFlux Governor'];
 assert.deepEqual(neuroFluxLevels({ownedAugs:new Map([['NeuroFlux Governor',7]])},queued),{installed:7,queued:2,purchased:9});
 assert.deepEqual(neuroFluxLevels({ownedAugs:{'NeuroFlux Governor':3}},queued),{installed:3,queued:2,purchased:5});
 assert.deepEqual(neuroFluxLevels({ownedAugs:{}},['SoA - Hunt of Artemis']),{installed:0,queued:0,purchased:0});
 for(const reset of [{},{ownedAugs:'bad'},{ownedAugs:{'NeuroFlux Governor':-1}}])assert.equal(neuroFluxLevels(reset,queued),null);
});
test('actual sorter and pruning wrappers preserve mutation semantics and use the corrected policies',async()=>{
 const source=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8');
 const sortBody=source.match(/function sortAugs\(ns, augs = \[\]\) \{([\s\S]*?)\n\}/)[1];
 const sort=Function('ns','augs','optimizeAugmentationOrder','augCountMult',sortBody);
 const A=aug('A',100,['B']),B=aug('B',1),C=aug('C',90),items=[A,C,B];
 assert.equal(sort({},items,optimizeAugmentationOrder,1.9),items);assert.deepEqual(items,[C,B,A]);
 assert.ok(source.includes('filterMissingPrereqs(ns,purchaseableAugs.filter(aug => aug !== augToDrop))'));
 assert.ok(source.includes('nfLevelPurchased=nfLevels.purchased'));assert.ok(!source.includes('Math.log(augNf.price'));
 assert.ok(source.includes('const droppedPriorityAugs = [...inaccessiblePriorityAugs]'));
});


test('future baskets insert expensive targets early and preserve committed donations',()=>{
 const items=[aug('Cheap',10)],target=aug('Expensive',100);
 assert.equal(futureAugmentationBasketCost(items,target,{donations:7}),126);
 assert.equal(cost([...items,target])+7,207);
 assert.deepEqual(items.map(a=>a.name),['Cheap']);assert.equal(Object.hasOwn(target,'purchaseFaction'),false);
});

test('future basket prices respect prerequisites, native queued inflation and SF11',()=>{
 for(const multiplier of [1,1.9,1.9*.93]){
  const items=[aug('Root',2,['Installed']),aug('Other',90)],target=aug('Child',100,['Root']);
  const expected=cost(optimizeAugmentationOrder([...items,target],multiplier),multiplier);
  assert.equal(futureAugmentationBasketCost(items,target,{owned:['Installed'],multiplier}),expected);
  // Native prices already contain the queued augmentation penalty; apply no extra prefix.
  assert.equal(futureAugmentationBasketCost([],aug('Next',190),{owned:['Queued'],multiplier}),190);
 }
});

test('unusable future baskets fail closed without changing their inputs',()=>{
 const items=[aug('Root',1)],before=JSON.stringify(items);
 for(const target of [aug('Child',2,['Missing']),aug('Root',2),aug('Bad',NaN),aug('Bad',-1)])
  assert.equal(futureAugmentationBasketCost(items,target),null);
 assert.equal(futureAugmentationBasketCost([],aug('Owned',1),{owned:['Owned']}),null);
 assert.equal(futureAugmentationBasketCost([aug('A',1,['B'])],aug('B',2,['A'])),null);
 for(const options of [{multiplier:NaN},{multiplier:.5},{donations:Infinity},{donations:-1}])
  assert.equal(futureAugmentationBasketCost(items,aug('Good',2),options),null);
 assert.equal(JSON.stringify(items),before);
});

test('future basket pricing retains ordered repeatable NeuroFlux and bounds large basket estimates',()=>{
 const items=[aug('NeuroFlux Governor',100),aug('NeuroFlux Governor',114)];
 const target=aug('Target',200);
 assert.equal(futureAugmentationBasketCost(items,target),cost(optimizeAugmentationOrder([...items,target])));
 const large=optimizeAugmentationOrder(Array.from({length:16},(_,i)=>aug('A'+i,100-i)));
 assert.ok(futureAugmentationBasketCost(large,target)<=cost([...large,target]));
});

test('runtime future target pricing delegates to the same prerequisite-aware purchase planner',async()=>{
 const source=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8');
 assert.ok(source.includes('cost:futureAugmentationBasketCost([...futurePurchaseAugs,...chain.slice(0,-1)],a,{owned:simulatedOwnedAugmentations,multiplier:augCountMult,donations:plannedDonations})'));
 assert.ok(!source.includes('cost:totalPurchaseCost+a.price*augCountMult**purchaseableAugs.length'));
});
