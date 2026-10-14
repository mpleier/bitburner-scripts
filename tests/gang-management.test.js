import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gangFocus,warfareDecision,chooseGangAscensions,gangTaskTotals,wantedRecoveryOrder,purchaseGangEquipment,gangMutationAllowed,gangOptionsError,gangTrainingRequired,nextWantedDowngrade,betterGangPlan} from '../gang-policy.js';
test('gang focus prioritizes recruitment before money and retains explicit overrides',()=>{
 const data={members:10,factionRep:1e7,requiredRep:1,money:1e6,respect:1e5};
 assert.equal(gangFocus(data),'respect');assert.equal(gangFocus({...data,moneyFocus:true}),'money');
 assert.equal(gangFocus({...data,members:12}),'money');
 assert.equal(gangFocus({...data,members:12,factionRep:0,money:1e12}),'respect');
 assert.equal(gangFocus({...data,members:12,factionRep:0}),'both money and respect');
});
test('warfare requires safe odds against every active rival',()=>{
 const gang={faction:'Mine',power:100,territory:.2};
 const rivals={Weak:{power:1,territory:.3},Strong:{power:200,territory:.5}};
 const decision=warfareDecision(gang,rivals);assert.ok(decision.average>.6);assert.equal(decision.engage,false);
 assert.equal(warfareDecision({...gang,power:1000},rivals).engage,true);
 assert.equal(warfareDecision({...gang,power:1000,territory:1},rivals).engage,false);
 assert.equal(warfareDecision(gang,{Gone:{power:1e9,territory:0}}).engage,false);
});
test('ascensions retain recruitment respect and stagger member resets',()=>{
 const names=Array.from({length:10},(_,i)=>'M'+i);
 const results=Object.fromEntries(names.map(n=>[n,{str:2,def:2,dex:2,agi:2,respect:500}]));
 const gang={respect:10000,respectForNextRecruit:20000};
 assert.equal(chooseGangAscensions(results,gang,names,['str','def','dex','agi']).length,1);
 assert.equal(chooseGangAscensions(results,{...gang,respect:18000},names,['str','def']).length,0);
 const costly={M0:{str:4,def:4,respect:5000}};
 assert.equal(chooseGangAscensions(costly,gang,names,['str','def']).length,0);
});
test('task totals use rate objects and support negative wanted gains',()=>{
 assert.deepEqual(gangTaskTotals({A:{money:5,respect:2,wanted:1},B:{money:0,respect:0,wanted:-2}}),{money:5,respect:2,wanted:-1});
});
test('wanted recovery picks the least production loss per reduction',()=>{
 const rate=(money,wanted,name='Crime')=>({name,money,respect:money/100,wanted});
 const rates={A:[rate(1000,2),rate(0,-1,'Recovery')],B:[rate(10,2),rate(0,-1,'Recovery')]};
 assert.deepEqual(wantedRecoveryOrder(['A','B'],{A:'Crime',B:'Crime'},rates,'Recovery','money'),['B','A']);
});
test('equipment purchases recheck actual prices and changing reserved cash',()=>{
 let money=100,reserve=20;const calls=[];
 const ns={read:()=>String(reserve),getPlayer:()=>({money}),gang:{getEquipmentCost:()=>30,purchaseEquipment:(member,name)=>{money-=30;reserve=60;calls.push(name);return true;}}};
 const orders=[{member:'A',equipmentName:'First'},{member:'B',equipmentName:'Second'}];
 assert.deepEqual(purchaseGangEquipment(ns,orders,20,60),[true,false]);assert.deepEqual(calls,['First']);
 assert.deepEqual(purchaseGangEquipment(ns,orders,20,0),[false,false]);
});
test('gang manager integrates task fixes, guards, native formulas and pause support',async()=>{
 const source=await readFile(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/gangTaskTotals\(bestTaskAssignments\)/);
 assert.match(source,/chooseGangAscensions\(/);
 assert.match(source,/warfareDecision\(/);
 assert.match(source,/wantedRecoveryOrder\(/);
 assert.match(source,/\.map\(m => ns.gang.setMemberTask\(m.name, m.task\)\)\.every\(Boolean\)/);
 assert.match(source,/isScriptPaused/);assert.match(source,/ns.formulas.gang.moneyGain/);
 assert.match(source,/myGangInfo.moneyGainRate \/ 1000 \+ myGangInfo.respectGainRate/);
 assert.doesNotMatch(source,/myGangMembers.map\(m => assignedTasks\[m\]\).reduce/);
});


test('pending gang helpers reject dead, paused or challenge-blocked owners',()=>{
 let alive=true,paused='',profile='';const ns={isRunning:()=>alive,read:p=>p.includes('paused')?paused:profile,getResetInfo:()=>({lastNodeReset:7})};
 assert.equal(gangMutationAllowed(ns,1),true);alive=false;assert.equal(gangMutationAllowed(ns,1),false);
 alive=true;paused='true';assert.equal(gangMutationAllowed(ns,1),false);paused='';
 profile=JSON.stringify({active:true,nodeReset:7,deniedActions:['gang']});assert.equal(gangMutationAllowed(ns,1),false);
 profile=JSON.stringify({active:true,nodeReset:8,deniedActions:['gang']});assert.equal(gangMutationAllowed(ns,1),true);
});
test('equipment workers stop buying immediately when their owner becomes paused',()=>{
 let allowed=true,purchases=0;const ns={read:()=>'',getPlayer:()=>({money:100}),gang:{getEquipmentCost:()=>10,purchaseEquipment:()=>{purchases++;allowed=false;return true;}}};
 assert.deepEqual(purchaseGangEquipment(ns,[{member:'A',equipmentName:'X'},{member:'B',equipmentName:'X'}],0,100,()=>true,()=>allowed),[true,false]);assert.equal(purchases,1);
});
test('gang options reject impossible budgets, training and ascension settings',()=>{
 const o={'training-percentage':.05,'equipment-budget':null,'augmentations-budget':null,'warfare-win-chance':.75,'min-training-ticks':10,'ascend-multi-threshold-spacing':.05,reserve:null,'ascend-multi-threshold':1.05};
 assert.equal(gangOptionsError(o),null);
 for(const patch of [{'training-percentage':2},{'reserve':-1},{'min-training-ticks':-1},{'ascend-multi-threshold':1},{'ascend-multi-threshold-spacing':-1},{'money-focus':true,'reputation-focus':true}])assert.ok(gangOptionsError({...o,...patch}));
});
test('training windows preserve a reset at time zero and release after the configured duration',()=>{
 assert.equal(gangTrainingRequired(0,100,10),true);assert.equal(gangTrainingRequired(undefined,100,10),false);assert.equal(gangTrainingRequired(0,200000,10),false);
});
test('wanted recovery cannot override mandatory training or make a non-improving downgrade',()=>{
 const current={A:{name:'Train',wanted:0},B:{name:'Crime',wanted:3}},rates={A:[{name:'Recovery',wanted:-5}],B:[{name:'Crime',wanted:3},{name:'Less',wanted:1}]};
 assert.deepEqual(nextWantedDowngrade(current,rates,['A']),{name:'B',task:{name:'Less',wanted:1}});
 assert.equal(nextWantedDowngrade({B:{name:'Less',wanted:1}}, {B:[{name:'Same',wanted:1}]}),null);
});
test('gang plans prefer feasibility before profit and reduce infeasible wanted gains',()=>{
 assert.equal(betterGangPlan(0,1,2,100,0),true);assert.equal(betterGangPlan(1,100,0,1,0),false);
 assert.equal(betterGangPlan(1,10,2,100,0),true);assert.equal(betterGangPlan(-1,10,0,5,0),true);
 assert.equal(betterGangPlan(2,100,1,10,0),false);
});
test('recruitment, tasks, ascensions and clashes recheck pause state in generated workers',async()=>{
 const s=await readFile(new URL('../gangs.js',import.meta.url),'utf8');
 assert.ok(s.includes('while (!isScriptPaused(ns,ns.getScriptName()))'));assert.ok(s.includes('if(!await doRecruitMember(ns))await ns.sleep(1000)'));
 assert.ok(s.includes('steps<myGangMembers.length*allTaskNames.length'));assert.ok(s.includes('const engage=allowed&&ns.args[0]&&'));
 assert.ok(s.includes('autopilotSourceFiles(resetInfo)'));assert.ok(s.includes("ns.gang.getMemberInformation(name).task==='Territory Warfare'"));
});
