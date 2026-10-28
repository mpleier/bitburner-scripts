import test from 'node:test';
import assert from 'node:assert/strict';
import {candidatePasswordTurn,solveFeedbackPassword} from '../darknet-solvers.js';
import {createDarknetProgressReporter} from '../darknet-node.js';
const details={hostname:'h',modelId:'dictionary',passwordLength:1,passwordFormat:'alphabetic'};
const words=['a','b','c','d','e'];
const bad=()=>({success:false,code:401});

test('candidate turns resume without replaying rejected guesses',async()=>{
 const state={},guesses=[];const auth=async p=>{guesses.push(p);return p==='e'?{success:true}:bad();};
 assert.equal((await candidatePasswordTurn(details,undefined,words,state,auth,auth,100,2)).reason,'budget');
 assert.deepEqual(guesses,['a','b']);
 assert.equal((await candidatePasswordTurn(details,undefined,words,state,auth,auth,200,2)).reason,'budget');
 assert.equal((await candidatePasswordTurn(details,undefined,words,state,auth,auth,300,2)).password,'e');
 assert.deepEqual(guesses,words);
});
test('interrupted and thrown authentication preserve the current candidate',async()=>{
 for(const throws of [false,true]){
  const state={},guesses=[];let interrupt=true;
  const auth=async p=>{guesses.push(p);if(p==='b'&&interrupt){interrupt=false;if(throws)throw Error('offline');return {code:408};}return bad();};
  const run=()=>candidatePasswordTurn(details,undefined,words,state,auth,auth,100,2);
  if(throws)await assert.rejects(run(),/offline/);else assert.equal((await run()).reason,'interrupted');
  await run();assert.deepEqual(guesses,['a','b','b','c']);
 }
});
test('saved credentials consume budget once, including empty credentials',async()=>{
 for(const saved of ['a','']) {
  const state={},guesses=[];const auth=async p=>{guesses.push(p);return bad();};
  await candidatePasswordTurn(details,saved,[saved,'b','c'],state,auth,auth,100,1);
  await candidatePasswordTurn(details,saved,[saved,'b','c'],state,auth,auth,200,1);
  assert.deepEqual(guesses,[saved,'b']);
 }
});
test('candidate cooldown expires and changed puzzle or input invalidates progress',async()=>{
 const state={},guesses=[];const auth=async p=>{guesses.push(p);return bad();};
 const run=(d=details,w=['a'],now=100)=>candidatePasswordTurn(d,undefined,w,state,auth,auth,now,8,1000);
 assert.equal((await run()).reason,'exhausted');assert.equal((await run()).reason,'cooldown');assert.equal(guesses.length,1);
 await run(details,['a'],1100);assert.equal(guesses.length,2);
 await run({...details,data:'changed'},['a'],1101);assert.equal(guesses.length,3);
 await run({...details,data:'changed'},['b'],1102);assert.equal(guesses.at(-1),'b');
});
function puzzle(model='AccountsManager_4.2') {
 const guesses=[],logs=[],state={};let fail=true;
 const auth=async p=>{guesses.push(p);if(p==='42')return {success:true};logs.unshift({code:401,passwordAttempted:p,data:Number(p)>42?'Lower':'Higher'});return bad();};
 const read=async()=> fail?{success:false,code:408}:{success:true,logs};
 return {guesses,logs,state,auth,read,ready:()=>{fail=false;},details:{modelId:model,passwordLength:2,passwordFormat:'numeric',probeBudget:1}};
}
test('generic solver retrieves pending feedback without reauthenticating',async()=>{
 const p=puzzle();assert.match((await solveFeedbackPassword(p.details,p.auth,p.read,p.state)).reason,/Heartbleed/);
 assert.deepEqual(p.guesses,['49']);p.ready();
 await solveFeedbackPassword(p.details,p.auth,p.read,p.state);assert.deepEqual(p.guesses,['49']);
 for(let i=0;i<10;i++){const r=await solveFeedbackPassword(p.details,p.auth,p.read,p.state);if(r.success){assert.equal(r.password,'42');return;}}
 assert.fail('did not solve');
});
test('lost pending feedback permits a new probe after three successful empty reads',async()=>{
 const p=puzzle();await solveFeedbackPassword(p.details,p.auth,p.read,p.state);
 const read=async()=>({success:true,logs:[]});
 for(let i=0;i<3;i++)await solveFeedbackPassword(p.details,p.auth,read,p.state);
 assert.equal(p.guesses.length,1);
 await solveFeedbackPassword(p.details,p.auth,read,p.state);assert.deepEqual(p.guesses,['49','49']);
});
test('advanced RMS solver also retains pending feedback across failed reads',async()=>{
 const state={},details={modelId:'PHP 5.4',passwordLength:5,passwordFormat:'numeric',probeBudget:1};let guesses=0,ready=false;
 const auth=async()=>{guesses++;return bad();};const read=async()=>ready?{success:true,logs:[{code:401,passwordAttempted:'00000',data:'RMS Deviation: 1'}]}:{success:false};
 await solveFeedbackPassword(details,auth,read,state);ready=true;
 await solveFeedbackPassword(details,auth,read,state);assert.equal(guesses,1);assert.equal(state.rmsBaseline,5);
});
test('progress reports stay busy, throttle, and retry after failed publication',async()=>{
 let clock=0,fail=false;const calls=[];
 const report=createDarknetProgressReporter(async busy=>{calls.push(busy);if(fail)throw Error('offline');},()=>clock);
 assert.equal(await report(),true);clock=29999;assert.equal(await report(),false);
 clock=30000;fail=true;assert.equal(await report(),false);fail=false;assert.equal(await report(),true);
 assert.deepEqual(calls,[true,true,true]);clock=1;assert.equal(await report(),true);
});

import {main as managerMain} from '../darknet-manager.js';
import {main as scoutMain} from '../darknet-node.js';
test('manager and scout run bounded dictionary turns and resume the next pass',async()=>{
 for(const kind of ['manager','scout']) {
  const candidates=Array.from({length:20},(_,i)=>'zz'+String(i).padStart(7,'0'));
  const files=new Map([['darknet-candidates.txt',candidates.join('\n')]]),guesses=[],counts=[],messages=[];
  const script=kind==='manager'?'darknet-manager.js':'darknet-node.js',stop=Error('fixture done');let sleeps=0;
  const ns={pid:991,getScriptName:()=>script,getHostname:()=>kind==='manager'?'home':'origin',disableLog(){},
   read:name=>files.get(name)||'',write:(name,value)=>files.set(name,value),ls:(host,pattern='')=>[...files.keys()].filter(name=>name.includes(pattern)),fileExists:()=>false,
   hasTorRouter:()=>true,getResetInfo:()=>({lastNodeReset:1,lastAugReset:1}),getPlayer:()=>({skills:{charisma:0}}),
   print:line=>messages.push(String(line)),scp:async()=>true,ps:()=>[],getServerMaxRam:()=>16,getServerUsedRam:()=>16,getScriptRam:()=>0,
   sleep:async()=>{counts.push(guesses.length);if(++sleeps>=2){if(kind==='scout')throw stop;files.set('remote-control/paused/'+script+'.txt','true');}},
   dnet:{probe:()=>['target'],getServerDetails:host=>host==='target'?{modelId:'unknown',passwordLength:9,passwordFormat:'alphanumeric',blockedRam:0,hasSession:false,requiredCharismaSkill:1e9}:{depth:0,difficulty:0},
    authenticate:async(host,password)=>{guesses.push(password);return bad();},getServerRequiredCharismaLevel:()=>1e9,getStasisLinkedServers:()=>[],getStasisLinkLimit:()=>0}};
  if(kind==='manager')await managerMain(ns);else await assert.rejects(scoutMain(ns),e=>e===stop);
  assert.deepEqual(counts.slice(0,2),[8,16]);assert.deepEqual(guesses,candidates.slice(0,16));
  assert.equal(messages.some(x=>/TypeError|ReferenceError/.test(x)),false,messages.join('\n'));
 }
});
