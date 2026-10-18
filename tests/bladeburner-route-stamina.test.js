import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {nextBladeburnerProgressSkill,nextSkill,spendBladeburnerSkills,bladeburnerStaminaChance} from '../bladeburner-policy.js';
import {nodeRouteSnapshotSource,estimateBladeburnerRoute} from '../node-route-policy.js';
import {routeDevelopment} from '../node-route-selection-policy.js';

const names=["Cyber's Edge","Blade's Intuition",'Digital Observer'];
const levels=Object.fromEntries(names.map(n=>[n,0])),costs={"Cyber's Edge":10,"Blade's Intuition":1,'Digital Observer':1};
const context={target:'Operation Typhoon',rank:2500,requiredRank:2500,chance:[1,1],threshold:.99,stamina:[1,1],metadata:{baseDifficulty:2000}};
const choose=(patch={},points=100)=>nextBladeburnerProgressSkill(names,levels,costs,points,{}, {...context,...patch},nextSkill);
test('maximum stamina blockers prioritize Cyber Edge and bank points when unaffordable',()=>{
 assert.equal(choose(),"Cyber's Edge");assert.equal(choose({},5),null);
 assert.notEqual(choose({rank:1}),"Cyber's Edge");
 assert.notEqual(choose({stamina:[50,100]}),"Cyber's Edge");
 assert.notEqual(choose({stamina:[NaN,1]}),"Cyber's Edge");
 assert.notEqual(choose({metadata:{}}),"Cyber's Edge");
});
test('skill batches yield after a stamina upgrade until the native engine applies its effect',()=>{
 let purchases=0;
 const api={getSkillPoints:()=>100,getSkillLevel:()=>purchases,getSkillUpgradeCost:()=>1,upgradeSkill:()=>{purchases++;return true;}};
 assert.deepEqual(spendBladeburnerSkills(api,["Cyber's Edge"],{},()=>"Cyber's Edge",()=>true),["Cyber's Edge"]);
 assert.equal(purchases,1);
 const chooseNative=Function('return ('+nextBladeburnerProgressSkill.toString()+')')();
 assert.equal(chooseNative(names,levels,costs,100,{},context,nextSkill),"Cyber's Edge");
});
function nativeSnapshot(stamina=[50,100]){
 const ns={getPlayer:()=>({exp:{hacking:100,strength:100,defense:100,dexterity:100,agility:100},skills:{hacking:100,strength:100,defense:100,dexterity:100,agility:100},mults:{hacking:1,faction_rep:1,strength:1,defense:1,dexterity:1,agility:1},money:0}),getResetInfo:()=>({ownedAugs:{},lastAugReset:10,lastNodeReset:5,currentNode:9}),getBitNodeMultipliers:()=>({HackingLevelMultiplier:1}),serverExists:()=>false,ps:()=>[],
  bladeburner:{inBladeburner:()=>true,getStamina:()=>stamina,getActionEstimatedSuccessChance:()=>[1,1],getActionCurrentLevel:()=>1,getActionTime:()=>1000,getActionRankGain:()=>10,getActionRankLoss:()=>0,getActionCountRemaining:()=>10,getCity:()=> 'A',getRank:()=>1e6,getCurrentAction:()=>null,getBonusTime:()=>0,getBlackOpNames:()=>['Operation Typhoon'],getBlackOpRank:()=>2500,getContractNames:()=>['Tracking'],getOperationNames:()=>['Assassination']}};
 return {ns,snapshot:vm.runInNewContext(nodeRouteSnapshotSource(false,true),{ns})};
}
test('executed native route snapshot shares the action-start forecast and retains displayed odds',()=>{
 const {snapshot:s}=nativeSnapshot();assert.equal(s.bb.error,undefined);
 assert.equal(s.bb.chanceModel,'post-cost-v1');assert.equal(s.bb.ops[0].rawChance[0],1);
 assert.equal(s.bb.ops[0].chance[0],bladeburnerStaminaChance([1,1],[50,100],2000)[0]);
 assert.equal(s.bb.ops[0].capabilityChance[0],1);
 assert.ok(s.bb.actions.every(a=>a.chance[0]<1));
 const estimate=estimateBladeburnerRoute(s.bb);assert.equal(estimate.actionable,false);assert.match(estimate.reason,/stamina/);
 assert.equal(estimateBladeburnerRoute(nativeSnapshot([100,100]).snapshot.bb).actionable,true);
});
test('route snapshots fail closed when new or unsupported action difficulty is unknown',()=>{
 const {ns}=nativeSnapshot([100,100]);ns.bladeburner.getContractNames=()=>['Future Contract'];
 const s=vm.runInNewContext(nodeRouteSnapshotSource(false,true),{ns});
 assert.equal(s.bb.actions[0].chance[0],0);assert.equal(s.bb.actions[0].capabilityChance,null);
});
const sample=(at,chance,capability)=>({at,bb:{city:'A',chanceModel:'post-cost-v1',rank:5000,ops:[{name:'X',required:2500,chance:[chance,chance],capabilityChance:[capability,capability]}]}});
test('recovery-only chance improvements do not invent a skill-growth ETA',()=>{
 const first=sample(1000,.2,.8),current=sample(61000,.6,.8);
 const p=routeDevelopment(current,{samples:[first]});assert.equal(p.nextBlackOp.chanceEtaMs,null);
 const readyAtFull=routeDevelopment(sample(61000,.6,1),{samples:[sample(1000,.2,1)]});
 assert.equal(readyAtFull.nextBlackOp.staminaBlocked,true);assert.equal(readyAtFull.nextBlackOp.chanceEtaMs,null);assert.match(readyAtFull.nextBlackOp.reason,/Recover stamina/);
});
test('capability growth remains measurable with matching models and cities',()=>{
 const first=sample(1000,.4,.5),current=sample(61000,.5,.6);
 const p=routeDevelopment(current,{samples:[first]});assert.ok(Math.abs(p.nextBlackOp.chanceEtaMs-234000)<1e-6);
 assert.equal(p.nextBlackOp.safe,false);
 delete first.bb.chanceModel;
 assert.equal(routeDevelopment(current,{samples:[first]}).nextBlackOp.chanceEtaMs,null);
});
test('actual skill worker passes full stamina, not only its percentage',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.ok(source.includes('threshold:ns.args[6],stamina,maxStaminaMultiplier:'));
});
