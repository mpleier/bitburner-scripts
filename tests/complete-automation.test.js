import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { infiltrationInput, chooseInfiltration, findInfiltrationState, selectRewardFaction } from '../infiltration-solvers.js';
import { playInfiltration } from '../infiltration-manager.js';
import { activityBusy, claimActivity, releaseActivity, pendingRam } from '../activity-coordination.js';
import { needsHealing } from '../health-manager.js';
import { stockPromotionSignals, chooseStockPromotion } from '../darknet-stock-policy.js';
import { renderCommandJob } from '../remote-api-command.js';
import { solveFeedbackPassword, modelCandidates } from '../darknet-solvers.js';
import { packetCandidates } from '../darknet-advanced.js';

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
test('the infiltration runner cancels an unknown model without dispatching keyboard events', async () => {
  let cancelled=false;
  const model={maxLevel:3,startInfiltration(){},cancel(){cancelled=true;},results:'',stage:stage({unknown:true})};
  const files=new Map();
  const ns={pid:1,read:file=>files.get(file)||'',ps:()=>[],isRunning:()=>true,write:async(file,data)=>files.set(file,data),sleep:async()=>{}};
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
  const ns={pid:1,read:file=>files.get(file)||'',isRunning:()=>alive,write:async(file,data)=>files.set(file,data),rm:file=>files.delete(file)};
  assert.equal(await claimActivity(ns,'infiltration'),true);
  assert.equal(activityBusy(ns,2),true); assert.equal(activityBusy(ns,1),false);
  assert.equal(await claimActivity({...ns,pid:2},'other'),false);
  releaseActivity({...ns,pid:2}); assert.equal(activityBusy(ns,2),true);
  alive=false; assert.equal(activityBusy(ns,2),false);
  alive=true; releaseActivity(ns); assert.equal(activityBusy(ns,2),false);
  files.set('tasks/automation-ram-reserve.json',JSON.stringify({ownerPid:1,expiresAt:200,ram:731}));
  assert.equal(pendingRam(ns,100),731); assert.equal(pendingRam(ns,200),0); alive=false; assert.equal(pendingRam(ns,100),0);
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
test('supervision, RAM reservations and UI guards are integrated into the managers', async () => {
  const files=['autopilot.js','daemon.js','work-for-factions.js','bladeburner.js','grafting-manager.js'];
  for (const file of files) assert.match(await readFile(new URL('../'+file,import.meta.url),'utf8'),/activityBusy\(ns/,file);
  const daemon=await readFile(new URL('../daemon.js',import.meta.url),'utf8');
  assert.match(daemon,/pendingRam\(this.ns\)/); assert.match(daemon,/lastHelperCheck >= 30000/);
  const autopilot=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
  assert.match(autopilot,/ramReserveFile/); assert.match(autopilot,/health-manager\.js/); assert.match(autopilot,/infiltration-manager\.js/);
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
test('labyrinth DFS backtracks and saves the returned session token', async () => {
  const paths=new Map([['1,1',['east','south']],['3,1',['west']],['1,3',['north','east']],['3,3',['west','east']],['5,3',['west']]]);
  const offsets={north:[0,-2],east:[2,0],south:[0,2],west:[-2,0]};let position=[1,1];const guesses=[];
  const f={details:{modelId:'(The Labyrinth)',passwordLength:12,passwordFormat:'alphanumeric'},guesses,
    report:async()=>({success:true,coords:position,...Object.fromEntries(Object.keys(offsets).map(d=>[d,paths.get(position.join(',')).includes(d)]))}),
    readLogs:async()=>assert.fail('maze feedback comes directly from authenticate'),
    attempt:async direction=>{guesses.push(direction);assert.ok(paths.get(position.join(',')).includes(direction));position=position.map((v,i)=>v+offsets[direction][i]);return position.join(',')==='5,3'?{success:true,code:200,data:'maze-token'}:{success:false,code:401,message:'Moved',data:''};}};
  assert.equal((await untilSolved(f)).password,'maze-token');assert.deepEqual(guesses,['east','west','south','east','east']);
});
