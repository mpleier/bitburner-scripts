import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stockHackingTransitions,requestStockHackingDrain,coordinateHackingDrain,ownedHackingLoopCounts} from '../hacking-drain-policy.js';
import {planSleeveAugPurchase,sleeveAugmentedOutput} from '../sleeve-development-policy.js';
import {purchaseSleeveAugBatch} from '../sleeve-policy.js';
const reset={lastNodeReset:1,lastAugReset:2},meta=JSON.stringify({nodeReset:1,augReset:2,drainProtocol:1});
function worker(pid,tool,{owner=7,loop=true,stock=false,target='n',threads=1,host='home'}={}){return {pid,host,filename:'Remote/'+tool+'-target.js',threads,args:[target,1000,100,'XP',...(tool==='weak'?[]:[stock]),false,loop,owner,meta]};}
test('stock transition selection requires matching owner, target and attack tool',()=>{
 const ps=[worker(1,'hack'),worker(2,'grow'),worker(3,'weak'),worker(4,'hack',{owner:9}),worker(5,'hack',{target:'other'}),{pid:6,filename:'custom.js',args:['n']}];
 assert.deepEqual(stockHackingTransitions(ps,7,['n'],'Remote/hack-target.js').map(p=>p.pid),[1]);
});
test('finite stock-neutral work is preserved while finite wrong-direction work is queued',()=>{
 const ps=[worker(1,'hack',{loop:false}),worker(2,'hack',{loop:false,stock:true})];
 assert.deepEqual(stockHackingTransitions(ps,7,['n'],'Remote/hack-target.js').map(p=>p.pid),[2]);
});
test('native loop inventory counts hacks by threads and growers/weakeners by process',()=>{
 const other=worker(4,'weak');other.args[1]=2000;
 const ps=[worker(1,'hack',{threads:6}),worker(2,'grow'),worker(3,'weak'),other,worker(5,'hack',{owner:9,threads:99}),worker(6,'grow',{loop:false})];
 assert.deepEqual(ownedHackingLoopCounts(ps,7),{hacks:{n:6},grows:{n:1},weakens:{n:2}});
 assert.deepEqual(ownedHackingLoopCounts([],7),{hacks:{},grows:{},weakens:{}});
});
function fixture(){
 const files=new Map(),copies=[];let ps=[worker(1,'hack',{host:'alpha'}),worker(2,'grow',{host:'alpha'}),worker(3,'weak',{host:'alpha'})],failHost=false;
 const ns={pid:7,read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),ps:h=>{if(failHost&&h==='alpha')throw Error('offline');return ps.filter(p=>p.host===h);},isRunning:()=>true,getServerMaxRam:()=>100,getServerUsedRam:()=>10,scp:async(f,h)=>{copies.push(h);return true;}};
 return {ns,files,copies,setProcesses:v=>ps=v,setFailure:v=>failHost=v,processes:()=>ps};
}
test('stock transitions drain remote-only loop groups without requiring home RAM pressure',async()=>{
 const f=fixture();await requestStockHackingDrain(f.ns,f.processes(),['n'],'Remote/hack-target.js',reset,1000);
 let p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,1000);assert.equal(p.targets.n.stage,'attack');assert.equal(p.targets.n.reason,'stock-transition');
 assert.deepEqual(JSON.parse(f.files.get('tasks/hgw-stock-drain-7.json')).targets,[]);
 f.setProcesses([worker(2,'grow',{host:'alpha'}),worker(3,'weak',{host:'alpha'})]);p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,2000);assert.equal(p.targets.n.stage,'grow');
 f.setProcesses([worker(3,'weak',{host:'alpha'})]);p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,3000);assert.equal(p.targets.n.stage,'weaken');
 f.setProcesses([]);p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,4000);assert.deepEqual(p.completed,['n']);assert.deepEqual(p.targets,{});
});
test('queued stock requests are deduplicated and unknown server state cannot acknowledge them',async()=>{
 const f=fixture();await requestStockHackingDrain(f.ns,f.processes(),['n'],'Remote/hack-target.js',reset,1000);await requestStockHackingDrain(f.ns,f.processes(),['n'],'Remote/hack-target.js',reset,1000);
 assert.deepEqual(JSON.parse(f.files.get('tasks/hgw-stock-drain-7.json')).targets,['n']);
 f.setFailure(true);const p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,1000);assert.equal(p.incomplete,true);assert.deepEqual(JSON.parse(f.files.get('tasks/hgw-stock-drain-7.json')).targets,['n']);
});
test('finite-only stock work can finish safely and stale game epochs do not request a drain',async()=>{
 const f=fixture();f.setProcesses([worker(1,'hack',{loop:false,stock:true,host:'alpha'})]);await requestStockHackingDrain(f.ns,f.processes(),['n'],'Remote/hack-target.js',reset,1000);
 let p=await coordinateHackingDrain(f.ns,['home','alpha'],{...reset,lastAugReset:3},1000);assert.equal(p,null);
 p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,1000);assert.equal(p.targets.n.stage,'attack');
});
test('real daemon stock cleanup contains no kill path or positional counter decrements',()=>{
 const source=readFileSync(new URL('../daemon.js',import.meta.url),'utf8'),start=source.indexOf('    async function terminateScriptsManipulatingStock('),end=source.indexOf('    /** Helper to kill',start),body=source.slice(start,end);
 assert.ok(body.includes('requestStockHackingDrain'));assert.equal(body.includes('killProcessIds'),false);assert.equal(body.includes('process.args['),false);assert.ok(source.includes('ownedHackingLoopCounts(allHostNames.flatMap'));
});

const sleeve=(extra={})=>({shock:0,sync:100,skills:{hacking:1,strength:100,defense:100,dexterity:100,agility:100,charisma:1,intelligence:0},exp:{strength:1e6},mults:{strength:1,strength_exp:1,crime_success:1,crime_money:1},...extra});
const crimes={Mug:{time:1000,difficulty:100,strength_success_weight:1,strength_exp:100,money:1000000,karma:1}};
const offer=(name,cost,stats)=>({name,cost,stats});
test('healthy sleeve purchases evaluate the post-install skill reset against continued current work',()=>{
 const p=planSleeveAugPurchase({sleeve:sleeve(),offers:[offer('XP',100,{strength_exp:10})],budget:100,crimes});assert.deepEqual(p.names,['XP']);assert.ok(p.output>p.baseline*1.1);
 const weak=planSleeveAugPurchase({sleeve:sleeve({skills:{strength:10000},exp:{strength:1e100}}),offers:[offer('Weak',100,{strength_exp:1.001})],budget:100,crimes});assert.deepEqual(weak.names,[]);
});
test('unrelated augmentation stats and missing estimates cannot justify skill-reset purchases',()=>{
 for(const stats of [null,{}, {faction_rep:2}])assert.deepEqual(planSleeveAugPurchase({sleeve:sleeve(),offers:[offer('Unrelated',1,stats)],budget:100,crimes}).names,[]);
 assert.deepEqual(planSleeveAugPurchase({sleeve:sleeve(),offers:[offer('XP',1,{strength_exp:10})],budget:100,crimes,objective:'unpriced'}).names,[]);
});
test('crime money purchases must repay their actual cash cost in the modeled horizon',()=>{
 const good=planSleeveAugPurchase({sleeve:sleeve(),offers:[offer('Money',1,{crime_money:10})],budget:1,crimes,objective:'money'});assert.deepEqual(good.names,['Money']);assert.ok(good.gain>=good.cost);
 const bad=planSleeveAugPurchase({sleeve:sleeve(),offers:[offer('Money',1e15,{crime_money:1.01})],budget:1e15,crimes,objective:'money'});assert.deepEqual(bad.names,[]);
});
test('zero crime-money BitNodes cannot create a fictitious cash payback',()=>{
 const p=planSleeveAugPurchase({sleeve:sleeve(),offers:[offer('Money',1,{crime_money:10})],budget:1,crimes,objective:'money',context:{crimeMoneyMultiplier:0}});assert.deepEqual(p.names,[]);
});
test('purchase selection avoids spending on unrelated cheap filler and honors minimum batch size',()=>{
 const p=planSleeveAugPurchase({sleeve:sleeve(),offers:[offer('Filler',1,{faction_rep:2}),offer('XP',10,{strength_exp:10})],budget:11,crimes});assert.deepEqual(p.names,['XP']);assert.equal(p.cost,10);
 const blocked=planSleeveAugPurchase({sleeve:sleeve(),offers:[offer('XP',10,{strength_exp:10}),offer('Other',100,{}),offer('Other2',100,{})],budget:10,crimes,minBatch:2});assert.deepEqual(blocked.names,[]);
});
test('explicit budget-only purchasing skips estimates but retains a finite allocation',()=>{
 const p=planSleeveAugPurchase({offers:[offer('A',10,null),offer('B',20,null)],budget:10,manual:true});assert.deepEqual(p.names,['A']);assert.equal(p.cost,10);
 assert.deepEqual(planSleeveAugPurchase({offers:[],budget:NaN,manual:true}).names,[]);
});
test('crime projections safely ignore missing or invalid fixed-crime data',()=>{
 for(const stats of [undefined,null,{time:NaN},{time:0}])assert.equal(sleeveAugmentedOutput(sleeve(),{},{Bad:stats},900),0);
});
function purchaseFixture(){let money=100;const bought=[],claims=[];const ns={read:()=>'',getPlayer:()=>({money}),sleeve:{getSleeve:()=>({shock:0}),getSleevePurchasableAugs:()=>[{name:'A',cost:10},{name:'B',cost:20}],purchaseSleeveAug:(_i,n)=>{bought.push(n);money-=n==='A'?10:20;return true;}}};return {ns,bought,claims,claim:(_ns,_category,cost)=>{claims.push(cost);return true;}};}
test('adaptive batches preflight all quotes and claim the shared budget once',()=>{
 const f=purchaseFixture(),p=purchaseSleeveAugBatch(f.ns,0,['A','B'],30,0,f.claim,()=>true,true,true);assert.equal(p.spent,30);assert.deepEqual(f.bought,['A','B']);assert.deepEqual(f.claims,[30]);
});
test('missing offers or a quote above the planned allocation cannot cause an inferior partial batch',()=>{
 for(const names of [['A','Missing'],['A','B']]){const f=purchaseFixture();const p=purchaseSleeveAugBatch(f.ns,0,names,20,0,f.claim,()=>true,true,true);assert.equal(p.spent,0);assert.deepEqual(f.bought,[]);assert.deepEqual(f.claims,[]);}
});
test('whole-batch preflight still honors pause, reserves, claim rejection and native failures',()=>{
 const f=purchaseFixture();assert.equal(purchaseSleeveAugBatch(f.ns,0,['A','B'],30,80,f.claim,()=>true,true,true).spent,0);
 assert.equal(purchaseSleeveAugBatch(f.ns,0,['A','B'],30,0,f.claim,()=>false,true,true).spent,0);
 assert.equal(purchaseSleeveAugBatch(f.ns,0,['A','B'],30,0,()=>false,()=>true,true,true).spent,0);assert.deepEqual(f.bought,[]);
 f.ns.sleeve.purchaseSleeveAug=()=>false;const p=purchaseSleeveAugBatch(f.ns,0,['A','B'],30,0,f.claim,()=>true,true,true);assert.equal(p.spent,0);assert.equal(p.skipped[0].reason,'native purchase rejected');
});
test('serialized whole-batch helpers retain their independent guards',()=>{
 const f=purchaseFixture(),fn=new Function('ns','claim','return ('+purchaseSleeveAugBatch.toString()+')(ns,0,["A","B"],30,0,claim,()=>true,true,true)');assert.equal(fn(f.ns,f.claim).spent,30);
});
test('integration publishes purchase decisions and preserves an explicit estimate override',()=>{
 const source=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8');assert.ok(source.includes('disable-adaptive-augmentations'));assert.ok(source.includes('purchasePlans:sleevePurchasePlans'));assert.ok(source.includes('Math.min(budget,plan.cost)'));assert.ok(source.includes('actualTasks[i]'));
});

test('split grow/weaken jobs count once while all split hack threads remain represented',()=>{
 const ps=[worker(1,'grow'),worker(2,'grow',{host:'alpha'}),worker(3,'weak'),worker(4,'weak',{host:'alpha'}),worker(5,'hack',{threads:3}),worker(6,'hack',{host:'alpha',threads:7})];
 assert.deepEqual(ownedHackingLoopCounts(ps,7),{hacks:{n:10},grows:{n:1},weakens:{n:1}});
});
test('native stock cleanup uses the fresh inventory and never erases old counts on partial scan failure',()=>{
 const source=readFileSync(new URL('../daemon.js',import.meta.url),'utf8');assert.ok(source.includes('Incomplete inventory must not clear live loop counts.'));
 const sleeveSource=readFileSync(new URL('../sleeve.js',import.meta.url),'utf8');assert.equal(sleeveSource.includes('<30000&&!sleevePurchasePlans'),false);assert.ok(sleeveSource.includes("state:receipt.purchased.length?'purchased':'deferred'"));
});

test('cheap low-value offers cannot hide an affordable high-value augmentation from the shortlist',()=>{
 const offers=Array.from({length:8},(_,i)=>offer('Cheap'+i,1,{strength_exp:1.00001}));offers.push(offer('Useful',100,{strength_exp:10}));
 const p=planSleeveAugPurchase({sleeve:sleeve(),offers,budget:100,crimes});assert.deepEqual(p.names,['Useful']);
 const bounded=planSleeveAugPurchase({sleeve:sleeve(),offers:[offer('Useful',100,{strength_exp:10})],budget:100,crimes,horizon:1e9});assert.equal(bounded.horizon,900);
});

test('urgent home RAM reclamation takes precedence over a remote-only stock refresh',async()=>{
 const f=fixture(),home=worker(4,'hack',{target:'homeTarget'});f.setProcesses([...f.processes(),home]);f.ns.getServerUsedRam=()=>100;
 f.files.set('tasks/home-ram-reclaim.json',JSON.stringify({at:1000,ownerPid:99,satisfied:false,target:50}));
 await requestStockHackingDrain(f.ns,f.processes(),['n'],'Remote/hack-target.js',reset,1000);
 const p=await coordinateHackingDrain(f.ns,['home','alpha'],reset,1000);assert.equal(p.targets.homeTarget.stage,'attack');assert.equal(p.targets.n,undefined);assert.deepEqual(p.stockQueued,['n']);
});
