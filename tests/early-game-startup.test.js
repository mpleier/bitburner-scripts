import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {chooseCasinoSeedCrime,earnCasinoSeedSource,seedSleevesSource,essentialHomeRamSource} from '../casino-bootstrap-policy.js';
import {sleeveCrimeChance,sleeveStartupPlan} from '../sleeve-policy.js';
import {claimSpending} from '../spending-policy.js';
import {achievementActionAllowed} from '../achievement-policy.js';

const make=(name,money,time,chance=1)=>({name,money,time,chance});
test('seed crimes minimize whole-payout ETA and include profitable longer crimes',()=>{
 const choices=[make('Small',100,2000),make('Large',1000,10000),make('Bad',1e9,1,0)];
 assert.equal(chooseCasinoSeedCrime(choices,50),'Small');
 assert.equal(chooseCasinoSeedCrime(choices,1000),'Large');
 assert.equal(chooseCasinoSeedCrime([make('Failing',1e9,10000,.001),make('Reliable',1000,1000)],1000),'Reliable');
 assert.equal(chooseCasinoSeedCrime([make('Invalid',NaN,1)],1000),null);
});
function crimeApi({work=null,money=0}={}){
 let current=work,cash=money;const commits=[],files={};
 const ns={args:[],isRunning:()=>true,read:f=>files[f]||'',getPlayer:()=>({money:cash}),singularity:{
  getCurrentWork:()=>current,getCrimeStats:name=>({time:2000,money:name==='Mug'?100000:1000}),getCrimeChance:()=>1,
  commitCrime:name=>{commits.push(name);return 2000;}}};
 return {ns,commits,files,setWork:v=>current=v,setMoney:v=>cash=v};
}
const earn=vm.runInNewContext('('+earnCasinoSeedSource+')');
test('seed worker chooses a profitable crime and leaves an already optimal cycle intact',async()=>{
 const a=crimeApi();assert.equal((await earn(a.ns,1,300000,chooseCasinoSeedCrime)).crime,'Mug');assert.deepEqual(a.commits,['Mug']);
 const b=crimeApi({work:{type:'CRIME',crimeType:'Mug'}});await earn(b.ns,1,300000,chooseCasinoSeedCrime);assert.deepEqual(b.commits,[]);
});
test('crime switching waits for the native completion promise without restarting mid-cycle',async()=>{
 let finish;const boundary=new Promise(resolve=>finish=resolve);
 const a=crimeApi({work:{type:'CRIME',crimeType:'Shoplift',nextCompletion:boundary}});
 const pending=earn(a.ns,1,300000,chooseCasinoSeedCrime);assert.deepEqual(a.commits,[]);
 finish();await pending;assert.deepEqual(a.commits,['Mug']);
});
test('crime boundary rechecks seed funding, changed activity and owner control',async()=>{
 for(const change of ['money','work','pause','owner','maintenance']){
  let finish;const a=crimeApi({work:{type:'CRIME',crimeType:'Shoplift',nextCompletion:new Promise(resolve=>finish=resolve)}});
  const pending=earn(a.ns,1,300000,chooseCasinoSeedCrime);
  if(change==='money')a.setMoney(300000);
  if(change==='work')a.setWork({type:'GRAFTING'});
  if(change==='pause')a.files['remote-control/paused/casino.js.txt']='true';
  if(change==='owner')a.ns.isRunning=()=>false;
  if(change==='maintenance')a.files['tasks/automation-maintenance.json']=JSON.stringify({ownerPid:2,expiresAt:Date.now()+10000});
  finish();await pending;assert.deepEqual(a.commits,[],change);
 }
});
test('protected work and unsupported completion promises are preserved',async()=>{
 for(const work of [{type:'GRAFTING'},{type:'CREATE_PROGRAM'},{type:'CRIME',crimeType:'Shoplift'}]){
  const a=crimeApi({work});await earn(a.ns,1,300000,chooseCasinoSeedCrime);assert.deepEqual(a.commits,[]);
 }
});
function sleeveApi(){
 const files={},assignments=[],tasks=[null,null],sleeves=[0,1].map(()=>({shock:90,sync:100,skills:{strength:100,defense:100,dexterity:100,agility:100}}));
 const ns={pid:9,isRunning:()=>true,read:f=>files[f]||'',ps:()=>[],getPlayer:()=>({money:0}),getResetInfo:()=>({lastNodeReset:10}),sleeve:{
  getNumSleeves:()=>sleeves.length,getSleeve:i=>sleeves[i],getTask:i=>tasks[i],setToCommitCrime:(i,name)=>{assignments.push([i,name]);tasks[i]={type:'CRIME',crimeType:name};return true;}}};
 return {ns,files,assignments,tasks};
}
const seedSleeves=vm.runInNewContext('('+seedSleevesSource+')');
test('one-shot sleeve money assignments persist and do not require Singularity',()=>{
 const a=sleeveApi();seedSleeves(a.ns,1,300000,sleeveCrimeChance,achievementActionAllowed);
 assert.equal(a.assignments.length,2);seedSleeves(a.ns,1,300000,sleeveCrimeChance,achievementActionAllowed);assert.equal(a.assignments.length,2);
});
test('one-shot sleeve bootstrap honors managers, pauses, explicit configuration and challenge restrictions',()=>{
 for(const mode of ['manager','pause','explicit','challenge','lock','bad-config']){
  const a=sleeveApi();
  if(mode==='manager')a.ns.ps=()=>[{filename:'sleeve.js'}];
  if(mode==='pause')a.files['remote-control/paused/sleeve.js.txt']='true';
  if(mode==='explicit')a.files['sleeve.js.config.txt']='{"crime":"Mug"}';
  if(mode==='bad-config')a.files['sleeve.js.config.txt']='bad';
  if(mode==='challenge')a.files['tasks/achievement-profile.json']=JSON.stringify({active:true,nodeReset:10,deniedActions:['sleeve']});
  if(mode==='lock')a.files['tasks/activity-lock.json']=JSON.stringify({ownerPid:2,expiresAt:Date.now()+10000});
  seedSleeves(a.ns,1,300000,sleeveCrimeChance,achievementActionAllowed);assert.deepEqual(a.assignments,[],mode);
 }
});
test('one-shot sleeve bootstrap preserves a different crime already in progress',()=>{
 const a=sleeveApi();a.tasks[0]={type:'CRIME',crimeType:'Shoplift',cyclesWorked:5};
 seedSleeves(a.ns,1,300000,sleeveCrimeChance,achievementActionAllowed);assert.ok(a.assignments.every(([i])=>i!==0));
});

const ramWorker=vm.runInNewContext('('+essentialHomeRamSource+')');
function ramApi(){
 let money=1000,ram=32;const files={},purchases=[];
 const ns={getPlayer:()=>({money}),getResetInfo:()=>({lastNodeReset:10,lastAugReset:20}),getServerMaxRam:()=>ram,isRunning:()=>true,
  read:f=>files[f]||'',write:(f,s)=>files[f]=s,ps:()=>[{pid:1}],singularity:{getUpgradeHomeRamCost:()=>100,upgradeHomeRam:()=>{money-=100;ram*=2;purchases.push(ram);return true;}}};
 return {ns,files,purchases};
}
test('essential RAM worker immediately reaches 128 GB and stops at its target',()=>{
 const a=ramApi();ramWorker(a.ns,1,128,claimSpending,achievementActionAllowed);assert.deepEqual(a.purchases,[64,128]);
});
test('essential RAM upgrades respect wallet reserves, shared allowance and purchase failure',()=>{
 for(const mode of ['reserve','budget','pause','challenge','failure','owner']){
  const a=ramApi();
  if(mode==='reserve')a.files['reserve.txt']='950';
  if(mode==='budget')a.files['tasks/spending-plan.json']=JSON.stringify({ownerPid:1,reset:20,epoch:1,expiresAt:Date.now()+10000,allowances:{home:50}});
  if(mode==='pause')a.files['remote-control/paused/Tasks/ram-manager.js.txt']='true';
  if(mode==='challenge')a.files['tasks/achievement-profile.json']=JSON.stringify({active:true,nodeReset:10,deniedActions:['homeRam']});
  if(mode==='failure')a.ns.singularity.upgradeHomeRam=()=>false;
  if(mode==='owner')a.ns.isRunning=()=>false;
  ramWorker(a.ns,1,128,claimSpending,achievementActionAllowed);assert.deepEqual(a.purchases,[],mode);
 }
});

const crimes={Homicide:{time:3000,karma:3,money:45000,difficulty:1,strength_success_weight:2,defense_success_weight:2,dexterity_success_weight:.5,agility_success_weight:.5}};
const sleeve=(extra={})=>({shock:90,sync:100,skills:{strength:1000,defense:1000,dexterity:1000,agility:1000},...extra});
const opening=extra=>sleeveStartupPlan({sleeves:Array.from({length:8},()=>sleeve()),crimes,money:300000,casinoPending:false,gangAvailable:true,karma:-100,...extra});
test('gang ETA optimizer can use all productive sleeves instead of the fixed half split',()=>{
 const p=opening();assert.equal(p.workers.length,8);assert.ok(p.etaSeconds>0);assert.equal(Object.values(p.assignments).filter(v=>v==='karma').length,8);
});
test('gang ETA optimizer can leave an inefficient shocked sleeve recovering',()=>{
 const p=opening({sleeves:[sleeve(),sleeve({skills:{strength:1,defense:1,dexterity:1,agility:1}})]});
 assert.deepEqual(p.workers,[0]);assert.equal(p.assignments[1],'recovery');
});
test('near-target karma avoids pointless synchronization and respects explicit opt-out',()=>{
 const p=opening({sleeves:[sleeve({sync:99})],karma:-53999});assert.equal(p.assignments[0],'karma');
 assert.equal(opening({enabled:false}).stage,'normal');assert.deepEqual(opening({enabled:false}).assignments,{});
});
test('zero synchronization retains a path to karma and empty sleeves never produce invalid ETA',()=>{
 const p=opening({sleeves:[sleeve({sync:0}),sleeve({sync:0})]});assert.equal(Object.values(p.assignments).filter(v=>v==='sync').length,1);
 assert.equal(opening({sleeves:[]}).etaSeconds,null);
});
test('healthy sleeves remain in stable worker plans and modeled ETA accounts for them',()=>{
 const p=opening({sleeves:[sleeve({shock:0}),sleeve()],previousWorkers:[1]});assert.ok(p.workers.includes(0));
 assert.ok(Number.isFinite(p.etaSeconds));
});

async function bootstrapHarness({sf={},cash=0,ram=32,throwRun=false,sleeveFailure=false}={}){
 const source=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');const files={},launches=[],casinos=[];
 const ns={pid:1,getServerMaxRam:()=>ram,read:f=>files[f]||'',write:async(f,s)=>{files[f]=s;},isRunning:()=>false};
 const context={ns,casinoSeedMoney:300000,earnCasinoSeedSource,chooseCasinoSeedCrime,seedSleevesSource,sleeveCrimeChance,achievementActionAllowed,
  homeRam:ram,casinoSeedPending:false,ranCasino:false,options:{},unlockedSFs:sf,resetInfo:{lastAugReset:20,lastNodeReset:10},
  casinoSeedWorkerPid:0,lastSeedSleeves:0,ramReserveFile:'ram.json',isScriptPaused:()=>false,
  getPlayerMoneySources:async()=>({sinceInstall:{casino:0}}),setStatus(){},
  getNsDataThroughFile:async(ns,command,path,args)=>{assert.ok(args.every(a=>['number','string','boolean'].includes(typeof a)));if(sleeveFailure)throw Error('RAM');return {};},
  runCommand:async(ns,command,path,args)=>{if(throwRun)throw Error('RAM');launches.push({command,args});return 2;},
  maybeDoCasino:async(ns,p,immediate)=>casinos.push(immediate)};
 const begin=source.indexOf('    async function bootstrapCasino('),end=source.indexOf('    async function ensureEssentialHomeRam(',begin);
 vm.runInNewContext(source.slice(begin,end)+';globalThis.bootstrap=bootstrapCasino;',context);
 const blocked=await context.bootstrap(ns,{money:cash});return {context,blocked,files,launches,casinos};
}
test('actual bootstrap yields to hacking without SF4 and reserves the seed',async()=>{
 const r=await bootstrapHarness();assert.equal(r.blocked,false);assert.equal(r.context.casinoSeedPending,true);assert.equal(r.files['reserve.txt'],'300000');
 assert.equal(JSON.parse(r.files['tasks/casino-bootstrap.json']).state,'fallback');
});
test('actual bootstrap starts a funded casino immediately above 32 GB',async()=>{
 for(const ram of [32,64,1024]){const r=await bootstrapHarness({cash:300000,ram});assert.deepEqual(r.casinos,[true]);}
});
test('worker RAM failures yield to ordinary progression and do not prevent the player worker',async()=>{
 assert.equal((await bootstrapHarness({sf:{4:1},throwRun:true})).blocked,false);
 const r=await bootstrapHarness({sf:{4:3,10:2},sleeveFailure:true});assert.equal(r.launches.length,1);
 assert.ok(r.launches[0].args.every(a=>['number','string','boolean'].includes(typeof a)));
});
test('startup integration preserves seed cash, enables money hacking and exempts essential RAM from hacking-income gates',async()=>{
 const source=await readFile(new URL('../autopilot.js',import.meta.url),'utf8'),daemon=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
 assert.match(source,/if\(casinoSeedPending\)return ns.write\('reserve.txt'/);
 assert.match(source,/if\(casinoSeedPending&&bitNodeMults.ScriptHackMoney\*bitNodeMults.ScriptHackMoneyGain>0\)daemonArgs=daemonArgs.filter/);
 assert.match(source,/if \(!bootstrap && playerWealth > 1e9 && resetInfo.currentNode != 8\)/);
 assert.match(daemon,/homeServer.totalRam\(true\)<128 \|\| shouldImproveHacking\(\)/);
 assert.match(source,/await ensureEssentialHomeRam\(ns,player\)/);
});

test('successful seed crime startup also yields to parallel hacking',async()=>{
 const r=await bootstrapHarness({sf:{4:3}});assert.equal(r.blocked,false);assert.equal(r.launches.length,1);
 assert.equal(r.context.casinoSeedPending,true);
});
