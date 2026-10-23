import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rotateGangMaterialCandidates,gangEquipmentCandidateKey,planMarginalGangEquipment,forecastGangEquipmentDevelopment,projectGangMember} from '../gang-policy.js';
const candidate=(name,cost=20)=>({member:'M',equipmentName:name,cost});
test('rotation advances stable material keys while preserving cheap positions',()=>{
 const list=[candidate('C'),candidate('cheap',1),candidate('A'),candidate('B')],before=structuredClone(list);
 const a=rotateGangMaterialCandidates(list,null,1000);assert.deepEqual(a.map(c=>c.equipmentName),['A','cheap','B','C']);
 const b=rotateGangMaterialCandidates(list,gangEquipmentCandidateKey(a[0]),1000);assert.deepEqual(b.map(c=>c.equipmentName),['B','cheap','C','A']);assert.deepEqual(list,before);
 assert.deepEqual(rotateGangMaterialCandidates(list,'zz',1000).map(c=>c.equipmentName),['A','cheap','B','C']);
 assert.equal(rotateGangMaterialCandidates(list,null,null),list);
});
test('cursor survives removed candidates and bundle item order changes',()=>{
 const cursor=gangEquipmentCandidateKey(candidate('B'));assert.deepEqual(rotateGangMaterialCandidates([candidate('A'),candidate('C')],cursor,1000).map(c=>c.equipmentName),['C','A']);
 assert.equal(gangEquipmentCandidateKey({member:'M',items:[{name:'Z'},{name:'A'}]}),gangEquipmentCandidateKey({member:'M',items:[{name:'A'},{name:'Z'}]}));
});
test('budget-deferred comparisons do not advance past candidates that never received evidence',()=>{
 const equipment=Array.from({length:7},(_,i)=>({name:'G'+i,type:'Weapon',cost:20,stats:{str:2}})),seen=new Set();let cursor=null;
 for(let pass=0;pass<3;pass++){
  let checks=0;
  const r=planMarginalGangEquipment({members:{M:{name:'M',str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]}},equipment,evaluate:()=>({moneyGain:100}),
   horizon:900,materialCash:1000,purchaseCursor:cursor,maxBundleEvaluations:0,maxPurchaseChecks:8,
   purchaseGuard:c=>{if(checks++>=3)return {allowed:false,deferredRotation:true};seen.add(c.equipmentName);return {allowed:false,reason:'compared'};},
   budgets:{available:1000,equipmentLimit:1000,augLimit:1000,bootstrapBudget:1000}});
  cursor=r.diagnostics.nextPurchaseCursor;assert.equal(r.orders.length,0);
 }
 assert.equal(seen.size,7);
});
const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
function fixture(){const m=projectGangMember({name:'A',str_exp:1000,str_mult:1,str_asc_mult:1,task:'Work'},null,0),threshold=projectGangMember(m,training,150).str;
 return {members:{A:m,B:{...m,name:'B'}},name:'A',stats:{str:1.1},gang:{respect:1000,wantedLevel:1},training,tasks:{Work:{name:'Work',difficulty:0,baseWanted:0},'Train Combat':training},horizonSeconds:900,
  evaluate:(m,g,t)=>{const value=t==='Work'?(m.str>=threshold?10000:1):0;return {value,money:value,respect:0,wanted:0};},compareFreeTraining:true,cost:1,costWeight:1,maxSimulations:11,extendedWindows:true};}
test('longer recovery windows expose productive unlocks missed by short training',()=>{
 const long=forecastGangEquipmentDevelopment(fixture());assert.equal(long.comparison.freeTrainingSeconds,200);assert.equal(long.comparison.checks,5);assert.equal(long.comparison.allowed,false);
 const short=forecastGangEquipmentDevelopment({...fixture(),extendedWindows:false});assert.ok(long.comparison.freeProduction>short.comparison.freeProduction);
});
test('extended windows stay bounded by horizon and reject incomplete trajectory searches',()=>{
 const short=forecastGangEquipmentDevelopment({...fixture(),horizonSeconds:200});assert.equal(short.comparison.checks,3);
 assert.equal(forecastGangEquipmentDevelopment({...fixture(),maxSimulations:5}),null);
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(s,/equipmentPurchaseCursor=plan.diagnostics.nextPurchaseCursor/);assert.match(s,/saved.nodeReset===resetInfo.lastNodeReset/);assert.match(s,/extendedWindows:true/);assert.match(s,/maxPlanningMs:budgetMs,maxSimulations:17/);
});

test('extended ascension recovery compares all bounded windows within eleven trajectories',()=>{
 const f=fixture(),retained={...f.members.A,str_exp:0,str_mult:1,str_asc_mult:100};
 const r=forecastGangEquipmentDevelopment({...f,alternativeAscension:{member:retained,respectLoss:1}});
 assert.equal(r.comparison.checks,9);assert.equal(r.diagnostics.simulations,11);
 assert.equal(forecastGangEquipmentDevelopment({...f,alternativeAscension:{member:retained,respectLoss:1},maxSimulations:10}),null);
});

test('repeated power and production rankings share one material comparison slot',()=>{
 const list=[{...candidate('A'),reason:'power'},candidate('cheap',1),{...candidate('A'),reason:'production'},candidate('B')];
 const rotated=rotateGangMaterialCandidates(list,null,1000);assert.equal(rotated.length,3);assert.equal(rotated.filter(c=>c.equipmentName==='A').length,1);assert.equal(rotated.find(c=>c.equipmentName==='A').reason,'power');
});
