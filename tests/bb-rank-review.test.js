import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sleeveBladeburnerTasks} from '../sleeve-policy.js';
import {rankHashMaintenanceRequired,readRankHashUpgradeContext,rankHashUpgradeValue} from '../bladeburner-rank-support-policy.js';
const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
test('controller queries actual Black Op capability below the rank gate',async()=>{
 const expression=source.split('const blackOpsRawChance = ')[1].split(';')[0];
 const run=new (Object.getPrototypeOf(async function(){}).constructor)('nextBlackOp','rank','blackOpsRanks','getBBDictByActionType','ns','return '+expression);
 let calls=0;const native=async()=>{calls++;return {Annihilus:[1,1]};};
 assert.deepEqual(await run('Annihilus',183000,{Annihilus:200000},native,{}),[1,1]);
 assert.equal(calls,1);assert.deepEqual(await run(null,0,{},native,{}),[0,0]);assert.equal(calls,1);
 assert.ok(source.includes("rank>=blackOpsRanks[nextBlackOp]&&minChance(nextBlackOp)>=options['success-threshold']"));
});
const sleeves=Array.from({length:4},()=>({shock:0,sync:100}));
const plan={chaos:0,threshold:.99,rankReady:false,chance:[1,1],counts:{Tracking:500},farmingUncertain:true};
test('farming uncertainty assigns one analysis sleeve before the rank gate',()=>{
 const r=sleeveBladeburnerTasks(sleeves,[],plan);
 assert.equal(Object.values(r).filter(a=>a==='Field Analysis').length,1);
 assert.equal(Object.values(r).filter(a=>a==='Infiltrate Synthoids').length,3);
});
test('analysis respects healthy sleeves, existing analysis, support and faction work',()=>{
 const tasks=[{type:'FACTION'},{type:'BLADEBURNER',actionName:'Field Analysis'}];
 const r=sleeveBladeburnerTasks(sleeves,tasks,plan,[2]);
 assert.equal(r[0],undefined);assert.equal(r[2],undefined);assert.equal(r[1],'Field Analysis');
 assert.deepEqual(sleeveBladeburnerTasks([{shock:1,sync:100}],[],plan),{});
});
test('Black Op uncertainty alone no longer assigns ineffective analysis',()=>{
 const r=sleeveBladeburnerTasks(sleeves,[],{...plan,rankReady:true,chance:[.9,1],farmingUncertain:false});
 assert.ok(!Object.values(r).includes('Field Analysis'));
});
test('rank-only workers ignore only explicitly unrelated maintenance',()=>{
 let r={expiresAt:Date.now()+30000,ownerPid:1,scripts:['corporation-manager.js','/go.js']};
 const ns={read:()=>JSON.stringify(r),isRunning:()=>true},actions=['Exchange for Bladeburner Rank'];
 assert.equal(rankHashMaintenanceRequired(ns,actions),false);
 assert.equal(rankHashMaintenanceRequired(ns,['Sell for Money']),true);
 for(const scripts of [[],null,['bladeburner.js'],['autopilot.js'],['spend-hacknet-hashes.js'],['unknown.js']]){
  r.scripts=scripts;assert.equal(rankHashMaintenanceRequired(ns,actions),true);
 }
 r.expiresAt=0;assert.equal(rankHashMaintenanceRequired(ns,actions),false);
});
function fixture(){
 const now=100000,reset={lastNodeReset:1,lastAugReset:2},status={pid:7,at:now,nodeReset:1,augReset:2,state:'spending',decision:{preferred:'Exchange for Bladeburner Rank',rankGap:1000}};
 const files={'tasks/hash-worker-status-7.json':JSON.stringify(status)};
 const ns={read:p=>files[p]||'',ps:()=>[{pid:7,filename:'spend-hacknet-hashes.js'}],getResetInfo:()=>reset,hacknet:{hashCost:()=>1000,numHashes:()=>400,hashCapacity:()=>2000,numNodes:()=>1,getNodeStats:()=>({production:10})}};
 return {now,status,files,ns};
}
test('rank upgrade quotes use remaining hashes and current native production',()=>{
 const f=fixture(),context=readRankHashUpgradeContext(f.ns,f.now);
 assert.deepEqual(context,{remainingHashes:600,production:10});
 assert.deepEqual(rankHashUpgradeValue({cost:100,gain:10},context),{secondsSaved:30,secondsSavedPerDollar:.3});
});
test('rank upgrade context rejects stale, paused, mismatched and already funded evidence',()=>{
 for(const change of [f=>f.status.at-=15000,f=>f.status.augReset=0,f=>f.status.state='waiting',f=>f.status.decision.preferred='Sell for Money']){
  const f=fixture();change(f);f.files['tasks/hash-worker-status-7.json']=JSON.stringify(f.status);assert.equal(readRankHashUpgradeContext(f.ns,f.now),null);
 }
 const f=fixture();f.ns.hacknet.numHashes=()=>1000;assert.equal(readRankHashUpgradeContext(f.ns,f.now),null);
 const g=fixture();g.files['remote-control/paused/spend-hacknet-hashes.js.txt']='true';assert.equal(readRankHashUpgradeContext(g.ns,g.now),null);
 assert.equal(rankHashUpgradeValue({cost:0,gain:1},{remainingHashes:1,production:1}),null);
});

test('Black Op-specific recovery waits for rank eligibility',()=>{
 const expression=source.split('const blackOpStaminaBlocked=')[1].split(';')[0];
 const evaluate=Function('rank','nextBlackOp','blackOpsRanks','stamina','teamPlan','blackOpsRawChance','blackOpsChance','options','return '+expression);
 const args=['Annihilus',{Annihilus:200000},[60,100],{state:'needs-stamina'},[1,1],[.9,.9],{'success-threshold':.99}];
 assert.equal(evaluate(183000,...args),false);assert.equal(evaluate(200000,...args),true);
});
