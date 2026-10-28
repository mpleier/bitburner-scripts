import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteBladeburnerSkillThroughputs,bladeburnerRankRunway} from '../bladeburner-rank-acceleration-policy.js';
import {bladeburnerActionCandidates,bladeburnerRankRate,planBladeburnerLevels,planBladeburnerTeams,nextBladeburnerProgressSkill,nextSkill,bladeburnerStaminaChance} from '../bladeburner-policy.js';
import {sleeveBladeburnerTasks} from '../sleeve-policy.js';
function fixture(){let level=1,sets=0;const api={getStamina:()=>[1e8,1e8],getSkillLevel:()=>0,getActionCountRemaining:()=>100,getActionCurrentLevel:()=>level,getActionMaxLevel:()=>12,getActionAutolevel:()=>false,setActionAutolevel:()=>{},setActionLevel:(_t,_n,l)=>{level=l;sets++;},getActionEstimatedSuccessChance:()=>level<=8?[1,1]:[.5,.5],getActionTime:()=>1000*level,getActionRankGain:()=>level**2,getActionRankLoss:()=>1,getTeamSize:()=>0};return {api,level:()=>level,sets:()=>sets};}
const data={A:{base:10,factor:1.01,isStealth:true,chaos:{success:0,always:0,positivePercent:0}}};
const options={threshold:.99,stats:{agility:100,dexterity:100},mults:{bladeburner_stamina_gain:1},allowed:()=>true,planner:planBladeburnerLevels,rate:bladeburnerRankRate,forecast:bladeburnerStaminaChance,maintenance:{maintenance:true}};
test('skill quotes use optimized and near-threshold levels, then restore native state within a bounded probe budget',()=>{
 const f=fixture(),rows=quoteBladeburnerSkillThroughputs(f.api,[['A','Contracts']],data,options);
 assert.ok(rows.some(r=>r.level===8));assert.ok(rows.some(r=>r.level===9&&r.chance<.99));assert.ok(rows.every(r=>r.metrics.time>0));
 assert.equal(f.level(),1);assert.ok(f.sets()<=54);
 const disabled=fixture(),plain=quoteBladeburnerSkillThroughputs(disabled.api,[['A','Contracts']],data,{...options,planner:null});
 assert.deepEqual(plain.map(r=>r.level),[1]);assert.equal(disabled.level(),1);
});
test('interrupted and failed native skill probes restore the original level',()=>{
 const f=fixture();let polls=0;quoteBladeburnerSkillThroughputs(f.api,[['A','Contracts']],data,{...options,allowed:()=>++polls<5});assert.equal(f.level(),1);
 const g=fixture();g.api.getActionRankGain=()=>{throw Error('native failure');};
 assert.throws(()=>quoteBladeburnerSkillThroughputs(g.api,[['A','Contracts']],data,options));assert.equal(g.level(),1);
});
test('skill choice prices recruitment using the same net rank scorer as action planning',()=>{
 const factor=.5*(1000**.04+1000**.035+.1+.1),difficulty=101*10*factor;
 const names=['Overclock',"Blade's Intuition"],levels={Overclock:0,"Blade's Intuition":0},costs={Overclock:1,"Blade's Intuition":1};
 const action={type:'Operations',difficulty,gain:100,loss:0,chance:.999,metrics:{time:101000,gain:100,loss:0,team:3,recruitment:{time:1e6,chance:1}}};
 const context={rank:1,requiredRank:100000,threshold:.99,skills:{agility:1000,dexterity:1000},mults:{bladeburner_stamina_gain:1},stamina:[1e9,1e9],throughputs:[action]};
 assert.equal(nextBladeburnerProgressSkill(names,levels,costs,1,{},context,nextSkill),'Overclock');
 assert.equal(nextBladeburnerProgressSkill(names,levels,costs,1,{},context,nextSkill,bladeburnerRankRate),"Blade's Intuition");
});
test('bounded larger squads can unlock useful work while preserving humans, support and live assignments',()=>{
 let assigned=2;const probes=[],api={getTeamSize:type=>type?assigned:30,setTeamSize:(_t,_n,n)=>{assigned=n;probes.push(n);return n;},getActionCurrentLevel:()=>1,getActionMaxLevel:()=>1,getActionAutolevel:()=>false,setActionAutolevel:()=>{},setActionLevel:()=>{},getActionEstimatedSuccessChance:type=>type==='General'?[1,1]:assigned>=4?[1,1]:[.5,.5],getActionTime:type=>type==='General'?10:1000,getActionRankGain:()=>100,getActionRankLoss:()=>1};
 const plan=planBladeburnerTeams(api,[['A','Operations']],.99,bladeburnerRankRate,()=>true,planBladeburnerLevels,20,30,5).A;
 assert.equal(plan.team,4);assert.ok(probes.every(n=>n<=5));assert.equal(assigned,2);
 const unknown=planBladeburnerTeams(api,[['A','Operations']],.99,bladeburnerRankRate,()=>true,planBladeburnerLevels,20,30,null);assert.equal(unknown.A,undefined);assert.equal(assigned,2);
});
const rows=[{name:'Work',supply:100,time:1000,duty:1,rate:10}];
test('rank runway accounts for whole reserved supply, maintenance and possible bonus speed',()=>{
 assert.equal(bladeburnerRankRunway(rows,0).runwayMs,100000);
 assert.equal(bladeburnerRankRunway(rows,1).runwayMs,20000);
 assert.equal(bladeburnerRankRunway(rows,null).speed,5);
 assert.equal(bladeburnerRankRunway([{...rows[0],duty:.5}],0).runwayMs,200000);
 assert.equal(bladeburnerRankRunway([{...rows[0],supply:0}],0),null);
});
test('sleeve infiltration follows time to exhaustion rather than raw mission count',()=>{
 const sleeves=Array.from({length:8},()=>({shock:0,sync:100})),plan={chaos:0,threshold:.99,rankReady:false,chance:[1,1],counts:{Unused:0}};
 const low={...plan,rankSupply:bladeburnerRankRunway(rows,1)},scarce=sleeveBladeburnerTasks(sleeves,[],low);
 assert.equal(Object.values(scarce).filter(a=>a==='Infiltrate Synthoids').length,8);
 const ample={...plan,rankSupply:bladeburnerRankRunway([{...rows[0],supply:5,time:600000}],0)},tasks=sleeveBladeburnerTasks(sleeves,[],ample);
 assert.equal(Object.values(tasks).filter(a=>a==='Infiltrate Synthoids').length,1);assert.equal(Object.values(tasks).filter(a=>a==='combat-xp').length,7);
 assert.ok(!Object.values(sleeveBladeburnerTasks(sleeves,[],ample,[],false)).includes('combat-xp'));
 const protectedTasks=sleeveBladeburnerTasks(sleeves,[{type:'FACTION'}],ample,[1]);assert.equal(protectedTasks[0],undefined);assert.equal(protectedTasks[1],undefined);
 const corrupt=sleeveBladeburnerTasks(sleeves,[],{...ample,rankSupply:{...ample.rankSupply,runwayMs:Infinity}});assert.ok(!Object.values(corrupt).includes('combat-xp'));
});

import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {bladeburnerSkillContext,spendBladeburnerSkills,bladeburnerSkillGoal,readBladeburnerMaintenance} from '../bladeburner-policy.js';
import {bladeburnerRankSupply} from '../bladeburner-reserve-policy.js';
test('executed production skill worker uses optimized maintenance quotes for actual skill purchases',async()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('async function spendSkillPoints('),end=source.indexOf('/** @param {NS} ns',start);
 const factor=.5*(1000**.04+1000**.035+.1+.1),difficulty=101*10*factor,names=['Overclock',"Blade's Intuition"],levels={Overclock:0,"Blade's Intuition":0},bought=[];let points=1,level=1;
 const api={getRank:()=>1,getStamina:()=>[1e9,1e9],getSkillLevel:n=>levels[n]||0,getSkillPoints:()=>points,getSkillUpgradeCost:(_n,count=1)=>count,
 upgradeSkill:n=>{bought.push(n);levels[n]++;points--;return true;},getActionCountRemaining:()=>100,getActionCurrentLevel:()=>level,getActionMaxLevel:()=>1,getActionAutolevel:()=>false,setActionAutolevel:()=>{},setActionLevel:(_t,_n,l)=>level=l,
 getActionEstimatedSuccessChance:type=>type==='General'?[1,1]:[.999,.999],getActionTime:type=>type==='General'?1e6:101000,getActionRankGain:()=>100,getActionRankLoss:()=>0,getTeamSize:()=>3};
 const ns={pid:7,read:()=>'',write:()=>{},isRunning:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),getPlayer:()=>({skills:{agility:1000,dexterity:1000,charisma:1000},mults:{bladeburner_stamina_gain:1,bladeburner_max_stamina:1}}),bladeburner:api};
 const context={quoteBladeburnerSkillThroughputs,planBladeburnerLevels,bladeburnerRankRate,bladeburnerStaminaChance,readBladeburnerMaintenance,bladeburnerSkillContext,spendBladeburnerSkills,bladeburnerSkillGoal,nextBladeburnerProgressSkill,nextSkill,bbMutationGuard:'true',resetInfo:{lastNodeReset:1},skillNames:names,costAdjustments:{},remainingBlackOpsNames:[],blackOpsRanks:{},options:{'success-threshold':.99,'chaos-recovery-threshold':50},blackOpMetadata:{},bladeburnerDifficulty:{A:{base:difficulty,factor:1}},log:()=>{},cityPlanCache:null,levelPlanCache:null,
 getNsDataThroughFile:async(_ns,expression,_file,args)=>Function('ns','return '+expression)({...ns,args})};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+';globalThis.run=spendSkillPoints;',context);
 await context.run(ns,[['A','Operations']]);assert.deepEqual(bought,["Blade's Intuition"]);assert.equal(level,1);
});
test('actual sleeve-plan publisher computes runway using only rank-farmable stock',async()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),line=source.split('\n').find(l=>l.includes("await ns.write('tasks/bladeburner-sleeve-plan.json'"));let result;
 const context={bladeburnerActionCandidates,actionChances:{Tracking:[.9,1],Work:[1,1]},ns:{pid:7,write:async(_f,s)=>result=JSON.parse(s)},resetInfo:{lastNodeReset:1,lastAugReset:2},chaosByCity:{A:0},currentCity:'A',nextBlackOp:'X',rank:0,blackOpsRanks:{X:1000},statReadiness:{},rankEtaMs:100000,blackOpsChance:[1,1],options:{'success-threshold':.99},unreservedActions:['Tracking','Work'],getChance:()=>[1,1],getCount:n=>n==='Work'?50:1,actionMetrics:{Tracking:{time:1000,gain:100,loss:0},Work:{time:1000,gain:10,loss:0}},rankReserves:{population:200,maxRank:1000},rankBonusMs:0,bladeburnerRankRunway,bladeburnerRankRate,bladeburnerRankSupply};
 vm.createContext(context);vm.runInContext('globalThis.run=async()=>{'+line+'};',context);await context.run();
 assert.equal(result.farmingUncertain,true);assert.equal(result.rankSupply.action,'Work');assert.equal(result.rankSupply.supply,50);assert.equal(result.rankSupply.runwayMs,50000);
});
