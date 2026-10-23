import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteHacknetInvestment} from '../hacknet-policy.js';
import {upgradeHacknet} from '../hacknet-upgrade-manager.js';
import {claimSpending} from '../spending-policy.js';
const reset={lastNodeReset:1,lastAugReset:3,currentNode:1};
function fixture(hash=false){
 const now=Date.now(),files={'reserve.txt':'0'},nodes=[{level:10,ram:8,cores:2,ramUsed:hash?4:0,hashCapacity:hash?64:0,production:hash?5:1000}];let money=1e7,purchases=[];
 const plan={epoch:now-1000,expiresAt:now+60000,reset:3,ownerPid:7,homeRam:4096,signals:{augmentationCashTarget:{name:'Goal',cost:3e7},augmentationFunding:{at:now,rate:1000,nodeReset:1,augReset:3}},allowances:{hacknet:100000,gang:100000}};
 files['tasks/spending-plan.json']=JSON.stringify(plan);
 // Model a completed collection window; this call must still supply a fresh native quote.
 files['tasks/growth-investment-auction.json']=JSON.stringify({schemaVersion:1,scope:JSON.stringify([1,3,7,'Goal',30000000]),startedAt:now-31000,collectUntil:now-1000,expiresAt:now+29000,bids:[]});
 files['tasks/hash-spending-9.json']=JSON.stringify({at:now,pid:9,nodeReset:1,augReset:3,action:'Sell for Money',success:true,allowed:true,preferred:'Sell for Money',spent:4});
 files['tasks/hash-worker-status-9.json']=JSON.stringify({at:now,pid:9,nodeReset:1,augReset:3,state:'spending',decision:{preferred:'Sell for Money'}});
 const ns={pid:8,read:p=>files[p]||'',write:(p,v)=>files[p]=v,print:()=>{},getScriptName:()=> 'hacknet-upgrade-manager.js',getResetInfo:()=>reset,getPlayer:()=>({money,mults:{hacknet_node_money:1}}),
  ps:()=>[{pid:7,filename:'autopilot.js'},{pid:8,filename:'hacknet-upgrade-manager.js'},{pid:9,filename:'spend-hacknet-hashes.js'},{pid:10,filename:'gangs.js'}],isRunning:()=>true,
  hacknet:{numNodes:()=>nodes.length,maxNumNodes:()=>20,getNodeStats:i=>nodes[i],getLevelUpgradeCost:()=>100,getRamUpgradeCost:()=>100,getCoreUpgradeCost:()=>100,getPurchaseNodeCost:()=>Infinity,
   hashCost:()=>4,hashCapacity:()=>64,upgradeLevel:()=>{purchases.push('level');return true;},upgradeRam:()=>{purchases.push('ram');return true;},upgradeCore:()=>{purchases.push('cores');return true;}}};
 return {ns,files,nodes,plan,purchases,setMoney:n=>money=n,quote:kind=>quoteHacknetInvestment(ns,{kind,index:0,cost:100})};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('money-node investment uses actual native output and official marginal level/core ratios',()=>{
 const f=fixture();near(f.quote('level').gainPerSecond,100);near(f.quote('cores').gainPerSecond,1000/7);near(f.quote('ram').gainPerSecond,1000*(1.035**8-1));assert.equal(f.quote('ram').mode,'money');
});
test('hash investment includes current RAM load, native conversion cost and full cash-batch buffer',()=>{
 const f=fixture(true),q=f.quote('level');near(q.gainPerSecond,.5*1e6/4);near(q.delaySeconds,4/5.5);assert.equal(q.cashBatchSize,1e6);assert.equal(q.mode,'hash');near(f.quote('cores').gainPerSecond,5/6*1e6/4);
 f.ns.hacknet.hashCost=()=>8;near(f.quote('level').gainPerSecond,.5*1e6/8);
});
test('hash RAM, new-node and cache purchases cannot quote speculative cash growth',()=>{
 const f=fixture(true);for(const kind of ['ram','node','cache'])assert.equal(f.quote(kind),null);
});
test('hash cash proof requires successful real spending and a live current cash-priority worker',()=>{
 for(const patch of [{success:false},{spent:0},{spent:NaN},{action:'Exchange for Bladeburner SP'},{preferred:'Exchange for Bladeburner Rank'},{at:Date.now()-30001},{at:Date.now()+10000},{nodeReset:2},{augReset:2},{pid:99}]){const f=fixture(true),p=JSON.parse(f.files['tasks/hash-spending-9.json']);f.files['tasks/hash-spending-9.json']=JSON.stringify({...p,...patch});assert.equal(f.quote('level'),null);}
});
test('stale, paused and non-cash status cannot turn hashes into promised cash',()=>{
 for(const change of [f=>f.files['remote-control/paused/spend-hacknet-hashes.js.txt']='true',f=>delete f.files['tasks/hash-worker-status-9.json'],f=>f.files['tasks/hash-worker-status-9.json']=JSON.stringify({at:Date.now()-15001,pid:9,nodeReset:1,augReset:3,state:'spending',decision:{preferred:'Sell for Money'}}),f=>f.files['tasks/hash-worker-status-9.json']=JSON.stringify({at:Date.now(),pid:9,nodeReset:1,augReset:3,state:'spending',decision:{preferred:'Exchange for Bladeburner Rank'}}),f=>f.ns.ps=()=>[]]){const f=fixture(true);change(f);assert.equal(f.quote('cores'),null);}
});
test('unknown production, occupancy, capacity, identity and changed prices fail closed',()=>{
 for(const change of [f=>f.nodes[0].production=0,f=>f.nodes[0].production=NaN,f=>f.nodes[0].ramUsed=8,f=>f.ns.hacknet.hashCost=()=>0,f=>f.ns.hacknet.hashCapacity=()=>3,f=>f.ns.hacknet.getLevelUpgradeCost=()=>101,f=>f.ns.getResetInfo=()=>({}),f=>f.ns.pid=0]){const f=fixture(true);change(f);assert.equal(f.quote('level'),null);}
});
test('native-production quote remains self-contained after serialization',()=>{
 const f=fixture(true),quote=Function('return ('+quoteHacknetInvestment.toString()+')')();assert.equal(quote(f.ns,{kind:'level',index:0,cost:100}).gainPerSecond,f.quote('level').gainPerSecond);
});
test('money upgrades can borrow only when their discounted income funds the goal sooner',()=>{
 const f=fixture(),q=f.quote('level');assert.equal(claimSpending(f.ns,'hacknet',100),false);assert.equal(claimSpending(f.ns,'hacknet',100,q),false); // 5% gain does not clear the required 10% improvement.
 f.nodes[0].production=10000;assert.equal(claimSpending(f.ns,'hacknet',100,f.quote('level')),true);assert.equal(JSON.parse(f.files['tasks/spending-usage.json']).growthException.category,'hacknet');
});
test('hash settlement delay and one full cash batch are included in the funding comparison',()=>{
 const f=fixture(true),q=f.quote('level');assert.equal(claimSpending(f.ns,'hacknet',100,q),true);
 const g=fixture(true);g.plan.signals.augmentationCashTarget.cost=10001000;g.files['tasks/spending-plan.json']=JSON.stringify(g.plan);assert.equal(claimSpending(g.ns,'hacknet',100,g.quote('level')),false);
});
test('gang and Hacknet share the same exception token and cooldown',()=>{
 const f=fixture(true);assert.equal(claimSpending(f.ns,'hacknet',100,f.quote('level')),true);
 const p={kind:'gang-equipment',at:Date.now(),ownerPid:10,nodeReset:1,augReset:3,cost:100,gainPerSecond:10000};assert.equal(claimSpending(f.ns,'gang',100,p),false);
 const g=fixture(true);assert.equal(claimSpending(g.ns,'gang',100,p),true);assert.equal(claimSpending(g.ns,'hacknet',100,g.quote('level')),false);
});
test('cash reserves, shared allowance, pending resets and explicit spending limits remain binding',()=>{
 for(const change of [f=>f.files['reserve.txt']='9999999',f=>{f.plan.allowances.hacknet=99;f.files['tasks/spending-plan.json']=JSON.stringify(f.plan);},f=>f.files['tasks/augmentation-reset-plan.json']=JSON.stringify({pending:true,augReset:3,ownerPid:7,expiresAt:Date.now()+30000})]){const f=fixture(true);change(f);assert.equal(claimSpending(f.ns,'hacknet',100,f.quote('level')),false);}
 const f=fixture(true);assert.equal(upgradeHacknet(f.ns,99,3600,{}),false);assert.deepEqual(f.purchases,[]);
});
test('actual manager buys a justified hash upgrade after a fresh native quote',()=>{
 const f=fixture(true);assert.equal(upgradeHacknet(f.ns,100000,3600,{}),100);assert.equal(f.purchases.length,1);
 const used=JSON.parse(f.files['tasks/spending-usage.json']);assert.equal(used.growthException.kind,'hacknet-production');assert.equal(used.spent.hacknet,100);
});
test('actual manager tries an eligible smaller candidate when the best ratio exceeds the shared allowance',()=>{
 const f=fixture();f.setMoney(1e9);f.plan.signals.augmentationCashTarget=null;f.plan.allowances.hacknet=10;f.files['tasks/spending-plan.json']=JSON.stringify(f.plan);
 f.ns.hacknet.getLevelUpgradeCost=()=>100;f.ns.hacknet.getRamUpgradeCost=()=>10;f.ns.hacknet.getCoreUpgradeCost=()=>Infinity;
 f.nodes[0].ram=1; // level remains the best payoff: choose level=1 makes its marginal return high.
 f.nodes[0].level=1;
 assert.equal(upgradeHacknet(f.ns,100000,3600,{}),10);assert.deepEqual(f.purchases,['ram']);
});
test('missing cash conversion evidence cannot bypass the savings reserve in the real manager',()=>{
 const f=fixture(true);delete f.files['tasks/hash-spending-9.json'];assert.equal(upgradeHacknet(f.ns,100000,3600,{}),0);assert.deepEqual(f.purchases,[]);
});
test('achievement and pause restrictions remain authoritative',()=>{
 for(const change of [f=>f.files['remote-control/paused/hacknet-upgrade-manager.js.txt']='true',f=>f.files['tasks/achievement-profile.json']=JSON.stringify({active:true,nodeReset:1,deniedActions:['hacknetExpense']}),f=>f.files['tasks/achievement-profile.json']=JSON.stringify({active:true,nodeReset:1,deniedActions:['hacknetMoney']})]){const f=fixture(true);change(f);assert.equal(upgradeHacknet(f.ns,100000,3600,{}),0);assert.deepEqual(f.purchases,[]);}
});
