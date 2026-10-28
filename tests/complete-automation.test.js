import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { infiltrationInput, chooseInfiltration, findInfiltrationState, selectRewardFaction, selectedRewardFaction, enterInfiltration, marketRecoveryDelay, recordInfiltrationOutcome, infiltrationEntryAllowed } from '../infiltration-solvers.js';
import { playInfiltration } from '../infiltration-manager.js';
import { activityBusy, claimActivity, releaseActivity, pendingRam, markActivitySupport, compatibleFocusWorkers } from '../activity-coordination.js';
import { needsHealing } from '../health-manager.js';
import { stockPromotionSignals, chooseStockPromotion } from '../darknet-stock-policy.js';
import { renderCommandJob } from '../remote-api-command.js';
import { solveFeedbackPassword, modelCandidates } from '../darknet-solvers.js';
import { packetCandidates } from '../darknet-advanced.js';
import { chooseMigrationTarget } from '../darknet-migration-policy.js';

const ownedInfiltrationFiles=()=>new Map([['tasks/activity-lock.json',JSON.stringify({kind:'infiltration',ownerPid:1,expiresAt:Date.now()+15000})]]);
const stage = data => ({ onKey() {}, ...data });
test('all eight infiltration puzzle models produce valid incremental inputs', () => {
  assert.equal(infiltrationInput(stage({ answer: 'CAPS LOCK', guess: 'CAPS' })).key, ' ');
  assert.equal(infiltrationInput(stage({ left: '<[{', right: '}' })).key, ']');
  assert.equal(infiltrationInput(stage({ choices: ['bad', 'kind'], correctIndex: 1, index: 0 })).key, 'ArrowRight');
  assert.equal(infiltrationInput(stage({ choices: ['bad', 'kind'], correctIndex: 1, index: 1 })).key, ' ');
  assert.equal(infiltrationInput(stage({ code: ['←', '↑'], index: 1 })).key, 'ArrowUp');
  assert.equal(infiltrationInput(stage({ grid: [['AA','BB','CC']], answers: ['CC'], currentAnswerIndex: 0, x: 0, y: 0 })).key, 'ArrowLeft');
  assert.equal(infiltrationInput(stage({ minefield: [[false,true]], answer: [[false,false]], memoryPhase: true, x: 0, y: 0 })).wait, true);
  assert.equal(infiltrationInput(stage({ minefield: [[false,true]], answer: [[false,false]], memoryPhase: false, x: 1, y: 0 })).key, ' ');
  assert.equal(infiltrationInput(stage({ phase: 0, guardingEndTime: 100 })).wait, true);
  assert.equal(infiltrationInput(stage({ phase: 1, guardingEndTime: 100 })).key, ' ');
  assert.equal(infiltrationInput(stage({ phase: 2, guardingEndTime: 100 })).unsupported, true);
  assert.equal(infiltrationInput(stage({ wiresToCut: new Set([2,3]), cutWires: [false,false,false,false] })).key, '3');
  assert.equal(infiltrationInput(stage({ count: 2 })).wait, true);
  assert.equal(infiltrationInput(stage({ mystery: true })).unsupported, true);
});
test('infiltration selection rejects difficult locations and ranks rewards per floor', () => {
  const info = (name,difficulty,reward,floors) => ({ location:{name,city:'Sector-12'},difficulty,reward:{sellCash:reward},maxClearanceLevel:floors });
  assert.equal(chooseInfiltration([info('danger',2,1e12,1),info('slow',1,100,30),info('easy',1,100,5)],'Sector-12').location.name,'easy');
  assert.equal(chooseInfiltration([info('danger',2,1e12,1)],'Sector-12'),null);
});
test('infiltration selection learns completion time, cooldowns, travel limits and reputation value', () => {
  const info = (name, cash, rep, city='Sector-12') => ({location:{name,city},difficulty:1,reward:{sellCash:cash,tradeRep:rep},maxClearanceLevel:10});
  const locations=[info('cash',1000,1),info('rep',100,100),info('travel',1e6,1e6,'Aevum')];
  assert.equal(chooseInfiltration(locations,'Sector-12',1.5,{canTravel:false}).location.name,'cash');
  assert.equal(chooseInfiltration(locations,'Sector-12',1.5,{canTravel:false,reputation:true}).location.name,'rep');
  assert.equal(chooseInfiltration(locations,'Sector-12',1.5,{canTravel:false,history:{cash:{retryAt:200}},now:100}).location.name,'rep');
  assert.equal(chooseInfiltration(locations.slice(0,2),'Sector-12',1.5,{interval:1000,history:{cash:{durationMs:1000000},rep:{durationMs:1000}}}).location.name,'rep');
});
test('market recovery waits follow global demand decay and handle clamped demand',()=>{
  assert.equal(marketRecoveryDelay(0.8),0);
  assert.equal(marketRecoveryDelay(0),60000);
  const delay=marketRecoveryDelay(0.2);
  const recovered=1-(1-0.2)*Math.exp(-0.00004*delay);
  assert.ok(recovered >= 2/3 && recovered < 0.667);
});
test('failed locations back off while successful runs reset streaks and learn duration',()=>{
  const first=recordInfiltrationOutcome({}, {status:'failed'},100);
  assert.equal(first.retryAt,30100);
  const second=recordInfiltrationOutcome(first,{status:'missed-window'},200);
  assert.equal(second.retryAt,60200);
  assert.deepEqual(recordInfiltrationOutcome(second,{status:'interrupted'},300),second);
  const success=recordInfiltrationOutcome(second,{status:'completed',durationMs:10000},400);
  assert.equal(success.retryAt,0);assert.equal(success.failureStreak,0);assert.equal(success.successes,1);
  assert.equal(recordInfiltrationOutcome(success,{status:'completed',durationMs:20000},500).durationMs,13000);
});
function fakeDocument(state, buttons = []) {
  const node = { '__reactFiber$test': { memoizedProps:{state},return:null } };
  return { body:{textContent:''},querySelectorAll:selector => selector === 'button' ? buttons : selector === '[role="combobox"]' ? [] : [node] };
}
test('the UI adapter locates only a valid infiltration model and routes faction selection', () => {
  const model={maxLevel:3,startInfiltration(){},cancel(){},stage:stage({})};
  assert.equal(findInfiltrationState(fakeDocument(model)),model);
  assert.equal(findInfiltrationState(fakeDocument({stage:stage({})})),null);
  let value;
  const document={querySelectorAll:()=>[{'__reactFiber$x':{memoizedProps:{value:'none',onChange:event=>value=event.target.value}}}]};
  assert.equal(selectRewardFaction(document,'CyberSec'),true); assert.equal(value,'CyberSec');
});
test('reward faction selection rejects factions absent from the offered menu',()=>{
  const props={value:'NiteSec',children:[{props:{value:'NiteSec'}}],onChange(){throw new Error('must not select absent faction');}};
  const document={querySelectorAll:()=>[{'__reactFiber$x':{memoizedProps:props}}]};
  assert.equal(selectRewardFaction(document,'CyberSec'),false);
  assert.equal(selectedRewardFaction(document,'CyberSec'),false);
  assert.equal(selectedRewardFaction(document,'NiteSec'),true);
});
test('victory falls back to cash when the requested faction cannot be verified',async()=>{
  let ended=false, selected='';
  const model={maxLevel:3,startInfiltration(){},cancel(){ended=true;},results:'',stage:stage({})};
  const sell={textContent:'Sell for $100',click(){selected='money';ended=true;}};
  const trade={textContent:'Trade for reputation',click(){selected='wrong-faction';ended=true;}};
  const document=fakeDocument(model,[sell,trade]);document.body.textContent='Infiltration successful!';
  const query=document.querySelectorAll;document.querySelectorAll=selector=>ended?[]:query(selector);
  const files=ownedInfiltrationFiles(),ns={pid:1,read:f=>files.get(f)||'',ps:()=>[],isRunning:()=>true,write:async(f,v)=>files.set(f,v),sleep:async()=>{}};
  const result=await playInfiltration(ns,document,model,'CyberSec');
  assert.equal(result.status,'completed');assert.equal(result.reward,'money');assert.equal(selected,'money');
});
test('low demand cancels entry and returns a recovery wait without starting puzzles',async()=>{
  let cancelled=false;
  const model={maxLevel:3,gameStartTimestamp:-1,startInfiltration(){},cancel(){cancelled=true;},results:'',stage:stage({})};
  const document=fakeDocument(model,[{textContent:'Start',click(){throw new Error('must wait for demand');}}]);
  document.body.textContent='Market demand: 20.00%';
  const files=ownedInfiltrationFiles(),ns={pid:1,read:f=>files.get(f)||'',ps:()=>[],isRunning:()=>true,write:async(f,v)=>files.set(f,v),sleep:async()=>{}};
  const result=await playInfiltration(ns,document,model);
  assert.equal(result.status,'market-cooldown');assert.equal(cancelled,true);assert.ok(result.retryAfter>20000);
});
test('infiltration entry calls only the enabled company-entry handler', () => {
  let entered=false;
  const button={textContent:'Infiltrate Company',disabled:false,'__reactProps$x':{onClick:event=>{if(event.isTrusted)entered=true;}}};
  assert.equal(enterInfiltration(button),true);assert.equal(entered,true);
  assert.equal(enterInfiltration({...button,disabled:true}),false);
  assert.equal(enterInfiltration({...button,textContent:'Apply for job'}),false);
  assert.equal(enterInfiltration({textContent:'Infiltrate Company'}),false);
});
test('the infiltration runner cancels an unknown model without dispatching keyboard events', async () => {
  let cancelled=false;
  const model={maxLevel:3,startInfiltration(){},cancel(){cancelled=true;},results:'',stage:stage({unknown:true})};
  const files=ownedInfiltrationFiles();
  const ns={pid:1,getServerMaxRam:()=>512,read:file=>files.get(file)||'',ps:()=>[],isRunning:()=>true,write:async(file,data)=>files.set(file,data),sleep:async()=>{}};
  const result=await playInfiltration(ns,fakeDocument(model),model);
  assert.equal(result.status,'unsupported-ui'); assert.equal(cancelled,true);
});
test('health recovery recognizes missing HP and ignores healthy saves', () => {
  assert.equal(needsHealing({hp:{current:2,max:19}}),true);
  assert.equal(needsHealing({hp:{current:18,max:19}}),false);
  assert.equal(needsHealing({}),false);
});
test('activity ownership expires and dead owners cannot block managers', async () => {
  const files=new Map(); let alive=true;
  const ns={pid:1,getServerMaxRam:()=>512,read:file=>files.get(file)||'',isRunning:()=>alive,write:async(file,data)=>files.set(file,data),rm:file=>files.delete(file)};
  assert.equal(await claimActivity(ns,'infiltration'),true);
  assert.equal(activityBusy(ns,2),true); assert.equal(activityBusy(ns,1),false);
  assert.equal(await claimActivity({...ns,pid:2},'other'),false);
  releaseActivity({...ns,pid:2}); assert.equal(activityBusy(ns,2),true);
  alive=false; assert.equal(activityBusy(ns,2),false);
  alive=true; releaseActivity(ns); assert.equal(activityBusy(ns,2),false);
  files.set('tasks/automation-ram-reserve.json',JSON.stringify({ownerPid:1,expiresAt:200,ram:731}));
  assert.equal(pendingRam(ns,100),859); assert.equal(pendingRam(ns,200),128); alive=false; assert.equal(pendingRam(ns,100),128);
});
test('infiltration waits for running focus workers to support activity ownership', async () => {
  const files=new Map(),processes=[{filename:'bladeburner.js',pid:5}];
  const ns={pid:5,getScriptName:()=> 'bladeburner.js',read:file=>files.get(file)||'',write:async(file,data)=>files.set(file,data)};
  assert.equal(compatibleFocusWorkers(ns,processes),false);
  await markActivitySupport(ns); assert.equal(compatibleFocusWorkers(ns,processes),true);
  assert.equal(compatibleFocusWorkers(ns,[{filename:'bladeburner.js',pid:6}]),false);
  assert.equal(compatibleFocusWorkers(ns,[]),true);
});
test('UI ownership preserves the paused faction worker RAM allowance during refreshes', async () => {
  const files=new Map();
  const ns={pid:1,getServerMaxRam:()=>512,read:file=>files.get(file)||'',isRunning:()=>true,write:async(file,data)=>files.set(file,data),rm:file=>files.delete(file)};
  await claimActivity(ns,'infiltration',60);
  assert.equal(pendingRam(ns),196);
  await claimActivity(ns,'infiltration'); assert.equal(pendingRam(ns),196);
  releaseActivity(ns); assert.equal(pendingRam(ns),128);
});
test('stock promotions require fresh owned exposure and a reliable favorable forecast', () => {
  const stocks=[{sym:'LONG',prob:.8,sharesLong:100,sharesShort:0,price:10},{sym:'SHORT',prob:.2,sharesLong:0,sharesShort:200,price:10}];
  const signal=stockPromotionSignals(stocks,true,100);
  assert.equal(chooseStockPromotion(signal,101),'SHORT');
  assert.equal(chooseStockPromotion(signal,20101),null);
  assert.equal(chooseStockPromotion(stockPromotionSignals(stocks,false,100),101),null);
  assert.equal(chooseStockPromotion(stockPromotionSignals([{...stocks[0],prob:.5}],true,100),101),null);
  assert.equal(chooseStockPromotion(stockPromotionSignals([{...stocks[0],sharesShort:100}],true,100),101),null);
});
test('air-gap migration uses populated frontier scouts and preserves stasis and story nodes', () => {
  const frontier={depth:7,expiresAt:200};
  const candidate={host:'bridge',depth:7,difficulty:7,scoutRunning:true,hasSession:true,isStationary:false,stasis:false};
  assert.equal(chooseMigrationTarget([candidate],frontier,100),'bridge');
  for(const change of [{stasis:true},{isStationary:true},{scoutRunning:false},{hasSession:false},{difficulty:3}])
    assert.equal(chooseMigrationTarget([{...candidate,...change}],frontier,100),null);
  assert.equal(chooseMigrationTarget([candidate],{depth:10,expiresAt:200},100),null);
  assert.equal(chooseMigrationTarget([candidate],frontier,200),null);
});
test('supervision, RAM reservations and UI guards are integrated into the managers', async () => {
  const files=['autopilot.js','daemon.js','work-for-factions.js','bladeburner.js','grafting-manager.js'];
  for (const file of files) assert.match(await readFile(new URL('../'+file,import.meta.url),'utf8'),/activityBusy\(ns/,file);
  const daemon=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
  assert.match(daemon,/pendingRam\(this.ns\)/); assert.match(daemon,/lastHelperCheck >= 30000/);
  const autopilot=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
  assert.match(autopilot,/ramReserveFile/); assert.match(autopilot,/health-manager\.js/); assert.match(autopilot,/infiltration-manager\.js/);
  const supervision=autopilot.indexOf('async function checkOnRunningScripts');
  const status=autopilot.indexOf('const managerStatus');
  const launch=autopilot.indexOf('managerStatus.find');
  assert.ok(status>supervision && launch>status,'managerStatus must be declared in the process supervisor scope');
});
test('the remote worker reports fixed automation status without arbitrary file access', async () => {
  const request={id:'automation-status',method:'automation.status',args:[],expiresAt:Date.now()+60000};
  const worker=await import('data:text/javascript;base64,'+Buffer.from(renderCommandJob(request)).toString('base64'));
  const writes=[];
  await worker.main({pid:1,args:['[]','result.json',request.id],write:async(_file,data)=>writes.push(JSON.parse(data)),read:file=>file==='tasks/automation-status.json'?'{}':''});
  assert.equal(writes.at(-1).state,'completed'); assert.deepEqual(writes.at(-1).result.automation,{});
});
function puzzle(modelId,password,feedback,data='',format='numeric') {
  const logs=[],guesses=[];
  return { details:{modelId,passwordLength:password.length,passwordFormat:format,data,hostname:'dark:test'}, guesses,
    attempt:async guess=>{ guesses.push(guess); if(guess===password)return {success:true,code:200};
      logs.unshift(JSON.stringify({code:401,passwordAttempted:guess,...feedback(guess)}));return {success:false,code:401}; },
    readLogs:async()=>({success:true,logs}) };
}
async function untilSolved(fixture, passes=20) {
  const state={}; let result;
  for(let pass=0;pass<passes;pass++) { result=await solveFeedbackPassword(fixture.details,fixture.attempt,fixture.readLogs,state,fixture.report); if(result.success)return result; if(!/budget/.test(result.reason))return result; }
  return result;
}
test('RMS feedback reconstructs long shuffled digit passwords with linear probes', async () => {
  for(const password of ['98765','101010101','908172635']) {
    const f=puzzle('PHP 5.4',password,guess=>({data:'012345678; RMS Deviation:'+Math.sqrt([...guess].reduce((sum,digit,i)=>sum+(Number(digit)-Number(password[i]))**2,0)/password.length).toFixed(3)}));
    const result=await untilSolved(f); assert.equal(result.password,password); assert.ok(f.guesses.length<=password.length+2);
  }
});
test('divisibility probes reconstruct repeated factors and large game primes', async () => {
  const password=String(8n*7n*1069n*9859n);
  const f=puzzle('Factori-Os',password,guess=>({data:String(Number(password)%Number(guess)===0)}));
  const result=await untilSolved(f); assert.equal(result.password,password); assert.ok(f.guesses.length<150);
});
test('hill searches find the exact integer peak and resume across passes', async () => {
  for(const password of ['250','59817','9200001']) {
    const width=10**Math.max(password.length-2,0)+1, center=Number(password);
    const f=puzzle('KingOfTheHill',password,guess=>{
      const x=Number(guess);let altitude=10000*Math.exp(-(((x-center)/width)**2));
      if(Math.abs((x-center)/center)>=.03) altitude+=7400*Math.exp(-(((x-center-width*3)/width)**2))+4700*Math.exp(-(((x-center+width*6)/width)**2));
      return {data:String(altitude)};
    });
    const result=await untilSolved(f); assert.equal(result.password,password,JSON.stringify(result));
  }
});
test('packet captures reveal explicit credentials and intersect unlabelled payloads', async () => {
  assert.ok(packetCandidates('noise dark:test:aB7z more',4,'dark:test').includes('aB7z'));
  let capture=0;
  const f=puzzle('OpenWebAccessPoint','aB7z',()=>({data:['AAAAaB7zBBBB','CCCCaB7zDDDD','EEEEaB7zFFFF'][capture++%3]}),'','alphanumeric');
  assert.equal((await untilSolved(f)).password,'aB7z');
});
test('all built-in dictionary models work without a supplied candidate file', () => {
  assert.ok(modelCandidates({modelId:'FreshInstall_1.0'}).includes('0000'));
  assert.ok(modelCandidates({modelId:'Laika4'}).includes('rover'));
  assert.ok(modelCandidates({modelId:'EuroZone Free'}).includes('Republic of Cyprus'));
  assert.ok(modelCandidates({modelId:'TopPass'}).includes('matrix'));
});
test('XOR decoding preserves semicolons inside encrypted data and rejects malformed masks', () => {
  assert.deepEqual(modelCandidates({modelId:'OrdoXenos',data:';A;01111010 00000000'}),['AA']);
  assert.deepEqual(modelCandidates({modelId:'OrdoXenos',data:'AA;garbage 0'}),[]);
});
test('labyrinth DFS backtracks and saves the returned session token', async () => {
  const paths=new Map([['1,1',['east','south']],['3,1',['west']],['1,3',['north','east']],['3,3',['west','east']],['5,3',['west']]]);
  const offsets={north:[0,-2],east:[2,0],south:[0,2],west:[-2,0]};let position=[1,1];const guesses=[];
  const f={details:{modelId:'(The Labyrinth)',passwordLength:12,passwordFormat:'alphanumeric'},guesses,
    report:async()=>({success:true,coords:position,...Object.fromEntries(Object.keys(offsets).map(d=>[d,paths.get(position.join(',')).includes(d)]))}),
    readLogs:async()=>assert.fail('maze feedback comes directly from authenticate'),
    attempt:async direction=>{guesses.push(direction);assert.ok(paths.get(position.join(',')).includes(direction));position=position.map((v,i)=>v+offsets[direction][i]);return position.join(',')==='5,3'?{success:true,code:200,data:'maze-token'}:{success:false,code:401,message:'Moved',data:''};}};
  assert.equal((await untilSolved(f)).password,'maze-token');assert.deepEqual(guesses,['east','west','south','east','east']);
});


test('divisibility solvers confirm a complete factor product without scanning unused primes', async () => {
  for (const password of ['1', '8', '120']) {
    const f=puzzle('Factori-Os',password,guess=>({data:String(Number(password)%Number(guess)===0)}));
    assert.equal((await untilSolved(f)).password,password);
    assert.ok(f.guesses.length<12);
  }
});

test('infiltration combat cleanup converts the void API result into a readable receipt', async () => {
  const source=await readFile(new URL('../infiltration-manager.js',import.meta.url),'utf8');
  assert.match(source,/stopBladeburnerAction\(\), "stopped"/);
  assert.match(source,/if \(combat === 'blackop-active'\)/);
});


test('serialized infiltration entry guard requires a live owner and unexpired UI lease',()=>{
 const files=new Map(),alive=new Set([1]);let processes=[];
 const ns={read:f=>files.get(f)||'',isRunning:pid=>alive.has(pid),ps:()=>processes};
 const allowed=Function('return ('+infiltrationEntryAllowed.toString()+')')();
 assert.equal(allowed(ns,1),false);
 files.set('tasks/activity-lock.json',JSON.stringify({ownerPid:1,expiresAt:Date.now()+10000}));assert.equal(allowed(ns,1),true);
 files.set('remote-control/paused/infiltration-manager.js.txt','true');assert.equal(allowed(ns,1),false);files.delete('remote-control/paused/infiltration-manager.js.txt');
 for(const file of ['tasks/automation-maintenance.json','tasks/progression-transition.json']){
  files.set(file,JSON.stringify({ownerPid:2,expiresAt:Date.now()+10000}));assert.equal(allowed(ns,1),true);
  alive.add(2);assert.equal(allowed(ns,1),false);alive.delete(2);files.delete(file);
 }
 processes=[{filename:'/casino.js'}];assert.equal(allowed(ns,1),false);processes=[{filename:'ascend.js'}];assert.equal(allowed(ns,1),false);processes=[];
 alive.delete(1);assert.equal(allowed(ns,1),false);
});
test('reward completion tolerates delayed rendering without clicking twice',async()=>{
 let ended=false,pending=false,sleeps=0,clicks=0;
 const model={maxLevel:3,startInfiltration(){},cancel(){ended=true;},results:'',stage:stage({})};
 const sell={textContent:'Sell for $100',click(){clicks++;pending=true;}};
 const document=fakeDocument(model,[sell]);document.body.textContent='Infiltration successful!';
 const query=document.querySelectorAll;document.querySelectorAll=selector=>ended?[]:query(selector);
 const files=ownedInfiltrationFiles(),ns={pid:1,read:f=>files.get(f)||'',ps:()=>[],isRunning:()=>true,write:async(f,v)=>files.set(f,v),sleep:async()=>{if(pending&&++sleeps===3)ended=true;}};
 const result=await playInfiltration(ns,document,model);assert.equal(result.status,'completed');assert.equal(clicks,1);assert.equal(sleeps,3);
});
test('losing the activity lease prevents puzzle input',async()=>{
 let cancelled=false,pressed=false;
 const model={maxLevel:3,startInfiltration(){},cancel(){cancelled=true;},results:'',stage:stage({answer:'A',guess:'',onKey(){pressed=true;}})};
 const files=new Map([['tasks/activity-lock.json',JSON.stringify({ownerPid:2,expiresAt:Date.now()+10000})]]);
 const ns={pid:1,read:f=>files.get(f)||'',ps:()=>[],isRunning:()=>true,write:async(f,v)=>files.set(f,v),sleep:async()=>{}};
 const result=await playInfiltration(ns,fakeDocument(model),model);assert.equal(result.status,'interrupted');assert.equal(cancelled,true);assert.equal(pressed,false);
});
test('runner heartbeat remains fresh inside active infiltration and delayed entry uses fresh guards',async()=>{
 const source=await readFile(new URL('../infiltration-manager.js',import.meta.url),'utf8');
 const runner=source.slice(source.indexOf('export async function playInfiltration'),source.indexOf('export async function main'));
 assert.ok(runner.includes('automationHeartbeat(ns)'));
 assert.ok(source.includes('infiltrationEntryAllowed.toString()'));
 assert.ok(source.includes('sourceFiles[6] || sourceFiles[7]'));
 assert.ok(source.includes("else if (!active&&enteredUi&&!activityBusy(ns)&&!transitionBusy(ns))"));
 assert.equal(recordInfiltrationOutcome({}, {status:'error'},100).retryAt,30100);
});
