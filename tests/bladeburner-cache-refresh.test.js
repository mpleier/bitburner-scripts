import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {spendBladeburnerSkills,bladeburnerSkillGoal,nextBladeburnerProgressSkill,nextSkill} from '../bladeburner-policy.js';
const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
const start=source.indexOf('async function spendSkillPoints('),end=source.indexOf('/** @param {NS} ns',start);
function fixture(result,{bank=false,error=null}={}){
 if(arguments.length===0)result=[];
 const city={key:'city-before',at:1,rows:[{city:'A',score:1,trainingBaseline:{score:1}}]},level={key:'level-before',at:1,plans:{A:{level:1}}};
 const state={calls:0,reports:0,clearedBeforeReport:false};
 const context={spendBladeburnerSkills,bladeburnerSkillGoal,nextBladeburnerProgressSkill,nextSkill,bbMutationGuard:'true',resetInfo:{lastNodeReset:1},skillNames:['Cloak','Hyperdrive'],costAdjustments:{},remainingBlackOpsNames:[],blackOpsRanks:{},options:{},blackOpMetadata:{},bladeburnerDifficulty:{},cityPlanCache:city,levelPlanCache:level,
 getNsDataThroughFile:async()=>{state.calls++;if(error)throw error;return result;},
 log:()=>{state.reports++;state.clearedBeforeReport=context.cityPlanCache===null&&context.levelPlanCache===null;}};
 const ns={pid:7,read:()=>bank?JSON.stringify({nodeReset:1,expiresAt:Date.now()+100000,ownerPid:8,bankBladeburnerPoints:true}):'',isRunning:()=>true};
 vm.runInNewContext(source.slice(start,end)+';globalThis.run=spendSkillPoints;',context);
 return {state,context,city,level,run:()=>context.run(ns)};
}
test('a confirmed purchase clears city, Training and level plans before reporting',async()=>{
 for(const result of [['Cloak'],['Hyperdrive'],['Cloak','Cloak','Hyperdrive']]){
  const f=fixture(result);await f.run();assert.equal(f.context.cityPlanCache,null);assert.equal(f.context.levelPlanCache,null);assert.equal(f.state.clearedBeforeReport,true);assert.equal(f.state.calls,1);
 }
});
test('an empty purchase receipt preserves the existing cached plans without reporting upgrades',async()=>{
 const f=fixture();await f.run();assert.equal(f.context.cityPlanCache,f.city);assert.equal(f.context.levelPlanCache,f.level);assert.equal(f.state.reports,0);
});
test('banking achievements cannot clear caches or invoke a purchasing worker',async()=>{
 const f=fixture(['Cloak'],{bank:true});await f.run();assert.equal(f.context.cityPlanCache,f.city);assert.equal(f.context.levelPlanCache,f.level);assert.equal(f.state.calls,0);
});
test('an uncertain purchase failure invalidates both plans and preserves the original error',async()=>{
 const error=new Error('native worker disconnected after an upgrade'),f=fixture([],{error});
 await assert.rejects(f.run(),value=>value===error);assert.equal(f.context.cityPlanCache,null);assert.equal(f.context.levelPlanCache,null);assert.equal(f.state.reports,0);
});
test('malformed receipts invalidate caches rather than allowing stale plans or misleading purchase reports',async()=>{
 for(const result of [null,undefined,{},'Cloak']){
  const f=fixture(result);await assert.rejects(f.run(),/Invalid Bladeburner skill purchase response/);assert.equal(f.context.cityPlanCache,null);assert.equal(f.context.levelPlanCache,null);assert.equal(f.state.reports,0);
 }
});
test('the next no-purchase pass preserves freshly rebuilt caches',async()=>{
 const result=['Cloak'],f=fixture(result);await f.run();
 const city={key:'rebuilt-city'},level={key:'rebuilt-level'};f.context.cityPlanCache=city;f.context.levelPlanCache=level;result.length=0;await f.run();
 assert.equal(f.context.cityPlanCache,city);assert.equal(f.context.levelPlanCache,level);assert.equal(f.state.reports,1);
});
