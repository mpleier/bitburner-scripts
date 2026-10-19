import test from 'node:test';
import assert from 'node:assert/strict';
import {essentialManagerRamTarget} from '../home-ram-policy.js';
import {spendingPlan,claimSpending,adaptiveBudgetSignals} from '../spending-policy.js';
const process=(filename,ram,extra={})=>({filename,pid:1,threads:1,ram,...extra});
const target=(managers,processes,maximum=128,configured=0)=>essentialManagerRamTarget({getServerMaxRam:()=>maximum,read:()=>String(configured),getScriptRam:name=>processes.find(p=>p.filename===name)?.ram??86},managers,processes);
test('essential capacity includes persistent controllers, missing managers and helper headroom',()=>{
 const p=target([{script:'bladeburner.js',state:'needs-home-ram'}],[process('autopilot.js',50)]);
 assert.equal(p.target,256);assert.equal(p.required,136);assert.deepEqual(p.missing,['bladeburner.js']);
});
test('existing headroom prevents unnecessary emergency upgrades',()=>{
 assert.equal(target([{script:'bladeburner.js',state:'waiting-for-ram'}],[process('autopilot.js',30)],256),null);
});
test('paused, disabled, optional and already-running managers do not create upgrade demand',()=>{
 for(const state of ['paused','locked-or-disabled','running'])assert.equal(target([{script:'bladeburner.js',state}],[process('autopilot.js',10)]),null);
 assert.equal(target([{script:'grafting-manager.js',state:'needs-home-ram'}],[process('autopilot.js',10)]),null);
 assert.equal(target([{script:'bladeburner.js',state:'waiting-for-ram'}],[process('bladeburner.js',10)]),null);
});
test('batch workers and transient jobs do not inflate permanent manager capacity',()=>{
 const ps=[process('autopilot.js',10),process('Remote/grow-target.js',1000),process('Temp/query.js',1000),process('remote-control/job.js',1000),process('other.js',1000,{temporary:true})];
 assert.equal(target([],ps),null);
});
test('capacity honors explicit headroom and deduplicates pending managers',()=>{
 const ps=[process('autopilot.js',10)];assert.equal(target([],ps,128,200).target,256);
 const ms=Array.from({length:2},()=>({script:'bladeburner.js',state:'waiting-for-ram'}));assert.equal(target(ms,[process('autopilot.js',50)]).required,136);
});
const input={money:1e9,reserve:2e8,homeRam:128,node:7,signals:{route:'bladeburner',essentialHomeRam:{target:256}}};
test('essential RAM lifts the two-percent cap within the same total cash budget',()=>{
 const p=spendingPlan(input);assert.equal(p.allowances.home,4e8);
 assert.ok(Object.values(p.allowances).reduce((a,b)=>a+b,0)<=8e8+.001);
 assert.ok(p.reasons.some(s=>s.includes('256 GB')));
});
test('ordinary cap resumes at target and invalid targets cannot lift it',()=>{
 for(const target of [128,0,null,NaN,Infinity,2**31]){
  const p=spendingPlan({...input,signals:{route:'bladeburner',essentialHomeRam:{target}}});assert.ok(p.allowances.home<=16e6);
 }
 const p=spendingPlan({...input,homeRam:256});assert.ok(p.allowances.home<=16e6);
});
test('essential RAM preserves corporation startup capital and exhausted cash reserves',()=>{
 const p=spendingPlan({...input,money:200e9,reserve:10e9,signals:{...input.signals,corporationStartup:true}});
 assert.ok(p.allowances.corporation>=150e9);assert.ok(p.allowances.home<=40e9);assert.ok(Object.values(p.allowances).reduce((a,b)=>a+b,0)<=190e9+.001);
 const q=spendingPlan({...input,reserve:1e9});assert.equal(q.allowances.home,0);
});
function budgetFixture(){
 const now=Date.now(),files={'tasks/essential-home-ram.json':JSON.stringify({at:now,ownerPid:1,augReset:20,nodeReset:10,target:256})};
 const ns={read:p=>files[p]||'',write:(p,s)=>files[p]=s,getResetInfo:()=>({lastAugReset:20,lastNodeReset:10}),ps:()=>[{pid:1,filename:'autopilot.js'}],isRunning:()=>true,getPlayer:()=>({money:1000}),getServerMaxRam:()=>128};
 return {ns,files};
}
test('essential demand requires fresh evidence from the current live autopilot',()=>{
 const f=budgetFixture();assert.equal(adaptiveBudgetSignals(f.ns).essentialHomeRam.target,256);
 for(const change of [{at:Date.now()-46000},{at:Date.now()+1000},{augReset:21},{nodeReset:11},{target:Infinity},{ownerPid:2}]){
  const g=budgetFixture();g.files['tasks/essential-home-ram.json']=JSON.stringify({...JSON.parse(g.files['tasks/essential-home-ram.json']),...change});assert.equal(adaptiveBudgetSignals(g.ns).essentialHomeRam,null);
 }
 const g=budgetFixture();g.ns.ps=()=>[{pid:1,filename:'other.js'}];assert.equal(adaptiveBudgetSignals(g.ns).essentialHomeRam,null);
});
test('cached emergency allowance stops granting upgrades once native RAM meets target',()=>{
 const f=budgetFixture(),plan={epoch:1,ownerPid:1,reset:20,homeRam:128,expiresAt:Date.now()+10000,signals:input.signals,allowances:{home:500}};
 f.files['tasks/spending-plan.json']=JSON.stringify(plan);assert.equal(claimSpending(f.ns,'home',100),true);
 f.ns.getServerMaxRam=()=>256;assert.equal(claimSpending(f.ns,'home',100),false);
});
test('essential upgrade permission preserves augmentation savings and wallet reserves',()=>{
 const f=budgetFixture();f.files['tasks/spending-plan.json']=JSON.stringify({epoch:1,ownerPid:1,reset:20,homeRam:128,expiresAt:Date.now()+10000,signals:{...input.signals,augmentationCashTarget:{name:'Aug',cost:950}},allowances:{home:500}});
 assert.equal(claimSpending(f.ns,'home',100),false);
 f.files['reserve.txt']='950';assert.equal(claimSpending(f.ns,'home',100),false);
});
