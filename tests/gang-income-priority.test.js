import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangDevelopmentCashTarget,gangIncomeFunding,gangFundingPlanCovered,gangPowerBenefit,releaseGangIncomeTraining} from '../gang-power-policy.js';
import {gangFocus,gangWarfareContext,planGangGrowthTraining,forecastGangCrewTraining,projectGangMember} from '../gang-policy.js';
const now=Date.now();
const funding=patch=>gangIncomeFunding({cash:1000,equipmentCash:200,augmentationCash:800,augmentationKnown:true,externalCashRate:100,externalAt:now,at:now,horizonSeconds:900,...patch});
const path=(...points)=>({cumulative:points.map(([at,gangMoney])=>({at,gangMoney}))});
test('development funding sums one missing stat upgrade per member and rejects unknown prices',()=>{
 const members={A:{upgrades:['Bat'],augmentations:[]},B:{upgrades:[],augmentations:[]}},equipment=[{name:'Bat',cost:10,stats:{str:1.1}},{name:'Implant',cost:30,stats:{def:1.2}},{name:'Cosmetic',cost:1,stats:{}}];
 assert.equal(gangDevelopmentCashTarget(members,equipment),40);
 assert.equal(gangDevelopmentCashTarget({A:{upgrades:['Bat'],augmentations:['Implant']}},equipment),0);
 assert.equal(gangDevelopmentCashTarget(members,[{...equipment[0],cost:undefined}]),null);
 assert.equal(gangDevelopmentCashTarget(members,[{...equipment[0],stats:{str:Infinity}}]),null);
 assert.equal(gangDevelopmentCashTarget({A:{}},equipment),null);
});
test('cash coverage protects gear plus augmentations and halves only fresh external income',()=>{
 assert.equal(funding().deprioritize,true);const f=funding({cash:0});assert.equal(f.externalCashRate,50);assert.equal(f.deprioritize,true);
 assert.equal(funding({cash:0,externalAt:now-30001}).deprioritize,false);
 assert.equal(funding({cash:0,externalAt:now+1}).externalCashRate,0);
 assert.equal(funding({cash:0,augmentationCash:10000}).deprioritize,false);
 assert.equal(funding({forceMoney:true}).deprioritize,false);
 for(const patch of [{cash:NaN},{equipmentCash:null},{augmentationCash:-1},{augmentationKnown:false},{horizonSeconds:0}])assert.equal(funding(patch).known,false);
});
test('outside cash is credited once and training must preserve a concrete funding deadline',()=>{
 const f=funding({cash:0,equipmentCash:100,augmentationCash:0,externalCashRate:2});
 const baseline=path([10,100],[100,100]),late=path([10,0],[100,0]),same=path([10,100],[100,100]);
 assert.equal(f.deprioritize,true);assert.equal(gangFundingPlanCovered(late,baseline,f,100,now),false);
 assert.equal(gangFundingPlanCovered(same,baseline,f,100,now),true);
 assert.equal(gangFundingPlanCovered(path([100,0]),path([100,0]),f,100,now),true);
});
test('malformed, expired and future funding cannot relax production protection',()=>{
 const f=funding();for(const patch of [{at:now+1},{expiresAt:now},{cash:-1},{target:Infinity},{known:false},{deprioritize:false}])assert.equal(gangFundingPlanCovered({}, {},{...f,...patch},100,now),false);
 const need=funding({cash:0,equipmentCash:100,augmentationCash:0,externalCashRate:2});
 for(const p of [path([10,-1]),path([10,1],[9,2]),path([101,100]),path([10,NaN]),{}])assert.equal(gangFundingPlanCovered(p,path([100,0]),need,100,now),false);
});
test('funded power preparation can sacrifice income but still needs material improvement and persistent payback',()=>{
 const w={power:0,powerFocus:true,powerPriority:true,preparation:{active:true},rivals:[{samples:3}],incomeFunding:funding()};
 const before={power:10,powerReady:100,total:100,cumulative:[{at:20,power:2},{at:100,power:10}]},after={power:20,powerReady:50,total:10,cumulative:[{at:20,power:3},{at:100,power:20}]};
 const yes=gangPowerBenefit(after,before,w,100);assert.equal(yes.powerObjective,true);assert.equal(yes.incomeDeprioritized,true);
 assert.equal(gangPowerBenefit(after,before,{...w,incomeFunding:null},100).powerObjective,false);
 assert.equal(gangPowerBenefit({...after,cumulative:[]},before,w,100).powerObjective,false);
 assert.equal(gangPowerBenefit({...after,powerReady:99},before,w,100).powerObjective,false);
 assert.equal(gangPowerBenefit(after,before,{...w,powerPriority:false},100).powerObjective,false);
 assert.equal(gangPowerBenefit(after,before,{...w,incomeFunding:funding({forceMoney:true})},100).powerObjective,false);
});
test('needed reputation can take priority with covered funding while manual choices and purchase ETA remain authoritative',()=>{
 const base={members:12,factionRep:0,requiredRep:100,money:0,respect:10000,goal:{cost:100,rep:100},incomeFunding:funding()};
 assert.equal(gangFocus(base),'respect');assert.equal(gangFocus({...base,moneyFocus:true}),'money');assert.equal(gangFocus({...base,members:11}),'respect');
 assert.equal(gangFocus({...base,purchaseForecast:{focus:'money',etaSeconds:1}}),'money');
 assert.equal(gangFocus({...base,incomeFunding:funding({cash:0,externalCashRate:0})}),'both money and respect');
});
test('income-dependent burst release preserves mandatory cycles and ordinary bursts',()=>{
 const episodes={A:{incomeDependent:true},B:{incomeDependent:true,developmentCycle:true},C:{preparation:true}};
 assert.equal(releaseGangIncomeTraining(episodes,funding(),now).changed,false);
 for(const f of [null,funding({forceMoney:true}),{...funding(),expiresAt:now},{...funding(),at:now+1}]){
  const r=releaseGangIncomeTraining(episodes,f,now);assert.equal(r.changed,true);assert.deepEqual(Object.keys(r.episodes),['B','C']);
 }
 assert.ok(episodes.A);
});
test('income-dependent group scheduling retains a productive member and records its dependency',()=>{
 const rows=['A','B','C'].map(name=>({name,value:1,resetAt:0,mandatory:false,permitted:true,forecast:{train:false}}));
 const joint={verified:true,gain:-90,powerObjective:true,powerPaybackSeconds:10,incomeDeprioritized:true,members:['A','B'].map(name=>({name,window:60,trainingTask:'Train Combat'}))};
 const r=planGangGrowthTraining(rows,{},1000,joint,{preparation:true});assert.equal(r.plans.C,false);assert.equal(r.episodes.A.incomeDependent,true);assert.equal(r.episodes.B.incomeDependent,true);
});
test('controller wires funding to forecasts, uses live prices and excludes equipment purchases from the relaxed gate',()=>{
 const src=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),policy=readFileSync(new URL('../gang-policy.js',import.meta.url),'utf8');
 assert.match(src,/getEquipmentCost\(n\)/);assert.match(src,/cost:snapshot.prices\?\.\[e.name\]/);assert.match(src,/trainingFirst:gangTrainingFirst\(\),incomeFunding/g);assert.match(src,/releaseGangIncomeTraining\(trainingEpisodes,incomeFunding\)/);
 assert.match(src,/context\|\|incomeFunding\?\.deprioritize\?ns.getServerMoneyAvailable/);assert.match(policy,/equipmentDevelopment\?\{\.\.\.warfare,incomeFunding:null\}:warfare/);
});

test('reserve shortfalls must be funded before development cash is available',()=>{
 const f=funding({cash:0,reserveShortfall:10000});assert.equal(f.target,11000);assert.equal(f.deprioritize,false);
 assert.equal(funding({reserveShortfall:NaN}).known,false);
});
test('whole-crew forecasts can choose funded training below the old income floor while preserving cash milestones',()=>{
 const training={name:'Train Combat',difficulty:100,strWeight:25,defWeight:25,dexWeight:25,agiWeight:25},work={name:'Work',difficulty:0},war={name:'Territory Warfare',difficulty:5,strWeight:20,defWeight:20,dexWeight:20,agiWeight:20,hackWeight:15,chaWeight:5};
 const members=Object.fromEntries(Array.from({length:12},(_,i)=>{const name='M'+i;return [name,projectGangMember({name,task:'Work',str_exp:0,str_mult:1,str_asc_mult:1,earnedRespect:0,upgrades:[],augmentations:[]},null,0)];}));
 const warfare={active:true,power:1,rivalPower:100,threshold:.75,territory:1/7,clashChance:0,powerFocus:true,powerPriority:true,preparation:{enabled:true,active:true},rivals:[{name:'R',power:100,rate:0,territory:6/7,samples:4}],duty:{normalFraction:.1,bonusFraction:.5},incomeFunding:funding()};
 const input={members,gang:{respect:10000,wantedLevel:1},training,tasks:{'Train Combat':training,Work:work,'Territory Warfare':war},names:['M0'],warfare,horizonSeconds:900,windows:[600],evaluate:(m,g,t)=>({value:t==='Work'?(m.name==='M0'?1000:1):0,money:t==='Work'?(m.name==='M0'?1000:1):0,respect:0,wanted:0})};
 const baseline=forecastGangCrewTraining({...input,warfare:{...warfare,incomeFunding:null}}).forecasts.M0;
 const candidate=forecastGangCrewTraining(input).forecasts.M0;assert.equal(baseline.train,false);assert.equal(candidate.train,true);assert.equal(candidate.incomeDeprioritized,true);assert.ok(candidate.production<candidate.baseline*.5);assert.ok(candidate.powerPaybackSeconds<=900);
 const constrained=forecastGangCrewTraining({...input,goals:[{name:'cash',resource:'money',amount:10000}]}).forecasts.M0;assert.equal(constrained.train,false);
});

test('the exact native wallet/price query evaluates to a snapshot object',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 const expression=source.match(/const snapshot=await getNsDataThroughFile\(ns,'([^']+)'/)[1];
 const ns={args:[JSON.stringify(['Bat','Implant'])],getPlayer:()=>({money:500}),getMoneySources:()=>({sinceInstall:{gang:1,darknet:2}}),gang:{getEquipmentCost:name=>name==='Bat'?100:200}};
 const result=Function('ns','return '+expression)(ns);assert.deepEqual(result.player,{money:500});assert.deepEqual(result.prices,{Bat:100,Implant:200});assert.deepEqual(result.income.sources,{gang:1,darknet:2});assert.ok(Number.isFinite(result.income.at));
});
