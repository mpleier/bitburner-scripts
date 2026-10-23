import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {nextBladeburnerProgressSkill,nextSkill,spendBladeburnerSkills} from '../bladeburner-policy.js';
import {estimateBladeburnerRoute,nodeRouteSnapshotSource} from '../node-route-policy.js';

const names=["Cyber's Edge",'Reaper','Evasive System'];
const levels=Object.fromEntries(names.map(n=>[n,0]));
const context={target:'Operation Typhoon',rank:2500,requiredRank:2500,threshold:.99,chance:[1,1],metadata:{baseDifficulty:2000},stamina:[2,2],skills:{agility:1},maxStaminaMultiplier:1};
const choose=(costs,patch={},points=100)=>nextBladeburnerProgressSkill(names,levels,costs,points,{}, {...context,...patch},nextSkill);
test('stamina blockers compare Cyber Edge, Reaper and Evasive by native useful gain per point',()=>{
 assert.equal(choose({"Cyber's Edge":10,Reaper:1,'Evasive System':1}),'Evasive System');
 assert.equal(choose({"Cyber's Edge":10,Reaper:1,'Evasive System':100}),'Reaper');
 assert.equal(choose({"Cyber's Edge":.1,Reaper:10,'Evasive System':10}),"Cyber's Edge");
 assert.equal(choose({"Cyber's Edge":100,Reaper:100,'Evasive System':100},{},1),null);
});
test('training stamina is retained rather than incorrectly multiplying the entire maximum by agility',()=>{
 // With a large training term, agility adds little absolute stamina despite a large maximum.
 const c={...context,stamina:[2,2],skills:{agility:.01}};
 assert.equal(choose({"Cyber's Edge":1,Reaper:1,'Evasive System':1},c),"Cyber's Edge");
 const cost=.285*(2000**.28+2000/650),max=cost/(1-.99/2)-.001;
 assert.equal(choose({"Cyber's Edge":3,Reaper:1,'Evasive System':2},{stamina:[max,max]}),'Reaper');
});
test('missing agility inputs retain the validated Cyber Edge fallback and helpers serialize',()=>{
 const costs={"Cyber's Edge":10,Reaper:.01,'Evasive System':.01};
 assert.equal(choose(costs,{maxStaminaMultiplier:undefined}),"Cyber's Edge");
 const fn=Function('return ('+nextBladeburnerProgressSkill.toString()+')')();
 assert.equal(fn(names,levels,{"Cyber's Edge":10,Reaper:1,'Evasive System':1},100,{},context,nextSkill),'Evasive System');
});
test('all upgrades that change maximum stamina yield until the next game tick',()=>{
 for(const name of names){
  let purchases=0;const api={getSkillPoints:()=>100,getSkillLevel:()=>purchases,getSkillUpgradeCost:()=>1,upgradeSkill:()=>{purchases++;return true;}};
  assert.deepEqual(spendBladeburnerSkills(api,[name],{},()=>name,()=>true),[name]);assert.equal(purchases,1);
 }
});
const op=(name,required=0,p=1)=>({name,required,time:1000,chance:[p,p],gain:10,loss:0,staminaCost:5});
const recovery={regen:1,hrc:1};
test('route ETA includes recovery between Black Ops but none after the final success',()=>{
 const p=estimateBladeburnerRoute({rank:0,actions:[],ops:[op('A'),op('B')],recovery});
 assert.equal(p.lowerMs,4000);assert.equal(p.recoveryMs,2000);assert.equal(p.recoveryModel,'amortized-native');
 const last=estimateBladeburnerRoute({rank:0,ops:[op('A')],recovery});assert.equal(last.lowerMs,1000);assert.equal(last.recoveryMs,0);
 const retry=estimateBladeburnerRoute({rank:0,ops:[op('A',0,.99)],recovery});assert.ok(retry.recoveryMs>0);assert.ok(Math.abs(retry.lowerMs-(1000/.99+2000*.01/.99))<1e-6);
});
test('grinding pools include repeated recovery and select sustained throughput',()=>{
 const action={name:'X',time:1000,chance:[1,1],gain:50,loss:0,count:2,staminaCost:5};
 const p=estimateBladeburnerRoute({rank:0,actions:[action],ops:[op('Final',100)],recovery});assert.equal(p.lowerMs,7000);assert.equal(p.recoveryMs,4000);
 const expensive={...action,time:1000,staminaCost:100,count:1},sustained={...action,time:2000,staminaCost:0,count:1};
 const chosen=estimateBladeburnerRoute({rank:0,actions:[expensive,sustained],ops:[op('Final',50)],recovery});
 assert.equal(chosen.lowerMs,3000);assert.equal(chosen.recoveryMs,0);
});
test('missing or impossible recovery cannot produce invented precise recovery times',()=>{
 const unknown=estimateBladeburnerRoute({rank:0,ops:[op('A')]});assert.equal(unknown.recoveryMs,null);assert.equal(unknown.recoveryModel,'duty-range');
 const impossible=estimateBladeburnerRoute({rank:0,ops:[op('A')],recovery:{regen:0,hrc:0}});assert.equal(impossible.actionable,false);assert.match(impossible.reason,/recovery data unavailable/);
 const bad=estimateBladeburnerRoute({rank:0,ops:[{...op('A'),staminaCost:null}],recovery});assert.equal(bad.actionable,false);
});
test('executed native snapshot collects validated regeneration and action stamina costs',()=>{
 const skills={hacking:100,strength:100,defense:100,dexterity:100,agility:100};
 const ns={getPlayer:()=>({exp:skills,skills,mults:{hacking:1,faction_rep:1,strength:1,defense:1,dexterity:1,agility:1,bladeburner_stamina_gain:2},money:0}),getResetInfo:()=>({ownedAugs:{},currentNode:9}),getBitNodeMultipliers:()=>({HackingLevelMultiplier:1}),serverExists:()=>false,ps:()=>[],bladeburner:{inBladeburner:()=>true,getStamina:()=>[100,100],getSkillLevel:()=>1,getActionEstimatedSuccessChance:()=>[1,1],getActionTime:()=>1000,getActionRankGain:()=>10,getActionRankLoss:()=>0,getActionCountRemaining:()=>10,getCity:()=> 'A',getRank:()=>10000,getCurrentAction:()=>null,getBonusTime:()=>0,getBlackOpNames:()=>['Operation Typhoon'],getBlackOpRank:()=>2500,getContractNames:()=>[],getOperationNames:()=>[]}};
 const s=vm.runInNewContext(nodeRouteSnapshotSource(false,true),{ns});assert.equal(s.bb.error,undefined);
 assert.ok(s.bb.recovery.regen>0);assert.equal(s.bb.recovery.hrc,100*.01/60);assert.ok(s.bb.ops[0].staminaCost>0);
 const expected=(.0085+100/70000)*Math.pow(100*1.02*1.04,.17)*1.02*2;
 assert.ok(Math.abs(s.bb.recovery.regen-expected)<1e-12);
});
test('native skill worker supplies the max-stamina multiplier for exact agility gains',async()=>{
 const s=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');assert.ok(s.includes('maxStaminaMultiplier:ns.getPlayer().mults.bladeburner_max_stamina'));
});
