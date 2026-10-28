import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {quoteHackingTarget} from '../hacking-target-policy.js';
import {validateCommand,renderCommandJob} from '../remote-api-command.js';
import {readAutomationPerformance} from '../performance-status-policy.js';
const server={hostname:'x',moneyMax:1e6,moneyAvailable:1e6,minDifficulty:2,hackDifficulty:2};
const formulas={hackPercent:()=>.01,hackChance:()=>.9,weakenTime:()=>20000,growTime:()=>16000,growThreads:(s,p,m)=>Math.log(m/Math.max(1,s.moneyAvailable))/Math.log(1.02)};
const settings={ram:4096,largestHostRam:4096,cycleMs:4000,queueMs:1000,maxBatches:100,weakenPower:.05,padding:1,costs:{hack:1.7,grow:1.75,weak:1.75},incomeMultiplier:1,workerLimit:2048,fraction:.0625,now:()=>1000,planningUntil:1020};

test('bounded fraction search compares native returns without exceeding the steal cap or mutating targets',()=>{
 const before=JSON.stringify(server),baseline=quoteHackingTarget(server,{},formulas,settings);
 const best=quoteHackingTarget(server,{},formulas,{...settings,optimizeFractions:true,maxFraction:.4});
 assert.ok(best.projectedRate>=baseline.projectedRate);assert.ok(best.fraction<=.4);assert.ok(best.fractionsTested>1&&best.fractionsTested<=5);assert.equal(JSON.stringify(server),before);
 assert.equal(quoteHackingTarget(server,{},{...formulas,hackPercent:()=>.05},{...settings,optimizeFractions:true,maxFraction:.04}),null);
 assert.equal(quoteHackingTarget(server,{},formulas,{...settings,planningUntil:999,optimizeFractions:true}),null);
});
test('fraction comparisons obey the existing planning deadline',()=>{
 let now=1000,calls=0;
 const result=quoteHackingTarget(server,{}, {...formulas,growThreads:(...args)=>{calls++;now+=3;return formulas.growThreads(...args);}}, {...settings,optimizeFractions:true,now:()=>now});
 assert.ok(calls<=1);assert.ok(result===null||result.fractionsTested<=1);
});
test('the real scheduler seeds only fresh owned target quotes below its configured maximum',()=>{
 const s=readFileSync(new URL('../daemon.js',import.meta.url),'utf8'),start=s.indexOf('    function optimizePerformanceMetrics('),end=s.indexOf('        const maxAdjustments',start);
 const body=s.slice(start,end).replace('function optimizePerformanceMetrics','function seed')+'return currentTarget.percentageToSteal;}return seed;';
 const now=Date.now(),plan={at:now,ownerPid:7,nodeReset:1,augReset:2,enforced:true,preferred:'x',quotes:[{name:'x',fraction:.5}]};
 const seed=p=>Function('targetPaybackPlan','resetInfo','options',body)(p,{lastNodeReset:1,lastAugReset:2},{'max-steal-percentage':.75})({pid:7},{name:'x',percentageToSteal:.0625});
 assert.equal(seed(plan),.5);
 for(const patch of [{at:now-20000},{ownerPid:8},{augReset:3},{enforced:false},{preferred:'other'},{quotes:[{name:'x',fraction:.9}]}])assert.equal(seed({...plan,...patch}),.0625);
});

test('focused performance commands reject arbitrary sections and extra arguments',()=>{
 const command=args=>({id:'test',method:'automation.performance',args,expiresAt:Date.now()+60000});
 for(const section of ['hacking','progression','managers'])assert.doesNotThrow(()=>validateCommand(command([section])));
 for(const args of [[],['tasks/private.json'],['hacking','extra'],[null]])assert.throws(()=>validateCommand(command(args)));
});
test('the generated performance worker returns focused data without reading large unrelated status files',async()=>{
 const now=Date.now(),record={at:now,ownerPid:7,nodeReset:1,augReset:2,timing:{sleepLagMs:123}},reads=[];let response;
 const command={id:'performance-test',method:'automation.performance',args:['hacking'],expiresAt:now+60000};
 const job=await import('data:text/javascript;base64,'+Buffer.from(renderCommandJob(command)).toString('base64'));
 await job.main({args:['[]','out','id'],pid:9,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),ps:()=>[{pid:7,filename:'daemon.js'}],read:f=>{reads.push(f);return JSON.stringify(record);},write:async(f,s)=>response=JSON.parse(s)});
 assert.equal(response.state,'completed');assert.equal(response.result.budget.state,'live');assert.equal(response.result.budget.data.timing.sleepLagMs,123);
 assert.deepEqual(reads,['tasks/hgw-process-budget.json','tasks/hacking-target-plan.json']);assert.equal(response.result._diagnostics.truncated,false);
 const stale=readAutomationPerformance({getResetInfo:()=>({lastNodeReset:1,lastAugReset:3}),ps:()=>[{pid:7,filename:'daemon.js'}],read:()=>JSON.stringify(record)},'hacking',now);assert.equal(stale.budget.state,'stale');
});

function inviteFixture({installed=false,invited=false,joined=false,unknown=false}={}){
 const source=readFileSync(new URL('../work-for-factions.js',import.meta.url),'utf8'),start=source.indexOf('export async function factionInviteBackdoorReady('),end=source.indexOf('\n/** @param {NS} ns */',source.indexOf('export async function waitForFactionInvite(',start));
 let queries=0,sleeps=0,joins=0;
 const functions=Function('requiredBackdoorByFaction','getNsDataThroughFile','checkFactionInvites','getPlayerInfo','formatDuration','tryJoinFaction','log','loopSleepInterval','waitForFactionInviteTime',source.slice(start,end).replaceAll('export async function','async function')+'return {factionInviteBackdoorReady,waitForFactionInvite};')(
  {'Fulcrum Secret Technologies':'fulcrumassets'},async()=>{queries++;if(unknown)throw Error('unavailable');return installed;},async()=>invited||sleeps?['Fulcrum Secret Technologies']:[],async()=>({factions:joined?['Fulcrum Secret Technologies']:[]}),String,async()=>{joins++;return true;},()=>{},1000,30000);
 const ns={print(){},sleep:async()=>{sleeps++;}};
 return {functions,ns,counts:()=>({queries,sleeps,joins})};
}
test('missing and unknown native backdoors skip the invitation wait',async()=>{
 for(const options of [{},{unknown:true}]){const f=inviteFixture(options);assert.equal(await f.functions.waitForFactionInvite(f.ns,'Fulcrum Secret Technologies'),false);assert.equal(f.counts().sleeps,0);assert.equal(f.counts().queries,1);}
});
test('already invited/joined factions and factions without a prerequisite bypass the native backdoor query',async()=>{
 for(const options of [{invited:true},{joined:true}]){const f=inviteFixture(options);assert.equal(await f.functions.waitForFactionInvite(f.ns,'Fulcrum Secret Technologies'),true);assert.equal(f.counts().queries,0);assert.equal(f.counts().sleeps,0);}
 const f=inviteFixture();assert.equal(await f.functions.factionInviteBackdoorReady(f.ns,'Other'),true);assert.equal(f.counts().queries,0);
});
test('confirmed backdoors retain normal delayed invitation handling',async()=>{
 const f=inviteFixture({installed:true});assert.equal(await f.functions.waitForFactionInvite(f.ns,'Fulcrum Secret Technologies'),true);assert.deepEqual(f.counts(),{queries:1,sleeps:1,joins:1});
});
