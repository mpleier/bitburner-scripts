import {bladeburnerRankDetour} from '../bladeburner-rank-policy.js';
import {readBladeburnerTrainingProgress,readBladeburnerMissionProgress,bladeburnerMissionProgress} from '../bladeburner-growth-clock-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {valueBladeburnerStaminaGrowth,rankBladeburnerStaminaGrowth} from '../bladeburner-growth-stamina-policy.js';
import {bladeburnerTrainingPayoff} from '../bladeburner-training-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {bladeburnerDevelopmentAction} from '../bladeburner-policy.js';
import {earlyBladeburnerGrowth} from '../combat-growth-policy.js';
import {sleeveKarmaTrainingPlan} from '../sleeve-karma-training-policy.js';
import {adaptiveHgwTiming} from '../progression-improvements-policy.js';
const blocked={rank:500,requiredRank:2500,chance:[0,0],remainingMs:120000};
test('early Bladeburner development is opt-in and retains chance, training and budget guards',()=>{
 assert.equal(bladeburnerDevelopmentAction(blocked),null);assert.equal(bladeburnerDevelopmentAction({...blocked,allowBeforeRank:true}),'Training');
 for(const patch of [{remainingMs:0},{trainingEnabled:false},{chance:[1,1]},{chance:[NaN,0]},{rank:-1}])assert.equal(bladeburnerDevelopmentAction({...blocked,allowBeforeRank:true,...patch}),null);
 const c={kind:'training',score:2,time:30000},m={kind:'mission',name:'Tracking',score:1};assert.equal(earlyBladeburnerGrowth(c,m,{rankEtaMs:600000,remainingMs:120000}),true);
 for(const settings of [{rankEtaMs:100000,remainingMs:120000},{rankEtaMs:null,remainingMs:120000},{rankEtaMs:600000,remainingMs:20000}])assert.equal(earlyBladeburnerGrowth(c,m,settings),false);
 assert.equal(earlyBladeburnerGrowth({...c,score:1.1},m,{rankEtaMs:600000,remainingMs:120000}),false);
});
const keys=['hacking','strength','defense','dexterity','agility','charisma'];
const sleeve=()=>({shock:0,sync:100,skills:Object.fromEntries(keys.map(k=>[k,11])),exp:Object.fromEntries(keys.map(k=>[k,200])),mults:{}});
const crimes={Homicide:{time:3000,karma:3,difficulty:1,strength_success_weight:2,strength_exp:1},Conditioning:{time:2000,karma:0,difficulty:1,strength_success_weight:1,strength_exp:1000}};
const plan=(extra={})=>sleeveKarmaTrainingPlan({sleeves:[sleeve()],workers:[0],crimes,karma:0,...extra});
test('sleeve conditioning must beat evolving direct karma and recovery-first alternatives',()=>{
 const s=sleeve(),before=JSON.stringify(s),p=plan({sleeves:[s]});assert.equal(p.best.name,'Conditioning');assert.ok(p.best.etaSeconds<p.best.baselineSeconds*.9);assert.equal(JSON.stringify(s),before);assert.ok(p.evaluations<=9);
 assert.equal(plan({karma:-53999}).best,null);assert.equal(plan({enabled:false}).best,null);assert.equal(plan({sleeves:[{...sleeve(),shock:100}]}).best,null);assert.equal(plan({sleeves:[{...sleeve(),sync:50}]}).best,null);
 const strong={...sleeve(),skills:{...sleeve().skills,strength:975}};assert.equal(plan({sleeves:[strong],crimes:{Homicide:crimes.Homicide}}).best,null);
 assert.equal(plan({canEvaluate:()=>false}).deferred,true);
});
test('unfinished sleeve crimes are held without reassigning other recovering sleeves',()=>{
 const p=plan({sleeves:[sleeve(),sleeve()],tasks:[{type:'CRIME',crimeType:'Conditioning',cyclesWorked:2,cyclesNeeded:10}]});assert.equal(p.choices[0],'Conditioning');assert.equal(p.best,null);assert.equal(p.choices[1],undefined);
 assert.equal(plan({sleeves:[{...sleeve(),exp:{}}]}).best,null);
});
function receipts(){return Array.from({length:3},(_,j)=>{
 const plan=['hack','weak1','grow','weak2'].map((step,i)=>({step,tool:step.startsWith('weak')?'weaken':step,threads:1,deadline:200000+j*5000+i*1000}));
 return plan.map((p,i)=>({owner:7,pid:100+j*4+i,at:p.deadline+20,deadline:p.deadline,lateMs:20,target:'x',tool:p.tool,batchVersion:1,batchId:'1:2:7:'+j,batchStep:p.step,batchPlan:plan,pieceThreads:1}));
 }).flat();}
const previous={augReset:2,nodeReset:1,baseCycleMs:4000,multiplier:3,latencyFloorMs:24000,cleanWindows:2,windowAt:100000,operations:0,late:0,spacingSamples:0,spacingRisks:0,changedAt:0,at:100000};
const timing=(extra={})=>adaptiveHgwTiming(previous,{at:220000,ownerPid:7,augReset:2,nodeReset:1,counts:{operations:20,deadlineOverruns:0,spacingSamples:20,spacingRisks:0},recent:receipts(),...extra},{now:220000});
test('hacking recovery accelerates only with independent complete ordered current-owner batches',()=>{
 const good=timing();assert.equal(good.cycleMs,16000);assert.equal(good.recoveryEvidence.batches,3);
 for(const extra of [{recent:[]},{ownerPid:8},{recent:receipts().slice(1)},{recent:receipts().map(e=>({...e,error:'failed'}))},{recent:receipts().map(e=>({...e,batchId:'wrong'}))}]){const slow=timing(extra);assert.equal(slow.cycleMs,19200);}
 assert.equal(timing({blocked:true}).cycleMs,24000);
 const inversion=receipts();inversion[0].at=inversion[1].at+1;assert.equal(timing({recent:inversion}).cycleMs,19200);
});
test('live wiring gates all three optimizations and exposes their decisions',()=>{
 const bb=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),s=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8');
 assert.match(bb,/allowBeforeRank:true/);assert.match(bb,/if\(preparingChance\)\{rankDetour=bladeburnerRankDetour/);assert.match(bb,/if\(\(chanceBlocked\|\|preparingChance\)&&!blackOpStaminaBlocked/);
 assert.match(s,/startupPlan.stage==='gang-karma'/);assert.match(s,/disableSleeveExpAndAugmentation,canEvaluate/);assert.match(s,/karmaTraining:startupPlan.karmaTraining/);
});

test('executed Bladeburner growth branch prepares below rank gate and preserves urgent guards',async()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('    let developmentAction=bladeburnerDevelopmentAction('),end=source.indexOf('    let recruitmentDecision=',start);
 for(const guarded of [false,true]){
  const writes=[];const context={bladeburnerRankDetour,readBladeburnerTrainingProgress,readBladeburnerMissionProgress,bladeburnerMissionProgress,contractNames:['Tracking'],quotePlayerTrainingStamina,valueBladeburnerStaminaGrowth,rankBladeburnerStaminaGrowth,bladeburnerTrainingPayoff,trainingMilestone:{eligible:true,at:Date.now(),used:0,probeUntil:2},bladeburnerDevelopmentAction,earlyBladeburnerGrowth,rank:500,nextBlackOp:'Typhoon',blackOpsRanks:{Typhoon:700},blackOpsChance:[0,0],options:{'success-threshold':.99,'training-limit':50,'chaos-recovery-threshold':50},developmentBudget:{spentMs:0},timesTrained:0,rankEtaMs:600000,blackOpStaminaBlocked:guarded,lowHealthTriggered:false,lowStaminaTriggered:false,chaosByCity:{A:0},currentCity:'A',unreservedActions:['Tracking'],getCount:()=>10,minChance:()=>1,getChance:()=>[1,1],actionMetrics:{Tracking:{time:1000,gain:1,loss:0,level:1}},bladeburnerDifficulty:{Tracking:{base:1,factor:1}},levelPlans:{},bladeburnerRankRate:()=>1,bladeburnerXpWeights:{Tracking:{}},player:{},blackOpMetadata:{Typhoon:{}},bestActionName:'Tracking',surplusSelected:false,antiChaosOperation:'Stealth Retirement Operation',reason:'rank',developmentNow:1000,developmentSaved:null,statReadiness:{statEtaMs:900000},resetInfo:{lastAugReset:2,lastNodeReset:1},observedAction:{name:'Tracking'},bladeburnerRankSupply:()=>10,rankReserves:{},
   getNsDataThroughFile:async()=>({effective:{},hyperdrive:0,trainingTime:30000}),bladeburnerGrowthChoice:(_actions,_ctx,o)=>o.trainingAllowed?{kind:'training',name:'Training',score:2,time:30000}:{kind:'mission',name:'Tracking',score:1,time:1000,rankPerCycle:1,duty:1,supply:10},ns:{pid:7,write:async(_f,text)=>writes.push(JSON.parse(text))}};
  vm.runInNewContext('globalThis.run=async()=>{'+source.slice(start,end)+';return bestActionName;}',context);assert.equal(await context.run(),guarded?'Tracking':'Training');assert.equal(writes[0].preparingChance,true);
 }
});
test('executed sleeve opening task uses conditioning choice and respects ordinary karma fallback',async()=>{
 const source=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8'),start=source.indexOf('async function pickSleeveTask('),end=source.indexOf('    // Must synchronize first',start);
 const context={startupPlan:{assignments:{0:'karma'},karmaTraining:{choices:{0:'Conditioning'},best:{index:0}}},lastSleeveHp:[],lastSleeveShock:[],cachedCrimeStats:crimes,crimeNodeMultiplier:1,bestSleeveCrime:()=> 'Homicide',crimeTask:async(_ns,name)=>name};
 vm.runInNewContext(source.slice(start,end)+'};globalThis.pick=pickSleeveTask;',context);const s={...sleeve(),hp:{current:10}};
 assert.equal(await context.pick({}, {}, {},0,s,true),'Conditioning');context.startupPlan.karmaTraining=null;assert.equal(await context.pick({}, {}, {},0,s,true),'Homicide');
});
