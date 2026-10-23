import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bladeburnerRankRate,readBladeburnerMaintenance,bladeburnerStaminaChance,probeBladeburnerCities,chooseBladeburnerCity,planBladeburnerLevels} from '../bladeburner-policy.js';
const name='Stealth Retirement Operation';
const difficulty={[name]:{base:125,factor:1}};
function fixture(){
 const state={bonus:0,count:100,team:0,stamina:[100,100],chance:1};
 const api={getBonusTime:()=>state.bonus,getActionTime:(_t,n)=>n==='Diplomacy'?60000:1000,getActionEstimatedSuccessChance:()=>[state.chance,state.chance],getActionCountRemaining:()=>state.count,getActionCurrentLevel:()=>1,getTeamSize:()=>state.team,getStamina:()=>state.stamina,getActionRankGain:()=>20,getActionRankLoss:()=>1};
 return {api,state};
}
const person={shock:0,sync:100,skills:{charisma:1000}};
const task={type:'BLADEBURNER',actionType:'General',actionName:'Diplomacy',cyclesNeeded:300};
const sleeves=(s=person,t=task)=>({getNumSleeves:()=>1,getTask:()=>t,getSleeve:()=>s});
const options={success:.99,difficulty,forecast:bladeburnerStaminaChance};
const metrics={time:1000,gain:10,loss:0,staminaCost:1,staminaRegen:10,hrcRegen:1};
const control={time:60000,charisma:1000,threshold:50,effect:{success:0,always:.1,positivePercent:0}};
const rate=c=>bladeburnerRankRate([1,1],{...metrics,chaosControl:c});

test('confirmed healthy sleeve diplomacy reduces projected player cleanup time without creating rank',()=>{
 const {api}=fixture(),q=readBladeburnerMaintenance(api,1000,50,{sleeves:sleeves()});
 assert.ok(q.chaosControl.sleeveLogRate>0);
 const credited=rate({...control,sleeveLogRate:q.chaosControl.sleeveLogRate});
 assert.ok(credited>rate(control));assert.ok(credited<=10);
});
test('stopped, unhealthy, unrecognized or impossible-duration sleeve tasks earn no credit',()=>{
 const {api}=fixture();
 for(const [s,t]of [[{...person,shock:1},task],[{...person,sync:99},task],[person,{...task,actionName:'Field Analysis'}],[person,{...task,actionType:'Contracts'}],[person,{...task,cyclesNeeded:1}],[person,null]])
  assert.equal(readBladeburnerMaintenance(api,1000,50,{sleeves:sleeves(s,t)}).chaosControl.sleeveLogRate,0);
 assert.equal(readBladeburnerMaintenance(api,1000,50,{sleeves:{}}).chaosControl.sleeveLogRate,0);
});
test('player bonus acceleration reduces relative sleeve credit and unknown speed fails closed',()=>{
 const {api,state}=fixture(),read=()=>readBladeburnerMaintenance(api,1000,50,{sleeves:sleeves()}).chaosControl.sleeveLogRate;
 const normal=read();state.bonus=10000;assert.ok(Math.abs(read()-normal/5)<1e-20);
 state.bonus=NaN;assert.equal(read(),0);
});
test('sufficient confirmed sleeve cleanup can eliminate player downtime but never earn phantom rank',()=>{
 assert.equal(rate({...control,sleeveLogRate:1}),10);
 assert.equal(rate({...control,sleeveLogRate:-1}),rate(control));
 assert.equal(rate({...control,sleeveLogRate:NaN}),rate(control));
});
test('native solo cleanup quotes include real rank, loss, time, stamina and available stock',()=>{
 const {api}=fixture(),q=readBladeburnerMaintenance(api,1000,50,options).chaosControl.cleanup;
 assert.equal(q.team,0);assert.equal(q.count,100);assert.equal(q.time,1000);assert.equal(q.gain,20);assert.equal(q.loss,1);assert.ok(q.staminaCost>0);
 const credited=rate({...control,cleanup:q});assert.ok(credited>rate(control));assert.ok(credited<=20);
});
test('unsafe, non-solo, depleted and unavailable cleanup quotes are excluded',()=>{
 const {api,state}=fixture();
 for(const patch of [{team:1},{team:NaN},{count:.99},{chance:.99},{chance:.5},{stamina:[.1,100]}]){
  Object.assign(state,{team:0,count:100,chance:1,stamina:[100,100]},patch);
  assert.equal(readBladeburnerMaintenance(api,1000,50,options).chaosControl.cleanup,null);
 }
 assert.equal(readBladeburnerMaintenance(api,1000,50,{}).chaosControl.cleanup,null);
});
test('primary and cleanup together must fit whole-operation stock and safe stamina',()=>{
 const {api}=fixture(),q=readBladeburnerMaintenance(api,1000,50,options).chaosControl.cleanup;
 const large={...control,effect:{success:0,always:1,positivePercent:0}};
 assert.equal(rate({...large,cleanup:{...q,count:1}}),rate(large));
 assert.equal(rate({...control,cleanup:{...q,stamina:[51,100]}}),rate(control));
 assert.equal(rate({...control,cleanup:{...q,team:1}}),rate(control));
});
test('combat cleanup charges extra stamina and includes expected failure rank losses',()=>{
 const {api}=fixture(),q=readBladeburnerMaintenance(api,1000,50,options).chaosControl.cleanup;
 const m={...metrics,staminaRegen:0,hrcRegen:.1};
 const low=bladeburnerRankRate([1,1],{...m,chaosControl:{...control,cleanup:{...q,staminaCost:1}}});
 const high=bladeburnerRankRate([1,1],{...m,chaosControl:{...control,cleanup:{...q,staminaCost:10}}});
 assert.ok(low>high);
 assert.equal(rate({...control,cleanup:{...q,chance:.99,loss:10000}}),rate(control));
});
test('combat cleanup works even with zero-charisma diplomacy and cannot recursively reward itself',()=>{
 const {api}=fixture(),q=readBladeburnerMaintenance(api,0,50,options).chaosControl.cleanup;
 assert.ok(rate({...control,charisma:0,cleanup:q})>0);
 const clean={...control,effect:{success:0,always:0,positivePercent:0},cleanup:q};
 assert.equal(rate(clean),10);
});
test('missing primary stamina information cannot make combat cleanup free',()=>{
 const {api}=fixture(),q=readBladeburnerMaintenance(api,1000,50,options).chaosControl.cleanup;
 const m={time:1000,gain:10,loss:0};
 assert.equal(bladeburnerRankRate([1,1],{...m,chaosControl:{...control,cleanup:q}}),bladeburnerRankRate([1,1],{...m,chaosControl:control}));
});
test('city probes request fresh maintenance per city instead of reusing departure cleanup quotes',()=>{
 let city='Home';const seen=[];
 const api={getCity:()=>city,switchCity:c=>{city=c;return true;},getActionCountRemaining:()=>1,getActionCurrentLevel:()=>1,getActionEstimatedSuccessChance:()=>[1,1],getActionTime:()=>1000,getActionRankGain:()=>10,getActionRankLoss:()=>0};
 const recovery={stamina:[100,100],regen:10,hrc:1,maintenance:true,chaosControl:control};
 const data={X:{base:125,factor:1,chaos:control.effect}};
 const reader=()=>{seen.push(city);return {chaosControl:{...control,sleeveLogRate:city==='Other'?1:0}};};
 const rows=probeBladeburnerCities(api,['Home','Other'],[['X','Contracts']],.99,()=>true,data,bladeburnerRankRate,bladeburnerStaminaChance,recovery,null,reader);
 assert.deepEqual(seen,['Home','Other']);assert.equal(chooseBladeburnerCity(rows,'Home').city,'Other');assert.equal(city,'Home');
});
test('credit-aware helpers serialize for generated workers without hidden imports',()=>{
 const read=Function('return ('+readBladeburnerMaintenance.toString()+')')();
 const {api}=fixture();assert.ok(read(api,1000,50,{...options,sleeves:sleeves()}).chaosControl.cleanup);
 const fn=Function('return ('+bladeburnerRankRate.toString()+')')();assert.equal(fn([1,1],{...metrics,chaosControl:{...control,sleeveLogRate:1}}),10);
});
test('controller supplies native sleeve/cleanup inputs and quantizes maintenance cache noise',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.match(source,/sleeves:ns.sleeve,success:ns.args/);
 assert.match(source,/Math.floor\(cleanup.count\)/);assert.match(source,/planning.skills,maintenanceKey/);
 assert.match(source,/planBladeburnerLevels.toString\(\)\}\),\(\)=>/);
});
