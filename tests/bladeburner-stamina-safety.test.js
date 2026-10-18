import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bladeburnerStaminaChance,bladeburnerActionCandidates,planBladeburnerLevels,bladeburnerRankRate,startBladeburnerPlannedAction} from '../bladeburner-policy.js';
import {blackOpMetadata} from '../bladeburner-action-data.js';

test('stamina forecast uses native cost before success roll and never inflates capped chances',()=>{
 const cost=.285*(2000**.28+2000/650);
 assert.deepEqual(bladeburnerStaminaChance([1,1],[100,100],2000),[1,1]);
 const result=bladeburnerStaminaChance([.99,1],[50,100],2000);
 assert.ok(Math.abs(result[0]-.99*(50-cost)/50)<1e-12);
 assert.ok(result[1]<1);assert.equal(bladeburnerStaminaChance([1,1],[0,100],2000)[0],0);
 assert.deepEqual(bladeburnerStaminaChance([.5,.6],[1,100],2000),[0,0]);
});
test('invalid stamina and unknown difficulty cannot authorize actions',()=>{
 for(const [c,s,d]of [[[1,1],[1,0],2000],[[1,1],[NaN,100],2000],[[1,1],[50,100],undefined],[[1,1],[50,100],Infinity],[[.9,.8],[50,100],2],[[1,2],[50,100],2],[[1,1],[-1,100],2]])assert.equal(bladeburnerStaminaChance(c,s,d),null);
});
test('population uncertainty does not displace reliable rank work or allow upper-bound gambles',()=>{
 const result=bladeburnerActionCandidates(['Safe','Uncertain','Unsafe','Empty','Fractional'],{Safe:5,Uncertain:5,Unsafe:5,Empty:0,Fractional:.9},{Safe:[1,1],Uncertain:[.8,1],Unsafe:[.5,.6],Empty:[1,1],Fractional:[1,1]});
 assert.deepEqual(result,{reliable:['Safe'],uncertain:['Uncertain']});
 assert.deepEqual(bladeburnerActionCandidates(['X'],{X:1},{X:[1,.5]}),{reliable:[],uncertain:[]});
});
function apiMock(){
 const state={level:1,auto:true,started:false,stamina:[50,100]};
 return {state,api:{getActionCurrentLevel:()=>state.level,getActionMaxLevel:()=>2,getActionAutolevel:()=>state.auto,setActionLevel:(_t,_n,n)=>state.level=n,setActionAutolevel:(_t,_n,n)=>state.auto=n,getActionEstimatedSuccessChance:()=>[1,1],getStamina:()=>state.stamina,getRank:()=>99999,startAction:()=>{state.started=true;return true;},getActionTime:()=>1000,getActionRankGain:()=>state.level,getActionRankLoss:()=>0}};
}
const difficulty={X:{base:2000,factor:2}};
test('fresh stamina rejects cached safe plans and restores settings after rejection',()=>{
 const {state,api}=apiMock();
 assert.equal(startBladeburnerPlannedAction(api,'Contracts','X',{level:2},.99,0,0,()=>true,bladeburnerStaminaChance,difficulty),false);
 assert.equal(state.started,false);assert.equal(state.level,1);assert.equal(state.auto,true);
 state.stamina=[100,100];
 assert.equal(startBladeburnerPlannedAction(api,'Contracts','X',{level:2},.99,0,0,()=>true,bladeburnerStaminaChance,difficulty),true);
});
test('Black Ops and unoptimized native levels receive the same fresh stamina guard',()=>{
 for(const type of ['Operations','Contracts','Black Operations']){
  const {state,api}=apiMock();
  assert.equal(startBladeburnerPlannedAction(api,type,'X',null,.99,0,0,()=>true,bladeburnerStaminaChance,difficulty),false);
  assert.equal(state.started,false);
  assert.equal(startBladeburnerPlannedAction(api,type,'Unknown',null,.99,0,0,()=>true,bladeburnerStaminaChance,difficulty),false);
 }
});
test('level optimization filters choices using post-cost chance',()=>{
 const {state,api}=apiMock();state.stamina=[55,100];
 const recovery={stamina:state.stamina,actions:{X:{base:2000,factor:100}},regen:1,hrc:1};
 const plan=planBladeburnerLevels(api,[['X','Contracts']],.99,bladeburnerRankRate,()=>true,recovery,bladeburnerStaminaChance).X;
 assert.equal(plan.level,1);assert.equal(plan.maxSafeLevel,1);assert.equal(state.level,1);
 state.stamina=[1,100];recovery.stamina=state.stamina;
 assert.deepEqual(planBladeburnerLevels(api,[['X','Contracts']],.99,bladeburnerRankRate,()=>true,recovery,bladeburnerStaminaChance),{});
});
test('stamina helper and guarded start serialize without hidden module dependencies',()=>{
 const forecast=Function('return ('+bladeburnerStaminaChance.toString()+')')();
 const start=Function('return ('+startBladeburnerPlannedAction.toString()+')')();
 const {state,api}=apiMock();
 assert.equal(start(api,'Black Operations','X',null,.99,0,0,()=>true,forecast,difficulty),false);assert.equal(state.started,false);
 assert.equal(Object.keys(blackOpMetadata).length,21);
 assert.equal(blackOpMetadata['Operation Typhoon'].baseDifficulty,2000);
 assert.ok(Object.values(blackOpMetadata).every(m=>m.baseDifficulty>0));
});
test('actual runtime wires safety into planning, native fallback and guarded start',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 for(const token of ['stamina:planning.stamina','JSON.parse(ns.args[6]),(${bladeburnerStaminaChance.toString()})','ns.args[7]),(${bladeburnerStaminaChance.toString()})','if(data&&Number.isSafeInteger(level)','!blackOpStaminaBlocked&&!lowHealthTriggered','blackOpsRawChance'])assert.ok(source.includes(token),token);
 assert.ok(!source.includes('populationUncertain ? populationActions'));
});
