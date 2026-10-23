import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {bladeburnerRankSupply,readBladeburnerRankReserves} from '../bladeburner-reserve-policy.js';
import {estimateBladeburnerRoute,nodeRouteSnapshotSource} from '../node-route-policy.js';
const stealth='Stealth Retirement Operation';
const reserves={stealth:20,population:200,maxRank:1000,guardReady:true};
const action=(name,count,gain=10)=>({name,count,gain,time:1000,chance:[1,1],loss:0});
const op=(required,gain=0)=>({name:'Final',required,gain,time:1000,chance:[1,1],loss:0});
const estimate=(actions,required,patch={})=>estimateBladeburnerRoute({rank:0,reserves,actions,ops:[op(required)],...patch});

test('rank supply keeps whole Stealth Retirement reserve and requires a ready guard',()=>{
 for(const [count,want] of [[19,0],[20.99,0],[21,1],[22.99,2]])assert.equal(bladeburnerRankSupply(stealth,count,0,reserves),want);
 for(const patch of [{guardReady:false},{guardReady:1},{stealth:-1},{stealth:NaN},{stealth:1.5},{stealth:1000001}])assert.equal(bladeburnerRankSupply(stealth,100,0,{...reserves,...patch}),0);
 assert.equal(bladeburnerRankSupply(stealth,100,0,null),0);
 assert.equal(bladeburnerRankSupply(stealth,1.99,0,{...reserves,stealth:0}),1);
});
test('Raid never funds rank forecasts, even with raiding enabled for population cleanup',()=>{
 assert.equal(bladeburnerRankSupply('Raid',1e6,1e6,reserves),0);
 assert.equal(estimate([action('Raid',1000)],1).actionable,false);
});
test('population gates match the controller, including fractional supply and shrinking reserves',()=>{
 for(const name of ['Tracking','Investigation','Undercover Operation']) {
  assert.equal(bladeburnerRankSupply(name,200,0,reserves),0);
  assert.equal(bladeburnerRankSupply(name,200.5,0,reserves),1);
  assert.equal(bladeburnerRankSupply(name,201,0,reserves),1);
  assert.equal(bladeburnerRankSupply(name,200,495,reserves),100);
  assert.equal(bladeburnerRankSupply(name,200,990,reserves),200);
  assert.equal(bladeburnerRankSupply(name,.9,1000,reserves),0);
  assert.equal(bladeburnerRankSupply(name,200,0,null),0);
 }
 for(const patch of [{population:-1},{population:NaN},{maxRank:0},{maxRank:Infinity}])assert.equal(bladeburnerRankSupply('Tracking',201,0,{...reserves,...patch}),0);
});
test('ordinary action supply remains usable without controller reserve evidence',()=>{
 assert.equal(bladeburnerRankSupply('Retirement',3.99,0,null),3);
 assert.equal(estimate([action('Retirement',1)],10,{reserves:null}).actionable,true);
});
test('ETA cannot consume protected missions or count fractional surplus',()=>{
 assert.equal(estimate([action(stealth,21.99)],10).lowerMs,2000);
 const blocked=estimate([action(stealth,21.99)],20);
 assert.equal(blocked.actionable,false);assert.match(blocked.reason,/after reserves/);assert.equal(blocked.rankAfterStages,10);
 assert.equal(estimate([action(stealth,100)],10,{reserves:{...reserves,guardReady:false}}).actionable,false);
 assert.equal(estimate([action(stealth,100)],10,{reserves:null}).actionable,false);
});
test('finite surplus is shared across successive BlackOps',()=>{
 const result=estimate([action(stealth,22)],0,{ops:[op(10),op(20),op(30)]});
 assert.equal(result.actionable,false);assert.equal(result.completedStagesMs,4000);assert.equal(result.rankAfterStages,20);
});
test('rank gains release population reserves across batches and BlackOps',()=>{
 assert.equal(estimate([action('Tracking',201)],30).lowerMs,4000);
 assert.equal(estimate([action('Tracking',200)],10).actionable,false);
 assert.equal(estimate([action('Tracking',200.5)],10).actionable,true);
 const result=estimate([action('Tracking',200)],0,{ops:[op(0,495),op(1000)]});
 assert.equal(result.actionable,true);
});
function fixture() {
 const now=Date.now(),reset={lastNodeReset:1,lastAugReset:2};
 const data={...reserves,at:now,ownerPid:7,nodeReset:1,augReset:2,guardPid:8};
 const ready={pid:8,ownerPid:7,nodeReset:1,augReset:2};
 const lease={ownerPid:7,nodeReset:1,augReset:2,at:now,expiresAt:now+30000,reserve:20,mode:'farm'};
 const files={'tasks/bladeburner-rank-reserves.json':data,'/Temp/bladeburner-stock-ready-7.txt':ready,'tasks/bladeburner-stock-guard.json':lease};
 const processes=[{pid:7,filename:'bladeburner.js'},{pid:8,filename:'/Temp/bladeburner-stock-guard.js'}];
 const ns={read:f=>JSON.stringify(files[f]),ps:()=>processes};
 return {now,reset,data,ready,lease,files,processes,ns,read:()=>readBladeburnerRankReserves(ns,reset,now)};
}
test('serialized reserve reader recognizes only a current live controller and guard',()=>{
 const f=fixture();assert.equal(f.read().guardReady,true);
 const read=vm.runInNewContext('('+readBladeburnerRankReserves.toString()+')');
 assert.equal(read(f.ns,f.reset,f.now).guardReady,true);
 for(const change of [f=>f.data.at-=30000,f=>f.data.at++,f=>f.data.nodeReset++,f=>f.data.augReset++,f=>f.processes.shift(),f=>f.processes[0].filename='other.js',f=>f.files['tasks/bladeburner-rank-reserves.json']=null]) {
  const f=fixture();change(f);assert.equal(f.read(),null);
 }
});
test('stale, replaced, absent or unacknowledged guards cannot contribute surplus',()=>{
 for(const change of [f=>f.data.guardReady=false,f=>f.ready.pid++,f=>f.ready.ownerPid++,f=>f.ready.augReset++,f=>f.processes.pop(),f=>f.processes[1].filename='other.js',f=>f.lease.expiresAt=f.now,f=>f.lease.at++,f=>f.lease.reserve++,f=>f.lease.ownerPid++,f=>f.lease.nodeReset++,f=>f.lease.mode='unknown',f=>delete f.files['tasks/bladeburner-stock-guard.json']]) {
  const f=fixture();change(f);const r=f.read();assert.equal(r.guardReady,false);assert.equal(r.population,200);assert.equal(bladeburnerRankSupply(stealth,100,0,r),0);
 }
 assert.equal(readBladeburnerRankReserves({read:()=>{throw Error('Unavailable');}}, {},0),null);
});
test('actual snapshot worker embeds the self-contained reserve reader',()=>{
 const source=nodeRouteSnapshotSource(false,true);
 assert.match(source,/reserves:\(function readBladeburnerRankReserves/);
 assert.doesNotThrow(()=>new vm.Script(source));
 const controller=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.match(controller,/reservedActions=limitedActions.filter\(name=>bladeburnerRankSupply/);
 assert.match(controller,/ns.write\('tasks\/bladeburner-rank-reserves.json'/);
});

test('custom reserves change projected supply without default assumptions',()=>{
 const custom={stealth:3,population:2,maxRank:1000,guardReady:true};
 assert.equal(estimate([action(stealth,4)],10,{reserves:custom}).actionable,true);
 assert.equal(estimate([action(stealth,4)],20,{reserves:custom}).actionable,false);
 assert.equal(estimate([action('Tracking',3)],10,{reserves:custom}).actionable,true);
});
test('executed snapshot passes the current controller reserve evidence to ETA',()=>{
 const f=fixture();
 Object.assign(f.ns,{getPlayer:()=>({exp:{hacking:100},skills:{hacking:10},mults:{hacking:1},money:0}),getResetInfo:()=>({...f.reset,ownedAugs:{}}),getBitNodeMultipliers:()=>({HackingLevelMultiplier:1}),serverExists:()=>false,
 bladeburner:{inBladeburner:()=>true,getStamina:()=>[100,100],getSkillLevel:()=>0,getActionEstimatedSuccessChance:()=>[1,1],getActionCurrentLevel:()=>1,getActionTime:()=>1000,getActionRankGain:()=>10,getActionRankLoss:()=>0,getActionCountRemaining:()=>21,getCity:()=> 'A',getRank:()=>0,getCurrentAction:()=>null,getBonusTime:()=>0,getBlackOpNames:()=>['Operation Typhoon'],getBlackOpRank:()=>20,getContractNames:()=>[],getOperationNames:()=>[stealth]}});
 const source=nodeRouteSnapshotSource(false,true);
 const snapshot=vm.runInNewContext(source,{ns:f.ns,Date:{now:()=>f.now}});
 assert.equal(snapshot.bb.error,undefined);assert.equal(snapshot.bb.reserves.guardReady,true);
 // Only one of the 21 missions is available for rank; the 20-mission reserve cannot fund the gate.
 assert.equal(estimateBladeburnerRoute(snapshot.bb).actionable,false);
 f.processes.pop();
 const lost=vm.runInNewContext(source,{ns:f.ns,Date:{now:()=>f.now}});
 assert.equal(lost.bb.reserves.guardReady,false);
});
