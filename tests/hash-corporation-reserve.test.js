import test from 'node:test';
import assert from 'node:assert/strict';
import {hashReserveFor,hashSpendingDecision} from '../hash-spending-policy.js';

const cash='Sell for Money';
// A staged corporation milestone, as corporation-manager publishes it for the office rung that gates city
// expansion. `hashReserveFor` must hold exactly `totalHashes` back from every other hash sink.
function staged({hashes=20000,capacity=40000,routeEta=null,goal={}}={}){
 const now=Date.now(),files={},calls=[];
 const reset={lastAugReset:1,lastNodeReset:1};
 const base={schemaVersion:2,at:now,ownerPid:3,nodeReset:1,augReset:1,priority:true,
  milestone:{action:'Sell for Corporation Funds',label:'Grow Agri office in Sector-12 to 12',gap:4.1e9,reward:1e9,purchases:5,totalHashes:500,staged:true,target:5.18e9}};
 files['tasks/corporation-hash-goal.json']=JSON.stringify({...base,...goal,
  milestone:goal.milestone===null?null:{...base.milestone,...(goal.milestone||{})}});
 files['tasks/node-route-plan.json']=JSON.stringify({at:now,nodeReset:1,augReset:1,ownerPid:1,selected:'bladeburner',
  committed:'bladeburner',routes:{bladeburner:{etaMs:routeEta}},development:{nextBlackOp:{rankGap:0}}});
 const processes=[{pid:1,filename:'autopilot.js',args:[]},{pid:3,filename:'corporation-manager.js',args:[]}];
 const ns={pid:2,getResetInfo:()=>reset,read:f=>files[f]||'',ps:()=>processes,getPlayer:()=>({money:1e12}),
  hacknet:{numHashes:()=>hashes,hashCapacity:()=>capacity,hashCost:(a,q=1)=>({SelForMoney:4}[a]??({[cash]:4,'Sell for Corporation Funds':100,'Exchange for Bladeburner Rank':250}[a]))*q,
   spendHashes:(a,t,q=1)=>{calls.push([a,q]);return true}},bladeburner:{inBladeburner:()=>true,getRank:()=>0,getSkillPoints:()=>0}};
 return {ns,files,processes,reset,now,calls};
}

test('a staged corporation milestone reserves exactly its receipt cost',()=>{
 const f=staged();
 assert.equal(hashReserveFor(f.ns),500);
 // Not staged, missing, stale, foreign-reset, unpaused-owner-missing: nothing is held back.
 assert.equal(hashReserveFor(staged({goal:{milestone:{staged:false}}}).ns),0);
 assert.equal(hashReserveFor(staged({goal:{milestone:null}}).ns),0);
 assert.equal(hashReserveFor(staged({goal:{at:Date.now()-120000}}).ns),0);
 assert.equal(hashReserveFor(staged({goal:{priority:false}}).ns),0);
 assert.equal(hashReserveFor(staged({goal:{augReset:9}}).ns),0);
 const dead=staged();dead.processes.length=1;assert.equal(hashReserveFor(dead.ns),0);
});

test('a bulk Sell-for-Money cannot be judged one receipt at a time',()=>{
 // The spender asked for floor(budget / unitCost) in one call, so a guard that priced a single receipt let a
 // 5000-receipt sale walk past the corporation's reservation. Cost is the requested quantity now.
 const f=staged();
 const single=hashSpendingDecision(f.ns,cash,{quantity:100});
 assert.notEqual(single.reason,'Reserving hashes for staged corporation funding');
 const bulk=hashSpendingDecision(f.ns,cash,{quantity:6000});
 assert.equal(bulk.allowed,false);
 assert.match(String(bulk.reason),/Reserving hashes for staged corporation funding/);
 assert.equal(bulk.cashEquivalent,6000*4*250000);
});

test('the reserve the spender clamps with is the same number the decision refuses on',()=>{
 const f=staged(),reserve=hashReserveFor(f.ns);
 assert.ok(reserve>0);
 const justUnder=hashSpendingDecision(f.ns,cash,{quantity:Math.floor((20000-reserve)/4)});
 assert.equal(justUnder.allowed,true);
 const oneOver=hashSpendingDecision(f.ns,cash,{quantity:Math.floor((20000-reserve)/4)+1});
 assert.equal(oneOver.allowed,false);
});
