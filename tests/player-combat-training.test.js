import {captureParallelTrainingObservation,parallelTrainingFragment,recordParallelTrainingCalibration} from '../parallel-training-measurement-policy.js';
import {chooseParallelCombatTraining} from '../bb-stat-development-policy.js';
import {readBladeburnerTrainingProgress} from '../bladeburner-growth-clock-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {captureTrainingBackground,trainingBackgroundDelta,playerTrainingScope,recordPlayerTrainingCalibration,calibratePlayerTrainingQuotes} from '../player-training-calibration-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {quotePlayerCombatTraining,choosePlayerCombatTraining} from '../player-combat-training-policy.js';
import {combatXpValue} from '../combat-growth-policy.js';
import {runPlayerCombatTraining} from '../Tasks/bladeburner-training.js';
import {dispatchPlayerCombatTraining} from '../player-training-dispatch-policy.js';
import {bladeburnerRecruitmentBudget} from '../bladeburner-policy.js';
import {moduleManifest} from '../remote-api-command-policy.js';
const keys=['hacking','strength','defense','dexterity','agility','charisma'];
const person=()=>({city:'Sector-12',money:1e9,hp:{current:100,max:100},skills:{...Object.fromEntries(keys.map(k=>[k,100])),intelligence:0},exp:{...Object.fromEntries(keys.map(k=>[k,1000])),intelligence:0},mults:{}});
const metadata={baseDifficulty:2000,weights:{strength:1},decays:{strength:1}};
function fixture({change=null,simulacrum=false,claim=true,parallel=false}={}){
 let time=100000,work=null,bb=parallel?{type:'Contracts',name:'Tracking'}:{type:'General',name:'Training'},stops=0,bbStops=0,exit;const p=person(),files=new Map();
 const write=(f,s)=>files.set(f,s),set=(f,s)=>write(f,JSON.stringify(s)),reset={lastNodeReset:1,lastAugReset:2};
 set('tasks/activity-lock.json',{ownerPid:7,expiresAt:time+15000});set('tasks/node-route-plan.json',{ownerPid:9,selected:'bladeburner',at:time,nodeReset:1,augReset:2});
 set('tasks/bladeburner-development.json',{chanceBlocked:true,pid:7,target:'Typhoon',at:time,nodeReset:1,augReset:2,trainingTotal:60,externalTrainingTotal:0,trainingMilestone:{target:'Typhoon',limit:50,used:0,nativeUsed:0,baseTotal:60,baseNativeTotal:60},metadata,budget:{nodeReset:1,intervals:[],spentMs:0}});
 let parentAlive=true,cashAllowed=true;
 const ns={pid:11,args:[],read:f=>files.get(f)||'',write,rm:f=>files.delete(f),atExit:f=>{exit=f;},getResetInfo:()=>reset,getPlayer:()=>p,isRunning:pid=>pid===7?parentAlive:pid===9,ps:()=>[{pid:7,filename:'bladeburner.js'},{pid:9,filename:'autopilot.js'}],fileExists:()=>true,
  enums:{GymType:Object.fromEntries(['strength','defense','dexterity','agility'].map(k=>[k,k])),LocationName:{Sector12PowerhouseGym:'Powerhouse Gym'}},
  singularity:{getCurrentWork:()=>work,getOwnedAugmentations:()=>simulacrum?["The Blade's Simulacrum"]:[],getCrimeStats:()=>({time:3000}),getCrimeChance:()=>1,commitCrime:(name,focus)=>{assert.equal(focus,true);work={type:'CRIME',crimeType:name,cyclesWorked:0};return 3000;},gymWorkout:(gym,type,focus)=>{assert.equal(focus,true);work={type:'CLASS',classType:type,location:gym,cyclesWorked:0};return true;},stopAction:()=>{stops++;work=null;}},
  formulas:{work:{crimeGains:()=>({hackExp:0,strExp:40,defExp:0,dexExp:0,agiExp:0,chaExp:0}),gymGains:()=>({money:-1,strExp:20,defExp:0,dexExp:0,agiExp:0})}},
  bladeburner:{getCity:()=> 'Sector-12',getActionCurrentLevel:()=>1,getCurrentAction:()=>bb,getStamina:()=>[100,100],getSkillLevel:()=>0,getActionTime:()=>30000,getBonusTime:()=>0,stopBladeburnerAction:()=>{bbStops++;bb=null;}},
  sleep:async ms=>{time+=ms;if(work)work.cyclesWorked+=ms/200;set('tasks/node-route-plan.json',{ownerPid:9,selected:'bladeburner',at:time,nodeReset:1,augReset:2});if(change)change({ns,p,files,set,replace:w=>{work=w;},blackOp:()=>{bb={type:'Black Operations',name:'Typhoon'};},killParent:()=>{parentAlive=false;},denyCash:()=>{cashAllowed=false;}});}}
 const input={parallelMission:parallel,mission:parallel?{type:'Contracts',name:'Tracking'}:null,parent:7,target:'Typhoon',nodeReset:1,augReset:2,at:time,boundary:true,remainingMs:30000,rankGap:1000,rankRate:1};
 const ctx={captureParallelTrainingObservation:(ns,input)=>{const p=captureParallelTrainingObservation(ns,input);return p?{...p,at:time}:null;},parallelTrainingFragment,recordParallelTrainingCalibration,chooseParallelCombatTraining,readBladeburnerTrainingProgress,quotePlayerTrainingStamina,captureTrainingBackground,trainingBackgroundDelta,playerTrainingScope,recordPlayerTrainingCalibration,calibratePlayerTrainingQuotes,Date:{now:()=>time},combatXpValue,quotePlayerCombatTraining,choosePlayerCombatTraining,augmentationCashReserve:()=>0,claimSpending:()=>claim,achievementActionAllowed:(_ns,a)=>a!=='cashSpending'||cashAllowed,bladeburnerRecruitmentBudget};
 const run=vm.runInNewContext('('+runPlayerCombatTraining.toString()+')',ctx);
 return {clock:()=>time,ns,input,p,files,set,run:()=>run(ns,input),read:f=>JSON.parse(files.get(f)),receipt:()=>JSON.parse(files.get('tasks/bladeburner-external-training-7.json')),stops:()=>stops,bbStops:()=>bbStops,work:()=>work,bb:()=>bb,exit:()=>exit()};
}
test('native quotes account for completion versus cycle units and optional Formulas access',()=>{
 const f=fixture(),q=quotePlayerCombatTraining(f.ns,{player:f.p,metadata,inferLevels:true});assert.equal(q.length,7);assert.equal(q.find(q=>q.kind==='crime').rates.strength,40/3);assert.equal(q.find(q=>q.kind==='gym').rates.strength,100);assert.equal(q.find(q=>q.kind==='gym').costPerSecond,5);
 f.ns.fileExists=()=>false;assert.deepEqual(quotePlayerCombatTraining(f.ns,{player:f.p,metadata}),[]);
 f.ns.fileExists=()=>true;f.ns.formulas.work.gymGains=()=>{throw Error('locked');};assert.equal(quotePlayerCombatTraining(f.ns,{player:f.p,metadata,inferLevels:true}).length,3);
});
test('choice requires margin, reserves, whole crimes, quota and sufficient rank runway',()=>{
 const q={kind:'crime',name:'Mug',score:2,time:4000,costPerSecond:0},o={baselineScore:1,remainingMs:30000,quotaLeft:50,money:1e6,reserve:0,rankGap:1000,rankRate:1};
 assert.equal(choosePlayerCombatTraining([q],o).durationMs,28000);assert.equal(choosePlayerCombatTraining([q],{...o,simulacrum:true}).foregoneRank,0);
 for(const patch of [{remainingMs:500},{quotaLeft:0},{baselineScore:2},{rankRate:null},{rankGap:1},{reserve:Infinity}])assert.equal(choosePlayerCombatTraining([q],{...o,...patch}),null);
 assert.equal(choosePlayerCombatTraining([{...q,kind:'gym',costPerSecond:1000}],{...o,reserve:990000}),null);
});
test('bounded worker cleans up, accounts shared time/quota once and preserves installed Simulacrum work',async()=>{
 for(const simulacrum of [false,true]){const f=fixture({simulacrum});await f.run();const result=f.receipt();assert.equal(result.started,true);assert.equal(result.elapsedMs,30000);assert.equal(f.stops(),1);assert.equal(f.bbStops(),simulacrum?0:1);assert.equal(f.work(),null);assert.equal(f.read('tasks/bladeburner-development.json').externalTrainingTotal,1);assert.equal(f.read('tasks/bladeburner-development.json').budget.spentMs,30000);assert.equal(f.files.has('tasks/activity-lock.json'),false);f.exit();assert.equal(f.stops(),1);}
});
test('worker never interrupts player work, Black Ops, paused controllers or another lease',async()=>{
 for(const mode of ['busy','blackop','lease','pause','reset','stale']){const f=fixture();if(mode==='busy')f.ns.singularity.getCurrentWork=()=>({type:'GRAFTING'});if(mode==='blackop')f.ns.bladeburner.getCurrentAction=()=>({type:'Black Operations',name:'Typhoon'});if(mode==='lease')f.set('tasks/activity-lock.json',{ownerPid:99,expiresAt:120000});if(mode==='pause')f.files.set('remote-control/paused/bladeburner.js.txt','true');if(mode==='reset')f.input.augReset=3;if(mode==='stale')f.input.at=0;await f.run();assert.equal(f.receipt().started,false);assert.equal(f.stops(),0);assert.equal(f.bbStops(),0);}
});
test('watchdog handles owner loss, replacement work, cash reserve and protected Black Ops',async()=>{
 for(const mode of ['parent','replace','cash','blackop','achievement']){const f=fixture({simulacrum:true,change:c=>{if(mode==='parent')c.killParent();if(mode==='replace')c.replace({type:'GRAFTING'});if(mode==='cash')c.p.money=0;if(mode==='blackop')c.blackOp();if(mode==='achievement')c.denyCash();}});await f.run();assert.equal(f.receipt().reason,'guard-changed');assert.ok(f.receipt().elapsedMs<=200);assert.equal(f.stops(),mode==='replace'?0:1);if(mode==='replace')assert.equal(f.work().type,'GRAFTING');if(mode==='blackop')assert.equal(f.bb().type,'Black Operations');}
});
test('failed paid budget falls back to free crime and optional API errors defer cleanly',async()=>{
 const f=fixture({claim:false});await f.run();assert.equal(f.receipt().choice.kind,'crime');assert.equal(f.receipt().started,true);
 const unavailable=fixture();unavailable.ns.singularity.getCurrentWork=()=>{throw Error('Source File unavailable');};await unavailable.run();assert.equal(unavailable.receipt().started,false);
});
test('dispatcher leaves home headroom, owns one lease and rejects stale receipts',async()=>{
 let claims=0,releases=0,starts=0;const ctx={homeRamReserve:()=>128,claimActivity:async()=>{claims++;return true;},releaseActivity:()=>{releases++;},automationHeartbeat(){}};
 const dispatch=vm.runInNewContext('('+dispatchPlayerCombatTraining.toString()+')',ctx);const ns={pid:7,getScriptRam:()=>20,getServerMaxRam:()=>1024,getServerUsedRam:()=>1000,ps:()=>[],run:()=>{starts++;return 11;},isRunning:()=>false,read:()=>JSON.stringify({workerPid:11,parent:7,requestAt:1,started:true})};
 assert.equal((await dispatch(ns,{at:1})).reason,'worker-ram');assert.equal(claims,0);ns.getServerUsedRam=()=>0;assert.equal((await dispatch(ns,{at:1})).started,true);assert.equal(starts,1);assert.equal(releases,1);assert.equal((await dispatch(ns,{at:2})).reason,'missing-worker-receipt');
});
test('worker is compile-only diagnostic and production waits for a confirmed action boundary',()=>{
 const row=moduleManifest.find(m=>m.script==='Tasks/bladeburner-training.js');assert.equal(row.diagnostic,true);assert.equal(row.remoteControl,false);assert.equal(row.supervised,false);
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');assert.match(s,/trainingBoundary=true/);assert.match(s,/if\(trainingBoundary&&await tryExternalTraining\(\)\)return/);assert.match(s,/disable-external-training/);
});

test('active Bladeburner bonus time raises the retained native Training comparison',async()=>{
 const ordinary=fixture();await ordinary.run();const boosted=fixture();boosted.ns.bladeburner.getBonusTime=()=>120000;await boosted.run();assert.equal(boosted.receipt().choice.baselineGain,ordinary.receipt().choice.baselineGain*4);
});

test('executed controller dispatch requires Training selection, boundary, access and remaining budget',async()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=s.indexOf('    let trainingBoundary='),end=s.indexOf('    if (currentAction?.name) {',start);
 for(const mode of ['allowed','boundary','disabled','health','source','quota','budget','mission']){
  let calls=0;const c={currentAction:mode==='boundary'?{name:'Training'}:null,bestActionName:mode==='mission'?'Tracking':'Training',options:{'disable-external-training':mode==='disabled'},ownedSourceFiles:mode==='source'?{}:{4:3},nextBlackOp:'Typhoon',lowHealthTriggered:mode==='health',lowStaminaTriggered:false,trainingMilestone:{used:mode==='quota'?50:0,limit:50},developmentBudget:{spentMs:mode==='budget'?120000:0},resetInfo:{lastNodeReset:1,lastAugReset:2},rankGap:1000,measuredRankRate:1,lastAssignedTask:'Training',currentTaskEndTime:1,actionProgress:{},ns:{pid:7,print(){}},dispatchPlayerCombatTraining:async(_ns,input)=>{calls++;assert.equal(input.boundary,true);return {started:true,choice:{kind:'crime',name:'Mug'},reason:'completed'};}};
  vm.runInNewContext(s.slice(start,end)+';globalThis.run=tryExternalTraining;',c);assert.equal(await c.run(),mode==='allowed');assert.equal(calls,mode==='allowed'?1:0);
 }
});

test('rejected native work reports an owned Bladeburner stop for a fresh controller selection',async()=>{
 const f=fixture();f.ns.singularity.gymWorkout=()=>false;await f.run();assert.equal(f.receipt().started,false);assert.equal(f.receipt().bbStopped,true);assert.equal(f.receipt().reason,'start-rejected');assert.equal(f.read('tasks/bladeburner-development.json').externalTrainingTotal,0);
});


test('worker receipts calibrate only complete background-certified sessions',async()=>{
 for(const mode of ['known','unknown','parallel','interrupted','profile','observer-lost']){
  let count=0;const f=fixture({simulacrum:mode==='parallel',change:c=>{
   c.p.exp.strength+=20;
   if(mode==='interrupted')c.killParent();
   if(mode==='profile')c.p.mults.strength_exp=2;
   if(mode==='observer-lost'&&++count===10)c.ns.sleeve.getNumSleeves=()=>{throw Error('lost');};
  }});
  if(mode!=='unknown')f.ns.sleeve={getNumSleeves:()=>0};
  await f.run();const result=f.receipt();
  assert.equal(result.calibration?.accepted,['known','parallel'].includes(mode),mode);
  if(mode==='parallel'){
   const sample=f.read('tasks/player-training-calibration.json').samples[0];
   assert.equal(sample.net.strength,2820); // 3,000 total minus the 5x bound and one native completion.
  }
  if(mode==='known'){assert.equal(f.read('tasks/player-training-calibration.json').samples.length,1);f.exit();assert.equal(f.read('tasks/player-training-calibration.json').samples.length,1);}
 }
});


test('worker records stamina valuation and only preserves native gains when Training is actually active',async()=>{
 for(const mode of ['parallel','idle','unavailable','changed']){
  const f=fixture({simulacrum:true});
  if(mode==='idle')f.ns.bladeburner.getCurrentAction=()=>null;
  if(mode==='unavailable')f.ns.bladeburner.getStamina=()=>{throw Error('unavailable');};
  if(mode==='changed'){let calls=0;f.ns.bladeburner.getCurrentAction=()=>++calls<=2?{type:'General',name:'Training'}:null;}
  await f.run();const result=f.receipt();
  assert.equal(result.started,['parallel','idle'].includes(mode),mode);
  if(result.started){assert.equal(result.choice.stamina.parallel,mode==='parallel');assert.equal(result.choice.stamina.basis,'full-recovery');}
  if(mode==='changed')assert.equal(result.reason,'native-parallel-state-changed');
  if(mode==='unavailable')assert.match(result.reason,/deferred/);
 }
});

test('installed Simulacrum permits conditioning during a mission without stopping native work',async()=>{
 const f=fixture({simulacrum:true,parallel:true});await f.run();assert.equal(f.receipt().started,true);assert.equal(f.receipt().choice.parallelMission,true);assert.equal(f.bbStops(),0);assert.equal(f.bb().name,'Tracking');assert.equal(f.receipt().calibration.accepted,false);
 const locked=fixture({parallel:true});await locked.run();assert.equal(locked.receipt().started,false);assert.equal(locked.bbStops(),0);
});
test('parallel conditioning exits on a protected Black Op without stopping it',async()=>{
 const f=fixture({parallel:true,simulacrum:true,change:c=>c.blackOp()});await f.run();assert.equal(f.receipt().reason,'guard-changed');assert.equal(f.bbStops(),0);assert.equal(f.bb().type,'Black Operations');assert.equal(f.stops(),1);
});

test('parallel conditioning stops at mission completion and leaves the mission running',async()=>{
 const f=fixture({parallel:true,simulacrum:true});let progress=0;f.ns.bladeburner.getActionCurrentTime=()=>{progress++;return progress<5?progress*200:0;};
 await f.run();assert.equal(f.receipt().reason,'mission-boundary');assert.ok(f.receipt().elapsedMs<30000);assert.equal(f.bb().name,'Tracking');assert.equal(f.bbStops(),0);assert.equal(f.stops(),1);
});
test('parallel conditioning rejects stale preparation and aborts if installed Simulacrum is lost',async()=>{
 const stale=fixture({parallel:true,simulacrum:true});const d=stale.read('tasks/bladeburner-development.json');d.chanceBlocked=false;stale.set('tasks/bladeburner-development.json',d);await stale.run();assert.equal(stale.receipt().started,false);
 const lost=fixture({parallel:true,simulacrum:true,change:c=>c.ns.singularity.getOwnedAugmentations=()=>[]});await lost.run();assert.equal(lost.receipt().reason,'guard-changed');assert.equal(lost.bbStops(),0);
});
test('executed parent permits parallel missions without clearing their progress',async()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=s.indexOf('    let trainingBoundary='),end=s.indexOf('    if (currentAction?.name) {',start);
 let calls=0;const c={haveSimulacrum:true,currentAction:{name:'Tracking',type:'Contracts'},bestActionName:'Tracking',chanceBlocked:true,statReadiness:{},farmSurplus:false,ownsSurplus:false,options:{},ownedSourceFiles:{4:3},nextBlackOp:'Typhoon',lowHealthTriggered:false,lowStaminaTriggered:false,trainingMilestone:{used:0,limit:50},developmentBudget:{spentMs:0},resetInfo:{lastNodeReset:1,lastAugReset:2},rankGap:0,measuredRankRate:1,lastAssignedTask:'Tracking',currentTaskEndTime:12345,actionProgress:{progress:1000},ns:{pid:7,print(){}},dispatchPlayerCombatTraining:async(_ns,input)=>{calls++;assert.equal(input.parallelMission,true);assert.equal(input.mission.name,'Tracking');return {started:true,choice:{kind:'gym',name:'agility'},reason:'mission-boundary'};}};
 vm.runInNewContext(s.slice(start,end)+';globalThis.run=tryExternalTraining;',c);assert.equal(await c.run(true),true);assert.equal(calls,1);assert.equal(c.lastAssignedTask,'Tracking');assert.equal(c.currentTaskEndTime,12345);assert.equal(c.actionProgress.progress,1000);
 c.haveSimulacrum=false;assert.equal(await c.run(true),false);assert.equal(calls,1);
});

test('parallel worker measures external gym XP without crediting BB mission completion XP',async()=>{
 let paid=false;const f=fixture({parallel:true,simulacrum:true,change:c=>{c.p.exp.strength+=20;if(!paid&&f.clock()>=127000){paid=true;c.p.exp.strength+=5000;}}});
 f.ns.sleeve={getNumSleeves:()=>0};f.ns.bladeburner.getActionCurrentTime=()=>(f.clock()-100000)%27000;f.ns.bladeburner.getActionSuccesses=()=>paid?1:0;f.ns.bladeburner.getActionTime=(type)=>type==='General'?30000:27000;
 await f.run();const r=f.receipt();assert.equal(r.reason,'mission-boundary');assert.equal(r.calibration.accepted,true);const s=f.read('tasks/player-training-calibration.json').samples[0];assert.equal(s.evidence,'completion-free-fragments');assert.ok(s.seconds>=15);assert.ok(Math.abs(s.net.strength-s.seconds*100)<1e-6);assert.ok(s.net.strength<3000);assert.ok(r.after.strength-r.before.strength>5000);
});
