import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseBladeburnerFarm,farmingDamage,bladeburnerFarmStartAllowed} from '../bladeburner-farming-policy.js';
import {bladeburnerRankRate} from '../bladeburner-policy.js';
import {blackOpHospitalCost} from '../black-op-risk-policy.js';
const metrics={Tracking:{level:1,count:100,time:1000,gain:1,loss:0,difficulty:125},Investigation:{level:1,count:100,time:1000,gain:10,loss:1,difficulty:400}};
const chances={Tracking:[1,1],Investigation:[.95,1]};
const context={threshold:.99,floor:.9,hp:{current:100,max:100},money:1e9,reserve:1e8,hrcTime:60000};
const choose=(m=metrics,c=chances,q=context)=>chooseBladeburnerFarm(Object.keys(m),c,m,q,bladeburnerRankRate,blackOpHospitalCost);
test('lower-bound expected rank selects a profitable routine mission while Raids remain excluded',()=>{
 const r=choose();assert.equal(r.name,'Investigation');assert.ok(r.score>r.baseline*1.15);assert.equal(r.damage,0);
 assert.equal(choose(metrics,{...chances,Investigation:[.5,1]}),null);
 assert.equal(choose({...metrics,Raid:metrics.Investigation},{Tracking:[1,1],Investigation:[0,1],Raid:[.95,1]}),null);
});
test('failure recovery, cash replacement, reserves and missing evidence can reject apparent gains',()=>{
 const injured={Tracking:metrics.Tracking,Assassination:{...metrics.Investigation,difficulty:1500,gain:10}};
 const c={Tracking:[1,1],Assassination:[.95,1]};assert.equal(choose(injured,c),null);
 assert.equal(choose(metrics,chances,{...context,hp:{current:80,max:100}}),null);
 assert.equal(choose(metrics,chances,{...context,hrcTime:null}),null);
 const fatal={Tracking:metrics.Tracking,Assassination:{...metrics.Investigation,difficulty:1e9,gain:1e8}};
 assert.equal(choose(fatal,c,{...context,cashRate:null}),null);
 assert.equal(choose(fatal,c,{...context,cashRate:1e9,reserve:context.money}),null);
 assert.equal(choose(metrics,{...chances,Investigation:[.95,.9]}),null);
});
test('dispatch validates the actual conservative chance, fixed level, health, reserve and reset',()=>{
 const r=choose(),ticket={...r,at:1000,ownerPid:1,nodeReset:2,augReset:3,cashRate:null};
 const live={name:r.name,type:'Operations',at:1100,ownerPid:1,nodeReset:2,augReset:3,level:1,difficulty:400,hp:context.hp,money:context.money,reserve:context.reserve,chance:[.95,1]};
 const allowed=q=>bladeburnerFarmStartAllowed(ticket,{...live,...q},blackOpHospitalCost,farmingDamage);
 assert.equal(allowed({}),true);
 for(const q of [{type:'Black Operations'},{chance:[.5,1]},{level:2},{hp:{current:80,max:100}},{augReset:4},{at:17000}])assert.equal(allowed(q),false);
});

test('the generated native transaction enforces the same farming ticket before starting a mission',async()=>{
 const {readFileSync}=await import('node:fs');const policies=await import('../bladeburner-policy.js'),risk=await import('../black-op-risk-policy.js'),support=await import('../bladeburner-support-economics-policy.js');
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),literal=source.match(/const startResult = await getNsDataThroughFile\(ns, (`[^`]+`)/)[1];
 const env={...policies,...risk,...support,bladeburnerFarmStartAllowed,farmingDamage,bbMutationGuard:'true'};
 const expression=Function(...Object.keys(env),'return '+literal)(...Object.values(env));
 const at=Date.now(),selected=choose(),ticket={...selected,at,ownerPid:1,nodeReset:2,augReset:3};let p=.95,starts=0;
 const ns={pid:99,args:['Operations','Investigation',0,.9,0,1,JSON.stringify({level:1}),false,JSON.stringify({Investigation:{base:400,factor:1.03}}),-1,0,'null','null',JSON.stringify(ticket)],read:()=>'',isRunning:()=>true,getResetInfo:()=>({lastNodeReset:2,lastAugReset:3}),getPlayer:()=>({hp:context.hp,money:context.money}),singularity:{getCurrentWork:()=>null,getOwnedAugmentations:()=>[]},
 bladeburner:{getActionCurrentLevel:()=>1,getActionMaxLevel:()=>1,getActionAutolevel:()=>false,setActionAutolevel(){},setActionLevel(){},getActionCountRemaining:()=>100,getActionEstimatedSuccessChance:()=>[p,1],getStamina:()=>[100,100],startAction:()=>{starts++;return true;}}};
 const run=()=>Function('ns','return '+expression)(ns);
 assert.equal(run().success,true);assert.equal(starts,1);p=.7;assert.equal(run().reason,'farming-risk-changed');assert.equal(starts,1);
});
