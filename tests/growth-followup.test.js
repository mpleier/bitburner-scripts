import test from 'node:test';
import assert from 'node:assert/strict';
import {sleeveAugRecoveryPlan,planSleeveAugPurchase} from '../sleeve-development-policy.js';
import {gangGameSeconds,gangWallSeconds,forecastGangTraining,forecastGangAscension} from '../gang-policy.js';
import {allocateCorporationCityProfit,observeCorporationGrowth} from '../corporation-policy.js';

const sleeve={shock:1,sync:100,skills:{strength:10},exp:{strength:10},mults:{strength_exp:1}};
const crimes={Mug:{time:1000,difficulty:1,strength_success_weight:1,strength_exp:100}};
test('recovery uses the buyer projection and ignores unrelated cheap filler',()=>{
 const offers=[{name:'Filler',cost:1,stats:{faction_rep:2}},{name:'XP',cost:10,stats:{strength_exp:10}}];
 const quotes=sleeveAugRecoveryPlan([sleeve],[offers],crimes,{sleeves:[{rate:1}]},10);
 assert.deepEqual(quotes[0].names,['XP']);assert.equal(quotes[0].recoverySeconds,1);
 const buyer=planSleeveAugPurchase({sleeve:{...sleeve,shock:0},offers,budget:10,crimes,horizon:899});
 assert.equal(quotes[0].output,buyer.output);assert.equal(quotes[0].extra,buyer.gain);
});
test('recovery forecasts reject nonrepaying purchases and obey shared budgets',()=>{
 const offers=[{name:'XP',cost:10,stats:{strength_exp:10}}];
 const result=sleeveAugRecoveryPlan([sleeve,sleeve],[offers,offers],crimes,{sleeves:[{rate:1},{rate:1}]},10);
 assert.equal(Object.keys(result).length,1);assert.equal(Object.values(result).reduce((n,r)=>n+r.cost,0),10);
 assert.deepEqual(sleeveAugRecoveryPlan([sleeve],[offers],crimes,{sleeves:[{rate:1}]},10,1,null,900,{cooldowns:[901]}),{});
});
test('promising pairs are evaluated before cheap offers exhaust the work search',()=>{
 const offers=Array.from({length:30},(_,i)=>({name:'Cheap '+i,cost:1,stats:{strength:1.001}}));
 offers.push({name:'Strength',cost:40,stats:{strength:4}},{name:'Dexterity',cost:40,stats:{dexterity:4}});
 let calls=0;
 const p=planSleeveAugPurchase({sleeve,offers,budget:80,workForecast:(s,stats,t,reset)=>{calls++;return reset?(stats.strength>=4&&stats.dexterity>=4?1000:1):100;}});
 assert.deepEqual(p.names.slice().sort(),['Dexterity','Strength']);assert.ok(calls<=65);assert.ok(p.search.evaluations<=64);
});
test('gang bonus clock drains once and returns to ordinary progression',()=>{
 assert.equal(gangGameSeconds(1,24),25);assert.equal(gangGameSeconds(2,24),26);
 assert.equal(gangWallSeconds(25,24),1);assert.equal(gangWallSeconds(26,24),2);
 for(const bonus of [0,24,300,3600])for(const seconds of [0,1,20,900,3600])assert.ok(Math.abs(gangWallSeconds(gangGameSeconds(seconds,bonus),bonus)-seconds)<1e-8);
 assert.equal(gangGameSeconds(2,NaN),2);assert.equal(gangGameSeconds(-1,300),0);
});
test('training baseline includes accelerated natural working XP without reusing spent bonus',()=>{
 const member={str:1,str_exp:0,str_mult:1,str_asc_mult:1},task={difficulty:1,strWeight:100};
 const evaluate=m=>({value:m.str,task:'Work'}),tasks={Work:task};
 const normal=forecastGangTraining(member,task,tasks,evaluate,900);
 const bonus=forecastGangTraining(member,task,tasks,evaluate,900,undefined,2400);
 assert.equal(normal.train,false);assert.equal(bonus.train,false);assert.ok(bonus.baseline>normal.baseline);
});
test('ascension cannot turn an infinite recruitment delay into a finite bonus-clock cost',()=>{
 const member={name:'A',str:1,str_exp:0,str_mult:1,str_asc_mult:1,task:'Work'};
 const tasks={Work:{name:'Work',difficulty:0,strWeight:0,baseWanted:0},Train:{name:'Train',difficulty:0,strWeight:0,baseWanted:0}};
 const plan=forecastGangAscension({members:{A:member},name:'A',ascended:{...member,str_asc_mult:2},gang:{respect:1,wantedLevel:1,respectForNextRecruit:100},
  training:tasks.Train,tasks,assignments:{A:'Work'},bonusSeconds:1000,evaluate:(m,g,forced)=>({task:forced||'Work',value:forced==='Train'?0:m.str_asc_mult>1?100:1,respect:m.str_asc_mult>1?0:1,wanted:0})});
 assert.equal(plan,null);
});
const city=(name,sold,produced=sold)=>({key:'D/'+name,division:'D',city:name,expectedCities:2,profitPerSecond:100,sellThrough:1,pressure:.5,backlog:false,outputs:[{name:'P',sold,produced}]});
test('corporation sales shares preserve division profit and favor the selling city',()=>{
 const rows=allocateCorporationCityProfit([city('A',90),city('B',10)]);
 assert.equal(rows[0].profitPerSecond,180);assert.equal(rows[1].profitPerSecond,20);
 assert.equal(rows.reduce((n,r)=>n+r.profitPerSecond,0),200);
 assert.match(rows[0].profitBasis,/Estimated city/);
 let market;for(const at of [1,10001,20001])market=observeCorporationGrowth(market,{scope:'test',at,rows:[city('A',90),city('B',10)]});
 assert.equal(market.locations['D/A'].profitPerSecond,180);assert.equal(market.locations['D/B'].profitPerSecond,20);
});
test('corporation shares do not add unlike product units and fall back on incomplete observations',()=>{
 const a=city('A',1000),b=city('B',0);a.outputs.push({name:'Q',sold:0,produced:1});b.outputs.push({name:'Q',sold:1,produced:1});
 const balanced=allocateCorporationCityProfit([a,b]);assert.equal(balanced[0].profitPerSecond,100);assert.equal(balanced[1].profitPerSecond,100);
 for(const rows of [[city('A',10)],[city('A',0),city('B',0)],[city('A',10),{...city('B',1),outputs:null}]]){
  assert.deepEqual(allocateCorporationCityProfit(rows),rows);
 }
});
