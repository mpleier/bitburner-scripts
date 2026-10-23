import {supportReplacementStartAllowed} from '../bladeburner-support-economics-policy.js';
import {blackOpHospitalCost,blackOpBonusComparison,blackOpRiskStartAllowed} from '../black-op-risk-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {startBladeburnerPlannedAction,bladeburnerStaminaChance,bladeburnerWorkAllowed} from '../bladeburner-policy.js';
function api(stamina=[100,100]){
 const state={level:3,auto:true,starts:0};
 return {state,b:{getActionMaxLevel:()=>4,getActionCurrentLevel:()=>state.level,getActionAutolevel:()=>state.auto,
 setActionLevel:(_t,_n,n)=>state.level=n,setActionAutolevel:(_t,_n,n)=>state.auto=n,
 getActionEstimatedSuccessChance:()=>[1,1],getStamina:()=>stamina,startAction:()=>{state.starts++;return true;}}};
}
test('guarded start reports stamina and ownership deferrals without spending attempts',()=>{
 const f=api([1,100]),reasons=[];
 assert.equal(startBladeburnerPlannedAction(f.b,'Contracts','Retirement',{level:2},.99,0,0,()=>true,bladeburnerStaminaChance,{Retirement:{base:1,factor:1}},r=>reasons.push(r)),false);
 assert.deepEqual(reasons,['stamina-changed']);assert.equal(f.state.starts,0);assert.equal(f.state.level,3);assert.equal(f.state.auto,true);
 reasons.length=0;startBladeburnerPlannedAction(f.b,'Contracts','Retirement',null,.99,0,0,()=>false,null,null,r=>reasons.push(r));assert.deepEqual(reasons,['protected-work']);
});
test('native rejection remains distinct from a safety deferral',()=>{
 const f=api(),reasons=[];f.b.startAction=()=>false;
 assert.equal(startBladeburnerPlannedAction(f.b,'Contracts','Retirement',{level:2},.99,0,0,()=>true,null,null,r=>reasons.push(r)),false);
 assert.deepEqual(reasons,['rejected-by-game']);assert.equal(f.state.level,3);
});
function controller(stamina){
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('    const bestActionType = nextBlackOp == bestActionName'),end=source.indexOf('\n}',start),f=api(stamina),messages=[],writes=[];
 const ns={pid:7,args:[],bladeburner:f.b,isRunning:()=>true,singularity:{getCurrentWork:()=>null,getOwnedAugmentations:()=>[]},write:(file,text)=>writes.push(JSON.parse(text))};
 const context={supportReplacementStartAllowed,supportReplacement:null,blackOpHospitalCost,blackOpBonusComparison,blackOpRiskStartAllowed,blackOpRisk:{adaptive:false},startBladeburnerPlannedAction,bladeburnerStaminaChance,bladeburnerWorkAllowed,bbMutationGuard:'true',
 nextBlackOp:null,bestActionName:'Retirement',contractNames:['Retirement'],operationNames:[],blackOpsRanks:{},blackOpMetadata:{},bladeburnerDifficulty:{Retirement:{base:1,factor:1}},
 farmSurplus:false,stockReserve:20,surplusGuardPid:0,ownsSurplus:false,teamPlan:{},options:{'success-threshold':.99,'team-cap':0,'ignore-busy-status':false},levelPlans:{Retirement:{level:2}},
 lastStartDeferral:null,lastAssignedTask:'Retirement',lastAssignedCount:8,actionProgress:{progress:5},ownsRecruitment:false,currentTaskEndTime:12345,
 teamBudget:{},teamStatusFile:'tasks/bladeburner-team.json',currentAction:{name:'Retirement'},reason:'test',recruitmentDecision:{},getCount:()=>10,formatDuration:String,
 log:(_ns,message,terminal)=>messages.push({message,terminal}),getBBInfo:async()=>1000,
 getNsDataThroughFile:async(_ns,command,_file,args)=>Function('ns','return '+command)({...ns,args})};
 vm.runInNewContext('globalThis.run=async function(ns){'+source.slice(start,end)+'}',context);
 return {run:()=>context.run(ns),context,f,messages,writes};
}
test('actual generated worker returns a reason and controller preserves active action tracking',async()=>{
 const c=controller([1,100]);await c.run();
 assert.equal(c.writes.at(-1).lastStart.reason,'stamina-changed');assert.equal(c.context.lastAssignedTask,'Retirement');assert.equal(c.context.currentTaskEndTime,12345);assert.equal(c.context.actionProgress.progress,5);assert.equal(c.f.state.level,3);assert.equal(c.f.state.auto,true);
 assert.equal(c.messages.length,1);assert.equal(c.messages[0].terminal,false);assert.ok(!c.messages[0].message.includes('ERROR'));
 await c.run();assert.equal(c.messages.length,1);
});
test('actual generated worker starts safe actions and updates tracking',async()=>{
 const c=controller([100,100]);await c.run();assert.equal(c.f.state.starts,1);assert.equal(c.f.state.level,2);assert.equal(c.context.actionProgress,null);assert.equal(c.writes.at(-1).lastStart.success,true);assert.ok(c.context.currentTaskEndTime>12345);
});
