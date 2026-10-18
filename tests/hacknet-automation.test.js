import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {hacknetProduction,hacknetServerMode,hacknetOptionsError,hashOptionsError,hashOverflowBuffer,hashCapacityChoice,hacknetPayoffLimit} from '../hacknet-policy.js';
import {upgradeHacknet} from '../hacknet-upgrade-manager.js';

test('production estimates distinguish money nodes, hashes and occupied server RAM',()=>{
 const s={level:10,ram:8,cores:2,ramUsed:4};
 assert.equal(hacknetProduction(s,false),15*1.035**7*7/6);
 assert.equal(hacknetProduction(s,true),.01*1.07**3*1.2*.5);
 assert.equal(hacknetProduction({...s,ramUsed:8},true),0);
 assert.ok(hacknetProduction({...s,ram:16},true)>hacknetProduction(s,true));
});

test('empty Hacknet mode honors current node, overrides and disabled servers',()=>{
 assert.equal(hacknetServerMode({currentNode:9}),true);
 assert.equal(hacknetServerMode({currentNode:9,bitNodeOptions:{sourceFileOverrides:{9:0}}}),false);
 assert.equal(hacknetServerMode({ownedSF:{9:3},bitNodeOptions:{disableHacknetServer:true}}),false);
 assert.equal(hacknetServerMode({}, {hashCapacity:64}),true);
 assert.equal(hacknetServerMode({currentNode:9},{hashCapacity:0}),false);
});

function fixture({nodes=[],servers=false,money=1e6,costs={},reserve=0,paused=false}={}){
 const bought=[],api={numNodes:()=>nodes.length,getNodeStats:i=>nodes[i],maxNumNodes:()=>20,
 getPurchaseNodeCost:()=>costs.node??1000,getLevelUpgradeCost:()=>costs.level??Infinity,getRamUpgradeCost:()=>costs.ram??Infinity,getCoreUpgradeCost:()=>costs.cores??Infinity,
 purchaseNode:()=>{bought.push('node');return 0;},upgradeLevel:()=>{bought.push('level');return true;},upgradeRam:()=>{bought.push('ram');return true;},upgradeCore:()=>{bought.push('cores');return true;}};
 const ns={hacknet:api,getResetInfo:()=>({currentNode:servers?9:1}),getPlayer:()=>({money,mults:{hacknet_node_money:1}}),getScriptName:()=> 'hacknet-upgrade-manager.js',
 read:f=>f==='reserve.txt'?String(reserve):f.includes('paused/')&&paused?'true':'',print:()=>{}};
 return {ns,bought};
}

test('first node uses its actual starting production rather than unlimited ROI',()=>{
 const m=fixture({servers:true,costs:{node:50000}});
 assert.equal(upgradeHacknet(m.ns,1e6,100,{}),false);assert.deepEqual(m.bought,[]);
 assert.equal(upgradeHacknet(m.ns,1e6,300,{}),50000);assert.deepEqual(m.bought,['node']);
});

test('upgrade selection can buy an affordable alternative instead of stopping at the best ratio',()=>{
 const m=fixture({nodes:[{level:1,ram:1,cores:1,hashCapacity:0}],costs:{level:100,ram:1,cores:Infinity,node:Infinity}});
 assert.equal(upgradeHacknet(m.ns,10,1000,{}),1);assert.deepEqual(m.bought,['ram']);
});

test('upgrade purchases preserve global reserves and pause controls',()=>{
 for(const opts of [{money:1000,reserve:1000},{paused:true}]){
 const m=fixture(opts);assert.equal(upgradeHacknet(m.ns,1e6,1000,{}),0);assert.deepEqual(m.bought,[]);
 }
});

test('hash capacity selection skips capped caches and chooses the cheapest valid upgrade',()=>{
 const api={numNodes:()=>3,maxNumNodes:()=>3,getCacheUpgradeCost:i=>[Infinity,20,10][i],getPurchaseNodeCost:()=>5};
 assert.deepEqual(hashCapacityChoice(api),{kind:'cache',index:2,cost:10});
 assert.deepEqual(hashCapacityChoice({...api,maxNumNodes:()=>4}),{kind:'node',cost:5});
 assert.equal(hashCapacityChoice({...api,getCacheUpgradeCost:()=>Infinity}),null);
});

test('overflow prediction covers a full game tick at short polling intervals',()=>{
 assert.equal(hashOverflowBuffer(100,50,1),21);assert.equal(hashOverflowBuffer(100,1000,1),101);
});

test('invalid polling, spending, reserve and batch options are rejected',()=>{
 const upgrades={interval:0,'max-spend':Number.MAX_VALUE,reserve:null};assert.equal(hacknetOptionsError(upgrades,3600),null);
 assert.ok(hacknetOptionsError({...upgrades,interval:-1},3600));assert.ok(hacknetOptionsError(upgrades,NaN));
 const hashes={interval:50,'reserve-buffer':1,'ignore-reserve-if-upgrade-cost-less-than-pct':0,'max-purchases-per-loop':10000,reserve:null};
 assert.equal(hashOptionsError(hashes),null);assert.ok(hashOptionsError({...hashes,'max-purchases-per-loop':.5}));
});

test('hash spender budgets capacity purchases, checks pauses after yields, and counts bulk quantities',async()=>{
 const source=await readFile(new URL('../spend-hacknet-hashes.js',import.meta.url),'utf8');
 assert.match(source,/if \(!claimSpending\(ns,"hacknet",nextNodeCost\)\)/);
 assert.ok(source.indexOf('if (!claimSpending(ns,"hacknet",nextNodeCost))')<source.indexOf('if (ns.hacknet.purchaseNode()>=0)'));
 assert.match(source,/claimSpending\(ns,"hacknet",nextCacheUpgradeCost\)/);
 assert.match(source,/purchasesThisLoop\+=quantity/);assert.match(source,/maintenanceRequested\(ns\)/);
 assert.match(source,/hashOverflowBuffer\(globalProduction/);
});


test('invalid hash settings report an error without a startup logging exception',async()=>{
 const source=await readFile(new URL('../spend-hacknet-hashes.js',import.meta.url),'utf8'),messages=[];
 const context={hashOptionsError,registerAutomation:()=>{},isScriptPaused:()=>false,getConfiguration:()=>({interval:-1}),log_helper:(_ns,message)=>messages.push(message)};
 vm.runInNewContext(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export async function','async function').replaceAll('export function','function')+';globalThis.start=main;',context);
 await context.start({getScriptName:()=> 'spend-hacknet-hashes.js'});assert.match(messages[0],/interval must/);
});

test('cash bottleneck caps Hacknet payoff limit at 3600 seconds outside BN9',()=>{
 const reset={currentNode:1,lastAugReset:1000};
 const livePlan={reset:1000,expiresAt:2000,epoch:1000,signals:{bottleneck:'cash'}};
 assert.equal(hacknetPayoffLimit(7200,livePlan,reset,1500,true),3600);
 assert.equal(hacknetPayoffLimit(1800,livePlan,reset,1500,true),1800);
 assert.equal(hacknetPayoffLimit(7200,livePlan,{...reset,currentNode:9},1500,true),7200);
 assert.equal(hacknetPayoffLimit(7200,livePlan,reset,1500,false),7200);
 assert.equal(hacknetPayoffLimit(7200,{...livePlan,expiresAt:1200},reset,1500,true),7200);
 assert.equal(hacknetPayoffLimit(7200,{...livePlan,signals:{bottleneck:'ram'}},reset,1500,true),7200);
});

