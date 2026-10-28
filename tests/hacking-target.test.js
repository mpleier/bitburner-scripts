import {estimateHackingDrain,hackingDrainPadding} from '../hacking-deadline-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {selectHackingTargetCandidates,quoteHackingTarget,targetSwitchEconomics,planHackingTargets,sampleHackingRevenue,hackingPlanningHorizon} from '../hacking-target-policy.js';
const reset={lastNodeReset:1,lastAugReset:2};
const formulas={hackPercent:()=>.01,hackChance:()=>.9,weakenTime:s=>20000*s.hackDifficulty/s.minDifficulty,growTime:s=>16000*s.hackDifficulty/s.minDifficulty,growThreads:(s,p,m)=>Math.log(m/Math.max(1,s.moneyAvailable))/Math.log(1.02)};
const server={hostname:'current',moneyMax:1e6,moneyAvailable:1e6,minDifficulty:2,hackDifficulty:2};
const settings={ram:4096,largestHostRam:4096,cycleMs:4000,queueMs:1000,maxBatches:100,weakenPower:.05,padding:1,costs:{hack:1.7,grow:1.75,weak:1.75},incomeMultiplier:1,workerLimit:2048,fraction:.0625};
const q=(name,rate,prepMs=0)=>({name,projectedRate:rate,prepMs,weakMs:20000,firstReceiptMs:21000,ready:prepMs===0});

test('quotes model current fraction, batch capacity, pacing, chance and native preparation',()=>{
 const before=JSON.stringify(server),a=quoteHackingTarget(server,{},formulas,settings);assert.ok(a.projectedRate>0);assert.equal(a.fraction,.06);assert.equal(a.cycles,4);assert.equal(a.prepMs,0);assert.equal(JSON.stringify(server),before);
 const dirty=quoteHackingTarget({...server,hackDifficulty:4,moneyAvailable:1e4},{},formulas,settings);assert.ok(dirty.prepMs>0);assert.ok(dirty.prepRamSeconds>0);assert.equal(dirty.ready,false);
 const slow=quoteHackingTarget(server,{},formulas,{...settings,cycleMs:12000});assert.ok(slow.projectedRate<a.projectedRate);assert.equal(slow.cycles,1);
 assert.ok(quoteHackingTarget(server,{},formulas,{...settings,incomeMultiplier:.5}).projectedRate<a.projectedRate);
});
test('invalid native formulas and insufficient RAM never produce a switch quote',()=>{
 for(const change of [{ram:0},{largestHostRam:0},{incomeMultiplier:0},{workerLimit:3},{ram:1}])assert.equal(quoteHackingTarget(server,{},formulas,{...settings,...change}),null);
 for(const change of [{hackPercent:()=>1},{hackChance:()=>NaN},{growThreads:()=>Infinity},{weakenTime:()=>{throw Error('locked');}}])assert.equal(quoteHackingTarget(server,{},{...formulas,...change},settings),null);
});
test('switch payback includes preparation, drain, startup and full lost incumbent income',()=>{
 const result=targetSwitchEconomics(q('old',100),q('new',200,30000),1800000);assert.equal(result.overheadMs,71000);assert.equal(result.lostIncome,7100);assert.equal(result.paybackMs,142000);assert.equal(result.eligible,true);
 assert.equal(targetSwitchEconomics(q('old',100),q('new',110),1800000).eligible,false);assert.equal(targetSwitchEconomics(q('old',100),q('new',200,900000),1800000).eligible,false);assert.equal(targetSwitchEconomics(q('old',100),q('new',90),1800000).eligible,false);assert.equal(targetSwitchEconomics(q('old',100),q('new',200),60000).eligible,false);
});
function plan(previous,now,extra={}){return planHackingTargets(previous,{now,ownerPid:7,reset,current:'old',candidates:[q('old',100),q('new',200)],...extra});}
test('candidate must persist sixty seconds, and switch cooldown prevents churn',()=>{
 let p=plan(null,1000000);assert.equal(p.preferred,'old');for(let i=1;i<=12;i++)p=plan(p,1000000+i*5000);assert.equal(p.preferred,'new');assert.equal(p.decision,'switch');assert.equal(p.lastSwitchAt,1060000);
 p=plan(p,1065000,{candidates:[q('new',200),q('third',1000)]});assert.equal(p.preferred,'new');assert.match(p.reason,/cooldown/);
});
test('owner/reset changes, stale planning and unsupported modes cannot reuse confirmation',()=>{
 let p=plan(null,1000000);for(let i=1;i<12;i++)p=plan(p,1000000+i*5000);
 for(const extra of [{ownerPid:8},{reset:{...reset,lastAugReset:3}},{enabled:false}]){const next=plan(p,1060000,extra);assert.equal(next.decision==='switch',false);}
 assert.equal(plan(p,1080000).decision,'hold');assert.equal(plan(p,1060000,{enabled:false}).enforced,false);assert.equal(plan(null,1000000,{candidates:[]}).enforced,false);
});
test('observed revenue uses only current-owner receipts and bounded continuous windows',()=>{
 const telemetry=(at,money,count)=>({at,ownerPid:7,nodeReset:1,augReset:2,blocked:false,income:{own:{owner:7,target:'x',money,completions:count},other:{owner:8,target:'x',money:1e12,completions:999}}});
 let s=sampleHackingRevenue(null,telemetry(1000000,1000,1),7,reset,1000000);for(let i=1;i<=12;i++)s=sampleHackingRevenue(s,telemetry(1000000+i*5000,1000+i*100,1+i),7,reset,1000000+i*5000);
 assert.equal(s.state,'measured');assert.equal(s.observedRate,20);assert.equal(s.receipts,12);assert.equal(s.seconds,60);
 assert.equal(sampleHackingRevenue(s,telemetry(1080000,3000,15),7,reset,1080000).state,'sampling');assert.equal(sampleHackingRevenue(s,telemetry(1065000,1,1),7,reset,1065000).state,'sampling');assert.equal(sampleHackingRevenue(s,{...telemetry(1065000,3000,15),blocked:true},7,reset,1065000).state,'waiting');
 assert.equal(sampleHackingRevenue(s,telemetry(1065000,3000,15),8,reset,1065000).state,'waiting');
 for(let i=13;i<=61;i++)s=sampleHackingRevenue(s,telemetry(1000000+i*5000,1000+i*100,1+i),7,reset,1000000+i*5000);assert.equal(s.state,'sampling');
});
test('actual daemon refresh promotes a confirmed profitable target without kill or purchase APIs',()=>{
 const source=readFileSync(new URL('../daemon.js',import.meta.url),'utf8'),start=source.indexOf('    function refreshHackingTargetPlan('),end=source.indexOf('    /** @param {number} homeRam',start);let time=1000000;const files={};
 const make=(name,max,active)=>({name,server:{...server,moneyMax:max,hostname:name},percentageToSteal:.0625,_isTargeting:active,shouldHack:()=>true,canHack:()=>true,hasRoot:()=>true,isPrepped:()=>true,getMaxMoney:()=>max,getMinSecurity:()=>2,getSecurity:()=>2,getMoney:()=>max,totalRam:()=>4096});
 const old=make('old',1e6,true),next=make('new',1e7,false),ns={pid:7,formulas:{hacking:formulas},read:f=>files[f]||'',write:(f,s)=>{files[f]=s;},print(){}};
 const ctx=vm.createContext({selectHackingTargetCandidates,estimateHackingDrain,hackingDrainPadding,quoteHackingTarget,planHackingTargets,sampleHackingRevenue,hackingPlanningHorizon,Date:{now:()=>time},targetPaybackPlan:null,lastTargetPlanAt:0,revenueObservation:null,hasFormulas:true,xpOnly:false,hackOnly:false,stockFocus:false,options:{},loopingMode:false,maxTargets:1,timingControl:{targetCap:1},lastHackingInventory:{complete:true,allocations:{old:{ram:2048}}},hackingProcessBudget:{ready:true,limit:2048},lastProcessInventoryAt:time,getNetworkStats:()=>({totalFreeRam:2048,totalUsedRam:2048,listOfServersFreeRam:[2048]}),getAllServers:()=>[old,next],cycleTimingDelay:4000,queueDelay:1000,maxBatches:100,actualWeakenPotency:()=>.05,recoveryThreadPadding:1,getTool:t=>({cost:t==='hack'?1.7:1.75}),bitNodeMults:{ScriptHackMoneyGain:1},_cachedPlayerInfo:{},resetInfo:reset});
 vm.runInContext(source.slice(start,end)+';run=refreshHackingTargetPlan;',ctx);
 for(let i=0;i<=12;i++){time=1000000+i*5000;ctx.lastProcessInventoryAt=time;const order=ctx.run(ns,[old,next]);assert.equal(order[0].name,i===12?'new':'old');}
 const record=JSON.parse(files['tasks/hacking-target-plan.json']);assert.equal(record.decision,'switch');assert.equal(record.preferred,'new');
 files['tasks/hgw-misfires.json']=JSON.stringify({at:time+5000,ownerPid:7,nodeReset:1,augReset:2,blocked:false,recent:Array.from({length:5},(_,i)=>({owner:7,pid:100+i,tool:'hack',batchVersion:1,batchId:'1:2:7:'+i,at:time+i*400,deadline:time+i*400-1200,lateMs:1200}))});
 time+=5000;ctx.lastProcessInventoryAt=time;ctx.run(ns,[old,next]);const padded=JSON.parse(files['tasks/hacking-target-plan.json']);assert.equal(padded.drainPadding.paddingMs,1450);assert.equal(padded.drainPadding.basis,'observed-batch-delays');assert.equal(padded.quotes[0].drain.paddingMs,1450);
 ctx.xpOnly=true;time+=5000;assert.equal(ctx.run(ns,[old,next])[0].name,'old');assert.equal(JSON.parse(files['tasks/hacking-target-plan.json']).enforced,false);ctx.xpOnly=false;ctx.hasFormulas=false;time+=5000;ctx.run(ns,[old,next]);assert.match(JSON.parse(files['tasks/hacking-target-plan.json']).reason,/Formulas/);
 assert.match(source,/targetPaybackPlan\?\.enforced && server.name !== targetPaybackPlan.preferred/);assert.match(source,/!targetPaybackPlan\?\.enforced/);
});

test('pending installs and fresh route deadlines shorten investment horizons without trusting stale owners',()=>{
 const now=1000000,install={pending:true,ownerPid:9,expiresAt:now+120000,augReset:2},route={at:now,ownerPid:9,augReset:2,nodeReset:1,selected:'hacking',routes:{hacking:{lowerMs:300000}}};
 const input={now,reset,isRunning:p=>p===9};assert.equal(hackingPlanningHorizon({...input,install}).horizonMs,1);assert.equal(hackingPlanningHorizon({...input,route}).horizonMs,300000);assert.equal(hackingPlanningHorizon({...input,route:{...route,routes:{hacking:{lowerMs:0}}}}).horizonMs,1);
 for(const change of [{pending:false},{expiresAt:now-1},{ownerPid:8},{augReset:3},{augReset:undefined}])assert.equal(hackingPlanningHorizon({...input,install:{...install,...change}}).horizonMs,1800000);
 for(const change of [{at:now+1},{at:now-45001},{ownerPid:8},{augReset:3}])assert.equal(hackingPlanningHorizon({...input,route:{...route,...change}}).horizonMs,1800000);
});
