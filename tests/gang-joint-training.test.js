import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forecastGangCrewTraining,planGangTrainingBursts,restoreGangTrainingBursts,projectGangMember,gangWallSeconds,gangPlanningHorizon} from '../gang-policy.js';
const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
function fixture(){
 const members=Object.fromEntries(['A','B','C'].map(name=>{const m={name,task:'Work'};for(const k of ['hack','str','def','dex','agi','cha'])Object.assign(m,{[k+'_exp']:0,[k+'_mult']:1,[k+'_asc_mult']:1});return [name,projectGangMember(m,null,0)];}));
 return {members,gang:{respect:1000,wantedLevel:1,respectGainRate:0},training,tasks:{'Train Combat':training,Work:{name:'Work',difficulty:0,baseWanted:0}},horizonSeconds:900,names:['A','B'],allowJointTraining:true,maxSimulations:60,
  evaluate:(m,g,t)=>{const value=t==='Work'?(m.str>=30?100:1):0;return {task:t,value,money:value,respect:0,wanted:0};}};
}
const rows=()=>['A','B','C'].map(name=>({name,resetAt:0,value:1,permitted:true,mandatory:false,forecast:{train:false}}));
const proposal=()=>({verified:true,gain:100,members:[{name:'A',window:60,trainingTask:'Train Combat'},{name:'B',window:60,trainingTask:'Train Hacking'}]});
test('joint trajectory must beat continued work and the best completed single-member trajectory',()=>{
 const r=forecastGangCrewTraining(fixture());assert.ok(r.jointPlan?.verified);assert.equal(r.jointPlan.members.length,2);
 assert.ok(r.jointPlan.production>Math.max(...Object.values(r.forecasts).map(f=>f.production)));
 assert.equal(r.diagnostics.jointEvaluations,1);
});
test('joint choices may use different tasks and durations and inputs remain unchanged',()=>{
 const input=fixture();input.trainingOptions=['Train Combat','Train Hacking','Train Charisma'];
 input.tasks['Train Hacking']={name:'Train Hacking',difficulty:45,hackWeight:100,baseWanted:0};input.tasks['Train Charisma']={name:'Train Charisma',difficulty:8,chaWeight:100,baseWanted:0};
 input.evaluate=(m,g,t)=>{const value=t==='Work'?((m.name==='A'?m.cha:m.hack)>=10?100:1):0;return {value,money:value,respect:0,wanted:0};};
 const before=structuredClone({...input,evaluate:undefined}),r=forecastGangCrewTraining(input),byName=Object.fromEntries(r.jointPlan.members.map(p=>[p.name,p]));
 assert.equal(byName.A.trainingTask,'Train Charisma');assert.equal(byName.B.trainingTask,'Train Hacking');assert.notEqual(byName.A.window,byName.B.window);
 assert.deepEqual({...input,evaluate:undefined},before);
});
test('a joint forecast cannot borrow the delayed recruitment time of a single trainee as its baseline',()=>{
 const input=fixture(),evaluate=input.evaluate;input.goals=[{name:'recruit',resource:'respect',amount:10}];
 input.evaluate=(m,g,t)=>({...evaluate(m,g,t),respect:t==='Work'?1:0});
 const r=forecastGangCrewTraining(input);assert.equal(r.jointPlan,null);assert.ok(Object.values(r.forecasts).some(f=>f.train));
});
test('adding an unhelpful trainee cannot qualify solely because the first trainee is profitable',()=>{
 const input=fixture();input.evaluate=(m,g,t)=>{const value=t==='Work'?(m.name==='B'?50:m.str>=30?100:1):0;return {value,money:value,respect:0,wanted:0};};
 assert.equal(forecastGangCrewTraining(input).jointPlan,null);
});
test('an exhausted simulation budget cannot authorize an unverified pair',()=>{
 const r=forecastGangCrewTraining({...fixture(),maxSimulations:1});assert.equal(r.jointPlan,null);assert.equal(r.diagnostics.simulations,2);
});
test('active pair revalidation takes priority and checks both remaining windows',()=>{
 const input=fixture(),r=forecastGangCrewTraining({...input,maxSimulations:1,activeTraining:[{name:'A',window:60,trainingTask:'Train Combat'},{name:'B',window:60,trainingTask:'Train Combat'}]});
 assert.ok(r.jointPlan);assert.equal(r.diagnostics.jointEvaluations,1);assert.equal(r.diagnostics.simulations,2);
});
test('the scheduler admits exactly the verified pair and preserves productive crew capacity',()=>{
 const r=planGangTrainingBursts(rows(),{},1000,proposal());assert.equal(Object.values(r.plans).filter(Boolean).length,2);
 assert.equal(r.episodes.A.jointId,r.episodes.B.jointId);assert.equal(r.episodes.B.task,'Train Hacking');assert.equal(r.plans.C,false);
 const none=planGangTrainingBursts(rows().slice(0,2),{},1000,proposal());assert.ok(Object.values(none.plans).every(v=>!v));
});
test('pair persistence preserves tasks and deadlines after restart',()=>{
 const first=planGangTrainingBursts(rows(),{},1000,proposal()),reset={lastNodeReset:1,lastAugReset:2};
 const restored=restoreGangTrainingBursts({nodeReset:1,augReset:2,episodes:first.episodes},reset,['A','B','C'],2000);
 const p=proposal();p.members.forEach(m=>m.window=59);
 const r=planGangTrainingBursts(rows(),restored,2000,p);assert.equal(r.episodes.A.until,61000);assert.equal(r.episodes.B.task,'Train Hacking');assert.equal(r.plans.A,true);assert.equal(r.plans.B,true);
});
test('loss of joint verification cancels the pair instead of continuing two independent forecasts',()=>{
 const first=planGangTrainingBursts(rows(),{},1000,proposal()),next=planGangTrainingBursts(rows(),first.episodes,2000,null);
 assert.equal(next.plans.A,false);assert.equal(next.plans.B,false);assert.equal(next.episodes.A.until,2000);
});
test('pair admission respects recovery locks, cooldowns and an already active single burst',()=>{
 for(const patch of ['mandatory','urgent']){const r=rows();r[0][patch]=true;const result=planGangTrainingBursts(r,{},1000,proposal());assert.equal(result.plans.B,false);}
 const old={A:{resetAt:0,startedAt:0,until:100,workUntil:5000,task:'Train Combat'}};
 assert.equal(planGangTrainingBursts(rows(),old,1000,proposal()).plans.B,false);
});
test('a completed pair partner releases capacity while the remaining member can finish its burst',()=>{
 const first=planGangTrainingBursts(rows(),{},1000,proposal());first.episodes.B.until=1500;
 const r=planGangTrainingBursts(rows(),first.episodes,2000,null);assert.equal(r.plans.A,true);assert.equal(r.plans.B,false);
});
test('horizon calculation observes restored production before deriving recruitment time',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replaceAll('\r','');
 const waitLine='if(restored.restored>0)myGangInfo=await waitForGameUpdate(ns,myGangInfo);';
 const waitAt=source.indexOf(waitLine),start=source.indexOf('    const recruitSeconds=',waitAt),end=source.indexOf('    growthHorizon.bonusSeconds=',start);
 assert.ok(waitAt>source.indexOf('const restoreStarted=Date.now()'));assert.ok(start>waitAt);
 let observed=0;
 const build=Function('waitForGameUpdate','gangWallSeconds','gangPlanningHorizon','gangTrainingFirst','preparationFor',`return async(restored,myGangInfo)=>{const now=100000,resetInfo={lastNodeReset:0};const ns={},myGangMembers=Array(10),bonusSeconds=0,options={'growth-horizon-minutes':15},remaining=null,install=null,resetPending=false;let growthHorizon;${waitLine}${source.slice(start,end)}return growthHorizon;}`);
 const run=build(async()=>{observed++;return {respect:100000,respectForNextRecruit:390625,respectGainRate:.7};},gangWallSeconds,gangPlanningHorizon,()=>false,()=>({active:false}));
 const h=await run({restored:2},{respect:100000,respectForNextRecruit:390625,respectGainRate:0});assert.equal(observed,1);assert.equal(h.seconds,10800);
});
test('nearby recruitment uses the forecast ETA safeguard rather than an 80-percent training veto',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),body=source.slice(source.indexOf('async function refreshTrainingPlans('));
 assert.doesNotMatch(body,/respectForNextRecruit\*\.8|urgent:imminentRecruit/);assert.match(body,/allowJointTraining:true,activeTraining/);
 const input=fixture();input.gang.respect=850;input.gang.respectForNextRecruit=1000;input.goals=[{name:'recruit',resource:'respect',amount:150}];
 const evaluate=input.evaluate;input.evaluate=(m,g,t)=>({...evaluate(m,g,t),respect:t==='Work'?(m.str>=30?10:.001):0});
 assert.ok(forecastGangCrewTraining(input).jointPlan);
});
