import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forecastGangCrewTraining,projectGangMember,planGangTrainingBursts} from '../gang-policy.js';
const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0},work={name:'Work',difficulty:0,baseWanted:0};
const member=name=>projectGangMember({name,str_exp:0,str_mult:1,str_asc_mult:1,task:'Work'},null,0);
function fixture(extra={}){return {members:{Strong:member('Strong'),Weak:member('Weak')},gang:{respect:1000,wantedLevel:1},training,tasks:{Work:work,'Train Combat':training},horizonSeconds:900,
 prioritizeWeakTraining:true,maxSimulations:3,valuationOffset:6,evaluate:(m,g,t)=>{const value=t==='Work'?(m.name==='Strong'?1000:m.str>=30?100:1):0;return {value,money:value,respect:0,wanted:0};},...extra};}
test('low contribution members get completed training comparisons within bounded search',()=>{
 const r=forecastGangCrewTraining(fixture());assert.equal(r.diagnostics.weakTrainingPriority,'Weak');assert.equal(r.forecasts.Weak.train,true);assert.ok(r.diagnostics.simulations<=4);
 assert.equal(r.forecasts.Strong.train,false);
 const rows=['Strong','Weak'].map(name=>({name,resetAt:0,mandatory:false,permitted:true,value:name==='Strong'?1000:1,forecast:r.forecasts[name]}));
 const p=planGangTrainingBursts(rows,{},1000,null,{growthFirst:true});assert.equal(p.plans.Weak,true);assert.equal(p.plans.Strong,false);
});
test('weak-member preference never bypasses payback or milestone protections',()=>{
 const no=forecastGangCrewTraining(fixture({evaluate:(m,g,t)=>{const value=t==='Work'?(m.name==='Strong'?1000:1):0;return {value,money:value,respect:0,wanted:0};}}));assert.equal(no.forecasts.Weak.train,false);
 const urgent=forecastGangCrewTraining(fixture({goals:[{name:'rep',resource:'respect',amount:20}],evaluate:(m,g,t)=>{const value=t==='Work'?(m.name==='Strong'?1000:m.str>=30?100:1):0;return {value,money:value,respect:t==='Work'&&m.name==='Weak'?1:0,wanted:0};}}));assert.equal(urgent.forecasts.Weak.train,false);assert.equal(urgent.forecasts.Weak.milestoneBlocked,true);
});
test('manual members and balanced crews do not receive weak training priority',()=>{
 const manual=forecastGangCrewTraining(fixture({fixedTasks:{Weak:'Work'}}));assert.equal(manual.diagnostics.weakTrainingPriority,null);
 const equal=forecastGangCrewTraining(fixture({evaluate:(m,g,t)=>({value:t==='Work'?1:0,money:t==='Work'?1:0,respect:0,wanted:0})}));assert.equal(equal.diagnostics.weakTrainingPriority,null);
});
test('controller enables weak training evaluations and selected bundle goals',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(s,/growthFirst:true,prioritizeWeakTraining:true/);assert.match(s,/purchaseGoal=readSelectedGangBundleGoal\(ns,myGangFaction,resetInfo\)\|\|purchaseGoal/);
});
