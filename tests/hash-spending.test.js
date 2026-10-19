import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fundHashCashGoal,hashSpendingDecision,spendHashesWithPolicy,hasBladeburnerHashWorker,collectHashSpendingStatus} from '../hash-spending-policy.js';
import {hashCapacityChoice} from '../hacknet-policy.js';
import {routeHashBudget} from '../progression-improvements-policy.js';
import {renderCommandJob} from '../remote-api-command.js';
const rank='Exchange for Bladeburner Rank',sp='Exchange for Bladeburner SP',cash='Sell for Money';
function fixture(extra={}){
 const now=Date.now(),files={},writes=[],calls=[];
 const state={hashes:20000,capacity:40000,money:1e12,rank:3000,points:0,costs:{[rank]:250,[sp]:13000,[cash]:4,'Improve Gym Training':50,'Improve Studying':50,'Generate Coding Contract':25,'Increase Maximum Money':50,'Reduce Minimum Security':50,'Sell for Corporation Funds':100,'Exchange for Corporation Research':200},...extra};
 const reset={lastAugReset:1,lastNodeReset:1},route={at:now,nodeReset:1,augReset:1,ownerPid:1,selected:'bladeburner',routes:{bladeburner:{etaMs:null}},development:{nextBlackOp:{rankGap:0}}};
 files['tasks/node-route-plan.json']=JSON.stringify(route);
 files['tasks/hash-bladeburner-state.json']=JSON.stringify({at:now,nodeReset:1,augReset:1,ownerPid:2,rank:state.rank});
 const processes=[{pid:1,filename:'autopilot.js',args:[]},{pid:2,filename:'test.js',args:[]}];
 const ns={pid:2,args:[],getResetInfo:()=>reset,read:f=>files[f]||'',write:(f,v)=>{files[f]=v;writes.push(f);},getPlayer:()=>({money:state.money}),
 ps:h=>h==='home'?processes:[],scan:()=>[],ls:()=>[],getScriptRam:()=>2,getServer:()=>({moneyMax:1e9,minDifficulty:2,hackDifficulty:2,moneyAvailable:1e9}),weakenAnalyze:()=>.05,
 formulas:{hacking:{hackPercent:s=>.001*(100-s.hackDifficulty)/100,hackChance:()=>1,weakenTime:s=>10000+s.hackDifficulty*1000,growThreads:(s,p,target)=>Math.log(target/Math.max(1,s.moneyAvailable))/Math.log(1+.03/s.hackDifficulty)}},
 hacknet:{numHashes:()=>state.hashes,hashCapacity:()=>state.capacity,hashCost:(a,q=1)=>state.costs[a]*q,getStudyMult:()=>1,getTrainingMult:()=>1,
 spendHashes:(a,target,q=1)=>{calls.push([a,target,q]);const cost=state.costs[a]*q;if(cost>state.hashes)return false;state.hashes-=cost;if(a===cash)state.money+=1000000*q;
 if(a===rank){state.rank+=100*q;state.points+=(state.rank>(state.maximumRank??0)?33:0)*q;state.costs[rank]+=250*q;}return true;}},
 bladeburner:{inBladeburner:()=>true,getRank:()=>state.rank,getSkillPoints:()=>state.points}};
 const observeRank=()=>({rank:state.rank,points:state.points});
 return {ns,state,files,calls,writes,route,processes,observeRank};
}
test('rank-yield observation is bounded, measured and preferred on actual cheaper SP returns',()=>{
 const f=fixture();let d=hashSpendingDecision(f.ns,rank,{ownerPid:2});assert.equal(d.preferred,rank);assert.equal(d.probe,true);
 const receipt=spendHashesWithPolicy(f.ns,rank,undefined,1,{ownerPid:2,observeRank:f.observeRank},hashSpendingDecision);assert.equal(receipt.success,true);assert.equal(receipt.spent,250);
 const history=JSON.parse(f.files['tasks/hash-rank-history.json']);assert.equal(history.observedSpGain,33);assert.equal(history.knownMax,true);
 d=hashSpendingDecision(f.ns,sp,{observeRank:f.observeRank});assert.equal(d.preferred,rank);assert.equal(d.rankSpGain,33);assert.equal(d.rankHashCost,500);
});
test('rank below a known previous maximum is not credited fictitious SP',()=>{
 const f=fixture();f.files['tasks/hash-rank-history.json']=JSON.stringify({nodeReset:1,augReset:1,knownMax:true,maxRank:10000,probed:true});
 const d=hashSpendingDecision(f.ns,sp);assert.equal(d.rankSpGain,0);assert.equal(d.preferred,sp);
});
test('failed high-water observations cannot trigger repeated speculative probes',()=>{
 const f=fixture({maximumRank:10000});assert.equal(spendHashesWithPolicy(f.ns,rank,undefined,1,{observeRank:f.observeRank},hashSpendingDecision).success,true);
 const history=JSON.parse(f.files['tasks/hash-rank-history.json']);assert.equal(history.observedSpGain,0);assert.equal(history.knownMax,false);
 assert.equal(hashSpendingDecision(f.ns,sp).preferred,sp);
});
test('unknown rank yield does not justify a large speculative purchase',()=>{
 const f=fixture();f.state.costs[rank]=10000;assert.equal(hashSpendingDecision(f.ns,sp).preferred,sp);
});
test('all consumers preserve a route reserve without requiring an existing priority worker',()=>{
 const f=fixture({hashes:1000});const d=hashSpendingDecision(f.ns,'Improve Studying',{trainingSeconds:900});assert.equal(d.budget,750);
 f.state.hashes=250;assert.equal(hashSpendingDecision(f.ns,'Improve Studying',{trainingSeconds:900}).allowed,false);
 assert.equal(hashSpendingDecision(f.ns,cash).allowed,false);
});
test('capacity is expanded for a useful unreachable purchase, never just for cash overflow',()=>{
 const f=fixture({capacity:100,hashes:100});assert.equal(hashSpendingDecision(f.ns,'__capacity__').allowed,true);
 f.route.selected='hacking';f.files['tasks/node-route-plan.json']=JSON.stringify(f.route);assert.equal(hashSpendingDecision(f.ns,'__capacity__').allowed,false);
});
test('missing rank prices cannot authorize unbounded cache expansion',()=>{
 const f=fixture({capacity:100});f.state.costs[rank]=Infinity;f.state.costs[sp]=Infinity;
 assert.equal(hashSpendingDecision(f.ns,'__capacity__').allowed,false);
});
test('low bootstrap cash and reachable augmentation goals take cash priority',()=>{
 const f=fixture({money:200000});assert.equal(hashSpendingDecision(f.ns,cash).preferred,cash);assert.equal(hashSpendingDecision(f.ns,rank).preferred,cash);
 f.state.money=1e9;f.files['tasks/spending-plan.json']=JSON.stringify({reset:1,epoch:Date.now(),expiresAt:Date.now()+10000,ownerPid:1,signals:{augmentationCashTarget:{name:'Useful',cost:2e9}}});
 assert.equal(hashSpendingDecision(f.ns,cash).preferred,cash);
});
test('stale, dead-owner and wrong-reset routes do not reserve hashes',()=>{
 for(const patch of [{at:Date.now()-60000},{ownerPid:99},{augReset:2},{nodeReset:2}]){
  const f=fixture();f.files['tasks/node-route-plan.json']=JSON.stringify({...f.route,...patch});assert.equal(hashSpendingDecision(f.ns,cash).preferred,null);
 }
});
test('pause, maintenance and achievement restrictions prevent every native purchase',()=>{
 for(const file of ['remote-control/paused/test.js.txt','tasks/automation-maintenance.json','tasks/achievement-profile.json','tasks/achievement-goals.json']){
  const f=fixture();f.files[file]=file.endsWith('.txt')?'true':JSON.stringify({ownerPid:1,expiresAt:Date.now()+10000,nodeReset:1,active:true,deniedActions:['hashSpending']});
  assert.equal(spendHashesWithPolicy(f.ns,rank,undefined,1,{ownerPid:2,script:'test.js'},hashSpendingDecision).success,false);assert.deepEqual(f.calls,[]);
 }
 const f=fixture();assert.equal(spendHashesWithPolicy(f.ns,rank,undefined,1,{ownerPid:99},hashSpendingDecision).success,false);
});
test('cash-specific achievement restrictions preserve noncash spending',()=>{
 const f=fixture();f.files['tasks/achievement-goals.json']=JSON.stringify({nodeReset:1,ownerPid:1,expiresAt:Date.now()+10000,deniedActions:['hacknetMoney']});
 assert.equal(hashSpendingDecision(f.ns,cash).allowed,false);assert.equal(hashSpendingDecision(f.ns,rank).allowed,true);
});
test('batched purchases recheck total cost and cannot overrun a reserve',()=>{
 const f=fixture({hashes:255});assert.equal(spendHashesWithPolicy(f.ns,cash,undefined,2,{},hashSpendingDecision).success,false);assert.deepEqual(f.calls,[]);
 assert.equal(spendHashesWithPolicy(f.ns,cash,undefined,1,{observeRank:f.observeRank},hashSpendingDecision).success,true);
 assert.equal(f.state.hashes,251);
 for(const quantity of [0,-1,1.5,NaN,Infinity])assert.equal(spendHashesWithPolicy(f.ns,cash,undefined,quantity,{},hashSpendingDecision).success,false);
});
test('training improvements require sufficient remaining work and a bounded cash opportunity cost',()=>{
 const f=fixture();assert.equal(hashSpendingDecision(f.ns,'Improve Gym Training',{trainingSeconds:900}).allowed,true);
 assert.equal(hashSpendingDecision(f.ns,'Improve Gym Training',{trainingSeconds:30}).allowed,false);
 f.state.money=1e6;assert.equal(hashSpendingDecision(f.ns,'Improve Studying',{trainingSeconds:900}).allowed,false);
});
test('automatic corporate spending requires a useful near-term milestone',()=>{
 const f=fixture();assert.equal(hashSpendingDecision(f.ns,'Sell for Corporation Funds').allowed,false);
 assert.equal(hashSpendingDecision(f.ns,'Sell for Corporation Funds',{corporationUseful:true}).allowed,true);
});
test('contract generation respects verified solvers and unresolved backlog',()=>{
 const f=fixture();assert.equal(hashSpendingDecision(f.ns,'Generate Coding Contract').allowed,false);
 f.files['tasks/contract-validation.json']=JSON.stringify({types:{Known:{state:'passed'}}});
 assert.equal(hashSpendingDecision(f.ns,'Generate Coding Contract').allowed,true);
 f.ns.ls=()=>['pending.cct'];assert.equal(hashSpendingDecision(f.ns,'Generate Coding Contract').allowed,false);
});
test('server boosts require fresh analysis, assigned income RAM and a short payback',()=>{
 const f=fixture();assert.equal(hashSpendingDecision(f.ns,'Increase Maximum Money',{target:'n00dles'}).allowed,false);
 f.processes.push({pid:3,filename:'daemon.js',args:[]},{pid:4,filename:'Remote/hack-target.js',args:['n00dles',0,0,'test',false,false,false,3],threads:100});
 f.files['/Temp/analyze-hack.txt']=JSON.stringify([{hostname:'n00dles',gainRate:1e9}]);
 f.files['/Temp/analyze-hack-meta.txt']=JSON.stringify({at:Date.now(),augReset:1,nodeReset:1});
 assert.equal(hashSpendingDecision(f.ns,'Increase Maximum Money',{target:'n00dles'}).allowed,true);
 f.processes[2].args=['--xp-only'];assert.equal(hashSpendingDecision(f.ns,'Increase Maximum Money',{target:'n00dles'}).allowed,false);
});
test('automatic investments stop when an augmentation reset is imminent, explicit manual overrides remain available',()=>{
 const f=fixture();f.files['tasks/augmentation-reset-plan.json']=JSON.stringify({pending:true,ownerPid:1,expiresAt:Date.now()+10000});
 assert.equal(hashSpendingDecision(f.ns,'Improve Gym Training',{trainingSeconds:900}).allowed,false);
 assert.equal(hashSpendingDecision(f.ns,'Improve Gym Training',{automatic:false}).allowed,true);
});
test('capacity selection compares capacity per dollar and honors the cash limit',()=>{
 const api={numNodes:()=>2,maxNumNodes:()=>2,getPurchaseNodeCost:()=>Infinity,getCacheUpgradeCost:i=>i?100:10,getNodeStats:i=>({hashCapacity:i?4096:64})};
 assert.deepEqual(hashCapacityChoice(api),{kind:'cache',index:1,cost:100});assert.deepEqual(hashCapacityChoice(api,20),{kind:'cache',index:0,cost:10});assert.equal(hashCapacityChoice(api,9),null);
});
test('Bladeburner startup distinguishes cash/server workers from required rank/SP capabilities',()=>{
 assert.equal(hasBladeburnerHashWorker([{filename:'spend-hacknet-hashes.js',args:['--spend-on','Sell_for_Money']}]),false);
 assert.equal(hasBladeburnerHashWorker([{filename:'/spend-hacknet-hashes.js',args:['--spend-on','Exchange_for_Bladeburner_Rank','--spend-on','Exchange_for_Bladeburner_SP']}]),true);
});
test('legacy public route reserve can account for observed rank-derived skill points',()=>{
 const d={route:{selected:'bladeburner',development:{nextBlackOp:{rankGap:0}}},priorityActive:true,costs:{[rank]:500,[sp]:13000},rankSpGain:33,hashes:1000,capacity:2000};
 assert.equal(routeHashBudget(rank,d),1000);assert.equal(routeHashBudget(sp,d),500);
});
test('serialized native policy helpers remain self-contained',()=>{
 const f=fixture();const decide=new Function('return ('+hashSpendingDecision.toString()+')')();
 const spend=new Function('return ('+spendHashesWithPolicy.toString()+')')();
 assert.equal(spend(f.ns,rank,undefined,1,{observeRank:f.observeRank},decide).success,true);
});
test('all hash mutations pass through the common native guard and telemetry job compiles',()=>{
 for(const file of ['sleeve.js','work-for-factions.js','corporation-manager.js','daemon.js','spend-hacknet-hashes.js']){
  const text=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.match(text,/spendHashesWithPolicy/);assert.doesNotMatch(text,/ns\.hacknet\.spendHashes\(/);
 }
 const code=renderCommandJob({id:'test',method:'automation.status',args:[],expiresAt:Date.now()+10000});
 assert.doesNotThrow(()=>new Function(code.replace('export async function','async function')));
 const worker=readFileSync(new URL('../spend-hacknet-hashes.js',import.meta.url),'utf8');assert.match(worker,/requestedCost > capacity/);
 const bb=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');assert.match(bb,/nextHashWorkerCheck=Date.now\(\)\+60000/);
});

test('shared decisions remain usable without direct Bladeburner API access',()=>{
 const f=fixture();delete f.ns.bladeburner;
 assert.equal(hashSpendingDecision(f.ns,cash).preferred,rank);
 const source=hashSpendingDecision.toString()+spendHashesWithPolicy.toString();assert.doesNotMatch(source,/ns\.bladeburner/);
});
test('all completed BlackOps stop automatic rank and SP spending',()=>{
 const f=fixture();f.route.routes.bladeburner.etaMs=0;f.files['tasks/node-route-plan.json']=JSON.stringify(f.route);
 assert.equal(hashSpendingDecision(f.ns,rank).allowed,false);assert.equal(hashSpendingDecision(f.ns,sp).allowed,false);
 assert.equal(hashSpendingDecision(f.ns,cash).allowed,true);
});
test('rank purchase receipts expose the measured yield',()=>{
 const f=fixture(),r=spendHashesWithPolicy(f.ns,rank,undefined,1,{observeRank:f.observeRank},hashSpendingDecision);
 assert.equal(r.observedSpGain,33);assert.equal(r.observedRankGain,100);
});
test('hash diagnostics exclude dead owners, old resets, malformed and stale records',()=>{
 const f=fixture(),now=Date.now();
 for(const [name,patch]of [['live',{}],['dead',{pid:999}],['old',{at:now-130000}],['wrong',{augReset:2}]])f.files['tasks/hash-worker-status-'+name+'.json']=JSON.stringify({at:now,pid:2,nodeReset:1,augReset:1,...patch});
 f.ns.ls=()=>Object.keys(f.files).filter(x=>x.startsWith('tasks/hash-worker-status-'));
 assert.equal(collectHashSpendingStatus(f.ns,now).length,1);
});

test('a cache spending limit does not masquerade as a permanently capped fleet',()=>{
 const source=readFileSync(new URL('../spend-hacknet-hashes.js',import.meta.url),'utf8');
 assert.match(source,/const quote=choice\|\|hashCapacityChoice\(ns.hacknet\)/);
 assert.match(source,/choice\?\.kind==='node'/);assert.match(source,/choice\?\.kind==='cache'/);
});

test('unaffordable investments skip expensive income and network analysis',()=>{
 const f=fixture({hashes:10});f.ns.scan=()=>{throw Error('Should not scan');};
 assert.equal(hashSpendingDecision(f.ns,'Increase Maximum Money',{target:'n00dles'}).allowed,false);
});

test('cash goals reserve the entire shortfall and sell before overflow',()=>{
 const f=fixture({money:1000000,hashes:20000});
 f.files['tasks/spending-plan.json']=JSON.stringify({reset:1,epoch:Date.now(),expiresAt:Date.now()+10000,ownerPid:1,signals:{augmentationCashTarget:{cost:1001000000}}});
 let d=hashSpendingDecision(f.ns,rank);assert.equal(d.priorityCost,4000);assert.equal(d.budget,16000);
 const receipt=fundHashCashGoal(f.ns,{},10000);assert.equal(receipt.quantity,1000);assert.equal(receipt.success,true);assert.equal(f.state.money,1001000000);
 assert.equal(fundHashCashGoal(f.ns),null);assert.equal(f.state.hashes,16000);
});
test('unfunded cash shortfalls reserve the available capacity and allow partial funding',()=>{
 const f=fixture({money:1000000,hashes:100,capacity:200});
 f.files['tasks/spending-plan.json']=JSON.stringify({reset:1,epoch:Date.now(),expiresAt:Date.now()+10000,ownerPid:1,signals:{augmentationCashTarget:{cost:1001000000}}});
 assert.equal(hashSpendingDecision(f.ns,rank).budget,0);
 assert.equal(fundHashCashGoal(f.ns).quantity,25);assert.equal(f.state.hashes,0);
});
test('bootstrap funding rounds once and concurrent workers do not oversell the goal',()=>{
 const f=fixture({money:299999,hashes:100});
 assert.equal(fundHashCashGoal(f.ns).quantity,1);assert.equal(f.state.money,1299999);assert.equal(fundHashCashGoal(f.ns),null);
});
test('urgent cash funding honors manual controls and purchase limits',()=>{
 for(const options of [{automatic:false},{ignoreRoute:true}]){const f=fixture({money:0});assert.equal(fundHashCashGoal(f.ns,options),null);assert.deepEqual(f.calls,[]);}
 const f=fixture({money:0});assert.equal(fundHashCashGoal(f.ns,{},0),null);assert.equal(fundHashCashGoal(f.ns,{},NaN),null);
});
test('cash restrictions do not reserve an impossible cash goal or block allowed rank spending',()=>{
 const f=fixture({money:0});f.files['tasks/achievement-goals.json']=JSON.stringify({nodeReset:1,ownerPid:1,expiresAt:Date.now()+10000,deniedActions:['hacknetMoney']});
 assert.equal(fundHashCashGoal(f.ns),null);assert.equal(hashSpendingDecision(f.ns,rank).preferred,rank);assert.equal(hashSpendingDecision(f.ns,rank).allowed,true);
});
test('urgent cash mutation rechecks pause, maintenance and owner liveness',()=>{
 for(const patch of ['pause','maintenance','owner']){
  const f=fixture({money:0});
  if(patch==='pause')f.files['remote-control/paused/test.js.txt']='true';
  if(patch==='maintenance')f.files['tasks/automation-maintenance.json']=JSON.stringify({ownerPid:1,expiresAt:Date.now()+10000});
  const options={script:'test.js',ownerPid:patch==='owner'?999:2};assert.equal(fundHashCashGoal(f.ns,options),null);assert.deepEqual(f.calls,[]);
 }
});
test('expired or malformed cash goals do not override the route',()=>{
 for(const cost of [Infinity,NaN,-1]){const f=fixture();f.files['tasks/spending-plan.json']=JSON.stringify({reset:1,epoch:Date.now(),expiresAt:Date.now()+10000,ownerPid:1,signals:{augmentationCashTarget:{cost}}});assert.equal(fundHashCashGoal(f.ns),null);}
 const f=fixture();f.files['tasks/spending-plan.json']=JSON.stringify({reset:1,epoch:Date.now(),expiresAt:Date.now()-1,ownerPid:1,signals:{augmentationCashTarget:{cost:1e15}}});assert.equal(fundHashCashGoal(f.ns),null);
});

function valueFixture({rankCost=10500,spCost=3000,gap=10000,rate=4.6,safe=true}={}){
 const f=fixture();
 f.state.costs[rank]=rankCost;f.state.costs[sp]=spCost;
 f.files['tasks/hash-rank-history.json']=JSON.stringify({nodeReset:1,augReset:1,knownMax:true,maxRank:f.state.rank,probed:true});
 f.route.development={rankRate:rate,nextBlackOp:{rankGap:gap,requiredRank:f.state.rank+gap,safe,staminaBlocked:false}};
 f.files['tasks/node-route-plan.json']=JSON.stringify(f.route);return f;
}

test('large rank gaps do not override a more efficient direct-SP purchase',()=>{
 const f=valueFixture(),d=hashSpendingDecision(f.ns,sp,{observeRank:f.observeRank});
 assert.equal(d.preferred,sp);assert.equal(d.allowed,true);
 assert.ok(Math.abs(d.rankSecondsSaved-100/4.6)<1e-9);
 assert.ok(Math.abs(d.spSecondsSaved-30/4.6)<1e-9);
 assert.ok(d.spValuePerHash>d.rankValuePerHash);
 assert.equal(hashSpendingDecision(f.ns,rank).allowed,false); // Even with spare hashes, do not buy the lower-value reward first.
});

test('rank purchases win when their combined replacement time is better without double counting',()=>{
 const f=valueFixture({rankCost:9000}),d=hashSpendingDecision(f.ns,rank,{observeRank:f.observeRank});
 assert.equal(d.preferred,rank);assert.equal(d.allowed,true);
 assert.ok(Math.abs(d.rankValuePerHash-(100/4.6)/9000)<1e-12);
 assert.equal(hashSpendingDecision(f.ns,sp).allowed,false);
});

test('one rank purchase can unlock a safe BlackOp but cannot bypass chance or stamina requirements',()=>{
 const f=valueFixture({gap:75});let d=hashSpendingDecision(f.ns,rank);assert.equal(d.preferred,rank);assert.equal(d.rankGateReady,true);
 for(const next of [{safe:false},{staminaBlocked:true},{rankGap:101,requiredRank:f.state.rank+101}]){
  f.route.development.nextBlackOp={rankGap:75,requiredRank:f.state.rank+75,safe:true,staminaBlocked:false,...next};
  f.files['tasks/node-route-plan.json']=JSON.stringify(f.route);
  assert.equal(hashSpendingDecision(f.ns,sp).preferred,sp);
 }
});

test('gate comparison uses current rank against the native requirement instead of stale gap',()=>{
 const f=valueFixture({gap:75});f.state.rank+=100;
 const d=hashSpendingDecision(f.ns,sp,{observeRank:f.observeRank});
 assert.equal(d.rankGap,0);assert.equal(d.rankGateReady,false);assert.equal(d.preferred,sp);
});

test('unknown or malformed rank rates use known SP economics without fabricated time estimates',()=>{
 for(const rate of [null,0,-1,Infinity]){
  const f=valueFixture({rate}),d=hashSpendingDecision(f.ns,sp);
  assert.equal(d.preferred,sp);assert.equal(d.spSecondsSaved,null);assert.equal(d.rankSecondsSaved,null);
 }
 const f=valueFixture();f.files['tasks/hash-rank-history.json']=JSON.stringify({nodeReset:1,augReset:1,knownMax:true,maxRank:10000,probed:true});
 assert.equal(hashSpendingDecision(f.ns,sp).rankSpGain,0);
 assert.equal(hashSpendingDecision(f.ns,sp).preferred,sp);
});

test('useful fresh cash milestones outrank both rank and SP and disappear when funded',()=>{
 const f=valueFixture({gap:75});f.state.money=1e6;
 f.files['tasks/spending-plan.json']=JSON.stringify({reset:1,epoch:Date.now(),expiresAt:Date.now()+10000,ownerPid:1,signals:{augmentationCashTarget:{name:'Useful',cost:10e6}}});
 assert.equal(hashSpendingDecision(f.ns,sp).preferred,cash);
 const receipt=fundHashCashGoal(f.ns);assert.equal(receipt.quantity,9);assert.equal(f.state.money,10e6);
 assert.equal(hashSpendingDecision(f.ns,rank).preferred,rank);
});

test('cash milestones require the current autopilot owner and a bounded expiry',()=>{
 const f=valueFixture();f.state.money=1e6;
 for(const patch of [{ownerPid:2},{expiresAt:Date.now()+1e9},{reset:2},{epoch:Date.now()+1000}]){
  f.files['tasks/spending-plan.json']=JSON.stringify({reset:1,epoch:Date.now(),expiresAt:Date.now()+10000,ownerPid:1,signals:{augmentationCashTarget:{cost:10e6}},...patch});
  assert.notEqual(hashSpendingDecision(f.ns,sp).preferred,cash);
 }
});

test('explicit manual and route overrides retain control over nonpreferred Bladeburner rewards',()=>{
 const f=valueFixture();
 assert.equal(hashSpendingDecision(f.ns,rank,{automatic:false}).allowed,true);
 assert.equal(hashSpendingDecision(f.ns,rank,{ignoreRoute:true}).allowed,true);
});

test('new value comparison remains serializable without direct Bladeburner API access',()=>{
 const f=valueFixture();delete f.ns.bladeburner;
 const decide=Function('return ('+hashSpendingDecision.toString()+')')();
 assert.equal(decide(f.ns,sp).preferred,sp);
 assert.equal(decide(f.ns,rank).allowed,false);
});

test('hash capacity follows the better-value reward instead of an expensive distant rank goal',()=>{
 const f=valueFixture();f.state.capacity=8000;f.state.hashes=6000;
 const d=hashSpendingDecision(f.ns,'__capacity__');assert.equal(d.preferred,sp);
 assert.equal(d.priorityCost,3000);assert.equal(d.allowed,false);
});

test('missing live rank cannot produce a natural skill-time estimate',()=>{
 const f=valueFixture();f.files['tasks/hash-rank-history.json']=JSON.stringify({nodeReset:1,augReset:1,knownMax:true,maxRank:0,probed:true});
 const d=hashSpendingDecision(f.ns,sp,{observeRank:()=>({})});
 assert.equal(d.rankNow,null);assert.equal(d.spSecondsSaved,null);
 assert.equal(d.preferred,sp);
});

function skillGoalFixture({cost=100,points=80,state='target',gap=0}={}){
 const f=valueFixture({rankCost:9000,gap});
 f.processes[1].filename='bladeburner.js';f.state.points=points;
 f.files['tasks/hash-skill-goal.json']=JSON.stringify({schemaVersion:1,at:Date.now(),ownerPid:2,nodeReset:1,augReset:1,state,name:'Digital Observer',level:10,cost,points});
 return f;
}

test('hash scoring caps useful rank SP at the remaining concrete upgrade shortfall',()=>{
 const f=skillGoalFixture(),d=hashSpendingDecision(f.ns,sp,{observeRank:f.observeRank});
 assert.equal(d.preferred,sp); // 33 generic points favored rank; only 20 help this upgrade.
 assert.equal(d.skillGoal.name,'Digital Observer');assert.equal(d.skillGoal.shortfall,20);
 assert.ok(Math.abs(d.rankSpSecondsSaved-60/4.6)<1e-9);
 assert.ok(Math.abs(d.skillGoal.naturalFundingSeconds-60/4.6)<1e-9);
});

test('a funded skill target stops automatic SP buying and releases its hash reserve',()=>{
 const f=skillGoalFixture({points:100});
 assert.equal(hashSpendingDecision(f.ns,sp).preferred,null);assert.equal(hashSpendingDecision(f.ns,sp).allowed,false);
 assert.equal(hashSpendingDecision(f.ns,rank).allowed,false);
 assert.equal(hashSpendingDecision(f.ns,cash).allowed,true);
 assert.equal(hashSpendingDecision(f.ns,'__capacity__').allowed,false);
 assert.equal(hashSpendingDecision(f.ns,sp,{automatic:false}).allowed,true);
});

test('live point balances supersede the recorded goal balance before each purchase',()=>{
 const f=skillGoalFixture({points:80});f.state.points=100;
 const d=hashSpendingDecision(f.ns,sp,{observeRank:f.observeRank});
 assert.equal(d.skillGoal.shortfall,0);assert.equal(d.allowed,false);
 f.state.points=95;
 assert.equal(hashSpendingDecision(f.ns,sp,{observeRank:f.observeRank}).skillGoal.shortfall,5);
});

test('a fresh no-useful-upgrade quote stops speculative SP purchases but retains rank milestones',()=>{
 const f=skillGoalFixture({state:'no-useful-upgrade'});
 assert.equal(hashSpendingDecision(f.ns,sp).allowed,false);assert.equal(hashSpendingDecision(f.ns,cash).allowed,true);
 f.route.development.nextBlackOp={requiredRank:f.state.rank+75,rankGap:75,safe:true,staminaBlocked:false};
 f.files['tasks/node-route-plan.json']=JSON.stringify(f.route);
 assert.equal(hashSpendingDecision(f.ns,rank).preferred,rank);
});

test('skill targets must match the current reset, live controller, schema and bounded freshness',()=>{
 for(const patch of [{at:Date.now()-45001},{at:Date.now()+10000},{ownerPid:99},{nodeReset:2},{augReset:2},{schemaVersion:2},{cost:-1},{points:null},{level:-1}]){
  const f=skillGoalFixture();const g=JSON.parse(f.files['tasks/hash-skill-goal.json']);
  f.files['tasks/hash-skill-goal.json']=JSON.stringify({...g,...patch});
  assert.equal(hashSpendingDecision(f.ns,rank).skillGoal,null,JSON.stringify(patch));
 }
 const f=skillGoalFixture();f.processes[1].filename='other.js';
 assert.equal(hashSpendingDecision(f.ns,rank).skillGoal,null);
});

test('cash milestones still outrank concrete skill funding targets',()=>{
 const f=skillGoalFixture();f.state.money=0;
 assert.equal(hashSpendingDecision(f.ns,sp).preferred,cash);
 assert.equal(fundHashCashGoal(f.ns).success,true);
});

test('serialized hash decisions read skill goals without acquiring Bladeburner RAM',()=>{
 const f=skillGoalFixture();delete f.ns.bladeburner;
 const decide=Function('return ('+hashSpendingDecision.toString()+')')();
 assert.equal(decide(f.ns,sp).skillGoal.shortfall,20);assert.equal(decide(f.ns,sp).preferred,sp);
});

function bundleFixture(shortfall,rankCost=10500,spCost=3000){
 const f=skillGoalFixture({cost:shortfall,points:0});
 f.state.costs[rank]=rankCost;f.state.costs[sp]=spCost;
 f.ns.hacknet.hashCost=(a,q=1)=>f.state.costs[a]*q+([rank,sp].includes(a)?250*q*(q-1)/2:0);
 return f;
}

test('complete upgrade quotes avoid the 32-SP greedy purchase trap',()=>{
 const f=bundleFixture(32),d=hashSpendingDecision(f.ns,rank,{observeRank:f.observeRank});
 assert.equal(d.preferred,rank);assert.equal(d.skillGoal.fundingPlan.totalHashes,10500);
 assert.equal(d.skillGoal.fundingPlan.rankPurchases,1);assert.equal(d.skillGoal.fundingPlan.spPurchases,0);
 assert.equal(d.priorityCost,10500);assert.equal(d.skillGoal.fundingPlan.completeSearch,true);
 assert.equal(f.ns.hacknet.hashCost(sp,4),13500);
});

test('mixed purchases can fund an upgrade more cheaply than either pure reward',()=>{
 const f=bundleFixture(85),d=hashSpendingDecision(f.ns,sp,{observeRank:f.observeRank}),plan=d.skillGoal.fundingPlan;
 assert.equal(plan.rankPurchases,2);assert.equal(plan.spPurchases,2);assert.equal(plan.totalHashes,27500);
 assert.equal(d.preferred,sp);assert.equal(d.priorityCost,3000); // Reserve the next purchase, not the whole bundle.
 assert.ok(plan.totalHashes<f.ns.hacknet.hashCost(rank,3));assert.ok(plan.totalHashes<f.ns.hacknet.hashCost(sp,9));
});

test('bundle quotes match brute-force count pairs across shortfalls and escalating price combinations',()=>{
 for(const shortfall of [1,5,10,20,30,32,33,34,40,65,85,100,150])
  for(const rc of [5000,10500,15000])for(const sc of [2000,3000,5000]){
   const f=bundleFixture(shortfall,rc,sc),plan=hashSpendingDecision(f.ns,sp).skillGoal.fundingPlan;
   let expected=Infinity;
   for(let ranks=0;ranks<=Math.ceil(shortfall*3/100);ranks++)for(let skills=0;skills<=Math.ceil(shortfall/10);skills++){
    if(Math.floor(100*ranks/3)+10*skills<shortfall)continue;
    const cost=(ranks?f.ns.hacknet.hashCost(rank,ranks):0)+(skills?f.ns.hacknet.hashCost(sp,skills):0);
    expected=Math.min(expected,cost);
   }
   assert.equal(plan.totalHashes,expected,JSON.stringify({shortfall,rc,sc}));
  }
});

test('funding combinations respect current single-purchase capacity and avoid a stalled rank reserve',()=>{
 const f=bundleFixture(32);f.state.capacity=8000;f.state.hashes=6000;
 const d=hashSpendingDecision(f.ns,sp);
 assert.equal(d.preferred,sp);assert.equal(d.skillGoal.fundingPlan.rankPurchases,0);
 assert.equal(d.skillGoal.fundingPlan.totalHashes,13500);
 assert.equal(hashSpendingDecision(f.ns,'__capacity__').allowed,false);
});

test('unknown high-water rank history never gives a bundle speculative skill points',()=>{
 const f=bundleFixture(32);
 f.files['tasks/hash-rank-history.json']=JSON.stringify({nodeReset:1,augReset:1,knownMax:false,probed:true});
 const d=hashSpendingDecision(f.ns,sp);assert.equal(d.preferred,sp);
 assert.equal(d.skillGoal.fundingPlan.rankPurchases,0);assert.equal(d.skillGoal.fundingPlan.totalHashes,13500);
});

test('bundle search is bounded for very large goals and labels partial enumeration',()=>{
 const f=bundleFixture(40000);let quotes=0,maxQuantity=0;
 const quote=f.ns.hacknet.hashCost;f.ns.hacknet.hashCost=(a,q=1)=>{quotes++;maxQuantity=Math.max(maxQuantity,q);return quote(a,q);};
 const d=hashSpendingDecision(f.ns,sp);
 assert.equal(d.skillGoal.fundingPlan.completeSearch,false);assert.ok(quotes<550);assert.ok(maxQuantity<=4096);
});

test('executed mixed funding recomputes after each purchase and stops at the concrete target',()=>{
 const f=bundleFixture(85);f.state.hashes=40000;let spent=0,attempts=0;
 f.ns.hacknet.spendHashes=(a,_target,q=1)=>{
  const cost=f.ns.hacknet.hashCost(a,q);if(cost>f.state.hashes)return false;
  f.state.hashes-=cost;spent+=cost;
  if(a===rank){const before=f.state.rank;f.state.rank+=100*q;f.state.points+=Math.floor(f.state.rank/3)-Math.floor(before/3);}
  if(a===sp)f.state.points+=10*q;
  f.state.costs[a]+=250*q;return true;
 };
 while(f.state.points<85&&attempts++<10){
  const d=hashSpendingDecision(f.ns,sp,{observeRank:f.observeRank});
  const receipt=spendHashesWithPolicy(f.ns,d.preferred,undefined,1,{observeRank:f.observeRank});
  assert.equal(receipt.success,true);
 }
 assert.ok(f.state.points>=85);assert.equal(spent,27500);
 assert.equal(hashSpendingDecision(f.ns,sp,{observeRank:f.observeRank}).allowed,false);
});

test('cash milestones and safe BlackOp unlocks override a cheaper skill funding combination',()=>{
 const f=bundleFixture(32);
 f.route.development.nextBlackOp={requiredRank:f.state.rank+75,rankGap:75,safe:true,staminaBlocked:false};
 f.files['tasks/node-route-plan.json']=JSON.stringify(f.route);
 assert.equal(hashSpendingDecision(f.ns,rank).rankGateReady,true);
 f.state.money=0;assert.equal(hashSpendingDecision(f.ns,cash).preferred,cash);
});

test('bundle rank yields retain native three-rank threshold phase across purchases',()=>{
 const f=bundleFixture(34);f.state.rank=3002;
 f.files['tasks/hash-rank-history.json']=JSON.stringify({nodeReset:1,augReset:1,knownMax:true,maxRank:3002,probed:true});
 const d=hashSpendingDecision(f.ns,rank,{observeRank:f.observeRank});
 assert.equal(d.rankSpGain,34);assert.equal(d.skillGoal.fundingPlan.rankPurchases,1);
 assert.equal(d.skillGoal.fundingPlan.spPurchases,0);assert.equal(d.skillGoal.fundingPlan.totalHashes,10500);
});

test('rank yield contradictions invalidate the recorded maximum instead of funding fictitious points',()=>{
 const f=bundleFixture(32);f.state.maximumRank=10000;
 const receipt=spendHashesWithPolicy(f.ns,rank,undefined,1,{observeRank:f.observeRank});
 assert.equal(receipt.success,true);assert.equal(receipt.observedSpGain,0);
 assert.equal(JSON.parse(f.files['tasks/hash-rank-history.json']).knownMax,false);
 assert.equal(hashSpendingDecision(f.ns,sp).skillGoal.fundingPlan.rankPurchases,0);
});
