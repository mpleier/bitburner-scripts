import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {scoreBladeburnerCityFallback} from '../bladeburner-city-fallback-policy.js';
import {bladeburnerStaminaGrowthSource,valueBladeburnerStaminaGrowth,rankBladeburnerStaminaGrowth} from '../bladeburner-growth-stamina-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {readBladeburnerTrainingProgress,readBladeburnerMissionProgress,bladeburnerMissionProgress} from '../bladeburner-growth-clock-policy.js';
import {bladeburnerTrainingPayoff} from '../bladeburner-training-policy.js';
import {bladeburnerRankSupply} from '../bladeburner-reserve-policy.js';
import {combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining,planBladeburnerGrowthLevels,earlyBladeburnerGrowth} from '../combat-growth-policy.js';
import {probeBladeburnerCities,chooseBladeburnerCity,planBladeburnerLevels,planBladeburnerTeams,readBladeburnerMaintenance,bladeburnerRankRate,bladeburnerStaminaChance,bladeburnerDevelopmentAction,startBladeburnerPlannedAction} from '../bladeburner-policy.js';
const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
const keys=['strength','defense','dexterity','agility','charisma','hacking','intelligence'];
const player={skills:Object.fromEntries(keys.map(k=>[k,100])),exp:Object.fromEntries(keys.map(k=>[k,1000])),mults:{bladeburner_stamina_gain:1e6},hp:{current:100,max:100}};
const metadata={baseDifficulty:100,weights:{strength:1},decays:{strength:1}},stock={Scarce:2,Steady:30,Local:30};
const context={metadata,player,growthSupply:stock,inferLevels:true},data={Scarce:{base:1,factor:2},Steady:{base:1,factor:1},Local:{base:1,factor:1}};
const weights={Scarce:{strength:10},Steady:{strength:8},Local:{strength:8.25}},actions=Object.keys(stock).map(k=>[k,'Contracts']);
const bindings={probeBladeburnerCities,bladeburnerRankRate,bladeburnerStaminaChance,planBladeburnerLevels,readBladeburnerMaintenance,bbMutationGuard:'true',combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining,bladeburnerStaminaGrowthSource,scoreBladeburnerCityFallback,planBladeburnerGrowthLevels,planBladeburnerTeams};
function expression(name){const re=name==='city'?/const rows=await getNsDataThroughFile\(ns,(`[^`]+`),'\/Temp\/bladeburner-city-plan.txt'/:/levelPlans=await getNsDataThroughFile\(ns,(`[^`]+`),'\/Temp\/bladeburner-level-plan.txt'/;return Function(...Object.keys(bindings),'return '+source.match(re)[1])(...Object.values(bindings));}
function fixture(){
 const state={city:'Home',level:1,auto:true},calls={};
 const api={getCity:()=>state.city,switchCity:c=>{state.city=c;return true;},getActionCountRemaining:(_t,n)=>stock[n]??100,getActionCurrentLevel:()=>state.level,getActionMaxLevel:()=>2,getActionAutolevel:()=>state.auto,setActionLevel:(_t,_n,l)=>{state.level=l;},getActionEstimatedSuccessChance:(t,n)=>t==='General'||t==='Black Operations'?[1,1]:((state.city==='Home')===(n==='Local'))?[1,1]:[.1,.1],getActionTime:(t,n)=>t==='General'?30000:n==='Scarce'?state.level*10000:1000,getActionRankGain:()=>1,getActionRankLoss:()=>0,getSkillLevel:()=>0,getStamina:()=>[100,100],getTeamSize:()=>0,getBonusTime:()=>0};
 for(const [k,f]of Object.entries(api))api[k]=(...args)=>{calls[k]=(calls[k]||0)+1;return f(...args);};return {api,state,calls};
}
function levelPlans(f){f.state.city='Other';return vm.runInNewContext(expression('level'),{ns:{args:[JSON.stringify(actions.slice(0,2)),.99,7,0,0,'0',JSON.stringify({actions:data,stamina:[100,100],regen:1e6,hrc:1}),JSON.stringify(context),0,JSON.stringify(weights),30],bladeburner:f.api,isRunning:()=>true}});}
test('retaining three existing level quotes adds no native probes and preserves rank-only shape',()=>{
 const run=retain=>{const f=fixture();f.api.getActionMaxLevel=()=>10;f.api.getActionEstimatedSuccessChance=()=>[1,1];const plans=planBladeburnerLevels(f.api,[['Scarce','Contracts']],.99,(_p,m)=>100-(m.level-5)**2,()=>true,retain?{retainGrowthVariants:true}:null);return {f,p:plans.Scarce};};
 const single=run(false),joint=run(true);assert.equal(single.p.variants,undefined);assert.equal(joint.p.level,5);assert.deepEqual(joint.p.variants.map(v=>v.level),[5,1,10]);assert.deepEqual(joint.f.calls,single.f.calls);assert.equal(joint.f.state.level,1);assert.equal(joint.f.state.auto,true);
});
test('actual city worker can choose a lower level whose fallback beats the single-job level',()=>{
 const f=fixture(),rows=vm.runInNewContext(expression('city'),{ns:{args:[JSON.stringify(['Home','Other']),JSON.stringify(actions),.99,7,JSON.stringify(data),false,50,JSON.stringify(metadata),JSON.stringify(weights),'Target',30,JSON.stringify(stock),2],bladeburner:f.api,isRunning:()=>true,getPlayer:()=>player}});
 const winner=chooseBladeburnerCity(rows,'Home');assert.equal(winner.city,'Other');assert.equal(winner.action,'Scarce');assert.equal(winner.level,1);assert.equal(winner.fallback.first.level,1);assert.equal(winner.fallback.first.count,2);assert.equal(winner.fallback.second.name,'Steady');assert.equal(winner.fallback.second.count,8);assert.equal(f.state.city,'Home');assert.equal(f.state.level,1);
});
test('parent level worker retains a bounded lower-level alternative while restoring native state',()=>{
 const f=fixture(),plans=levelPlans(f);assert.equal(plans.Scarce.level,2);assert.ok(plans.Scarce.variants.length<=3);assert.ok(plans.Scarce.variants.some(v=>v.level===1));assert.equal(f.state.level,1);assert.equal(f.state.auto,true);
});
test('executed parent forwards chosen level, metrics and chance without mutating cached plans',async()=>{
 const f=fixture(),plans=levelPlans(f),original=JSON.stringify(plans),chance={Scarce:[1,1],Steady:[1,1]},metrics=Object.fromEntries(Object.entries(plans).map(([k,p])=>[k,p.metrics])),now=Date.now(),writes=[];
 const c={...bindings,quotePlayerTrainingStamina,valueBladeburnerStaminaGrowth,rankBladeburnerStaminaGrowth,readBladeburnerTrainingProgress,readBladeburnerMissionProgress,bladeburnerMissionProgress,bladeburnerTrainingPayoff,bladeburnerDevelopmentAction,earlyBladeburnerGrowth,bladeburnerRankSupply,trainingMilestone:{eligible:true,at:now,used:0,nativeUsed:0,probeUntil:2,limit:50},rank:5000,nextBlackOp:'Target',blackOpsRanks:{Target:2500},blackOpsChance:[.2,.2],options:{'success-threshold':.99,'training-limit':50,'chaos-recovery-threshold':50},developmentBudget:{spentMs:0},timesTrained:0,rankEtaMs:1000,blackOpStaminaBlocked:false,lowHealthTriggered:false,lowStaminaTriggered:false,chaosByCity:{Other:0},currentCity:'Other',unreservedActions:['Scarce','Steady'],getCount:n=>stock[n],minChance:n=>chance[n][0],getChance:n=>chance[n],actionMetrics:metrics,bladeburnerDifficulty:data,levelPlans:plans,bladeburnerXpWeights:weights,player,blackOpMetadata:{Target:metadata},bestActionName:'Steady',surplusSelected:false,antiChaosOperation:'Stealth Retirement Operation',reason:'rank',developmentNow:now,developmentSaved:null,statReadiness:{},resetInfo:{lastAugReset:2,lastNodeReset:1},observedAction:{name:'Steady'},rankReserves:{},contractNames:['Scarce','Steady'],contractChances:chance,operationChances:{},getNsDataThroughFile:async()=>({player,stamina:[100,100],cyber:0,effective:{},hyperdrive:0,trainingTime:30000}),ns:{pid:7,write:async(_f,s)=>writes.push(JSON.parse(s))}};
 const start=source.indexOf('    let developmentAction=bladeburnerDevelopmentAction('),end=source.indexOf('    let recruitmentDecision=',start);vm.runInNewContext('globalThis.run=async()=>{'+source.slice(start,end)+';return {name:bestActionName,choice:growthChoice,plans:levelPlans};}',c);
 const result=await c.run();assert.equal(result.name,'Scarce');assert.equal(result.choice.level,1);assert.equal(result.plans.Scarce.level,1);assert.equal(result.plans.Scarce.metrics.level,1);assert.equal(c.actionMetrics.Scarce.level,1);assert.equal(JSON.stringify(plans),original);assert.notEqual(result.plans,plans);assert.equal(writes[0].growthChoice.level,1);
});
test('a chosen lower level still obeys the existing protected-work and native-start guards',()=>{
 const f=fixture(),plans=levelPlans(f),p={...plans.Scarce,...plans.Scarce.variants.find(v=>v.level===1)};let level=2,starts=0,sets=0;
 const api={getActionMaxLevel:()=>2,getActionCurrentLevel:()=>level,getActionAutolevel:()=>false,setActionAutolevel:()=>{},setActionLevel:(_t,_n,l)=>{sets++;level=l;},getActionEstimatedSuccessChance:()=>[1,1],getStamina:()=>[100,100],startAction:()=>{starts++;return true;}};
 assert.equal(startBladeburnerPlannedAction(api,'Contracts','Scarce',p,.99,0,0,()=>false,bladeburnerStaminaChance,data),false);assert.equal(sets,0);assert.equal(starts,0);
 assert.equal(startBladeburnerPlannedAction(api,'Contracts','Scarce',p,.99,0,0,()=>true,bladeburnerStaminaChance,data),true);assert.equal(level,1);assert.equal(starts,1);
});
test('growth skill estimates require the live level to match during a deferred switch',()=>{
 const condition=source.match(/d\.growthChoice\?\.name&&d\.growthChoice\.name!=="Training"&&d\.growthChoice\.name===active\?\.name&&\(!Number\.isSafeInteger\(d\.growthChoice\.level\)\|\|d\.growthChoice\.level===ns\.bladeburner\.getActionCurrentLevel\(active\.type,d\.growthChoice\.name\)\)/)[0];
 const run=Function('d','active','ns','return !!('+condition+')'),d={growthChoice:{name:'Scarce',level:1}},active={name:'Scarce',type:'Contracts'};
 assert.equal(run(d,active,{bladeburner:{getActionCurrentLevel:()=>2}}),false);assert.equal(run(d,active,{bladeburner:{getActionCurrentLevel:()=>1}}),true);assert.equal(run({growthChoice:null},null,{}),false);
});
test('retained alternatives never mix stock from two levels of the same mission',()=>{
 const rates={strength:1,agility:0},training={kind:'training',name:'Training',score:.0001,time:30000,rates},q=quotePlayerTrainingStamina(context,{stamina:[100,100],cyber:0,time:30000}),rows=[1,2,3].map(level=>({name:'Only',kind:'mission',level,score:.01*level,time:1000*level,duty:1,supply:1,rates}));
 const result=rankBladeburnerStaminaGrowth(rows,training,q);assert.equal(result.fallbackPairs,0);assert.equal(result.choice.fallback,undefined);
});


test('multiple levels cannot crowd every other mission out of the bounded pair pools',()=>{
 const rates={strength:1,agility:0},training={kind:'training',name:'Training',score:.0001,time:30000,rates},q=quotePlayerTrainingStamina(context,{stamina:[100,100],cyber:0,time:30000});
 const rows=Array.from({length:12},(_,i)=>({name:'ManyLevels',kind:'mission',level:i+1,score:.02+i*.001,time:1000,duty:1,supply:1,rates}));
 rows.push({name:'OtherMission',kind:'mission',level:1,score:.001,time:1000,duty:1,supply:1,rates});
 const result=rankBladeburnerStaminaGrowth(rows,training,q);assert.ok(result.fallbackPairs>0);assert.ok(result.fallbackPairs<=64);assert.equal(result.byName.ManyLevels.fallback.second.name,'OtherMission');
});
