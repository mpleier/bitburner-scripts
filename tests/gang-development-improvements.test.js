import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseGangAscensions,ascendGangMemberSafely,rankGangEquipment,forecastGangTraining,allocateGangEquipment} from '../gang-policy.js';

test('economic ascensions reject forecasts that depend on unguaranteed equipment restoration',()=>{
 const names=Array.from({length:12},(_,i)=>'M'+i),calls=[];
 const ns={gang:{getMemberNames:()=>names,getGangInformation:()=>({respect:10000}),getAscensionResult:()=>({str:2,respect:1}),
  getMemberInformation:()=>({str:100}),setTerritoryWarfare:()=>calls.push('warfare'),ascendMember:()=>{calls.push('ascend');return {};},setMemberTask:()=>calls.push('train')}};
 const plan={name:'M0',expiresAt:Date.now()+10000,paybackSeconds:60,horizonSeconds:900,member:{str:100},ascension:{str:2},restoreEquipment:true};
 assert.equal(ascendGangMemberSafely(ns,'M0',['str'],1.05,.05,chooseGangAscensions,()=>true,plan),null);
 assert.deepEqual(calls,[]);
});
test('adaptive ascension candidates do not depend on recruitment order; legacy spacing remains available',()=>{
 const names=['Old','New'],results={Old:{str:1.2,respect:1},New:{str:1.2,respect:1}},gang={respect:1000,respectForNextRecruit:10000};
 const forward=chooseGangAscensions(results,gang,names,['str'],1.05,.05,12,true).map(x=>x.name).sort();
 const reverse=chooseGangAscensions(results,gang,[...names].reverse(),['str'],1.05,.05,12,true).map(x=>x.name).sort();
 assert.deepEqual(forward,['New','Old']);assert.deepEqual(forward,reverse);
 assert.equal(chooseGangAscensions(results,gang,names,['str'],1.05,.05,12).length,0);
 assert.deepEqual(chooseGangAscensions(results,{...gang,respect:9000},names,['str'],1.05,.05,12,true),[]);
});
test('bounded recruitment equipment can qualify despite weak direct money ROI',()=>{
 const orders=[{equipmentName:'Recruit faster',cost:100000,moneyGain:.01,respectGain:.1}];
 const context={memberCount:8,respectRate:1,respectGap:1000,bootstrapBudget:200000};
 const ranked=rankGangEquipment(orders,900,context);
 assert.equal(ranked.length,1);assert.equal(ranked[0].reason,'recruitment');assert.ok(ranked[0].recruitSecondsSaved>90);
 assert.equal(rankGangEquipment(orders,900,{...context,bootstrapBudget:99999}).length,0);
 assert.equal(rankGangEquipment(orders,900,{...context,memberCount:12}).length,0);
});

test('training forecast sees task unlocks beyond twenty seconds and includes natural working XP',()=>{
 const member={str:1,str_exp:0,str_mult:1,str_asc_mult:1};
 const train={difficulty:100,strWeight:100},work={difficulty:1,strWeight:100};
 const evaluate=m=>({value:m.str>=30?100:1,task:'Work'});
 const plan=forecastGangTraining(member,train,{Work:work},evaluate,900);
 assert.equal(plan.train,true);assert.equal(plan.window,60);assert.ok(plan.production>plan.baseline);
 const identical=forecastGangTraining(member,train,{Work:train},evaluate,900);
 assert.equal(identical.train,false);
 for(const horizon of [NaN,Infinity,0,20])assert.equal(forecastGangTraining(member,train,{Work:work},evaluate,horizon).train,false);
 assert.equal(member.str_exp,0);
});
test('recruitment equipment batches obey the shared exception cap and explicit type budgets',()=>{
 const orders=[{cost:75,type:'Weapon',reason:'recruitment'}, {cost:75,type:'Weapon',reason:'recruitment'}, {cost:75,type:'Augmentation',reason:'production'}];
 const budget={available:1000,equipmentLimit:1000,augLimit:1000,bootstrapBudget:100};
 assert.equal(allocateGangEquipment(orders,budget).length,2);
 assert.equal(allocateGangEquipment(orders,{...budget,equipmentLimit:0}).length,1);
 assert.equal(allocateGangEquipment(orders,{...budget,bootstrapBudget:0,augLimit:0}).length,0);
 assert.equal(allocateGangEquipment(orders,{...budget,available:74}).length,0);
 assert.equal(allocateGangEquipment(orders,{...budget,available:75}).length,1);
});
test('recruitment exceptions reject tiny benefits, no respect production, invalid data and completed recruitment',()=>{
 const order={cost:100,moneyGain:0,respectGain:.1};
 const context={memberCount:8,respectRate:1,respectGap:1000,bootstrapBudget:1000};
 for(const patch of [{respectRate:0},{respectRate:NaN},{respectGap:0},{memberCount:12},{bootstrapBudget:0}])
  assert.equal(rankGangEquipment([order],900,{...context,...patch}).length,0);
 assert.equal(rankGangEquipment([{...order,respectGain:.001}],900,context).length,0);
 assert.equal(rankGangEquipment([{...order,cost:Infinity}],900,context).length,0);
});
test('adaptive native ascension eligibility uses economic threshold and rejects stale or costly respect loss',()=>{
 const calls=[],names=['Old','New'];let respect=1000;
 const ns={gang:{getMemberNames:()=>names,getGangInformation:()=>({respect,respectForNextRecruit:10000}),getAscensionResult:()=>({str:1.2,respect:1}),
  getMemberInformation:()=>({str:100}),setTerritoryWarfare:()=>calls.push('warfare'),ascendMember:()=>{calls.push('ascend');return {};},setMemberTask:()=>calls.push('train')}};
 const plan={name:'Old',expiresAt:Date.now()+10000,paybackSeconds:60,horizonSeconds:900,member:{str:100},ascension:{str:1.2},restoreEquipment:false,adaptive:true};
 assert.ok(ascendGangMemberSafely(ns,'Old',['str'],1.05,.05,chooseGangAscensions,()=>true,plan));
 assert.deepEqual(calls,['warfare','ascend','train']);calls.length=0;respect=9000;
 assert.equal(ascendGangMemberSafely(ns,'Old',['str'],1.05,.05,chooseGangAscensions,()=>true,plan),null);assert.deepEqual(calls,[]);
});
test('controller retains recruit protection, individual cooldown, one ascension and explicit money/equipment priorities',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/plannedAscensions.delete\(member\)/);assert.match(source,/await saveGangTraining\(ns\);break;/);
 assert.match(source,/lastMemberReset\[member\]\|\|0\)<\(options\['power-focus'\]&&!options\['disable-adaptive-growth'\]\?2000:60000\)/);
 assert.match(source,/planGangTrainingBursts\(rows,trainingEpisodes,at,crew.jointPlan,\{growthFirst:true\}\)/);
 assert.match(source,/name:'recruit',resource:'respect'/);assert.match(source,/allowJointTraining:true,activeTraining/);
 assert.match(source,/gangEquipmentBudgets\(\{money:homeMoney/);assert.match(source,/moneyFocus:options\['money-focus'\]/);
 assert.match(source,/horizonSeconds:growthHorizon.seconds/);
 assert.match(source,/restoreEquipment:false/);assert.doesNotMatch(source,/for\(const restoreEquipment of/);
});
