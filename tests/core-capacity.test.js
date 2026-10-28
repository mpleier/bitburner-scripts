import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastCoreBatches} from '../hacking-core-policy.js';
import {quoteHackingTarget} from '../hacking-target-policy.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const host=(host,ram,cores=1)=>({host,ram,maxRam:ram,cores});
const jobs=[{tool:'hack',threads:10,cost:2},{tool:'grow',threads:40,cost:2},{tool:'weak',threads:20,cost:2},{tool:'weak',threads:20,cost:2}];
const plan=(hosts,j=jobs,extra={})=>forecastCoreBatches(hosts,j,{maxBatches:20,workerLimit:100,logGrowth:.03,maxPlanningMs:Infinity,...extra});
test('host-specific complete-batch forecasts benefit from cores without pooling grow legs',()=>{
 const one=plan([host('home',128)]),many=plan([host('home',128,17)]);assert.equal(one.cycles,0);assert.ok(many.cycles>one.cycles);assert.ok(many.remaining[0].ram>=0);
 assert.equal(plan(Array.from({length:10},(_,i)=>host('n'+i,16))).cycles,0);
});
test('failed placements do not consume capacity or claim a partial batch',()=>{
 const r=plan([host('home',100,17)],jobs,{workerLimit:2});assert.equal(r.cycles,0);assert.equal(r.ram,0);assert.equal(r.remaining[0].ram,100);assert.equal(r.workers,0);
});
test('forecasts preserve input snapshots, worker limits and conservative unknown growth',()=>{
 const hosts=[host('home',256,17),host('n',128)],before=structuredClone(hosts),r=plan(hosts,jobs,{workerLimit:4});assert.equal(r.cycles,1);assert.ok(r.workers<=4);assert.deepEqual(hosts,before);
 const unknown=plan(hosts,jobs,{logGrowth:NaN});assert.ok(unknown.ram>=r.ram||unknown.cycles===0);
 assert.equal(plan(hosts,jobs,{workerLimit:NaN}),null);
});
test('bounded forecasting exposes time limits and keeps only completed cycles',()=>{
 let n=0;const r=plan([host('home',4096,17)],jobs,{maxPlanningMs:2,now:()=>n++});assert.equal(r.limited,true);assert.ok(r.cycles<=1);assert.equal(r.workers,r.cycles*4);
});
test('a smaller core-rich host can fit an unsplittable leg when the largest one cannot',()=>{
 const r=plan([host('ordinary',180),host('home',128,17)],[{tool:'grow',threads:100,cost:2}],{maxBatches:1});assert.equal(r.cycles,1);assert.equal(r.workers,1);assert.equal(r.remaining.find(h=>h.host==='ordinary').ram,180);
});
test('target quotes use actual host placement instead of aggregate RAM alone',()=>{
 const server={hostname:'n',moneyMax:1e6,moneyAvailable:1e6,minDifficulty:1,hackDifficulty:1};const formulas={hackChance:()=>1,hackPercent:()=>.01,weakenTime:()=>10000,growTime:()=>8000,growThreads:()=>40};
 const s={ram:128,largestHostRam:128,cycleMs:2000,queueMs:0,maxBatches:4,weakenPower:.005,padding:1,costs:{hack:2,grow:2,weak:2},workerLimit:100,incomeMultiplier:1,fraction:.1,logGrowth:.03};
 assert.equal(quoteHackingTarget(server,{},formulas,{...s,hosts:Array.from({length:8},(_,i)=>host('n'+i,16))}),null);
 const q=quoteHackingTarget(server,{},formulas,{...s,hosts:[host('home',128,17)]});assert.ok(q?.cycles>0);assert.ok(q.residentRam<=128);assert.match(q.model,/host-specific/);
});
test('executed batch sizing skips core simulation on one-core hosts and after the shared deadline',()=>{
 const source=readFileSync(new URL('../daemon.js',import.meta.url),'utf8'),start=source.indexOf('    function getPerformanceSnapshot('),end=source.indexOf('\n    }',start)+6;let calls=0;
 const target={actualPercentageToSteal:()=>.1,timeToWeaken:()=>5000,getHackThreadsNeeded:()=>1,getGrowThreadsNeededAfterTheft:()=>1,getWeakenThreadsNeededAfterTheft:()=>1,getWeakenThreadsNeededAfterGrowth:()=>1,serverGrowthPercentage:()=>1};
 const context={Date:{now:()=>1000},xpOnly:false,loopingMode:false,hackOnly:false,options:{},maxBatches:4,cycleTimingDelay:1000,hackingProcessBudget:{limit:100,used:0},unadjustedGrowthRate:1.03,getTool:()=>({cost:1}),forecastCoreBatches:(_h,_j,o)=>{calls++;assert.equal(o.maxPlanningMs,3);return {cycles:2,limited:false};}};
 vm.runInNewContext(source.slice(start,end)+';globalThis.snapshot=getPerformanceSnapshot;',context);
 const n={hosts:[host('home',1024)],listOfServersFreeRam:[1024],corePlanningUntil:1020};context.snapshot(target,n);assert.equal(calls,0);
 n.hosts[0].cores=17;n.corePlanningUntil=999;context.snapshot(target,n);assert.equal(calls,0);
 n.corePlanningUntil=1020;assert.ok(context.snapshot(target,n).placement);assert.equal(calls,1);assert.match(source,/networkStats\.corePlanningUntil=Date\.now\(\)\+20/);
});
