import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangComparisonBudget,recordGangComparisonTiming,forecastGangEquipmentDevelopment,projectGangMember,planMarginalGangEquipment} from '../gang-policy.js';
const now=100000,row=(patch={})=>({at:now-1,elapsedMs:25,budgetMs:25,incomplete:true,...patch});
test('repeated expensive failures concentrate time without raising total comparison allowance',()=>{
 const normal=gangComparisonBudget([],now);assert.equal(normal.candidateLimit,3);assert.equal(normal.perComparisonMs,25);
 const adapted=gangComparisonBudget([row(),row()],now);assert.equal(adapted.candidateLimit,1);assert.equal(adapted.perComparisonMs,50);assert.ok(adapted.candidateLimit*adapted.perComparisonMs<=normal.candidateLimit*normal.perComparisonMs);
 assert.equal(gangComparisonBudget([row(),row(),row({incomplete:false}),row({incomplete:false})],now).candidateLimit,3);
});
test('stale future malformed and quick incomplete observations cannot expand time',()=>{
 for(const r of [row({at:now-60001}),row({at:now+1}),row({elapsedMs:NaN}),row({budgetMs:Infinity}),row({elapsedMs:101}),row({elapsedMs:1})])assert.equal(gangComparisonBudget([r,r],now).perComparisonMs,25);
 const history=Array.from({length:20},()=>row());assert.equal(recordGangComparisonTiming(history,row(),now).length,8);
});
const combat={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0},hacking={name:'Train Hacking',difficulty:100,hackWeight:100,baseWanted:0},charisma={name:'Train Charisma',difficulty:100,chaWeight:100,baseWanted:0};
function fixture(){
 const keys=['hack','str','def','dex','agi','cha'],m=projectGangMember({name:'A',task:'Work',...Object.fromEntries(keys.flatMap(k=>[[k+'_exp',1000],[k+'_mult',1],[k+'_asc_mult',1]]))},null,0),threshold=projectGangMember(m,hacking,90).hack;
 return {members:{A:m,B:{...m,name:'B'}},name:'A',stats:{str:1.1},gang:{respect:1000,wantedLevel:1},training:combat,tasks:{Work:{name:'Work',difficulty:0,baseWanted:0},'Train Combat':combat,'Train Hacking':hacking,'Train Charisma':charisma},horizonSeconds:900,
  evaluate:(m,g,t)=>{const value=t==='Work'?(m.hack>=threshold?10000:1):0;return {value,money:value,respect:0,wanted:0};},compareFreeTraining:true,extendedWindows:true,alternateTrainingTasks:true,cost:1,costWeight:1,maxSimulations:17};
}
test('alternate training tasks expose a hacking unlock that combat training misses',()=>{
 const r=forecastGangEquipmentDevelopment(fixture());assert.equal(r.comparison.freeTrainingTask,'Train Hacking');assert.equal(r.comparison.freeTrainingSeconds,120);assert.equal(r.comparison.checks,9);assert.equal(r.comparison.allowed,false);
 const primary=forecastGangEquipmentDevelopment({...fixture(),alternateTrainingTasks:false});assert.ok(r.comparison.freeProduction>primary.comparison.freeProduction);
});
test('full alternate training and ascension search is bounded by seventeen trajectories',()=>{
 const f=fixture(),retained={...f.members.A,hack_exp:0,hack_mult:1,hack_asc_mult:2};
 const r=forecastGangEquipmentDevelopment({...f,alternativeAscension:{member:retained,respectLoss:1}});assert.equal(r.comparison.checks,15);assert.equal(r.diagnostics.simulations,17);
 const incomplete=forecastGangEquipmentDevelopment({...f,maxSimulations:3,returnIncomplete:true});assert.equal(incomplete.verified,false);assert.equal(incomplete.comparison,undefined);assert.equal(incomplete.diagnostics.alternativeIncomplete,true);
});
test('no-training and missing optional task data keep the smaller legal search',()=>{
 const f=fixture(),no=forecastGangEquipmentDevelopment({...f,trainingPermitted:false});assert.equal(no.comparison.checks,0);
 delete f.tasks['Train Hacking'];delete f.tasks['Train Charisma'];assert.equal(forecastGangEquipmentDevelopment(f).comparison.checks,5);
});
test('purchase guards receive the remaining global planning time',()=>{
 let clock=0,remaining;
 planMarginalGangEquipment({members:{M:{name:'M',str_exp:10000,str_mult:1,str_asc_mult:1,upgrades:[],augmentations:[]}},equipment:[{name:'Gear',type:'Weapon',cost:10,stats:{str:2}}],evaluate:()=>({moneyGain:100}),
  now:()=>clock++,maxPlanningMs:100,purchaseGuard:(c,crew,spent,planning)=>{remaining=planning.remainingMs;return {allowed:false};},budgets:{available:100,equipmentLimit:100,augLimit:100,bootstrapBudget:100}});
 assert.ok(remaining>0&&remaining<=100);
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(source,/Math.min\(comparisonBudget.perComparisonMs/);assert.match(source,/comparisonTiming=recordGangComparisonTiming/);assert.match(source,/alternateTrainingTasks:true,returnIncomplete:true/);
});
