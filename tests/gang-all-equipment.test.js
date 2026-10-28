import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planGangEquipmentCollection} from '../gang-equipment-collection-policy.js';
import {spendingPlan,claimSpending} from '../spending-policy.js';
import {purchaseGangEquipment} from '../gang-policy.js';
const members={A:{name:'A',upgrades:[],augmentations:[]},B:{name:'B',upgrades:['Sword'],augmentations:[]}};
const equipment=[{name:'Sword',type:'Weapon',cost:10,stats:{str:2}},{name:'Hack Tool',type:'Rootkit',cost:5,stats:{hack:2}},{name:'Aug',type:'Augmentation',cost:20,stats:{cha:2}}];
test('collection includes every missing item and augmentation, cheapest first, independent of stats/ROI',()=>{
 const p=planGangEquipmentCollection(members,equipment,{cash:1000});
 assert.equal(p.remainingCount,5);assert.equal(p.remainingCost,60);assert.equal(p.orders.length,5);
 assert.deepEqual(p.orders.map(o=>o.cost),[5,5,10,20,20]);assert.ok(p.orders.every(o=>o.reason==='priority'));
 const complete={A:{...members.A,upgrades:['Sword','Hack Tool'],augmentations:['Aug']}};
 assert.equal(planGangEquipmentCollection(complete,equipment,{cash:1000}).remainingCount,0);
});
test('collection preserves budgets, handles future ascensions and bounds native batches',()=>{
 const p=planGangEquipmentCollection(members,equipment,{cash:30,equipmentFraction:0,augmentationFraction:1});
 assert.equal(p.orders.length,1);assert.equal(p.orders[0].type,'Augmentation');assert.equal(p.remainingCount,5);
 const skipped=planGangEquipmentCollection(members,equipment,{cash:1000,skipTransient:['A']});
 assert.ok(skipped.orders.some(o=>o.member==='A'&&o.type==='Augmentation'));assert.ok(!skipped.orders.some(o=>o.member==='A'&&o.type!=='Augmentation'));
 assert.equal(planGangEquipmentCollection(members,equipment,{cash:NaN}).orders.length,0);
 const many=Array.from({length:100},(_,i)=>({name:'E'+i,type:'Weapon',cost:1}));assert.equal(planGangEquipmentCollection({A:members.A},many,{cash:1000}).orders.length,64);
});
test('shared budget prioritizes the collection and protects it from corporation startup while retaining essential RAM',()=>{
 const base={money:200e9,reserve:10e9,homeRam:128,node:1,epoch:100,ownerPid:7,reset:2};
 const normal=spendingPlan(base),p=spendingPlan({...base,signals:{gangEquipmentPriority:{remainingCount:100,remainingCost:200e9},corporationStartup:true}});
 assert.ok(p.allowances.gang>normal.allowances.gang);assert.ok(p.allowances.gang>100e9);
 assert.ok(Object.values(p.allowances).reduce((n,v)=>n+v,0)<=190e9+.01);
 const ram=spendingPlan({...base,homeRam:32,signals:{gangEquipmentPriority:{remainingCount:100,remainingCost:200e9},essentialHomeRam:{target:128}}});assert.ok(ram.allowances.home>=95e9);
 const disabled=spendingPlan({...base,signals:{gangEquipmentPriority:{remainingCount:100,remainingCost:200e9},activeCategories:{gang:false}}});assert.equal(disabled.allowances.gang,0);
});
function fixture(){
 const at=Date.now(),proof={kind:'gang-equipment-priority',ownerPid:8,nodeReset:1,augReset:2,at,cost:10,member:'A',equipment:'Sword'};
 const report={schemaVersion:1,enabled:true,ownerPid:8,nodeReset:1,augReset:2,at,remainingCount:1,remainingCost:10,orders:[{member:'A',equipmentName:'Sword',cost:10}]};
 const plan={epoch:at,expiresAt:at+60000,ownerPid:7,reset:2,homeRam:128,signals:{augmentationCashTarget:{name:'Future augmentation',cost:100}},allowances:{gang:50}};
 const files=new Map([['reserve.txt','20'],['tasks/spending-plan.json',JSON.stringify(plan)],['tasks/gang-equipment-priority.json',JSON.stringify(report)]]);
 let money=100;const bought=[];
 const ns={read:f=>files.get(f)||'',write:(f,v)=>files.set(f,v),getPlayer:()=>({money}),getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),
  ps:()=>[{pid:7,filename:'autopilot.js'},{pid:8,filename:'gangs.js'}],isRunning:()=>true,
  gang:{getMemberInformation:()=>({upgrades:bought,augmentations:[]}),getEquipmentCost:()=>10,purchaseEquipment:(_m,item)=>{bought.push(item);money-=10;return true;}}};
 return {ns,files,proof,report,plan,bought,setMoney:n=>money=n};
}
test('fresh collection purchases can precede ordinary savings but never fixed reserves or shared allowances',()=>{
 const f=fixture();assert.equal(claimSpending(f.ns,'gang',10,f.proof),true);
 const reserve=fixture();reserve.setMoney(25);assert.equal(claimSpending(reserve.ns,'gang',10,reserve.proof),false);
 const budget=fixture();budget.plan.allowances.gang=5;budget.files.set('tasks/spending-plan.json',JSON.stringify(budget.plan));assert.equal(claimSpending(budget.ns,'gang',10,budget.proof),false);
});
test('stale, missing, foreign, disabled or unlisted priority evidence cannot borrow savings',()=>{
 for(const patch of [{at:Date.now()-30001},{at:Date.now()+10000},{nodeReset:2},{augReset:3},{ownerPid:9},{enabled:false},{remainingCount:0},{orders:[]}]){
  const f=fixture();f.files.set('tasks/gang-equipment-priority.json',JSON.stringify({...f.report,...patch}));assert.equal(claimSpending(f.ns,'gang',10,f.proof),false);
 }
 const f=fixture();f.files.delete('tasks/gang-equipment-priority.json');assert.equal(claimSpending(f.ns,'gang',10,f.proof),false);
});
test('active resets keep ordinary savings protection and native equipment purchase claims current proof',()=>{
 const reset=fixture();reset.files.set('tasks/augmentation-reset-plan.json',JSON.stringify({pending:true,augReset:2,expiresAt:Date.now()+60000,ownerPid:7}));assert.equal(claimSpending(reset.ns,'gang',10,reset.proof),false);
 const f=fixture(),order={member:'A',equipmentName:'Sword',cost:10,type:'Weapon',reason:'priority'};
 const receipts=purchaseGangEquipment(f.ns,[order],20,50,claimSpending,()=>true,true,8);
 assert.equal(receipts[0].success,true);assert.deepEqual(f.bought,['Sword']);
 assert.equal(purchaseGangEquipment(f.ns,[order],20,50,claimSpending,()=>true,true,8)[0].reason,'already-owned');
});
test('a valid timed augmentation wait remains protected from equipment collection',()=>{
 const f=fixture(),at=Date.now(),startedAt=at-1000,deadline=at+30000;
 f.plan.signals.augmentationCashTarget={name:'Timed augmentation',cost:100,source:'augmentation-wait',startedAt,deadline};
 f.files.set('tasks/spending-plan.json',JSON.stringify(f.plan));
 f.files.set('tasks/augmentation-wait-plan.json',JSON.stringify({schemaVersion:1,active:true,ownerPid:7,nodeReset:1,augReset:2,at,startedAt,expiresAt:at+60000,
  plan:{worthWaiting:true,name:'Timed augmentation',cashTarget:100,at,deadline}}));
 assert.equal(claimSpending(f.ns,'gang',10,f.proof),false);
});
test('controller enables collection by default and keeps the territory income rule',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(s,/prioritize-all-equipment', true/);
 assert.match(s,/planGangEquipmentCollection\(dictMembers,equipments/);assert.match(s,/gangTerritoryDevelopmentFocus/);assert.match(s,/gang-equipment-priority.json/);
});
