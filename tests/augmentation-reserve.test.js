import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {augmentationCashReserve,claimSpending,adaptiveBudgetSignals,spendingPlan} from '../spending-policy.js';
function fixture(){
 const now=Date.now(),plan={epoch:now,expiresAt:now+60000,reset:3,ownerPid:7,homeRam:1024,signals:{augmentationCashTarget:{name:'Combat',cost:125}},allowances:{servers:500,home:500,hacknet:500}};
 const files={'tasks/spending-plan.json':JSON.stringify(plan),'reserve.txt':'0'};let money=150;
 const ns={read:f=>files[f]||'',write:(f,s)=>files[f]=s,getResetInfo:()=>({lastAugReset:3}),ps:()=>[{pid:7,filename:'autopilot.js'}],getPlayer:()=>({money})};
 return {ns,files,plan,setMoney:n=>money=n};
}
test('shared augmentation reserve expires and requires current reset and named owner',()=>{
 const {ns,files,plan}=fixture();assert.equal(augmentationCashReserve(ns),125);
 for(const patch of [{reset:2},{epoch:Date.now()+10000},{expiresAt:1},{ownerPid:8},{signals:{augmentationCashTarget:{name:'Combat',cost:Infinity}}}]){
  files['tasks/spending-plan.json']=JSON.stringify({...plan,...patch});assert.equal(augmentationCashReserve(ns),0);
 }
});
test('discretionary buyers cannot consume augmentation savings; essential home RAM can still be funded',()=>{
 const f=fixture();assert.equal(claimSpending(f.ns,'servers',26),false);assert.equal(claimSpending(f.ns,'servers',25),true);
 assert.equal(claimSpending(f.ns,'hacknet',126),false);
 f.files['tasks/spending-plan.json']=JSON.stringify({...f.plan,homeRam:32});assert.equal(claimSpending(f.ns,'home',100),true);
});
test('reserve checks execute identically after serialization and observe changed wallet balances',()=>{
 const f=fixture(),reserve=new Function('return ('+augmentationCashReserve.toString()+')')(),claim=new Function('return ('+claimSpending.toString()+')')();
 assert.equal(reserve(f.ns),125);f.setMoney(124);assert.equal(claim(f.ns,'servers',1),false);
 f.setMoney(200);assert.equal(claim(f.ns,'servers',50),true);
});


function waitingFixture(){
 const f=fixture(),now=Date.now();
 f.ns.getResetInfo=()=>({lastAugReset:3,lastNodeReset:1});
 const wait={schemaVersion:1,active:true,ownerPid:7,nodeReset:1,augReset:3,startedAt:now-1000,at:now,expiresAt:now+60000,
  plan:{name:'Full chain',at:now,worthWaiting:true,deadline:now+60000,cashTarget:200}};
 f.files['tasks/augmentation-wait-plan.json']=JSON.stringify(wait);
 const goal=augmentationCashReserve(f.ns,true);
 f.plan.signals.augmentationCashTarget=goal;
 f.files['tasks/spending-plan.json']=JSON.stringify(f.plan);
 return {...f,wait};
}

test('selected wait reserves the full basket bill even before ordinary spending signals refresh',()=>{
 const f=waitingFixture();delete f.files['tasks/spending-plan.json'];
 assert.equal(augmentationCashReserve(f.ns),200);
 assert.deepEqual(augmentationCashReserve(f.ns,true),{name:'Full chain',cost:200,source:'augmentation-wait',
  startedAt:f.wait.startedAt,deadline:f.wait.plan.deadline,nodeReset:1});
 assert.equal(adaptiveBudgetSignals(f.ns).augmentationCashTarget.cost,200);
});

test('full chain reservations block discretionary purchases but preserve essential home RAM allowances',()=>{
 const f=waitingFixture();
 assert.equal(claimSpending(f.ns,'servers',1),false);
 f.files['tasks/spending-plan.json']=JSON.stringify({...f.plan,homeRam:32});
 assert.equal(claimSpending(f.ns,'home',100),true);
 f.setMoney(250);assert.equal(claimSpending(f.ns,'servers',50),true);
 assert.equal(claimSpending(f.ns,'servers',51),false);
});

test('withdrawn or expired receipts release cached wait signals immediately',()=>{
 for(const patch of [{active:false},{expiresAt:1},{at:Date.now()-120001},{augReset:2},{nodeReset:2},{ownerPid:9},
  {expiresAt:'invalid'},{startedAt:Date.now()+10000}]){
  const f=waitingFixture();f.files['tasks/augmentation-wait-plan.json']=JSON.stringify({...f.wait,...patch});
  assert.equal(augmentationCashReserve(f.ns),0);
  assert.equal(claimSpending(f.ns,'servers',100),true);
 }
});

test('future, oversized and orphaned wait receipts cannot freeze cash',()=>{
 for(const patch of [{at:Date.now()+10000},{expiresAt:Date.now()+20*60000},{schemaVersion:0}]){
  const f=waitingFixture();f.files['tasks/augmentation-wait-plan.json']=JSON.stringify({...f.wait,...patch});
  assert.equal(augmentationCashReserve(f.ns),0);
 }
 const f=waitingFixture();f.ns.ps=()=>[];
 assert.equal(augmentationCashReserve(f.ns),0);
});

test('serialized stock and spending checks enforce and release the same selected-plan reserve',()=>{
 const f=waitingFixture(),reserve=new Function('return ('+augmentationCashReserve.toString()+')')(),
  claim=new Function('return ('+claimSpending.toString()+')')();
 assert.equal(reserve(f.ns),200);assert.equal(claim(f.ns,'servers',1),false);
 f.files['tasks/augmentation-wait-plan.json']=JSON.stringify({...f.wait,active:false});
 assert.equal(reserve(f.ns),0);assert.equal(claim(f.ns,'servers',100),true);
});

test('budget goal refresh preserves epoch, consumed allowances and unrelated signals',async()=>{
 const source=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const start=source.indexOf('    async function refreshAugmentationFundingBudget('),
  end=source.indexOf('    /** Consolidated logic',start);
 const f=waitingFixture();f.ns.pid=7;f.files['tasks/spending-usage.json']=JSON.stringify({epoch:f.plan.epoch,spent:{servers:17}});
 const beforeUsage=f.files['tasks/spending-usage.json'];let selected={name:'Full chain',cost:200};
 const refresh=Function('adaptiveBudgetSignals','spendingPlan','homeRam','resetInfo',
  'return '+source.slice(start,end))( ()=>({augmentationCashTarget:selected}),spendingPlan,1024,{lastAugReset:3,currentNode:9});
 await refresh(f.ns,{money:150});
 let plan=JSON.parse(f.files['tasks/spending-plan.json']);
 assert.equal(plan.epoch,f.plan.epoch);assert.deepEqual(plan.allowances,f.plan.allowances);
 assert.equal(plan.signals.augmentationCashTarget.cost,200);
 assert.equal(f.files['tasks/spending-usage.json'],beforeUsage);
 selected=null;await refresh(f.ns,{money:150});
 plan=JSON.parse(f.files['tasks/spending-plan.json']);assert.equal(plan.signals.augmentationCashTarget,null);
 assert.equal(plan.epoch,f.plan.epoch);
});
