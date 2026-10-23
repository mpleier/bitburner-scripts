import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readBladeburnerTrainingProgress,readBladeburnerMissionProgress,bladeburnerMissionProgress} from '../bladeburner-growth-clock-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {valueBladeburnerStaminaGrowth,rankBladeburnerStaminaGrowth} from '../bladeburner-growth-stamina-policy.js';
import {bladeburnerTrainingPayoff} from '../bladeburner-training-policy.js';
import {bladeburnerGrowthChoice,earlyBladeburnerGrowth} from '../combat-growth-policy.js';
import {bladeburnerDevelopmentAction} from '../bladeburner-policy.js';
const keys=['strength','defense','dexterity','agility'],zero=Object.fromEntries(keys.map(k=>[k,0]));
const person={skills:Object.fromEntries(keys.map(k=>[k,100])),exp:Object.fromEntries(keys.map(k=>[k,1000])),mults:{},hp:{current:100,max:100}};
const metadata={baseDifficulty:50000,weights:{strength:1},decays:{strength:1}},context={player:person,metadata,effective:{},inferLevels:true};
const cost=.285*(50000**.28+50000/650),quote=max=>quotePlayerTrainingStamina(context,{stamina:[max,max],cyber:0,time:30000});
const training={kind:'training',name:'Training',score:.001,time:30000,rates:{...zero,strength:1}},mission={kind:'mission',name:'Tracking',score:.002,time:1000,rates:{...zero,strength:2}};
test('parent ranking can prefer Training for stamina capacity while preserving XP rates for empirical gating',()=>{
 const result=rankBladeburnerStaminaGrowth([mission],training,quote(cost*1.5),{trainingAllowed:true});
 assert.equal(result.choice.name,'Training');assert.equal(result.choice.xpScore,.001);assert.equal(result.choice.rates,training.rates);assert.ok(result.choice.score>result.mission.score);
 const s={eligible:true,at:100000,nativeUsed:2,probeUntil:2,evidenceVersion:3,samples:[{at:100000,backgroundCorrected:true,completionAligned:true,rates:zero}]};
 assert.equal(bladeburnerTrainingPayoff(s,result.choice,result.mission.score,100000),false);
 assert.equal(bladeburnerTrainingPayoff({...s,eligible:false},result.choice,result.mission.score,100000),false);
});
test('all eligible missions are ranked in the same stamina units and disabled Training remains disabled',()=>{
 const agility={...mission,name:'Agility',score:.0015,rates:{...zero,agility:100}};
 const result=rankBladeburnerStaminaGrowth([mission,agility],training,quote(cost*1.5),{trainingAllowed:false});
 assert.equal(result.choice.name,'Agility');assert.equal(result.training,null);assert.ok(result.choice.score>result.choice.xpScore);
});
test('saturated capacity, missing quotes and invalid horizons retain XP ordering without input mutations',()=>{
 const before=JSON.stringify([training,mission]);
 for(const [stamina,seconds]of [[quote(cost*3),30],[null,30],[quote(cost*1.5),0]]){
  const result=rankBladeburnerStaminaGrowth([mission],training,stamina,{trainingAllowed:true,seconds});assert.equal(result.choice.name,'Tracking');
 }
 assert.equal(JSON.stringify([training,mission]),before);
 assert.equal(valueBladeburnerStaminaGrowth({...mission,score:NaN},training,quote(cost*1.5)),null);
 assert.equal(valueBladeburnerStaminaGrowth({...mission,rates:{agility:Infinity}},training,quote(cost*1.5)),null);
});
test('candidate value uses the same horizon for rank work and the growth alternative',()=>{
 const q=quote(cost*1.5),a=valueBladeburnerStaminaGrowth(mission,training,q,15),b=rankBladeburnerStaminaGrowth([mission],training,q,{seconds:15});
 assert.equal(a.score,b.mission.score);assert.equal(a.stamina.horizonSeconds,15);assert.ok(a.score>0);
});

test('executed controller retains recovery, rank-runway and empirical guards with stamina-aware growth',async()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('    let developmentAction=bladeburnerDevelopmentAction('),end=source.indexOf('    let recruitmentDecision=',start),block=source.slice(start,end);
 for(const mode of ['allowed','health','stamina','blackop-stamina','chaos','rank-runway','empirical']){
  const writes=[];let captured=null;
  const now=Date.now(),stamina=cost*1.5,q={player:person,stamina:[stamina,stamina],cyber:0,effective:{},hyperdrive:0,trainingTime:30000};
  const c={readBladeburnerTrainingProgress,readBladeburnerMissionProgress,bladeburnerMissionProgress,contractNames:['Tracking'],quotePlayerTrainingStamina,valueBladeburnerStaminaGrowth,rankBladeburnerStaminaGrowth,bladeburnerTrainingPayoff,bladeburnerDevelopmentAction,earlyBladeburnerGrowth,bladeburnerGrowthChoice,trainingMilestone:{eligible:true,at:now,used:0,nativeUsed:mode==='empirical'?2:0,probeUntil:2,evidenceVersion:3,samples:[{at:now,backgroundCorrected:true,completionAligned:true,rates:zero}]},rank:mode==='rank-runway'?500:5000,nextBlackOp:'Target',blackOpsRanks:{Target:2500},blackOpsChance:[.2,.2],options:{'success-threshold':.99,'training-limit':50,'chaos-recovery-threshold':50},developmentBudget:{spentMs:0},timesTrained:0,rankEtaMs:1000,blackOpStaminaBlocked:mode==='blackop-stamina',lowHealthTriggered:mode==='health',lowStaminaTriggered:mode==='stamina',chaosByCity:{A:mode==='chaos'?100:0},currentCity:'A',unreservedActions:['Tracking'],getCount:()=>10,minChance:()=>1,getChance:()=>[1,1],actionMetrics:{Tracking:{time:1000,gain:1,loss:0,level:1}},bladeburnerDifficulty:{Tracking:{base:1,factor:1}},levelPlans:{},bladeburnerRankRate:()=>1,bladeburnerXpWeights:{Tracking:{strength:1}},player:person,blackOpMetadata:{Target:metadata},bestActionName:'Tracking',surplusSelected:false,antiChaosOperation:'Stealth Retirement Operation',reason:'rank',developmentNow:now,developmentSaved:null,statReadiness:{},resetInfo:{lastAugReset:2,lastNodeReset:1},observedAction:{name:'Tracking'},bladeburnerRankSupply:()=>10,rankReserves:{},getNsDataThroughFile:async(_ns,body)=>{captured=body;return q;},ns:{pid:7,write:async(_f,body)=>writes.push(JSON.parse(body))}};
  vm.runInNewContext('globalThis.run=async()=>{'+block+';return bestActionName;}',c);
  assert.equal(await c.run(),mode==='allowed'?'Training':'Tracking',mode);assert.equal(writes.length,1);
  if(mode==='allowed'){
   assert.ok(writes[0].growthChoice.stamina);assert.ok(writes[0].growthChoice.xpScore>0);
   const native=vm.runInNewContext(captured,{ns:{getPlayer:()=>person,bladeburner:{getStamina:()=>[stamina,stamina],getActionTime:()=>30000,getSkillLevel:name=>{assert.ok(['Reaper','Evasive System','Hyperdrive',"Cyber's Edge"].includes(name));return 0;}}}});
   assert.equal(native.player,person);assert.equal(native.cyber,0);assert.equal(native.stamina[1],stamina);
  }
 }
});
