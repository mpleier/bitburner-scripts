import {supportReplacementStartAllowed} from '../bladeburner-support-economics-policy.js';
import {blackOpHospitalCost,blackOpBonusComparison,blackOpRiskStartAllowed} from '../black-op-risk-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {bladeburnerSurplusAvailable,bladeburnerStockGuard,optionsError,rankBladeburnerActions,bladeburnerRankRate,startBladeburnerPlannedAction,bladeburnerStaminaChance,bladeburnerWorkAllowed} from '../bladeburner-policy.js';
import {apiReferences,estimateRam} from '../scripts/audit-core.js';
const action='Stealth Retirement Operation';
function fixture(onTick=()=>{}){
 const state={alive:true,count:21.9,action:{type:'Operations',name:action},reset:{lastNodeReset:1,lastAugReset:2},stops:0,ticks:0,logs:[],files:{}};
 state.intent={ownerPid:7,nodeReset:1,augReset:2,at:Date.now(),expiresAt:Date.now()+30000,reserve:20,mode:'farm'};
 const ns={pid:8,getResetInfo:()=>state.reset,isRunning:()=>state.alive,read:file=>file==='intent'?JSON.stringify(state.intent):state.files[file]||'',write:async(file,value)=>state.files[file]=value,rm:file=>delete state.files[file],print:line=>state.logs.push(line),bladeburner:{
  getCurrentAction:()=>state.action,getActionCountRemaining:()=>state.count,stopBladeburnerAction:()=>{state.stops++;state.action=null;},nextUpdate:async()=>{state.ticks++;if(state.ticks>10)throw Error('test guard exceeded tick bound');onTick(state);}}};
 return {ns,state,run:()=>bladeburnerStockGuard(ns,7,1,2,'intent','ready')};
}
test('surplus requires whole stock strictly above a valid reserve and acknowledged protection',()=>{
 assert.equal(bladeburnerSurplusAvailable(21,20,true),true);
 assert.equal(bladeburnerSurplusAvailable(1,0,true),true);
 for(const count of [20.99,20,0,-1,NaN,Infinity])assert.equal(bladeburnerSurplusAvailable(count,20,true),false);
 for(const reserve of [-1,.5,NaN,1000001])assert.equal(bladeburnerSurplusAvailable(100,reserve,true),false);
 assert.equal(bladeburnerSurplusAvailable(100,20,false),false);
});
test('reserve options accept only bounded nonnegative integers',()=>{
 const o={'team-cap':30,'success-threshold':.99,'low-stamina-pct':.5,'high-stamina-pct':.6,'chaos-recovery-threshold':50,'max-chaos':100,'training-limit':50,'reserved-action-count':200,'update-interval':2000};
 for(const reserve of [0,20,1000000])assert.equal(optionsError({...o,'stealth-retirement-reserve':reserve}),null);
 for(const reserve of [-1,NaN,Infinity,.5,1000001,'20'])assert.match(optionsError({...o,'stealth-retirement-reserve':reserve}),/stealth-retirement-reserve/);
});
test('native update guard stops at the reserve boundary before another repeat',async()=>{
 const f=fixture(s=>s.count-=1);await f.run();
 assert.equal(f.state.ticks,1);assert.equal(f.state.stops,1);assert.equal(Math.floor(f.state.count),20);assert.equal(f.state.files.ready,undefined);
});
test('fractional stock at the floor cannot fund even the first farming attempt',async()=>{
 const f=fixture();f.state.count=20.99;await f.run();assert.equal(f.state.ticks,0);assert.equal(f.state.stops,1);
});
test('explicit chaos cleanup can spend reserved missions',async()=>{
 const f=fixture(s=>{s.count=19;s.alive=false;});f.state.intent.mode='cleanup';f.state.count=20;await f.run();assert.equal(f.state.stops,0);
 const transition=fixture(s=>{if(s.ticks===1){s.intent.mode='cleanup';s.count=19;}else s.alive=false;});await transition.run();assert.equal(transition.state.stops,0);
});
test('stale or malformed leases stop only already-owned farming',async()=>{
 for(const mutate of [s=>s.intent.expiresAt=Date.now()-1,s=>s.intent.reserve=-1,s=>s.intent.at=Date.now()+1000]){
  const f=fixture(mutate);await f.run();assert.equal(f.state.stops,1);assert.equal(f.state.ticks,1);
 }
 const untouched=fixture(s=>s.alive=false);untouched.state.intent=null;await untouched.run();assert.equal(untouched.state.stops,0);
});
test('parent exit stops owned farming but does not stop other actions or Black Ops',async()=>{
 const f=fixture(s=>s.alive=false);await f.run();assert.equal(f.state.stops,1);
 for(const next of [{type:'Black Operations',name:'Operation Daedalus'},{type:'General',name:'Diplomacy'}]){
  const x=fixture(s=>{s.action=next;s.alive=false;});await x.run();assert.equal(x.state.stops,0);
 }
});
test('replacement ownership and reset changes cannot stop the new controller',async()=>{
 const f=fixture(s=>s.intent.ownerPid=99);await f.run();assert.equal(f.state.stops,0);
 const x=fixture(s=>s.reset={lastNodeReset:3,lastAugReset:4});await x.run();assert.equal(x.state.stops,0);
});
test('unsupported native APIs fail gracefully and remove their readiness marker',async()=>{
 const f=fixture();f.ns.bladeburner.nextUpdate=async()=>{throw Error('Source File unavailable');};await f.run();assert.equal(f.state.stops,1);assert.equal(f.state.files.ready,undefined);assert.match(f.state.logs[0],/unavailable/);
 const missing=fixture();delete missing.ns.bladeburner.nextUpdate;await missing.run();assert.equal(missing.state.stops,0);assert.equal(missing.state.files.ready,undefined);
});
test('unknown stock and ordinary activity changes cannot leave owned auto-repeat running',async()=>{
 const f=fixture(s=>s.count=NaN);await f.run();assert.equal(f.state.stops,1);
 const x=fixture(s=>{s.intent.mode='idle';if(s.ticks>1)s.alive=false;});await x.run();assert.equal(x.state.stops,1);
});
test('surplus competes on rank rate rather than forcing a worse farming action',()=>{
 const chances={[action]:[1,1],Retirement:[1,1]},metrics={[action]:{time:1000,gain:22,loss:0},Retirement:{time:1000,gain:1,loss:0}};
 assert.equal(rankBladeburnerActions(['Retirement',action],chances,metrics,null,bladeburnerRankRate)[0],action);
 metrics[action].time=100000;assert.equal(rankBladeburnerActions([action,'Retirement'],chances,metrics,null,bladeburnerRankRate)[0],'Retirement');
});
test('actual start transaction rechecks whole stock and guard liveness',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
 const literal=source.match(/const startResult = await getNsDataThroughFile\(ns, (`[^`]+`)/)[1];
 const expression=Function('blackOpHospitalCost','blackOpBonusComparison','startBladeburnerPlannedAction','bladeburnerStaminaChance','bladeburnerWorkAllowed','bbMutationGuard','blackOpRiskStartAllowed','supportReplacementStartAllowed','return '+literal)(blackOpHospitalCost,blackOpBonusComparison,startBladeburnerPlannedAction,bladeburnerStaminaChance,bladeburnerWorkAllowed,'true',blackOpRiskStartAllowed,supportReplacementStartAllowed);
 const state={count:20.99,live:true,starts:0};
 const ns={args:['Operations',action,0,.99,0,7,'null',false,JSON.stringify({[action]:{base:125,factor:1}}),20,8],isRunning:id=>id===7||id===8&&state.live,singularity:{getCurrentWork:()=>null,getOwnedAugmentations:()=>[]},bladeburner:{getActionCountRemaining:()=>state.count,getActionCurrentLevel:()=>1,getActionEstimatedSuccessChance:()=>[1,1],getStamina:()=>[100,100],startAction:()=>{state.starts++;return true;}}};
 const run=()=>Function('ns','return '+expression)(ns);
 assert.equal(run().reason,'stock-reserved');assert.equal(state.starts,0);
 state.count=21;state.live=false;assert.equal(run().reason,'stock-guard-unavailable');assert.equal(state.starts,0);
 state.live=true;assert.equal(run().success,true);assert.equal(state.starts,1);
 ns.args[9]=-1;state.count=20;state.live=false;assert.equal(run().success,true);
});
function startup(ack=true){
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('async function ensureSurplusStockGuard('),end=source.indexOf('/** @param {NS} ns',start);
 const state={now:100000,files:{},live:false,launches:0,kills:0};
 const ns={pid:7,read:file=>state.files[file]||'',write:async(file,text)=>state.files[file]=text,rm:file=>delete state.files[file],isRunning:()=>state.live,kill:()=>{state.live=false;state.kills++;},sleep:async ms=>state.now+=ms,print:()=>{},bladeburner:{getCurrentAction:()=>null}};
 const context={Date:{now:()=>state.now},bladeburnerSurplusAvailable,bladeburnerStockGuard,surplusGuardPid:0,surplusGuardAttemptAt:0,ownsSurplus:false,antiChaosOperation:action,resetInfo:{lastNodeReset:1,lastAugReset:2},stockIntentFile:'intent',runCommand:async(_ns,_code,_path,args)=>{state.live=true;state.launches++;if(ack)state.files[args[4]]=JSON.stringify({ownerPid:7,pid:8,nodeReset:1,augReset:2});return 8;}};
 vm.runInNewContext(source.slice(start,end)+';globalThis.ensure=ensureSurplusStockGuard;',context);
 return {state,ns,context,run:count=>context.ensure(ns,count,20)};
}
test('controller requires a current guard acknowledgement and reuses a healthy worker',async()=>{
 const f=startup();assert.equal(await f.run(20),false);assert.equal(f.state.launches,0);
 assert.equal(await f.run(21),true);assert.equal(await f.run(100),true);assert.equal(f.state.launches,1);
});
test('unacknowledged startup is killed and retried with a bounded backoff',async()=>{
 const f=startup(false);assert.equal(await f.run(100),false);assert.equal(f.state.kills,1);
 assert.equal(await f.run(100),false);assert.equal(f.state.launches,1);
 f.state.now+=15000;assert.equal(await f.run(100),false);assert.equal(f.state.launches,2);
});
test('reserve guard serializes and stays within the documented sixteen-GB helper slot',async()=>{
 const guard=Function('return ('+bladeburnerStockGuard.toString()+')')();const f=fixture(s=>s.count--);
 await guard(f.ns,7,1,2,'intent','ready');assert.equal(f.state.stops,1);
 const refs=apiReferences('guard.js',bladeburnerStockGuard.toString()).references;
 const ram=estimateRam(refs,JSON.parse(readFileSync(new URL('../scripts/api-surface.json',import.meta.url),'utf8')),3);
 assert.deepEqual(ram.unknown,[]);assert.ok(ram.ram<=16,ram.ram+' GB');
});

test('deferred nonurgent switches renew farming protection without interrupting a partial mission',async()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
 const start=source.indexOf('        if(bestActionName===currentAction.name&&!levelChange'),end=source.indexOf('    } // Otherwise prior action',start),modes=[];
 const context={tryExternalTraining:async()=>false,bestActionName:'Retirement',currentAction:{name:action},levelChange:false,urgent:false,interrupted:false,currentTaskEndTime:Date.now()+100000,farmSurplus:false,ownsSurplus:true,antiChaosOperation:action,stockReserve:20,publishBladeburnerStockIntent:async(_ns,mode)=>modes.push(mode)};
 vm.runInNewContext('globalThis.run=async function(ns){'+source.slice(start,end)+'}',context);
 await context.run({});assert.deepEqual(modes,['farm']);assert.equal(context.ownsSurplus,true);
 context.bestActionName=action;await context.run({});assert.deepEqual(modes,['farm','cleanup']);assert.equal(context.ownsSurplus,false);
});

test('an exiting guard cannot delete a replacement workers acknowledgement',async()=>{
 const f=fixture(s=>{s.intent.ownerPid=99;s.files.ready=JSON.stringify({ownerPid:7,pid:99,nodeReset:1,augReset:2});});
 await f.run();assert.equal(JSON.parse(f.state.files.ready).pid,99);assert.equal(f.state.stops,0);
});
