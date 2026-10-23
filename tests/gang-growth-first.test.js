import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forecastGangCrewTraining,planGangTrainingBursts,restoreGangTrainingBursts,projectGangMember} from '../gang-policy.js';
const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
function fixture(count=5){
 const members=Object.fromEntries(Array.from({length:count},(_,i)=>{const name='M'+i;return [name,projectGangMember({name,str_exp:0,str_mult:1,str_asc_mult:1,task:'Work'},null,0)];}));
 return {members,gang:{respect:1000,wantedLevel:1},training,tasks:{'Train Combat':training,Work:{name:'Work',difficulty:0,baseWanted:0}},growthFirst:true,allowJointTraining:true,horizonSeconds:1800,maxSimulations:60,evaluate:(m,g,t)=>{const value=t==='Work'?(m.str>=30?100:1):0;return {value,money:value,respect:0,wanted:0};}};
}
const rows=(count=5)=>Array.from({length:count},(_,i)=>({name:'M'+i,resetAt:0,value:1,permitted:true,mandatory:false,forecast:{train:false}}));
const proposal=(count=4,window=60)=>({verified:true,gain:100,members:Array.from({length:count},(_,i)=>({name:'M'+i,window,trainingTask:'Train Combat'}))});
const schedule=(r,old={},at=1000,p=null)=>planGangTrainingBursts(r,old,at,p,{growthFirst:true});
test('growth-first searches completed groups larger than two and leaves a producer',()=>{
 const r=forecastGangCrewTraining(fixture());assert.equal(r.jointPlan.members.length,4);assert.ok(r.diagnostics.jointEvaluations>=3);assert.equal(r.diagnostics.trainingPolicy,'growth-first');
 assert.ok(r.jointPlan.production>Math.max(...Object.values(r.forecasts).filter(f=>f.train).map(f=>f.production)));
 const p=schedule(rows(),{},1000,r.jointPlan);assert.equal(Object.values(p.plans).filter(Boolean).length,4);assert.equal(p.plans.M4,false);
});
test('larger groups must preserve recruitment and augmentation ETA',()=>{
 for(const resource of ['money','respect']){const input=fixture();input.goals=[{name:'goal',resource,amount:50}];const evaluate=input.evaluate;
  input.evaluate=(m,g,t)=>({...evaluate(m,g,t),respect:t==='Work'?1:0});const r=forecastGangCrewTraining(input);assert.equal(r.jointPlan,null);
 }
});
test('growth-first exposes longer default windows only when the horizon can repay them',()=>{
 const input=fixture(3);input.evaluate=(m,g,t)=>{const value=t==='Work'?(m.str>=110?1000:1):0;return {value,money:value,respect:0,wanted:0};};
 const r=forecastGangCrewTraining(input);assert.ok(Object.values(r.forecasts).some(f=>f.train&&f.window>300));
 const short=forecastGangCrewTraining({...input,horizonSeconds:900});assert.ok(Object.values(short.forecasts).every(f=>!f.train||f.window<=300));
});
test('a fresh profitable forecast can bypass the previous productive cooldown',()=>{
 const r=rows(2);r[0].forecast={train:true,gain:100,window:60,trainingTask:'Train Combat'};
 const old={M0:{resetAt:0,startedAt:0,until:500,workUntil:60000,task:'Train Combat'}};
 const p=schedule(r,old);assert.equal(p.plans.M0,true);assert.equal(p.episodes.M0.workUntil,p.episodes.M0.until);assert.equal(p.episodes.M0.growthFirst,true);
});
test('an active verified group retains its deadlines after restart',()=>{
 const first=schedule(rows(),{},1000,proposal(4,900)),reset={lastNodeReset:1,lastAugReset:2};
 const restored=restoreGangTrainingBursts({nodeReset:1,augReset:2,episodes:first.episodes},reset,rows().map(r=>r.name),2000);
 assert.equal(Object.keys(restored).length,4);
 const p=schedule(rows(),restored,2000,proposal(4,899));assert.equal(p.episodes.M0.until,901000);assert.equal(p.episodes.M3.until,901000);
 assert.deepEqual(restoreGangTrainingBursts({nodeReset:1,augReset:2,episodes:first.episodes},{...reset,lastAugReset:3},rows().map(r=>r.name),2000),{});
});
test('incomplete group verification returns optional members to work',()=>{
 const first=schedule(rows(),{},1000,proposal()),p=schedule(rows(),first.episodes,2000,null);assert.ok(Object.values(p.plans).every(v=>!v));assert.equal(p.episodes.M0.until,2000);
});
test('a single active episode requires a fresh profitable forecast and never extends its deadline',()=>{
 const r=rows(2);r[0].forecast={train:true,gain:100,window:60,trainingTask:'Train Combat'};const first=schedule(r);
 r[0].forecast.window=59;const next=schedule(r,first.episodes,2000);assert.equal(next.episodes.M0.until,61000);assert.equal(next.plans.M0,true);
 r[0].forecast.train=false;assert.equal(schedule(r,first.episodes,2000).plans.M0,false);
});
test('mandatory recovery, wanted-control capacity and permission vetoes survive growth-first',()=>{
 const r=rows();r[4].mandatory=true;assert.equal(schedule(r,{},1000,proposal()).plans.M0,false);
 r[4].mandatory=false;r[2].permitted=false;assert.equal(schedule(r,{},1000,proposal()).plans.M0,false);
 r[2].permitted=true;r[2].urgent=true;assert.equal(schedule(r,{},1000,proposal()).plans.M0,false);
});
test('overlong, duplicate and all-member proposals are rejected',()=>{
 for(const p of [proposal(4,901),proposal(5),{...proposal(),members:Array(4).fill(proposal().members[0])}])assert.ok(Object.values(schedule(rows(),{},1000,p).plans).every(v=>!v));
});
test('active four-person groups are revalidated before bounded candidate searches',()=>{
 const input=fixture(),r=forecastGangCrewTraining({...input,maxSimulations:1,activeTraining:proposal().members});assert.equal(r.jointPlan.members.length,4);assert.equal(r.diagnostics.simulations,2);
 const missing=forecastGangCrewTraining({...input,maxSimulations:0,activeTraining:proposal().members});assert.equal(missing.jointPlan,null);
});

test('larger groups retain the warfare readiness safeguard',()=>{
 const input=fixture();
 for(const [name,m]of Object.entries(input.members)){for(const k of ['hack','def','dex','agi','cha'])m[k+'_exp']=1e6;input.members[name]=projectGangMember(m,null,0);}
 assert.equal(forecastGangCrewTraining(input).jointPlan.members.length,4);
 const r=forecastGangCrewTraining({...input,warfare:{active:true,power:1,rivalPower:1,threshold:.75,territory:.5,clashChance:0}});
 assert.ok(!r.jointPlan||r.jointPlan.members.length<4);
});
test('nonfinite gains and invalid single windows never authorize growth training',()=>{
 for(const [gain,window]of [[NaN,60],[Infinity,60],[0,60],[100,901]]){const r=rows(2);r[0].forecast={train:true,gain,window,trainingTask:'Train Combat'};assert.equal(schedule(r).plans.M0,false);}
});
test('restored training cannot exceed the bounded growth episode length',()=>{
 const reset={lastNodeReset:1,lastAugReset:2},entry={resetAt:0,startedAt:1000,until:902000,workUntil:902000,task:'Train Combat',growthFirst:true};
 assert.deepEqual(restoreGangTrainingBursts({nodeReset:1,augReset:2,episodes:{M0:entry}},reset,['M0'],2000),{});
});

test('the executed controller considers training before ascension and refreshes after a real reset',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 const start=source.indexOf('    // Preserve existing bursts'),end=source.indexOf('    await tryUpgradeMembers',start);
 assert.ok(start>=0&&end>start);
 const build=Function('change',`return async()=>{const events=[],ns={},options={},myGangMembers=['M0'],ascensionRecoveries={},trainingEpisodes={};let wantedPreparation=null,dictMembers={},myGangInfo={};const refreshTrainingPlans=async()=>events.push('training'),tryAscendMembers=async()=>{events.push('ascension');if(change)ascensionRecoveries.M0={until:10000};},getGangInfoDict=async()=>({}),getNsDataThroughFile=async()=>{events.push('fresh-info');return {};};${source.slice(start,end)}return events;}`);
 assert.deepEqual(await build(false)(),['training','ascension']);
 assert.deepEqual(await build(true)(),['training','ascension','fresh-info','training']);
});
