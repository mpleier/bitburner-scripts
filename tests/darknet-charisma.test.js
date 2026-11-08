import test from 'node:test';
import assert from 'node:assert/strict';
import {charismaGate,passiveCharismaRate,planCharismaStudy,planCharismaInterrupt,coordinateCharismaGoal,charismaGoalFile,charismaLedgerFile,charismaTrainingFile,nextLabCharismaTarget} from '../darknet-charisma-policy.js';
import {main as scout} from '../darknet-node.js';
import {main as train} from '../darknet-charisma.js';
import {solveLabyrinth} from '../darknet-advanced.js';
import {solverProgressFingerprint} from '../darknet-throughput-policy.js';
test('Charisma gates apply to feedback solving and disappear at the exact threshold',()=>{
 const info={modelId:'(The Labyrinth)',requiredCharismaSkill:1500};assert.equal(charismaGate(info,1426),true);assert.equal(charismaGate(info,1500),false);assert.equal(charismaGate({...info,requiredCharismaSkill:NaN},1),false);assert.equal(charismaGate({modelId:'NIL',requiredCharismaSkill:100},50,true),true);
});
test('passive XP estimates reject gaps, changed multipliers and XP resets',()=>{
 const p={signature:'same',at:10000,exp:100},c={signature:'same',at:40000,exp:400};assert.equal(passiveCharismaRate(p,c),10);
 for(const patch of [{signature:'changed'},{at:10001},{at:140001},{exp:99}])assert.equal(passiveCharismaRate(p,{...c,...patch}),null);
});
test('study plans honor passive gains, total budget, reserve and exact remaining time',()=>{
 const args={remainingXp:1000,passiveRate:10,quotes:[{rate:100,costPerSecond:100,travelCost:0,university:'local'},{rate:100,costPerSecond:100,travelCost:200000,university:'away'}],money:100000000,reserve:1000000};
 const good=planCharismaStudy(args);assert.equal(good.state,'study');assert.equal(good.university,'local');assert.ok(good.seconds<=30);assert.ok(good.etaSeconds<good.passiveEtaSeconds);
 assert.equal(planCharismaStudy({...args,passiveRate:2000}).state,'passive');assert.equal(planCharismaStudy({...args,secondsUsed:600}).state,'bounded');assert.equal(planCharismaStudy({...args,cashUsed:5000000}).state,'bounded');assert.equal(planCharismaStudy({...args,money:1000000}).state,'passive');assert.equal(planCharismaStudy({...args,remainingXp:100000000}).state,'passive');assert.equal(planCharismaStudy({...args,passiveRate:null}).state,'waiting');
});
test('small-gap interrupts stay inside their own seconds and cash budget',()=>{
 const args={remainingXp:1000,passiveRate:0,quotes:[{rate:100,costPerSecond:10,travelCost:0,university:'local'}],money:1e9,reserve:0};
 const p=planCharismaInterrupt(args);assert.equal(p.state,'study');assert.equal(p.seconds,10);assert.ok(p.cost<=1e6);
 assert.equal(planCharismaInterrupt({...args,passiveRate:100}).state,'passive');
 assert.equal(planCharismaInterrupt({...args,secondsUsed:45}).state,'bounded');
 assert.equal(planCharismaInterrupt({...args,cashUsed:1e6}).state,'bounded');
 assert.equal(planCharismaInterrupt({...args,remainingXp:1e6}).state,'defer');
 assert.equal(planCharismaInterrupt({...args,money:0}).state,'defer');
});
test('goal selection requires fresh adjacency and native confirmation of the next labyrinth threshold',async()=>{
 const now=100000,files=new Map(),report={live:true,at:now,neighbours:['lab'],charismaBlocked:[{host:'lab',at:now,required:1500,modelId:'(The Labyrinth)'}]},ns={pid:1,getPlayer:()=>({skills:{charisma:1426}}),dnet:{getServerDetails:()=>({hasSession:false,modelId:'(The Labyrinth)',requiredCharismaSkill:1500})},write:async(f,v)=>files.set(f,v),fileExists:()=>false};
 const reset={lastNodeReset:1,lastAugReset:2};assert.equal((await coordinateCharismaGoal(ns,[report],reset,now)).target,1500);
 assert.equal((await coordinateCharismaGoal(ns,[{...report,neighbours:[]}],reset,now)).state,'none');ns.dnet.getServerDetails=()=>({modelId:'(The Labyrinth)',requiredCharismaSkill:2500});assert.equal((await coordinateCharismaGoal(ns,[report],reset,now)).state,'none');
});
test('standing charisma targets follow installed lab augments even with no adjacent labyrinth',async()=>{
 assert.equal(nextLabCharismaTarget([]).target,300);assert.equal(nextLabCharismaTarget(['The Broken Wings']).target,600);
 assert.equal(nextLabCharismaTarget(['The Broken Wings','The Boots']).target,1500);assert.equal(nextLabCharismaTarget(['The Broken Wings','The Boots','The Hammer','The Staff','The Law','The Sword']).target,4000);
 const redPill=['The Broken Wings','The Boots','The Hammer','The Staff','The Red Pill'];
 assert.equal(nextLabCharismaTarget(redPill,15).target,3500);assert.equal(nextLabCharismaTarget(redPill,11).target,3000);
 const now=100000,files=new Map(),ns={pid:1,getPlayer:()=>({skills:{charisma:1426}}),dnet:{getServerDetails:()=>({})},singularity:{getOwnedAugmentations:()=>['The Broken Wings','The Boots']},write:async(f,v)=>files.set(f,v),fileExists:()=>false};
 const goal=await coordinateCharismaGoal(ns,[],{lastNodeReset:1,lastAugReset:2},now);assert.equal(goal.state,'target');assert.equal(goal.target,1500);assert.equal(goal.host,null);
 ns.getPlayer=()=>({skills:{charisma:1600}});assert.equal((await coordinateCharismaGoal(ns,[],{lastNodeReset:1,lastAugReset:2},now)).state,'none');
});
test('a locked labyrinth publishes its threshold without requesting a cracking grant or attempting authentication',async()=>{
 const files=new Map([['tasks/dnet-cache-context.json',JSON.stringify({nodeReset:1,augReset:2})]]),stop=Error('stop'),messages=[];
 const ns={pid:7,getHostname:()=> 'origin',disableLog(){},read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),ls:(_h,p='')=>[...files.keys()].filter(f=>f.includes(p)),fileExists:f=>files.has(f),scp:async f=>{assert.notEqual(f,'tasks/dnet-maze-leases.json');return true;},isRunning:()=>true,ps:()=>[],hasRootAccess:h=>h!=='lab',getServerMaxRam:()=>16,getServerUsedRam:()=>16,getScriptRam:()=>0,getPlayer:()=>({skills:{charisma:1426}}),print:s=>messages.push(s),sleep:async()=>{throw stop;},dnet:{probe:()=>['lab'],getServerDetails:h=>h==='lab'?{modelId:'(The Labyrinth)',passwordLength:4,passwordFormat:'numeric',data:'',hasSession:false,requiredCharismaSkill:1500}:{depth:0,difficulty:0},getStasisLinkedServers:()=>[],getStasisLinkLimit:()=>0,getServerRequiredCharismaLevel:()=>1500,authenticate:()=>assert.fail('locked target must not authenticate')}};
 await assert.rejects(scout(ns),e=>e===stop);assert.equal(messages.some(s=>/TypeError|ReferenceError/.test(s)),false,messages.join('\n'));const survey=JSON.parse(files.get('tasks/dnet-survey-origin.json'));assert.equal(survey.mazeRequests.length,0);assert.equal(survey.charismaBlocked[0].required,1500);
});
test('repeated maze polls are not progress, but a newly observed position is',async()=>{
 const state={signature:'same'};let coords=[1,1];const report=async()=>({success:true,coords,east:true,west:true,north:false,south:false});
 await solveLabyrinth(async()=>({success:false}),state,report);const first=solverProgressFingerprint(state),reports=state.labReports;
 await solveLabyrinth(async()=>({success:false}),state,report);assert.equal(state.labReports,reports+1);assert.equal(solverProgressFingerprint(state),first);
 coords=[3,1];await solveLabyrinth(async()=>({success:false}),state,report);assert.notEqual(solverProgressFingerprint(state),first);
});
function trainerFixture(busy=false){
 const now=Date.now(),reset={lastNodeReset:1,lastAugReset:2},p={city:'Volhaven',money:100000000,skills:{charisma:1499},exp:{charisma:10000},mults:{charisma:1,charisma_exp:1}};
 const files=new Map([[charismaGoalFile,JSON.stringify({version:1,state:'target',ownerPid:1,nodeReset:1,augReset:2,at:now,expiresAt:now+90000,target:1500,host:'lab'})],[charismaLedgerFile,JSON.stringify({nodeReset:1,augReset:2,goals:{},sample:{at:now-30000,exp:9000,signature:'[1,1]'}})],['reserve.txt','1000000']]);let work=busy?{type:'FACTION',factionName:'Daedalus'}:null,studies=0,stops=0,exit;
 const ns={pid:2,args:[1],disableLog(){},getHostname:()=> 'home',getResetInfo:()=>reset,getPlayer:()=>p,atExit:f=>exit=f,read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),rm:f=>files.delete(f),isRunning:()=>true,ps:()=>[{pid:1,filename:'darknet-manager.js'}],sleep:async()=>{p.skills.charisma=1500;},getBitNodeMultipliers:()=>({CharismaLevelMultiplier:1}),formulas:{work:{universityGains:()=>({chaExp:1000,money:-10})},skills:{calculateExp:()=>11000}},singularity:{getCurrentWork:()=>work,getOwnedAugmentations:()=>[],travelToCity:()=>assert.fail('equivalent local study should avoid travel'),universityCourse:(location,classType)=>{studies++;work={type:'CLASS',location,classType};return true;},stopAction:()=>{stops++;work=null;}}};
 return {ns,files,p,studies:()=>studies,stops:()=>stops,exit:()=>exit()};
}
test('trainer takes over low-value faction work for one bounded Charisma burst',async()=>{
 const f=trainerFixture(true);await train(f.ns);assert.ok(f.studies()>=1);assert.ok(f.stops()>=1);
 const budget=JSON.parse(f.files.get(charismaLedgerFile)).goals['1500'];assert.equal(budget.interrupt.count,1);
});
test('trainer reserves budget before starting, stops at threshold, and releases its activity claim',async()=>{
 const f=trainerFixture();await train(f.ns);assert.equal(f.studies(),1);assert.equal(f.stops(),1);assert.equal(JSON.parse(f.files.get(charismaTrainingFile)).state,'complete');assert.equal(f.files.has('tasks/activity-lock.json'),false);const budget=JSON.parse(f.files.get(charismaLedgerFile)).goals['1500'];assert.ok(budget.seconds>0&&budget.seconds<=30);assert.ok(budget.cash>0&&budget.cash<=5000000);f.exit();assert.equal(f.stops(),1);
});
test('a small-gap crime is interrupted for one bounded study burst',async()=>{
 const f=trainerFixture();f.ns.formulas.skills.calculateExp=()=>30000;let work={type:'CRIME',crimeType:'Mug'};f.ns.singularity.getCurrentWork=()=>work;const stop=f.ns.singularity.stopAction;f.ns.singularity.stopAction=()=>{work=null;stop();};await train(f.ns);
 assert.equal(f.stops(),1);assert.equal(f.studies(),1);
 const budget=JSON.parse(f.files.get(charismaLedgerFile)).goals['1500'];assert.equal(budget.interrupt.count,1);assert.ok(budget.interrupt.seconds>0&&budget.interrupt.seconds<=45);assert.ok(budget.interrupt.cash>0&&budget.interrupt.cash<=1000000);
});
test('a small-gap crime waits when passive gain closes the gap within the interrupt horizon',async()=>{
 const f=trainerFixture();let work={type:'CRIME',crimeType:'Mug'};f.ns.singularity.getCurrentWork=()=>work;await train(f.ns);
 assert.equal(f.stops(),0);assert.equal(f.studies(),0);assert.equal(JSON.parse(f.files.get(charismaTrainingFile)).state,'passive');
});
test('augmentation preparation, another activity owner and exhausted budgets cannot start study',async()=>{
 for(const mode of ['reset','activity','budget','class','grafting']){
  const f=trainerFixture();
  if(mode==='reset')f.files.set('tasks/augmentation-reset-plan.json',JSON.stringify({pending:true,ownerPid:1,expiresAt:Date.now()+60000}));
  if(mode==='activity')f.files.set('tasks/activity-lock.json',JSON.stringify({ownerPid:99,expiresAt:Date.now()+60000}));
  if(mode==='budget'){const ledger=JSON.parse(f.files.get(charismaLedgerFile));ledger.goals['1500']={seconds:86400,cash:0};f.files.set(charismaLedgerFile,JSON.stringify(ledger));}
  if(['class','crime','grafting'].includes(mode))f.ns.singularity.getCurrentWork=()=>({type:mode.toUpperCase(),classType:'Leadership',location:'ZB Institute of Technology'});
  await train(f.ns);assert.equal(f.studies(),0,mode);assert.equal(f.stops(),0,mode);
 }
});
