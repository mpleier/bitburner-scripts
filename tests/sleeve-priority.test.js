import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sleeveRepAssignments,sleeveReputationReservations,sleeveReputationTask} from '../sleeve-policy.js';
import {sleeveKarmaTrainingPlan} from '../sleeve-karma-training-policy.js';
import {allocateSleeveAugBudget} from '../sleeve-development-policy.js';
const keys=['hacking','strength','defense','dexterity','agility','charisma'];
const sleeve=()=>({shock:0,sync:100,city:'Sector-12',hp:{current:10},skills:Object.fromEntries(keys.map(k=>[k,11])),exp:Object.fromEntries(keys.map(k=>[k,200])),mults:{}});
test('reputation allocation uses actual reservations rather than historical sleeve indices',()=>{
 const sleeves=Array.from({length:5},sleeve),targets=Array.from({length:5},(_,i)=>({type:'FACTION',name:'f'+i,workTypes:['hacking']}));
 const reservations=sleeveReputationReservations({1:'Infiltrate Synthoids',2:'Field Analysis',3:'combat-xp'},[4]);
 assert.deepEqual(reservations,[4,2,3]);
 const assignments=sleeveRepAssignments(sleeves,targets,{},-1,true,[],null,false,{reservedSleeves:reservations});
 assert.equal(assignments[0].name,'f0');assert.equal(assignments[1].name,'f1');
 for(const i of [2,3,4])assert.equal(assignments[i],undefined);
 const all=sleeveRepAssignments(sleeves,targets,{},-1,true);assert.equal(Object.keys(all).length,5);
 assert.deepEqual(sleeveReputationReservations({},[],[1,1,7,-1,NaN]),[1,7]);
});
test('critical reputation outranks generic training while recovery and explicit crime remain authoritative',async()=>{
 const source=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8'),start=source.indexOf('async function pickSleeveTask('),end=source.indexOf('/** Helper to prepare the shock recovery task',start);
 const context={startupPlan:{assignments:{}},lastSleeveHp:[],lastSleeveShock:[],worldDaemonPriority:true,reputationAssignments:{0:{type:'FACTION',name:'Daedalus',priority:0,workType:'hacking'}},
  options:{'min-shock-recovery':0,'shock-recovery':0,'train-to-strength':105,'train-to-defense':105,'train-to-dexterity':70,'train-to-agility':70},
  bladeburnerSupportSleeves:new Set(),sleeveReputationTask,shockRecoveryTask:()=>['recovery'],crimeTask:async()=>['explicit-crime'],trainStats:keys.slice(1,5),trainSmarts:[],
 };
 vm.runInNewContext(source.slice(start,end)+';globalThis.pick=pickSleeveTask;',context);
 const ns={enums:{UniversityClassType:{algorithms:'Algorithms',leadership:'Leadership'},CityName:{Sector12:'Sector-12'},LocationName:{Sector12PowerhouseGym:'Gym'}}};
 assert.equal((await context.pick(ns,{}, {},0,sleeve(),true))[0],"work for faction 'Daedalus' (hacking)");
 assert.equal((await context.pick(ns,{}, {},0,{...sleeve(),shock:1},true))[0],'recovery');
 context.options.crime='Mug';assert.equal((await context.pick(ns,{}, {},0,sleeve(),true))[0],'explicit-crime');
 context.options.crime=null;context.reputationAssignments[0].priority=1;
 assert.match((await context.pick(ns,{}, {},0,sleeve(),true))[0],/^train /);
});
test('karma training excludes planned synchronization and recovery from other-worker production',()=>{
 const crimes={Homicide:{time:3000,karma:3,difficulty:1,strength_success_weight:2,strength_exp:1},Conditioning:{time:2000,karma:0,difficulty:1,strength_success_weight:1,strength_exp:1000}};
 const input={sleeves:[sleeve(),sleeve(),sleeve()],tasks:[null,{type:'CRIME'},null],workers:[0,1,2],assignments:{0:'karma',1:'sync',2:'recovery'},crimes,karma:0};
 const planned=sleeveKarmaTrainingPlan(input);assert.deepEqual(planned.activeWorkers,[0]);assert.equal(planned.otherKarmaPerSecond[0],0);
 const working=sleeveKarmaTrainingPlan({...input,assignments:{0:'karma',1:'karma',2:'recovery'}});assert.ok(working.otherKarmaPerSecond[0]>0);
 const legacy=sleeveKarmaTrainingPlan({...input,assignments:null,tasks:[null,{type:'SYNCHRO'},{type:'RECOVERY'}]});assert.deepEqual(legacy.activeWorkers,[0]);
});
const quote=(index,cost,gain,objective='xp',extra={})=>({index,plan:{names:['aug'+index],cost,gain,baseline:100,output:100+gain,horizon:900,objective,...extra}});
test('shared augmentation selection funds a stronger later sleeve instead of exhausting cash by index',()=>{
 const quotes=[quote(0,100,20),quote(7,100,80)];
 assert.deepEqual(Object.keys(allocateSleeveAugBudget(quotes,100).plan),['7']);
 assert.deepEqual(Object.keys(allocateSleeveAugBudget([...quotes].reverse(),100).plan),['7']);
 const both=allocateSleeveAugBudget(quotes,200);assert.equal(both.cost,200);assert.equal(both.gain,100);
});
test('cross-sleeve allocation can select cheaper alternatives to fund a stronger combined basket',()=>{
 const a=quote(0,100,100),b=quote(1,60,70);a.plan.alternatives=[{...a.plan,names:['cheap'],cost:40,gain:50,output:150}];
 const result=allocateSleeveAugBudget([a,b],100);assert.equal(result.cost,100);assert.equal(result.gain,120);assert.deepEqual(result.plan[0].names,['cheap']);
});
test('different augmentation objectives use dimensionless gains and malformed forecasts are rejected',()=>{
 const result=allocateSleeveAugBudget([quote(0,100,1000,'money',{baseline:100000,output:101000}),quote(1,100,50,'xp')],100);
 assert.equal(result.metric,'fractional-output-gain');assert.deepEqual(Object.keys(result.plan),['1']);
 for(const patch of [{gain:NaN},{cost:Infinity},{horizon:NaN},{output:0},{names:['dup','dup']}])assert.equal(Object.keys(allocateSleeveAugBudget([quote(0,100,50,'xp',patch)],100).plan).length,0);
 assert.equal(allocateSleeveAugBudget([quote(1,100,50)],0).cost,0);
});
test('controller quotes all candidates before purchasing and preserves explicit budget-only mode',()=>{
 const source=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8');
 assert.ok(source.indexOf('augmentationQuotes.push')<source.indexOf('const augmentationAllocation='));
 assert.ok(source.indexOf('const augmentationAllocation=')<source.indexOf('const selected=options'));
 assert.match(source,/assignments:startupPlan.assignments,karma:/);
 assert.match(source,/augmentationAllocation.plan\[i\]/);
 assert.match(source,/includeAlternatives:true/);
});
