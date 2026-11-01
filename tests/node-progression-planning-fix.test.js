import test from 'node:test';
import assert from 'node:assert/strict';
import {planBitNodePriority,rankOptionalBitNodes,recordBitNodeRun} from '../bitnode-priority.js';
import {chooseNodeRoute,nodeRouteMilestones,committedRoute,restoreNodeProbe} from '../node-route-selection-policy.js';
import {runCompletionHook,completionHookFile} from '../progression-coordination.js';
const minute=60000,now=100*minute;
test('uncertain hook receipts hold departure without replay; live hooks finish and record completion',async()=>{
 const files=new Map(),ns={read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),isRunning:()=>false},launch=()=>assert.fail('must not replay');
 for(const status of ['claimed','started','uncertain']){
 files.set(completionHookFile,JSON.stringify({nodeReset:1,status,pid:42}));
 assert.equal(await runCompletionHook(ns,1,'hook.js',[],launch,async()=>{}),false);assert.equal(JSON.parse(files.get(completionHookFile)).status,'uncertain');
 }
 files.set(completionHookFile,JSON.stringify({nodeReset:1,status:'started',pid:42}));ns.isRunning=()=>true;
 assert.equal(await runCompletionHook(ns,1,'hook.js',[],launch,async()=>{}),true);assert.equal(JSON.parse(files.get(completionHookFile)).status,'completed');
});
test('optional history rankings preserve unlocks, overrides and confidence requirements',()=>{
 const owned={1:2,2:1,3:3,4:3,5:1,7:3,8:2,9:2,10:1,13:1,15:1};
 const history={runs:[11,11,10,10].map((node,i)=>({node,nodeReset:i+1,at:now-i*1000,durationMs:node===11?100*minute:10*minute,challenge:false}))};
 assert.equal(rankOptionalBitNodes(planBitNodePriority({},1),history,now).nextBn,4);
 const base=planBitNodePriority(owned,11);assert.equal(base.nextBn,11);
 const ranked=rankOptionalBitNodes(base,history,now);assert.equal(ranked.nextBn,10);assert.equal(ranked.historyRanking.used,true);
 assert.equal(rankOptionalBitNodes(planBitNodePriority(owned,11,5),history,now).nextBn,5);
 assert.equal(rankOptionalBitNodes(base,{runs:history.runs.map(r=>({...r,challenge:true}))},now).nextBn,11);
 assert.equal(rankOptionalBitNodes(base,{runs:history.runs.slice(1)},now).nextBn,11);
 const run=history.runs[0];assert.equal(recordBitNodeRun({runs:[run]},run).runs.length,1);
});
test('milestone probes are bounded, disclosed, cooldown-limited and subordinate to explicit routes',()=>{
 const routes={hacking:{actionable:false},bladeburner:{actionable:false}},options={now,node:11,nodeReset:1,augReset:2,availability:{hacking:true,bladeburner:true},milestones:{bladeburner:{name:'Operation readiness',etaMs:minute}}};
 let p=chooseNodeRoute(routes,null,options);assert.equal(p.policy,'milestone-probe');assert.equal(p.selected,'bladeburner');assert.equal(p.probe.until-now,2*minute);
 assert.equal(p.committed,'hacking');assert.equal(committedRoute(p),'hacking');
 const restored=restoreNodeProbe(JSON.stringify({at:now,nodeReset:1,augReset:2,probe:p.probe}),{lastNodeReset:1,lastAugReset:2},now+1000);
 assert.equal(restored.committed,'hacking');
 assert.equal(committedRoute({...p,probe:restored}),'hacking');
 for(let i=1;i<6;i++){p=chooseNodeRoute(routes,p,{...options,now:now+i*30000});if(p.policy==='milestone-probe')assert.equal(p.committed,'hacking');}
 assert.equal(p.selected,'hacking');assert.equal(p.probe.status,'cooldown');
 assert.equal(committedRoute(p),'hacking');
 assert.equal(committedRoute({selected:'bladeburner'}),'bladeburner');
 assert.equal(chooseNodeRoute(routes,null,{...options,override:'wd'}).selected,'hacking');
 assert.equal(chooseNodeRoute(routes,null,{...options,adaptive:false}).selected,'hacking');
 assert.equal(chooseNodeRoute(routes,null,{...options,availability:{hacking:true,bladeburner:false}}).selected,'hacking');
 assert.equal(chooseNodeRoute({...routes,hacking:{actionable:true,etaMs:minute}},null,options).selected,'hacking');
 assert.equal(chooseNodeRoute(routes,null,{...options,milestones:{bladeburner:{name:'unknown',etaMs:Infinity}}}).selected,'hacking');
});
test('partial milestones do not invent a forecast for chance or stamina blockers',()=>{
 assert.deepEqual(nodeRouteMilestones({}, {nextBlackOp:{name:'op',rankEtaMs:minute,chanceEtaMs:null}}),{});
 assert.deepEqual(nodeRouteMilestones({}, {nextBlackOp:{name:'op',rankEtaMs:minute,chanceEtaMs:0,staminaBlocked:true}}),{});
 assert.equal(nodeRouteMilestones({}, {nextBlackOp:{name:'op',rankEtaMs:minute,chanceEtaMs:0}}).bladeburner.etaMs,minute);
});

test('restricted and overridden runs never become normal completion-cost samples',async()=>{
 const {restrictedBitNodeRun}=await import('../bitnode-priority.js');
 assert.equal(restrictedBitNodeRun({bitNodeOptions:{sourceFileOverrides:new Map(),intelligenceOverride:undefined,disableGang:false}},null),false);
 for(const bitNodeOptions of [{disableGang:true},{intelligenceOverride:10},{sourceFileOverrides:new Map([[4,3]])},{sourceFileOverrides:{4:3}}])assert.equal(restrictedBitNodeRun({bitNodeOptions},null),true);
 assert.equal(restrictedBitNodeRun({}, {active:true}),true);
});
