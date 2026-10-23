import test from 'node:test';
import assert from 'node:assert/strict';
import {planSleeveAugPurchase,selectSleeveAugBundles,sleeveRecoveryForecast,sleeveAugRecoveryPlan} from '../sleeve-development-policy.js';
const sleeve={shock:0,sync:100,skills:{strength:10},exp:{strength:10},mults:{strength_exp:1}};
const crimes={Mug:{time:1000,difficulty:1,strength_success_weight:1,strength_exp:100}};
test('equivalent named bundles share a projection but retain their individual prices',()=>{
 let calls=0;
 const offers=[{name:'Cheap',cost:1,stats:{strength_exp:2}},{name:'Expensive',cost:3,stats:{strength_exp:2}}];
 const p=planSleeveAugPurchase({sleeve,offers,budget:3,workForecast:(s,stats,t,reset)=>{calls++;return reset?100*(stats.strength_exp??1):10;},includeAlternatives:true});
 assert.deepEqual(p.names,['Cheap']);assert.equal(p.cost,1);assert.equal(p.search.evaluations,2);
 assert.equal(p.search.projections,1);assert.equal(p.search.projectionHits,1);assert.equal(calls,2);
 assert.equal(p.alternatives.length,1);assert.equal(p.alternatives[0].cost,1);
});
test('equivalent-effect caching survives resumed passes without reusing changed context',()=>{
 const state={};let calls=0,quota=2;
 const forecast=(s,stats,t,reset)=>{calls++;quota--;return reset?100*(stats.strength_exp??1):10;};
 const input={sleeve,offers:Array.from({length:12},(_,i)=>({name:'A'+i,cost:1,stats:{strength_exp:2}})),budget:3,workForecast:forecast,resumeState:state,canEvaluate:()=>quota>0};
 let result;
 for(let pass=0;pass<50;pass++){quota=2;result=planSleeveAugPurchase(input);if(!result.search?.timeLimited)break;}
 assert.equal(result.search.timeLimited,false);assert.ok(result.search.projectionHits>0);assert.equal(calls,result.search.projections+1);
 const before=calls;quota=Infinity;planSleeveAugPurchase({...input,context:{crimeExpMultiplier:.5}});assert.ok(calls>before);
});
test('joint selection spends leftover cash on a higher-total-gain combination',()=>{
 const choice=(name,cost,extra)=>({names:[name],cost,extra,output:extra+100});
 const groups=[{index:0,choices:[choice('Small',4,8),choice('Large',6,11)]},{index:1,choices:[choice('Other',4,7)]}];
 const selected=selectSleeveAugBundles(groups,10);
 assert.equal(selected.cost,10);assert.equal(selected.gain,18);assert.deepEqual(selected.plan[0].names,['Large']);assert.deepEqual(selected.plan[1].names,['Other']);
 // Gain/cost greedy chooses Small+Other for gain 15; the joint choice gains 20% more.
 assert.equal(selected.gain/15,1.2);
});
test('joint selector matches exhaustive enumeration on small multiple-choice wallets',()=>{
 let seed=12;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 for(let sample=0;sample<30;sample++){
  const groups=Array.from({length:4},(_,index)=>({index,choices:Array.from({length:3},(_,i)=>({names:[index+'/'+i],cost:1+Math.floor(rand()*10),extra:1+Math.floor(rand()*20)}))}));
  const budget=15;let optimum=0;
  const visit=(i,cost,gain)=>{if(cost>budget)return;if(i===groups.length){optimum=Math.max(optimum,gain);return;}visit(i+1,cost,gain);for(const c of groups[i].choices)visit(i+1,cost+c.cost,gain+c.extra);};
  visit(0,0,0);const selected=selectSleeveAugBundles(groups,budget);
  assert.equal(selected.gain,optimum);assert.ok(selected.cost<=budget);assert.equal(new Set(Object.keys(selected.plan)).size,Object.keys(selected.plan).length);
 }
});
test('joint selector bounds states, handles deadlines and rejects invalid bundles',()=>{
 const groups=Array.from({length:8},(_,index)=>({index,choices:Array.from({length:20},(_,i)=>({names:['A'+i],cost:i+1,extra:(i+1)*(index+1)}))}));
 const selected=selectSleeveAugBundles(groups,100,{maxStates:16});assert.ok(selected.states<=16);assert.ok(selected.cost<=100);
 const stopped=selectSleeveAugBundles(groups,100,{canEvaluate:()=>false});assert.equal(stopped.timeLimited,true);assert.equal(stopped.cost,0);
 const invalid=selectSleeveAugBundles([{index:0,choices:[{names:['A','A'],cost:1,extra:10},{names:['B'],cost:NaN,extra:10},{names:['C'],cost:1,extra:Infinity}]}],10);
 assert.equal(invalid.cost,0);assert.equal(invalid.gain,0);
 assert.deepEqual(selectSleeveAugBundles(groups,NaN).plan,{});
});
test('recovery quote alternatives are bounded, affordable and cannot mutate cached names',()=>{
 const input={sleeve,offers:Array.from({length:24},(_,i)=>({name:'XP'+i,cost:i+1,stats:{strength_exp:1.1+i*.1}})),budget:100,crimes,horizon:899,objective:'xp'};
 const cache=new Map();const quote=sleeveRecoveryForecast(input,{cache,now:100});
 assert.ok(quote.alternatives.length>0&&quote.alternatives.length<=12);
 for(const a of quote.alternatives){assert.ok(a.cost<=100);assert.ok(a.gain>0);}
 quote.alternatives[0].names.push('Mutated');
 assert.ok(sleeveRecoveryForecast(input,{cache,now:200}).alternatives.every(a=>!a.names.includes('Mutated')));
 const stats={};const shocked={...sleeve,shock:1};
 const plan=sleeveAugRecoveryPlan([shocked,shocked],[input.offers,input.offers],crimes,{sleeves:[{rate:1},{rate:1}]},100,1,null,900,{cacheStats:stats});
 const gain=Object.values(plan).reduce((n,p)=>n+p.extra,0);assert.ok(gain>=stats.allocation.greedyGain);assert.ok(Object.values(plan).reduce((n,p)=>n+p.cost,0)<=100);
});
