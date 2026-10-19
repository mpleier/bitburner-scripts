import {publishCloudPurchase} from '../cloud-status-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {cloudCashBudget,cloudCandidates,cloudDemand,normalizeCloudOptions,cloudPurchaseSource} from '../cloud-server-policy.js';
import {homeRamHeadroom} from '../home-ram-policy.js';
import {claimSpending} from '../spending-policy.js';
const defaults={c:false,'run-continuously':false,interval:10000,'min-ram-exponent':5,'utilization-trigger':.8,
 'absolute-reserve':null,'reserve-percent':0,'reserve-by-time':false,'reserve-by-time-decay-factor':.2,
 budget:Infinity,'allow-worse-purchases':false,'compare-to-home-threshold':.25,'compare-to-network-ram-threshold':.02};
const purchase=vm.runInNewContext('('+cloudPurchaseSource+')');
function fixture({money=100000,limit=2,maxRam=256,owned={},options={},used=120}={}){
 const state={money,owned:{...owned},used,limit,maxRam},files={},calls=[],claims=[];
 const ns={pid:5,args:[],read:f=>files[f]||'',write:(f,s)=>files[f]=s,isRunning:()=>true,
  getResetInfo:()=>({lastAugReset:1,lastNodeReset:2}),getPlayer:()=>({money:state.money}),
  ps:()=>[{pid:1,filename:'autopilot.js'}],serverExists:n=>n==='home'||n in state.owned,hasRootAccess:()=>true,
  getServerMaxRam:n=>n==='home'?128:state.owned[n],getServerUsedRam:n=>n==='home'?state.used:state.owned[n],
  cloud:{getServerLimit:()=>state.limit,getRamLimit:()=>state.maxRam,getServerNames:()=>Object.keys(state.owned),
   getServerCost:ram=>ram*10,getServerUpgradeCost:(name,ram)=>ram>state.owned[name]?(ram-state.owned[name])*10:-1,
   purchaseServer:(name,ram)=>{calls.push(['purchase',ram]);state.money-=ram*10;const host=name+calls.length;state.owned[host]=ram;return host;},
   upgradeServer:(name,ram)=>{calls.push(['upgrade',name,ram]);state.money-=(ram-state.owned[name])*10;state.owned[name]=ram;return true;}}};
 const request={servers:['home',...Object.keys(owned)],options:{...defaults,...options},budget:null};
 const claim=(ns,category,cost)=>{claims.push(cost);return claimSpending(ns,category,cost);};
 const run=()=>purchase(ns,request,claim,cloudCashBudget,cloudCandidates,cloudDemand,homeRamHeadroom);
 return {state,files,calls,claims,ns,request,run};
}
function allowance(f,amount,spent=0){const epoch=Date.now();f.files['tasks/spending-plan.json']=JSON.stringify({epoch,expiresAt:epoch+60000,reset:1,ownerPid:1,allowances:{servers:amount}});f.files['tasks/spending-usage.json']=JSON.stringify({epoch,spent:{servers:spent}});}

test('cloud buying falls back to the largest size inside the remaining shared allowance',()=>{
 const f=fixture();allowance(f,1000,300);const r=f.run();assert.equal(r.purchased,true);assert.equal(r.ram,64);assert.equal(r.cost,640);
 assert.deepEqual(f.claims,[2560,1280,640]);assert.equal(f.calls.length,1);
 assert.equal(JSON.parse(f.files['tasks/spending-usage.json']).spent.servers,940);
});
test('denied candidates consume no allowance and make no native purchase',()=>{
 const f=fixture();allowance(f,200);assert.equal(f.run().reason,'shared-budget');assert.equal(f.calls.length,0);assert.equal(JSON.parse(f.files['tasks/spending-usage.json']).spent.servers,0);
});
test('full fleet upgrades use incremental native prices and strictly increase RAM',()=>{
 const f=fixture({owned:{small:128,big:256}});f.request.budget=1300;const r=f.run();assert.equal(r.purchased,true);assert.equal(r.name,'small');assert.equal(r.ram,256);assert.equal(r.cost,1280);assert.deepEqual(f.calls,[['upgrade','small',256]]);
});
test('useful upgrades below the largest existing server are eligible',()=>{
 const f=fixture({owned:{small:64,big:256}});f.request.budget=700;assert.equal(f.run().ram,128);assert.deepEqual(f.calls,[['upgrade','small',128]]);
});
test('unchanged size is never purchased or claimed when the next upgrade is unaffordable',()=>{
 const f=fixture({owned:{small:128,big:256}});f.request.budget=1000;assert.equal(f.run().reason,'no-affordable-capacity');assert.deepEqual(f.calls,[]);assert.deepEqual(f.claims,[]);
});
test('maximum fleet and disabled cloud limits exit cleanly',()=>{
 const f=fixture({owned:{one:256,two:256}});assert.equal(f.run().reason,'maximum-capacity');assert.deepEqual(f.claims,[]);
 assert.equal(fixture({limit:0}).run().reason,'disabled');
});
test('fresh absolute, percentage and global reserves constrain the final purchase',()=>{
 for(const options of [{'absolute-reserve':750},{'reserve-percent':.75}]){
  const f=fixture({options,money:10000});f.state.money=1000;assert.equal(f.run().reason,'no-affordable-capacity');assert.equal(f.calls.length,0);
 }
 const f=fixture({money:1000});f.files['reserve.txt']='750';assert.equal(f.run().reason,'no-affordable-capacity');assert.equal(f.calls.length,0);
 f.files['reserve.txt']='invalid';assert.equal(f.run().reason,'invalid-reserve');
});
test('budget exhaustion and per-purchase percent limits preserve available cash',()=>{
 const f=fixture({money:1000,options:{'reserve-percent':.5}});const r=f.run();assert.equal(r.ram,32);assert.equal(f.state.money,680);
 const g=fixture();g.request.budget=0;assert.equal(g.run().reason,'reserved-cash');assert.equal(g.calls.length,0);
 assert.equal(cloudCashBudget(1000,Infinity,300,.5),500);
 for(const args of [[NaN,1,0,0],[1000,-1,0,0],[1000,1,-1,0],[1000,1,0,2]])assert.equal(cloudCashBudget(...args),0);
});
test('time reserve uses the current reset and can veto all spending',()=>{
 const f=fixture({options:{'reserve-by-time':true,'reserve-by-time-decay-factor':1}});assert.equal(f.run().reason,'reserved-cash');assert.deepEqual(f.calls,[]);
});
test('idle capacity prevents purchases and an explicit zero trigger permits them',()=>{
 const f=fixture({used:10});assert.equal(f.run().reason,'idle-capacity');assert.deepEqual(f.calls,[]);f.request.options['utilization-trigger']=0;assert.equal(f.run().purchased,true);
});
test('demand excludes reserved free home RAM and idle hash servers',()=>{
 const servers=[{name:'home',ram:128,used:100},{name:'hash',ram:1024,used:0,hacknet:true}];
 assert.equal(cloudDemand(servers,.8).needed,false);assert.equal(cloudDemand(servers,.8,32).needed,true);
 servers[1].used=1;assert.equal(cloudDemand(servers,.8,32).needed,false);
 assert.equal(cloudDemand([],.8).needed,false);assert.equal(cloudDemand([],NaN).needed,false);
});
test('upgrade network threshold measures added RAM rather than replacement RAM',()=>{
 const args={budget:10000,minRam:32,maxRam:1024,homeRam:128,totalRam:1000,homeThreshold:0,networkThreshold:.1,bestRam:0};
 assert.equal(cloudCandidates([{ram:128,oldRam:64,cost:640}],args).length,0);
 assert.equal(cloudCandidates([{ram:256,oldRam:128,cost:1280}],args).length,1);
});
test('new purchases retain minimum size and existing best-server protections',()=>{
 const f=fixture({limit:3,owned:{big:256}});f.request.budget=700;assert.equal(f.run().reason,'no-affordable-capacity');
 f.request.options['allow-worse-purchases']=true;assert.equal(f.run().ram,64);
});
test('pause, maintenance and achievement restrictions prevent spending',()=>{
 for(const mode of ['pause','maintenance','achievement']){
  const f=fixture();if(mode==='pause')f.files['remote-control/paused/host-manager.js.txt']='true';
  if(mode==='maintenance')f.files['tasks/automation-maintenance.json']=JSON.stringify({expiresAt:Date.now()+60000,ownerPid:1});
  if(mode==='achievement')f.files['tasks/achievement-profile.json']=JSON.stringify({active:true,nodeReset:2,deniedActions:['cashSpending']});
  assert.equal(f.run().purchased,false);assert.deepEqual(f.calls,[]);
 }
});
test('invalid prices and unavailable APIs fail gracefully',()=>{
 const f=fixture();f.ns.cloud.getServerCost=()=>Infinity;assert.equal(f.run().reason,'no-affordable-capacity');assert.deepEqual(f.calls,[]);
 const g=fixture();g.ns.cloud=null;assert.equal(g.run().reason,'api-unavailable');assert.deepEqual(g.calls,[]);
 const h=fixture();h.ns.cloud.purchaseServer=()=>'';assert.equal(h.run().reason,'purchase-failed');assert.equal(h.claims.length,1);
});
test('cloud options normalize numeric strings and reject invalid ranges',()=>{
 assert.equal(normalizeCloudOptions({...defaults,budget:'1000','absolute-reserve':'100'}).budget,1000);
 for(const patch of [{budget:-1},{budget:NaN},{interval:0},{'reserve-percent':2},{'absolute-reserve':'bad'},{'min-ram-exponent':1.5},{'utilization-trigger':-1},{'reserve-by-time-decay-factor':2}])assert.equal(normalizeCloudOptions({...defaults,...patch}),null);
});

test('actual manager serializes worker arguments and executes the generated purchase expression',async()=>{
 const f=fixture();allowance(f,700);const messages=[];
 const source=readFileSync(new URL('../host-manager.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/export /g,'');
 const context=vm.createContext({publishCloudPurchase,cloudPurchaseSource,cloudCashBudget,cloudCandidates,cloudDemand,normalizeCloudOptions,homeRamHeadroom,claimSpending,
  getConfiguration:()=>({...defaults}),instanceCount:async()=>1,formatMoney:String,formatRam:String,log:(ns,m)=>messages.push(m),
  getNsDataThroughFile:async(ns,code,file,args=[])=>{
   assert.ok(args.every(a=>['number','string','boolean'].includes(typeof a)));
   if(code.startsWith('scanAllServers'))return f.request.servers;
   f.ns.args=args;return vm.runInNewContext(code,{ns:f.ns});
  }});
 f.ns.disableLog=()=>{};context.ns=f.ns;vm.runInContext(source,context);await vm.runInContext('main(ns)',context);
 assert.deepEqual(f.calls,[['purchase',64]]);assert.ok(messages.some(m=>m.startsWith('SUCCESS:')));
});
test('daemon automatic cloud purchases use an eighty percent demand threshold',()=>{
 const source=readFileSync(new URL('../daemon.js',import.meta.url),'utf8');assert.match(source,/'--utilization-trigger', 0\.8/);assert.match(source,/name: "host-manager\.js", minRamReq: 16/);
});
