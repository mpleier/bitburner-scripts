import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveHgwTiming,graftResetBlocked,currentCorporationStatus,augmentationSavingsTarget,routeHashBudget} from '../progression-improvements-policy.js';
import {spendingPlan} from '../spending-policy.js';
import {hacknetPayoffLimit} from '../hacknet-policy.js';
import {renderCommandJob} from '../remote-api-command.js';
const evidence=(at,operations=0,deadlineOverruns=0,extra={})=>({at,augReset:1,nodeReset:2,counts:{operations,deadlineOverruns},...extra});
const pacing=(prior,now,ops=0,late=0,extra={})=>adaptiveHgwTiming(prior,evidence(now,ops,late),{now,baseCycleMs:4000,baseQueueMs:100,targetCount:4,...extra});

test('sustained late completions widen spacing and reduce future target concurrency',()=>{
 let s=pacing(null,100000);s=pacing(s,130000,100,10);
 assert.equal(s.cycleMs,6000);assert.equal(s.targetCap,3);assert.equal(s.queueMs,150);
 s=pacing(s,160000,200,20);assert.equal(s.cycleMs,6000);
 s=pacing(s,190000,300,30);assert.equal(s.cycleMs,9000);
});
test('old lifetime overruns and sparse windows do not cause pacing backoff',()=>{
 let s=pacing(null,100000,10000,1000);s=pacing(s,130000,10010,1001);assert.equal(s.multiplier,1);
 s=pacing(s,160000,10100,1001);assert.equal(s.multiplier,1);
});
test('pacing recovery requires clean windows and backoff is bounded',()=>{
 let s=pacing(null,100000);
 for(let i=1;i<=8;i++)s=pacing(s,100000+i*60000,i*100,i*10);
 assert.equal(s.multiplier,4);
 for(let i=1;i<=3;i++)s=pacing(s,580000+i*60000,800+i*100,80);
 assert.equal(s.multiplier,3.2);assert.ok(s.cycleMs>=4000);
});
test('counter resets, stale or blocked evidence, reset changes and missing telemetry remain safe',()=>{
 let s=pacing(null,100000);s=pacing(s,130000,100,20);
 const stale=adaptiveHgwTiming(s,evidence(130000,200,100),{now:180000,baseCycleMs:4000});assert.equal(stale.multiplier,1.5);
 const blocked=adaptiveHgwTiming(s,evidence(180000,200,100,{blocked:true}),{now:180000,baseCycleMs:4000});assert.equal(blocked.multiplier,1.5);
 s=pacing(s,160000,0,0);assert.equal(s.multiplier,1.5);
 const reset=adaptiveHgwTiming(s,evidence(180000,1,0,{augReset:3}),{now:180000});assert.equal(reset.multiplier,1);
 assert.equal(adaptiveHgwTiming(null,null,{now:1}).cycleMs,4000);
});
const reset={lastAugReset:100,lastNodeReset:50,currentNode:9},owner=[{pid:7,filename:'autopilot.js'}];
test('only a fresh owned reset countdown blocks grafting',()=>{
 const p={pending:true,ownerPid:7,augReset:100,expiresAt:2000};
 assert.equal(graftResetBlocked(p,reset,owner,1000),true);
 for(const q of [{...p,pending:false},{...p,ownerPid:8},{...p,augReset:99},{...p,expiresAt:900},{...p,expiresAt:1e9}])assert.equal(graftResetBlocked(q,reset,owner,1000),false);
 assert.equal(graftResetBlocked(p,reset,[{pid:7,filename:'other.js'}],1000),false);
});
test('corporation snapshots require the current run, a live named owner and recent evidence',()=>{
 const record={at:1000,pid:9,nodeReset:50,augReset:100},ps=[{pid:9,filename:'corporation-manager.js'}];
 assert.equal(currentCorporationStatus(record,reset,ps,2000),record);
 for(const q of [{...record,at:99},{...record,at:3000},{...record,nodeReset:1},{...record,augReset:1}])assert.equal(currentCorporationStatus(q,reset,ps,2000),null);
 assert.equal(currentCorporationStatus(record,reset,[],2000),null);
 assert.equal(currentCorporationStatus(record,reset,ps,130000),null);
});
const rank='Exchange for Bladeburner Rank',sp='Exchange for Bladeburner SP';
const hash={route:{selected:'bladeburner',development:{nextBlackOp:{rankGap:10}}},priorityActive:true,costs:{[rank]:4000,[sp]:4000},hashes:4500,capacity:8000,overflowBuffer:10};
test('hash purchases reserve the route priority instead of racing to empty the pool',()=>{
 assert.equal(routeHashBudget('Increase Maximum Money',hash),500);
 assert.equal(routeHashBudget(rank,hash),4500);
 assert.equal(routeHashBudget(sp,hash),500);
 assert.equal(routeHashBudget('Sell for Money',{...hash,priorityActive:false}),4500);
 assert.equal(routeHashBudget('Sell for Money',{...hash,route:{selected:'hacking'}}),4500);
});
test('hash policy favors skills after rank gate, cheaper skills, and configured priority spenders',()=>{
 assert.equal(routeHashBudget(sp,{...hash,route:{selected:'bladeburner',development:{nextBlackOp:{rankGap:0}}}}),4500);
 assert.equal(routeHashBudget(sp,{...hash,costs:{[rank]:10000,[sp]:1000}}),4500);
 assert.equal(routeHashBudget(sp,{...hash,priorityActions:[sp]}),4500);
 assert.equal(routeHashBudget('Sell for Money',{...hash,costs:{[rank]:10000,[sp]:10000},capacity:4000,hashes:4000}),10);
 assert.equal(routeHashBudget('Sell for Money',{...hash,costs:{}}),4500);
});
test('nearby augmentation targets require current reputation, prerequisites, useful stats and reachable costs',()=>{
 const target={name:'Combat',directCost:200,rep:10,factions:['Tetrads'],stats:{strength:1.2}};
 const snapshot={augReset:100,at:1000,reputation:{Tetrads:10},targets:[target]};
 assert.equal(augmentationSavingsTarget(snapshot,reset,100,'bladeburner',2000).name,'Combat');
 for(const patch of [{directCost:1000},{directCost:null},{rep:20},{stats:{charisma:2}}])assert.equal(augmentationSavingsTarget({...snapshot,targets:[{...target,...patch}]},reset,100,'bladeburner',2000),null);
 assert.equal(augmentationSavingsTarget({...snapshot,augReset:1},reset,100,'bladeburner',2000),null);
 assert.equal(augmentationSavingsTarget(snapshot,reset,100,'bladeburner',400000),null);
});
test('BN9 route and nearby augmentation goals cap reinvestment but retain essential home RAM funding',()=>{
 const args={money:1e9,homeRam:1024,node:9,ownerPid:7,reset:100,signals:{route:'bladeburner'}};
 const p=spendingPlan(args);assert.ok(p.allowances.home<=2e7);assert.ok(p.allowances.servers<=2e7);assert.ok(p.allowances.hacknet<=5e7);
 const saving=spendingPlan({...args,signals:{augmentationCashTarget:{name:'Combat',cost:2e9}}});assert.ok(saving.allowances.hacknet<=2e7);
 const small=spendingPlan({...args,homeRam:32});assert.ok(small.allowances.home>2e7);
 assert.ok(Object.values(p.allowances).reduce((a,b)=>a+b,0)<=1e9);
});
test('BN9 payoff exemptions yield to fresh route or augmentation priorities and explicit shorter horizons win',()=>{
 const p={reset:100,epoch:1000,expiresAt:3000,signals:{route:'bladeburner'}};
 assert.equal(hacknetPayoffLimit(1e9,p,reset,2000,true),7200);
 assert.equal(hacknetPayoffLimit(1e9,{...p,signals:{augmentationCashTarget:{cost:1e9}}},reset,2000,true),3600);
 assert.equal(hacknetPayoffLimit(300,p,reset,2000,true),300);
 assert.equal(hacknetPayoffLimit(1e9,p,reset,4000,true),1e9);
});
test('generated API status filters archived corporation snapshots without extending command permissions',async()=>{
 const command={id:'status-qc',method:'automation.status',args:[],expiresAt:Date.now()+60000};
 const job=await import('data:text/javascript;base64,'+Buffer.from(renderCommandJob(command)).toString('base64'));let response;
 await job.main({args:['[]','out','id'],pid:1,read:f=>f==='tasks/corporation-status.json'?JSON.stringify({at:10,pid:9}):'',getResetInfo:()=>reset,ps:()=>[],write:async(f,s)=>response=JSON.parse(s)});
 assert.equal(response.state,'completed');assert.equal(response.result.corporation,null);assert.equal(response.result.hgwPacing,null);
});


test('sparse clean traffic restores pacing with eight completions per two-minute window',()=>{
 let s=pacing(null,100000);s=pacing(s,130000,100,10);
 s=pacing(s,250000,108,10);assert.equal(s.multiplier,1.5);
 s=pacing(s,370000,116,10);assert.equal(s.multiplier,1.2);assert.ok(s.completionsPerSecond>0);
 const twoTargets=adaptiveHgwTiming(s,evidence(370001,116,10),{now:370001,baseCycleMs:4000,targetCount:2});
 assert.equal(twoTargets.targetCap,2);
});
test('sparse traffic with fresh overruns cannot falsely recover and silence is not a clean sample',()=>{
 let s=pacing(null,100000);s=pacing(s,130000,100,10);
 s=pacing(s,250000,108,11);assert.equal(s.multiplier,1.5);assert.equal(s.cleanWindows,0);
 s=pacing(s,370000,108,11);assert.equal(s.multiplier,1.5);assert.equal(s.cleanWindows,0);
});
