import {bladeburnerStaminaGrowthSource} from '../bladeburner-growth-stamina-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {combatXpValue,bladeburnerGrowthChoice,planBladeburnerGrowthLevels} from '../combat-growth-policy.js';
import {planBladeburnerLevels,planBladeburnerTeams,bladeburnerRankRate,bladeburnerStaminaChance,nextBladeburnerProgressSkill,nextSkill,optionsError,bladeburnerSkillGoal} from '../bladeburner-policy.js';
const player={skills:{strength:100},exp:{strength:1000},mults:{}};
const metadata={weights:{strength:1},decays:{strength:.8}};
const context={metadata,player};
function fixture(type='Contracts') {
 const state={level:1,auto:true,team:2,throws:false,calls:0};
 const api={getActionCurrentLevel:()=>state.level,getActionMaxLevel:()=>4,getActionAutolevel:()=>state.auto,setActionLevel:(_t,_n,level)=>{state.level=level;state.calls++;},
  getActionEstimatedSuccessChance:()=>state.level<=3?[1,1]:[.5,.5],getActionTime:()=>{if(state.throws&&state.level===2)throw Error('native');return 1000;},getActionRankGain:()=>state.level**12,getActionRankLoss:()=>0,
  getTeamSize:()=>state.team,setTeamSize:(_t,_n,n)=>state.team=n,getActionTimeCurrent:()=>0};
 const recovery={actions:{Work:{base:125,factor:100}},regen:1,hrc:1,stamina:[1e9,1e9]};
 const run=(allowed=()=>true)=>planBladeburnerGrowthLevels(api,[['Work',type]],.99,allowed,0,0,0,recovery,context,0,{Work:{strength:1}},planBladeburnerTeams,planBladeburnerLevels,bladeburnerRankRate,bladeburnerGrowthChoice,null);
 return {api,state,recovery,run};
}
test('XP level objective can differ from rank while retaining measured safe candidates',()=>{
 const f=fixture();
 f.recovery.actions.Work.factor=10000;f.api.getActionRankGain=()=>f.state.level**40;
 f.api.getActionEstimatedSuccessChance=()=>f.state.level<3?[1,1]:f.state.level===3?[.99,.99]:[.5,.5];
 const rank=planBladeburnerLevels(f.api,[['Work','Contracts']],.99,bladeburnerRankRate,()=>true,f.recovery).Work;
 const xp=f.run().Work;
 assert.equal(rank.level,3);assert.ok(xp.level<rank.level);assert.equal(xp.objective,'combat-xp');assert.ok(xp.chance[0]>=.99);
 assert.equal(f.state.level,1);assert.equal(f.state.auto,true);assert.ok(xp.probes<=128);
});
test('XP operation probes restore both squad and level on native errors',()=>{
 const f=fixture('Operations');f.state.throws=true;
 assert.throws(()=>f.run(),/native/);assert.equal(f.state.team,2);assert.equal(f.state.level,1);
});
test('cancelled XP probing restores levels and avoids unmeasured plans',()=>{
 const f=fixture();const p=f.run(()=>f.state.calls<3);
 assert.equal(f.state.level,1);if(p.Work)assert.ok(p.Work.probes<=3);
 assert.deepEqual(f.run(()=>false),{});
});
test('XP planning fails closed without action XP weights or target evidence',()=>{
 const f=fixture();
 const args=[f.api,[['Work','Contracts']],.99,()=>true,0,0,0,f.recovery];
 assert.deepEqual(planBladeburnerGrowthLevels(...args,context,0,{},planBladeburnerTeams,planBladeburnerLevels,bladeburnerRankRate,bladeburnerGrowthChoice,null),{});
 assert.deepEqual(planBladeburnerGrowthLevels(...args,null,0,{Work:{strength:1}},planBladeburnerTeams,planBladeburnerLevels,bladeburnerRankRate,bladeburnerGrowthChoice,null),{});
});
test('XP optimizer serializes with explicit worker dependencies',()=>{
 const f=fixture();const plan=vm.runInNewContext('('+planBladeburnerGrowthLevels.toString()+')');
 const result=plan(f.api,[['Work','Contracts']],.99,()=>true,0,0,0,f.recovery,context,0,{Work:{strength:1}},planBladeburnerTeams,planBladeburnerLevels,bladeburnerRankRate,bladeburnerGrowthChoice,null);
 assert.equal(result.Work.level,f.run().Work.level);
});
const names=['Hyperdrive',"Blade's Intuition",'Reaper','Evasive System'];
const levels={Hyperdrive:0,"Blade's Intuition":0,Reaper:0,'Evasive System':0};
const prices={Hyperdrive:1,"Blade's Intuition":100,Reaper:1000,'Evasive System':1000};
const base={target:'Blocked',rank:100,requiredRank:100,chance:[.2,.2],threshold:.99,metadata,skills:player.skills,exp:player.exp,
 growthHorizonSeconds:300,growth:{known:true,target:'Blocked',hyperdrive:0,effective:{strength:1,dexterity:1},rates:{strength:1000},pool:{strength:1000},supplySeconds:300}};
const choose=(c=base,ls=levels,cs=prices,points=100)=>nextBladeburnerProgressSkill(names,ls,cs,points,{},c,nextSkill);
test('cheap Hyperdrive competes through bounded delayed capability, not a direct chance bonus',()=>{
 assert.equal(choose(),'Hyperdrive');
 assert.equal(choose({...base,growth:{...base.growth,rates:{strength:0}}}),"Blade's Intuition");
 assert.equal(choose({...base,growth:{...base.growth,pool:{strength:1e12}}}),"Blade's Intuition");
});
test('an immediate Black Op unlock takes priority over Hyperdrive growth',()=>{
 assert.equal(choose({...base,chance:[.985,.985]}),"Blade's Intuition");
});
test('Hyperdrive requires known current-level funding and finite unreserved supply',()=>{
 for(const patch of [{known:false},{hyperdrive:1},{target:'Other'},{effective:{strength:2,dexterity:2}},{supplySeconds:0},{supplySeconds:NaN},{pool:{strength:NaN}}])
  assert.equal(choose({...base,growth:{...base.growth,...patch}}),"Blade's Intuition");
 assert.equal(choose(base,levels,{...prices,Hyperdrive:101}),"Blade's Intuition");
 assert.equal(choose({...base,exp:null}),"Blade's Intuition");
});
test('Hyperdrive horizon is bounded and no action-planning points are spent by quotes',()=>{
 for(const growthHorizonSeconds of [0,29,901,NaN])assert.equal(choose({...base,growthHorizonSeconds}),"Blade's Intuition");
 for(const growthHorizonSeconds of [30,300,900])assert.equal(choose({...base,growthHorizonSeconds}),'Hyperdrive');
 const api={getSkillPoints:()=>100,getSkillLevel:n=>levels[n],getSkillUpgradeCost:n=>prices[n]};
 assert.equal(bladeburnerSkillGoal(api,names,{},nextBladeburnerProgressSkill,()=>base).name,'Hyperdrive');
});
test('mission intelligence XP uses the native .003 coefficient',()=>{
 const result=bladeburnerGrowthChoice([{name:'X',time:1000,difficulty:100,chance:1,duty:1,weights:{strength:.5,intelligence:.5}}],context);
 assert.ok(Math.abs(result.rates.intelligence/result.rates.strength-.003)<1e-12);
});
test('generated level worker compiles with both XP and rank branches',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
 const literal=s.match(/levelPlans=await getNsDataThroughFile\(ns,(`[^`]+`),'\/Temp\/bladeburner-level-plan.txt'/)[1];
 const expression=Function('combatXpValue','planBladeburnerGrowthLevels','planBladeburnerTeams','planBladeburnerLevels','bladeburnerRankRate','bladeburnerGrowthChoice','bladeburnerStaminaChance','bbMutationGuard','bladeburnerStaminaGrowthSource','return '+literal)(combatXpValue,planBladeburnerGrowthLevels,planBladeburnerTeams,planBladeburnerLevels,bladeburnerRankRate,bladeburnerGrowthChoice,bladeburnerStaminaChance,'true',bladeburnerStaminaGrowthSource);
 assert.doesNotThrow(()=>new vm.Script(expression));
 for(const target of [context,null]){
  const f=fixture();const args=[JSON.stringify([['Work','Contracts']]),.99,7,0,0,'0',JSON.stringify(f.recovery),JSON.stringify(target),0,JSON.stringify({Work:{strength:1}})];
  const result=vm.runInNewContext(expression,{ns:{args,bladeburner:f.api,isRunning:()=>true}});
  assert.ok(result.Work);assert.equal(result.Work.objective,target?'combat-xp':undefined);assert.equal(f.state.level,1);
 }
});
