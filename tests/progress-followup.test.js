import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastCorePreparation,forecastCoreBatches} from '../hacking-core-policy.js';
import {quoteHackingTarget} from '../hacking-target-policy.js';
import {adaptiveHgwTiming} from '../progression-improvements-policy.js';
import {anchorComparisonBaseline,evaluateAnchorComparison,coordinateDarknetAnchors,anchorRequestFile,anchorComparisonFile} from '../darknet-anchor-policy.js';
const hosts=[{host:'a',ram:16,cores:1},{host:'home',ram:16,cores:17}],costs={weak:1.75,grow:1.75,hack:1.7};
const prep=(extra={},h=hosts)=>forecastCorePreparation(h,{securityThreads:16,growThreads:16,costs,weakenPower:.05,weakMs:20000,growMs:16000,queueMs:1000,workerLimit:10,now:()=>0,...extra});
test('preparation respects discrete hosts, cores, worker capacity and fresh serial waves',()=>{
 const before=JSON.stringify(hosts),p=prep();assert.ok(p.waves>=2);assert.equal(p.securityWaves,1);assert.equal(p.durationMs,p.securityWaves*21000+p.growthWaves*37000);assert.ok(p.ramSeconds>0);assert.equal(JSON.stringify(hosts),before);
 assert.ok(prep({},hosts.map(h=>({...h,cores:1}))).ramSeconds>p.ramSeconds);
 assert.equal(prep({workerLimit:0}),null);assert.equal(prep({maxPlanningMs:0}),null);
 assert.equal(prep({},[{host:'a',ram:1,cores:1},{host:'b',ram:1,cores:1}]),null);
 assert.equal(prep({securityThreads:0,growThreads:0}).waves,0);
 assert.equal(prep({securityThreads:1e9}),null);
});
test('only preparation permits splitting grow and weakening is reserved first',()=>{
 const h=[{host:'a',ram:8,cores:1},{host:'b',ram:8,cores:1}];
 assert.equal(forecastCoreBatches(h,[{tool:'grow',threads:6,cost:1.75}]).cycles,0);
 assert.equal(forecastCoreBatches(h,[{tool:'grow',threads:6,cost:1.75,split:true}]).cycles,1);
 const p=prep({securityThreads:0,growThreads:6},h);assert.equal(p.growthWaves,1);assert.equal(p.workers,3);
});
test('target quotes expose prep placement and reject unusable fragmented capacity',()=>{
 const f={hackChance:()=>1,hackPercent:()=>.01,weakenTime:()=>20000,growTime:()=>16000,growThreads:s=>s.moneyAvailable<50?30:2};
 const s={hostname:'x',minDifficulty:1,hackDifficulty:2,moneyAvailable:1,moneyMax:100};
 const settings={ram:32,hosts,cycleMs:4000,queueMs:1000,maxBatches:100,weakenPower:.05,padding:1,costs,incomeMultiplier:1,workerLimit:10};
 const q=quoteHackingTarget(s,{},f,settings);assert.ok(q.preparation.growthWaves>1);assert.equal(q.prepMs,q.preparation.durationMs);
 assert.equal(quoteHackingTarget(s,{},f,{...settings,hosts:[{host:'a',ram:1,cores:1}]}),null);
 assert.equal(quoteHackingTarget(s,{},f,{...settings,planningUntil:0}),null);
});
function receipts(){return Array.from({length:3},(_,j)=>{
 const plan=['hack','weak1','grow','weak2'].map((step,i)=>({step,tool:step.startsWith('weak')?'weaken':step,threads:1,deadline:200000+j*5000+i*1000}));
 return plan.map(p=>({owner:7,pid:100+j*4+plan.indexOf(p),at:p.deadline+20,deadline:p.deadline,lateMs:20,target:'x',tool:p.tool,batchVersion:1,batchId:'1:2:7:'+j,batchStep:p.step,batchPlan:plan,pieceThreads:1}));
}).flat();}
test('three clean complete batches can evaluate a sparse 30-second recovery window',()=>{
 const previous={augReset:2,nodeReset:1,baseCycleMs:4000,multiplier:3,latencyFloorMs:24000,cleanWindows:1,windowAt:190000,operations:0,late:0,spacingSamples:0,spacingRisks:0,changedAt:0,at:190000};
 const evidence={at:220000,ownerPid:7,augReset:2,nodeReset:1,counts:{operations:12,deadlineOverruns:0,spacingSamples:12,spacingRisks:0},recent:receipts()};
 assert.equal(adaptiveHgwTiming(previous,evidence,{now:220000}).cycleMs,16000);
 for(const recent of [[],receipts().slice(1),receipts().map(e=>({...e,owner:8})),receipts().map(e=>({...e,error:'failed'}))])assert.equal(adaptiveHgwTiming(previous,{...evidence,recent},{now:220000}).cycleMs,24000);
 assert.equal(adaptiveHgwTiming({...previous,changedAt:210000},evidence,{now:220000}).cycleMs,24000);
 const takeover=adaptiveHgwTiming({...previous,ownerPid:8},evidence,{now:220000});assert.equal(takeover.cycleMs,24000);assert.equal(takeover.cleanWindows,0);assert.equal(takeover.windowAt,220000);assert.equal(takeover.ownerPid,7);
});
test('old-owner receipts cannot inflate a new owner latency floor',()=>{
 const t={at:100000,ownerPid:7,augReset:2,nodeReset:1,counts:{operations:0,deadlineOverruns:0,spacingSamples:0,spacingRisks:0}};
 const p=adaptiveHgwTiming(null,t,{now:100000});
 const recent=[1,2,3].map(pid=>({owner:8,pid,tool:'hack',target:'x',at:129000,deadline:120000,lateMs:9000,legSpacingMs:1000,toleranceMs:250}));
 const r=adaptiveHgwTiming(p,{...t,at:130000,counts:{operations:3,deadlineOverruns:3,spacingSamples:3,spacingRisks:3},recent},{now:130000});assert.equal(r.cycleMs,6000);
});
const sample=(host,rate,start=1000)=>({identity:'scope:'+host,epoch:'e',cashKnown:true,windows:Array.from({length:3},(_,i)=>({start:{at:start+i*30000,money:i*rate*30},end:{at:start+(i+1)*30000,money:(i+1)*rate*30}}))});
const values=(start=1000)=>({a:sample('a',10,start),b:sample('b',20,start),c:sample('c',5,start)});
test('anchor comparison uses retained control, overlapping exact windows and separates income channels',()=>{
 const before=anchorComparisonBaseline(values(),'a','b',['a','c'],91000);assert.equal(before.control.host,'c');
 const request={id:'trial',source:'a',target:'b',phase:'done',at:100000,nodeReset:1,augReset:2,comparison:before};
 const v=values(100001);v.b=sample('b',30,100001);v.c=sample('c',7,100001);
 const r=evaluateAnchorComparison(request,v,['b','c'],190001);assert.equal(r.state,'measured');assert.equal(r.retainedRate,12);assert.equal(r.delta,18);assert.equal(r.totalIncomeKnown,false);assert.equal(r.phishingIncomeKnown,false);
 assert.equal(evaluateAnchorComparison(request,values(),['b','c'],190001).state,'sampling');
 assert.equal(evaluateAnchorComparison(request,v,['b'],190001).state,'inconclusive');
 v.b.epoch='new';assert.equal(evaluateAnchorComparison(request,v,['b','c'],190001).state,'inconclusive');
 assert.equal(evaluateAnchorComparison({...request,comparison:{goal:'exact-cache-cash'}},v,['b','c'],190001),null);
});
test('anchor controls reject missing, stale, reversed and nonoverlapping native evidence',()=>{
 assert.equal(anchorComparisonBaseline(values(),'a','b',['a'],91000),null);
 assert.equal(anchorComparisonBaseline(values(),'a','b',['c'],200001),null);
 const corrupt=values();corrupt.c.windows[1].start.money=-1;assert.equal(anchorComparisonBaseline(corrupt,'a','b',['c'],91000),null);
 const separate=values();separate.c=sample('c',5,91001);assert.equal(anchorComparisonBaseline(separate,'a','b',['c'],181001),null);
 const empty=values();empty.b.windows=[];assert.equal(anchorComparisonBaseline(empty,'a','b',['c'],91000),null);
});
test('manager records a completed comparison once without requesting another native anchor action',async()=>{
 const at=Date.now(),before=anchorComparisonBaseline(values(at-300000),'a','b',['c'],at-210000);
 const request={id:'trial',source:'a',target:'b',phase:'done',at:at-100000,nodeReset:1,augReset:2,comparison:before};
 const files=new Map([[anchorRequestFile,JSON.stringify(request)]]),writes=[];
 const ns={pid:7,read:f=>files.get(f)||'',write:async(f,s)=>{writes.push(f);files.set(f,s);},dnet:{getStasisLinkedServers:()=>['b','c']}};
 await coordinateDarknetAnchors(ns,[],new Map(),{lastNodeReset:1,lastAugReset:2},values(at-95000));
 assert.equal(JSON.parse(files.get(anchorComparisonFile)).state,'measured');assert.deepEqual(writes,[anchorComparisonFile]);
 await coordinateDarknetAnchors(ns,[],new Map(),{lastNodeReset:1,lastAugReset:2},{});assert.deepEqual(writes,[anchorComparisonFile]);
});
