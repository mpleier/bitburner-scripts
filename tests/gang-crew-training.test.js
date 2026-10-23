import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forecastGangCrewTraining,projectGangWanted} from '../gang-policy.js';
const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
const work={name:'Work',difficulty:1,strWeight:100,baseWanted:0};
const member=name=>({name,str:1,str_exp:0,str_mult:1,str_asc_mult:1,task:'Work'});
const fixture=()=>({members:{A:member('A'),B:member('B')},gang:{respect:1000,wantedLevel:1,respectGainRate:0},training,
 tasks:{Work:work,'Train Combat':training},horizonSeconds:900,
 evaluate:(m,g,t)=>{const value=t===training.name?0:m.str>=30?100:1;return {value,money:value,respect:0,wanted:0,task:t};}});

test('whole-crew forecast shares a baseline and sees profitable bounded training',()=>{
 const input=fixture(),before=structuredClone({...input,evaluate:undefined}),r=forecastGangCrewTraining(input);
 assert.equal(r.forecasts.A.train,true);assert.equal(r.forecasts.A.window,60);
 assert.equal(r.forecasts.A.baseline,r.forecasts.B.baseline);
 assert.equal(r.diagnostics.simulations,11);assert.equal(r.diagnostics.baselineReady,true);
 assert.deepEqual({...input,evaluate:undefined},before);
});
test('natural work XP unlocks better tasks for other crew without imaginary training benefits',()=>{
 const input=fixture();let unlocked=false;
 input.tasks.Work={...work,difficulty:100};input.tasks.Elite={...work,name:'Elite',difficulty:100};
 input.evaluate=(m,g,t)=>{
  const value=t==='Work'?1:t==='Elite'&&m.str>=30?100:0;
  if(m.name==='B'&&t==='Elite'&&value>0)unlocked=true;
  return {value,money:value,respect:0,wanted:0,task:t};
 };
 const r=forecastGangCrewTraining(input);
 assert.equal(unlocked,true);assert.ok(r.forecasts.A.baseline>1800);
 assert.equal(r.forecasts.A.train,false);assert.equal(r.forecasts.B.train,false);
});
test('individual gains cannot justify a crew-wide wanted penalty loss',()=>{
 const input=fixture();input.gang.respect=100;input.names=['A'];
 input.evaluate=(m,g,t)=>{
  const active=t==='Work';
  const value=!active?0:m.name==='B'?1e9*g.respect/(g.respect+g.wantedLevel):m.str>=30?100:1;
  return {value,money:value,respect:active&&m.name==='A'?10:0,wanted:0,task:t};
 };
 assert.equal(forecastGangCrewTraining(input).forecasts.A.train,false);
 const isolated={...input,members:{A:input.members.A}};
 assert.equal(forecastGangCrewTraining(isolated).forecasts.A.train,true);
});
test('recruitment milestone protection rejects lost early production',()=>{
 const input=fixture();input.goals=[{name:'recruit',resource:'respect',amount:10}];
 const evaluate=input.evaluate;input.evaluate=(m,g,t)=>{const r=evaluate(m,g,t);return {...r,respect:r.money};};
 const r=forecastGangCrewTraining(input);
 assert.equal(r.forecasts.A.baselineMilestones.recruit,5);
 assert.equal(r.forecasts.A.train,false);assert.equal(r.forecasts.A.milestoneBlocked,true);
});
test('joint augmentation readiness keeps cash and reputation in one milestone',()=>{
 const input=fixture();input.goals=[{name:'cash',group:'augmentation',resource:'money',amount:20000},
 {name:'rep',group:'augmentation',resource:'respect',amount:1}];
 const evaluate=input.evaluate;input.evaluate=(m,g,t)=>({...evaluate(m,g,t),respect:t==='Work'?1:0});
 const r=forecastGangCrewTraining(input);
 assert.equal(r.forecasts.A.train,true);
 assert.ok(r.forecasts.A.trainingMilestones.cash<r.forecasts.A.baselineMilestones.cash);
});
test('external income stays in wall time while gang bonus time drives work XP',()=>{
 const input=fixture();input.bonusSeconds=2400;input.horizonSeconds=100;input.otherCashRate=10;
 input.goals=[{name:'cash',resource:'money',amount:500}];
 input.evaluate=(m,g,t)=>({value:t==='Work'?1:0,money:0,respect:0,wanted:0,task:t});
 assert.equal(forecastGangCrewTraining(input).forecasts.A.baselineMilestones.cash,50);
});
test('normal and bonus justice projections match repeated native constant-rate batches',()=>{
 for(const batch of [2,5])for(const wanted of [1,100])for(const rate of [-1,0,1])for(const justice of [0,1,12]){
  let expected=wanted;
  for(let i=0;i<10;i++)if(expected!==1||rate>=0)expected=Math.max(1,(expected+rate*batch)*(1-justice*.001));
  const actual=projectGangWanted(wanted,rate,justice,batch*10,batch);
  assert.ok(Math.abs(actual-expected)<1e-8,JSON.stringify({wanted,rate,justice,batch,actual,expected}));
 }
 assert.ok(projectGangWanted(100,0,1,20,2)<projectGangWanted(100,0,1,20,5));
});
test('wanted state changes affect subsequent member rate evaluations',()=>{
 const input=fixture(),seen=[];input.gang.wantedLevel=10;input.gang.respect=10000;
 input.tasks.Recover={...work,name:'Recover',baseWanted:-1};
 input.evaluate=(m,g,t)=>{
  seen.push(g.wantedLevel);const value=t==='Work'?10*g.respect/(g.respect+g.wantedLevel):0;
  return {value,money:value,respect:0,wanted:t==='Work'?.01:t==='Recover'?-2:0,task:t};
 };
 const r=forecastGangCrewTraining({...input,maxSimulations:1});
 assert.equal(r.diagnostics.baselineReady,true);assert.ok(new Set(seen.map(n=>n.toFixed(3))).size>1);
});
test('recovery members are locked until their supplied deadline then rejoin productive planning',()=>{
 const input=fixture();input.recoveryUntil={B:60};input.names=['A'];
 const r=forecastGangCrewTraining(input),locked=forecastGangCrewTraining({...input,recoveryUntil:{B:900}});
 assert.ok(r.forecasts.A.baseline>locked.forecasts.A.baseline);
 assert.equal(r.diagnostics.baselineReady,true);
});
test('simulation cap rotates candidates and never reuses unfinished results',()=>{
 const first=forecastGangCrewTraining({...fixture(),maxSimulations:1});
 assert.equal(first.diagnostics.simulations,2);assert.equal(first.diagnostics.simulationLimited,true);assert.equal(first.nextOffset,1);
 const second=forecastGangCrewTraining({...fixture(),maxSimulations:1,valuationOffset:first.nextOffset});
 assert.equal(second.nextOffset,2);
 const third=forecastGangCrewTraining({...fixture(),maxSimulations:1,valuationOffset:second.nextOffset});
 assert.equal(third.forecasts.A.train,true);assert.equal(third.forecasts.A.window,60);
 const limited=forecastGangCrewTraining({...fixture(),maxPlanningMs:0});
 assert.equal(limited.diagnostics.timeLimited,true);assert.equal(limited.diagnostics.baselineReady,false);
 assert.equal(limited.forecasts.A.train,false);
});
test('invalid snapshots and unavailable native tasks fail closed',()=>{
 for(const patch of [{horizonSeconds:NaN},{horizonSeconds:0},{gang:{respect:Infinity,wantedLevel:1}},
  {training:{name:'Missing'}},{otherCashRate:-1},{evaluate:()=>({value:NaN,money:0,respect:0,wanted:0})}]){
  assert.equal(forecastGangCrewTraining({...fixture(),...patch}).forecasts.A.train,false);
 }
 assert.equal(projectGangWanted(0,1,1,2),null);
});
test('controller uses one bounded crew forecast and exposes diagnostic work counts',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/forecastGangCrewTraining\(\{members,gang/);
 assert.match(source,/maxPlanningMs:150,maxSimulations:60,valuationOffset:trainingValuationCursor/);
 assert.match(source,/memberBestValue\(m,state,weight,forced\)/);
 assert.match(source,/trainingEpisodes,trainingDiagnostics,ascensionDiagnostics,ascensionRecoveries,equipmentOpportunity/);
});

test('an interrupted candidate cannot publish partial gains after the baseline completes',()=>{
 let tick=0;
 const r=forecastGangCrewTraining({...fixture(),maxPlanningMs:60,now:()=>tick++});
 assert.equal(r.diagnostics.baselineReady,true);assert.equal(r.diagnostics.timeLimited,true);
 assert.equal(r.diagnostics.simulations,2);
 assert.ok(Object.values(r.forecasts).every(f=>!f.train&&f.gain===0));
});
