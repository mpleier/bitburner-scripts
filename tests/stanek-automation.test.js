import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stanekChargePlan,stanekThreadBudget,selectStanekLayout,stanekOptionsError,stanekSourceLevel,stanekLayoutDimensions} from '../stanek-policy.js';
import {chargeStanekFragments} from '../stanek.js';
const fragment=(extra={})=>({id:0,x:0,y:0,rotation:0,numCharge:0,highestCharge:0,...extra});
const options={'reserved-ram':32,'reserved-ram-ideal':64,'max-charges':120,'reputation-threshold':.2};
test('Stanek targets use exact fractional counts without a compulsory extra charge',()=>{
 assert.equal(stanekChargePlan([fragment({numCharge:119.1})],120).complete,false);
 assert.equal(stanekChargePlan([fragment({numCharge:120})],120).complete,true);
 assert.equal(stanekChargePlan([fragment({numCharge:120})],120,true).complete,false);
 assert.equal(stanekChargePlan([fragment()],0,false,1000).complete,true);
});
test('boosters are never charged and booster-only or empty grids are blocked',()=>{
 assert.equal(stanekChargePlan([],120).blocked,true);
 assert.equal(stanekChargePlan([fragment({id:100})],120).blocked,true);
 assert.deepEqual(stanekChargePlan([fragment({id:100}),fragment()],120).fragments.map(f=>f.id),[0]);
});
test('charging can improve peak power after reaching the numeric count target',()=>{
 assert.equal(stanekChargePlan([fragment({numCharge:120,highestCharge:10})],120,false,100).complete,false);
 assert.equal(stanekChargePlan([fragment({numCharge:120,highestCharge:100})],120,false,100).complete,true);
});
test('Stanek budgets use measured worker RAM and preserve explicit, ideal and activity reserves',()=>{
 assert.deepEqual(stanekThreadBudget(2000,4,32,64),{threads:484,reserve:64});
 assert.deepEqual(stanekThreadBudget(100,4,32,64,50),{threads:12,reserve:50});
 assert.equal(stanekThreadBudget(30,2,32,64).threads,0);
 assert.equal(stanekThreadBudget(100,0,32,64).threads,0);
 assert.equal(stanekThreadBudget(2000,2,100,64).reserve,100);
});
test('layout selection handles small grids and never mutates shared saved layouts',()=>{
 const layouts=[{width:3,height:3,fragments:[{id:0,x:0,y:0,rotation:0}]}];
 assert.equal(selectStanekLayout(layouts,2,2),null);
 assert.equal(selectStanekLayout(layouts,3,3,7).fragments[0].id,30);
 assert.equal(selectStanekLayout(layouts,3,3,1).fragments[0].id,0);
 assert.equal(layouts[0].fragments[0].id,0);
});
test('invalid options and optional SF4 access are handled without requiring Singularity',()=>{
 assert.equal(stanekOptionsError(options),null);
 assert.ok(stanekOptionsError({...options,'max-charges':NaN}));
 assert.ok(stanekOptionsError({...options,'reserved-ram':-1}));
 assert.ok(stanekOptionsError({...options,'reputation-threshold':2}));
 assert.equal(stanekSourceLevel({currentNode:13,ownedSF:new Map([[13,1]])},4),0);
 assert.equal(stanekSourceLevel({currentNode:4},4),3);
 assert.equal(stanekSourceLevel({ownedSF:{4:3},bitNodeOptions:{sourceFileOverrides:new Map([[4,0]])}},4),0);
});
async function chargeFixture({gain=true,launch=true,free=100,peak=false}={}) {
 let current=fragment({numCharge:10,highestCharge:1}),runs=[];
 const ns={read:()=>'',getScriptName:()=> 'stanek.js',getServerMaxRam:()=>free,getServerUsedRam:()=>0,getScriptRam:()=>4,
   print:()=>{},isRunning:()=>false,sleep:async()=>{},run:(_script,config)=>{runs.push(config.threads);if(!launch)return 0;if(gain)current=peak?{...current,numCharge:2,highestCharge:100}:{...current,numCharge:11};return 1;}};
 const children=new Set();
 const successful=await chargeStanekFragments(ns,[current],'home',options,async()=>[{...current}],children);
 return {successful,runs,children};
}
test('charge workers report success only after observed progress, including peak normalization',async()=>{
 assert.equal((await chargeFixture()).successful,true);
 assert.equal((await chargeFixture({peak:true})).successful,true);
 assert.equal((await chargeFixture({gain:false})).successful,false);
 assert.equal((await chargeFixture({launch:false})).successful,false);
 assert.equal((await chargeFixture()).children.size,0);
});
test('lack of RAM waits safely without launching a zero-thread worker',async()=>{
 const result=await chargeFixture({free:20});assert.equal(result.successful,false);assert.deepEqual(result.runs,[]);
});
test('autopilot retries failed Stanek starts and removes its temporary daemon RAM reservation',async()=>{
 const source=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.match(source,/stanekLaunched = stanekRunning = stanekPid > 0/);
 assert.match(source,/daemonArgumentsChanged\(existingDaemon.args, daemonArgs\)/);
 const manager=await readFile(new URL('../stanek.js',import.meta.url),'utf8');
 assert.match(manager,/await checkOnChargeScript/);assert.doesNotMatch(manager,/Math.ceil\(minCharges\)|chargeAttempts/);
});


test('forced Stanek dimensions reject oversize, fractional and nonpositive grids',()=>{
 assert.deepEqual(stanekLayoutDimensions(6,5,null,null),{width:6,height:5});
 assert.deepEqual(stanekLayoutDimensions(6,5,4,3),{width:4,height:3});
 for(const [w,h] of [[7,5],[6,6],[0,3],[3.5,3],[NaN,3]])assert.equal(stanekLayoutDimensions(6,5,w,h),null);
});

test('pause and maintenance cancel active Stanek workers and release child tracking',async()=>{
 for(const maintenance of [false,true]){
  let running=false,stopped=0,slept=false;
  const children=new Set(),ns={pid:10,getScriptName:()=> 'stanek.js',
   read:path=>path.includes('paused/')?(!maintenance&&slept?'true':''):path.includes('maintenance')?(maintenance&&slept?JSON.stringify({ownerPid:99,expiresAt:Date.now()+60000}):''):'',
   getServerMaxRam:()=>100,getServerUsedRam:()=>0,getScriptRam:()=>4,print:()=>{},
   run:()=>{running=true;return 1;},isRunning:pid=>pid===99||running,
   kill:()=>{running=false;stopped++;return true;},sleep:async()=>{slept=true;}};
  const result=await chargeStanekFragments(ns,[fragment()],'home',options,async()=>[fragment()],children);
  assert.equal(result,false);assert.equal(stopped,1);assert.equal(children.size,0);
 }
});

test('lost optional faction access falls back to the numeric charge target',async()=>{
 const source=await readFile(new URL('../stanek.js',import.meta.url),'utf8');
 const ns={getServerMaxRam:()=>100,getServerUsedRam:()=>0,getScriptRam:()=>4,getServer:()=>({cpuCores:1})};
 const context={stanekChargePlan,stanekThreadBudget,pendingRam:()=>0,log:()=>{},getNsDataThroughFile:async(_ns,expression)=>{
  if(expression.includes('activeFragments'))return [fragment({numCharge:120,highestCharge:100})];
  throw new Error('Faction API unavailable');
 }};
 vm.runInNewContext(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export async function','async function').replaceAll('export function','function')+";options="+JSON.stringify(options)+";currentServer='home';maxCharges=120;sf4Level=1;shouldContinueForAug=()=>true;globalThis.plan=getFragmentsToCharge;",context);
 assert.equal((await context.plan(ns)).length,0);
});
