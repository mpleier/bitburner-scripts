import test from 'node:test';
import assert from 'node:assert/strict';
import {augmentationSavingsTarget} from '../progression-improvements-policy.js';
import {claimSpending,adaptiveBudgetSignals} from '../spending-policy.js';
import {purchaseGangEquipment} from '../gang-policy.js';
const reset={lastNodeReset:1,lastAugReset:3};
const target=(name,cost,strength)=>({name,directCost:cost,stats:{strength},rep:100,factions:['F']});
function rank(targets,economics={cashRate:1,recoveryMs:1200000,rebuildMs:0}){return augmentationSavingsTarget({at:100000,augReset:3,reputation:{F:100},targets},reset,100,'bladeburner',100000,economics);}
test('savings prefers stronger estimated route growth per funding and recovery time over lowest price',()=>{
 const d=rank([target('Cheap',150,1.1),target('Strong',250,2)]);assert.equal(d.name,'Strong');assert.equal(d.source,'growth-ranked');assert.equal(d.waitMs,150000);assert.equal(d.recoveryMs,1200000);assert.ok(d.score>0);
});
test('cash wait and rebuild downtime both affect the preferred savings target',()=>{
 const targets=[target('Cheap',150,1.5),target('Strong',250,2)];assert.equal(rank(targets,{cashRate:1,recoveryMs:0,rebuildMs:0}).name,'Cheap');assert.equal(rank(targets,{cashRate:1,recoveryMs:0,rebuildMs:1200000}).name,'Strong');
});
test('unknown timing evidence retains the existing price fallback',()=>{
 const targets=[target('Cheap',150,1.1),target('Strong',250,2)];
 for(const e of [null,{cashRate:0,recoveryMs:0,rebuildMs:0},{cashRate:1,recoveryMs:NaN,rebuildMs:0},{cashRate:1,recoveryMs:0,rebuildMs:null}])assert.deepEqual(rank(targets,e),{name:'Cheap',cost:150});
});
test('savings preserves milestone priority, reputation eligibility and reachability',()=>{
 const pill={...target('The Red Pill',150,1),stats:{}};assert.equal(rank([target('Strong',250,2),pill]).name,'The Red Pill');
 for(const patch of [{rep:101},{directCost:null},{directCost:301},{stats:{strength:NaN}}])assert.equal(rank([{...target('Unavailable',150,2),...patch}]),null);
});
test('known route completion excludes investments whose wait and rebuild arrive too late',()=>{
 assert.equal(rank([target('Late',150,2)],{cashRate:1,recoveryMs:1200000,rebuildMs:0,remainingMs:600000}),null);
 assert.equal(rank([{...target('The Red Pill',150,1),stats:{}}],{cashRate:1,recoveryMs:1200000,rebuildMs:0,remainingMs:600000}).name,'The Red Pill');
});
test('fresh operation weights favor useful combat stats over irrelevant large multipliers',()=>{
 const combat={player:{skills:{strength:100,dexterity:100}},metadata:{weights:{strength:1,dexterity:0},decays:{strength:1,dexterity:1}}};
 assert.equal(rank([target('Useful',150,1.1),{...target('Irrelevant',150,1),stats:{dexterity:4}}],{cashRate:1,recoveryMs:1200000,rebuildMs:0,combat}).name,'Useful');
});
function fixture(){
 const now=Date.now();let money=100000;const files={'reserve.txt':'0'};
 const plan={epoch:now,expiresAt:now+60000,reset:3,ownerPid:7,homeRam:1024,signals:{augmentationCashTarget:{name:'Goal',cost:300000},augmentationFunding:{rate:100,at:now,nodeReset:1,augReset:3}},allowances:{gang:10000,servers:10000}};
 files['tasks/spending-plan.json']=JSON.stringify(plan);
 // Model a completed collection window; this call must still supply a fresh native quote.
 files['tasks/growth-investment-auction.json']=JSON.stringify({schemaVersion:1,scope:JSON.stringify([1,3,7,'Goal',300000]),startedAt:now-31000,collectUntil:now-1000,expiresAt:now+29000,bids:[]});
 const proof={kind:'gang-equipment',at:now,ownerPid:8,nodeReset:1,augReset:3,cost:500,gainPerSecond:100,member:'A',equipment:'Bat'};
 const ns={read:p=>files[p]||'',write:(p,v)=>files[p]=v,getPlayer:()=>({money}),getResetInfo:()=>reset,ps:()=>[{pid:7,filename:'autopilot.js'},{pid:8,filename:'gangs.js'}],isRunning:()=>true};
 return {ns,files,plan,proof,setMoney:v=>money=v};
}
test('short-payback cash equipment can fund the selected augmentation sooner',()=>{
 const f=fixture();assert.equal(claimSpending(f.ns,'gang',500),false);assert.equal(claimSpending(f.ns,'gang',500,f.proof),true);
 const usage=JSON.parse(f.files['tasks/spending-usage.json']);assert.equal(usage.spent.gang,500);assert.equal(usage.growthException.projectedGainPerSecond,50);
});
test('savings exceptions cannot stack within an epoch or through rapid budget renewals',()=>{
 const f=fixture();f.plan.epoch-=1000;f.files['tasks/spending-plan.json']=JSON.stringify(f.plan);assert.equal(claimSpending(f.ns,'gang',500,f.proof),true);assert.equal(claimSpending(f.ns,'gang',500,f.proof),false);
 f.plan.epoch+=1;f.files['tasks/spending-plan.json']=JSON.stringify(f.plan);assert.equal(claimSpending(f.ns,'gang',500,f.proof),false);
 const usage=JSON.parse(f.files['tasks/spending-usage.json']);usage.growthException.at=Date.now()-60001;f.files['tasks/spending-usage.json']=JSON.stringify(usage);
 const a=JSON.parse(f.files['tasks/growth-investment-auction.json']),now=Date.now();a.state='ready';a.startedAt=now-31000;a.collectUntil=now-1000;a.expiresAt=now+29000;a.bids=[];f.files['tasks/growth-investment-auction.json']=JSON.stringify(a);
 assert.equal(claimSpending(f.ns,'gang',500,f.proof),true);
});
test('investment cannot bypass explicit reserves, shared allowance or its wallet exposure cap',()=>{
 for(const setup of [f=>f.files['reserve.txt']='99900',f=>{f.plan.allowances.gang=499;},f=>f.setMoney(40000)]){const f=fixture();setup(f);f.files['tasks/spending-plan.json']=JSON.stringify(f.plan);assert.equal(claimSpending(f.ns,'gang',500,f.proof),false);}
});
test('stale, future, reset-mismatched or unowned investment quotes fail closed',()=>{
 for(const patch of [{at:Date.now()-5001},{at:Date.now()+10000},{ownerPid:7},{ownerPid:99},{nodeReset:2},{augReset:2},{cost:499},{gainPerSecond:NaN},{gainPerSecond:0},{kind:'other'}]){const f=fixture();assert.equal(claimSpending(f.ns,'gang',500,{...f.proof,...patch}),false);}
});
test('funding-rate evidence and a meaningful projected advantage are required',()=>{
 for(const setup of [f=>f.plan.signals.augmentationFunding=null,f=>f.plan.signals.augmentationFunding.rate=0,f=>f.plan.signals.augmentationFunding.at-=120001,f=>f.plan.signals.augmentationFunding.augReset=2,f=>f.proof.gainPerSecond=.01,f=>f.plan.signals.augmentationFunding.rate=10000]){const f=fixture();setup(f);f.files['tasks/spending-plan.json']=JSON.stringify(f.plan);assert.equal(claimSpending(f.ns,'gang',500,f.proof),false);}
});
test('pending resets and valid install-wait reservations remain protected',()=>{
 const f=fixture();f.files['tasks/augmentation-reset-plan.json']=JSON.stringify({pending:true,augReset:3,ownerPid:7,expiresAt:Date.now()+30000});assert.equal(claimSpending(f.ns,'gang',500,f.proof),false);
 delete f.files['tasks/augmentation-reset-plan.json'];const at=Date.now(),startedAt=at-1000,deadline=at+60000;
 f.plan.signals.augmentationCashTarget={name:'Goal',cost:300000,source:'augmentation-wait',startedAt,deadline};
 f.files['tasks/augmentation-wait-plan.json']=JSON.stringify({schemaVersion:1,active:true,ownerPid:7,nodeReset:1,augReset:3,at,startedAt,expiresAt:deadline,plan:{worthWaiting:true,name:'Goal',cashTarget:300000,at,deadline}});
 f.files['tasks/spending-plan.json']=JSON.stringify(f.plan);assert.equal(claimSpending(f.ns,'gang',500,f.proof),false);
});
test('other categories cannot borrow from savings and serialized claims keep all guards',()=>{
 const f=fixture(),claim=Function('return ('+claimSpending.toString()+')')();assert.equal(claim(f.ns,'servers',500,f.proof),false);assert.equal(claim(f.ns,'gang',500,f.proof),true);
});
function nativeFixture(){
 const f=fixture(),member={name:'A',task:'Work',upgrades:[],augmentations:[]};for(const k of ['hack','str','def','dex','agi','cha']){member[k+'_mult']=1;member[k+'_asc_mult']=1;member[k+'_exp']=10000;}
 let purchases=0;f.ns.fileExists=()=>true;f.ns.gang={getMemberInformation:()=>member,getGangInformation:()=>({}),getTaskStats:()=>({money:true}),getEquipmentStats:()=>({str:2}),getEquipmentCost:()=>500,purchaseEquipment:()=>{purchases++;return true;}};
 f.ns.formulas={gang:{moneyGain:(g,m,t)=>t.money?m.str:0,wantedLevelGain:()=>0}};
 const execute=(purchase=purchaseGangEquipment)=>purchase(f.ns,[{member:'A',equipmentName:'Bat',cost:500,reason:'production'}],0,500,claimSpending,()=>true,true,8);
 return {...f,member,execute,purchases:()=>purchases};
}
test('actual purchase worker obtains its own native marginal cash quote before spending',()=>{
 const f=nativeFixture();assert.equal(f.execute()[0].success,true);assert.equal(f.purchases(),1);assert.ok(JSON.parse(f.files['tasks/spending-usage.json']).growthException.projectedGainPerSecond>0);
});
test('missing formulas, increased wanted and nonproductive current tasks cannot justify an investment',()=>{
 for(const change of [f=>f.ns.fileExists=()=>false,f=>f.ns.formulas.gang.wantedLevelGain=(g,m)=>m.str,f=>f.ns.gang.getTaskStats=()=>({money:false}),f=>f.member.upgrades=['Bat']]){const f=nativeFixture();change(f);assert.equal(f.execute()[0].success,false);assert.equal(f.purchases(),0);}
});
test('serialized native equipment worker retains the proof and spending checks',()=>{
 const f=nativeFixture();assert.equal(f.execute(Function('return ('+purchaseGangEquipment.toString()+')')())[0].success,true);
});
test('budget signals use only fresh source-based income and include fresh recovery economics',()=>{
 const f=fixture(),at=Date.now();f.files['tasks/speed-observation.json']=JSON.stringify({at,augReset:3,rateMeasuredAt:at,cashRate:100,cashObservation:{mode:'sources-v1'}});
 f.files['tasks/progression-speed.json']=JSON.stringify({at,augReset:3,recoveryMs:1200000,resetEconomics:{rebuildMs:0}});
 f.files['/Temp/affordable-augs.txt']=JSON.stringify({speedSnapshot:{at,augReset:3,reputation:{F:100},targets:[target('Cheap',150000,1.1),target('Strong',250000,2)]}});
 f.files['tasks/node-route-plan.json']=JSON.stringify({at,augReset:3,nodeReset:1,ownerPid:7,selected:'bladeburner'});
 let signals=adaptiveBudgetSignals(f.ns);assert.equal(signals.augmentationFunding.rate,100);assert.equal(signals.augmentationCashTarget.name,'Strong');
 f.files['tasks/speed-observation.json']=JSON.stringify({at,augReset:3,rateMeasuredAt:at-120001,cashRate:100,cashObservation:{mode:'sources-v1'}});signals=adaptiveBudgetSignals(f.ns);assert.equal(signals.augmentationFunding,null);assert.equal(signals.augmentationCashTarget.name,'Cheap');
});
