import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangPreparationComparison,gangPreparationStatus,gangPowerBenefit,releaseGangPreparationTraining,gangPowerPurchaseAllowed} from '../gang-power-policy.js';
import {gangWarfareContext,gangWarfareDuty,forecastGangCrewTraining,projectGangMember,planGangTrainingBursts,warfareDecision,ascendGangMemberSafely} from '../gang-policy.js';
import {planGangAttrition} from '../gang-attrition-policy.js';
const now=100000,gang={faction:'Own',power:200,territory:.2,territoryClashChance:0,territoryWarfareEngaged:false};
function snapshot(power=100){return {at:now,faction:'Own',gangs:{Own:{power:gang.power,territory:.2},Rival:{power,territory:.8},Defeated:{power:10000,territory:0}},powerHistory:{Rival:[1,1,1]}};}
const timing={detected:true,paddingMs:200,intervalMs:200,restoreMs:1,powerPriority:true,trainingFirst:true};
test('preparation targets at least 75 percent against every active rival with a moving power goal',()=>{
 const r=gangPreparationStatus(gang,snapshot(),.75,now);assert.equal(r.active,true);assert.equal(r.targetPower,300);assert.equal(r.strongest,'Rival');
 assert.equal(gangPreparationStatus({...gang,power:300},snapshot(),.75,now).ready,true);
 assert.equal(gangPreparationStatus({...gang,power:300},snapshot(110),.75,now).active,true);
 assert.equal(gangPreparationStatus(gang,snapshot(),.6,now).target,.75);
 assert.ok(Math.abs(gangPreparationStatus(gang,snapshot(),.8,now).targetPower-400)<1e-9);
 for(const snap of [null,{...snapshot(),at:now-45001},{...snapshot(),at:now+1},{...snapshot(),faction:'Other'}])assert.equal(gangPreparationStatus(gang,snap,.75,now).known,false);
 assert.equal(gangPreparationStatus(gang,snapshot(),.75,now,false).enabled,false);
});
test('explicit power priority continues after readiness while balanced mode preserves higher thresholds',()=>{
 const before=gangWarfareContext(gang,snapshot(),.6,now,timing);assert.equal(before.threshold,.75);assert.equal(before.powerPriority,true);assert.equal(before.preparation.active,true);
 const after=gangWarfareContext({...gang,power:300},snapshot(),.75,now,timing);assert.equal(after.powerPriority,true);assert.equal(after.powerFocus,true);assert.equal(after.preparation.active,false);assert.equal(after.statPriority,false);
 const balanced=gangWarfareContext({...gang,power:300},snapshot(),.75,now,{...timing,powerPriority:false});assert.equal(balanced.powerPriority,false);assert.equal(balanced.powerFocus,false);
 assert.equal(gangWarfareContext({...gang,power:300},snapshot(),.8,now,timing).preparation.active,true);
 const legacy=gangWarfareContext({...gang,power:300},snapshot(),.75,now,{...timing,trainingFirst:false});assert.equal(legacy.powerPriority,true);
});
test('preparation power decisions need a material reachable readiness gain and completed payback',()=>{
 const w={powerFocus:true,powerPriority:true,power:100,preparation:{active:true},rivals:[{samples:3}]};
 const before={power:200,powerReady:600,total:100,cumulative:[{at:20,power:101},{at:600,power:200}]};
 const after={power:230,powerReady:400,total:60,cumulative:[{at:20,power:102},{at:600,power:230}]};
 assert.equal(gangPowerBenefit(after,before,w,900).powerObjective,true);
 for(const patch of [{powerReady:590},{powerReady:Infinity},{total:49},{cumulative:[]}])assert.equal(gangPowerBenefit({...after,...patch},before,w,900).powerObjective,false);
 assert.equal(gangPowerBenefit(after,before,{...w,rivals:[{samples:2}]},900).powerObjective,false);
 const finite=gangPowerBenefit({...after,powerReady:890},{...before,powerReady:Infinity},w,900);assert.equal(finite.powerObjective,true);assert.equal(finite.powerSecondsSaved,0);
});
test('distant readiness allows verified foundation growth without inventing a threshold ETA',()=>{
 const w={powerFocus:true,powerPriority:true,power:100,preparation:{active:true},rivals:[{samples:3}]};
 const before={power:200,powerReady:Infinity,total:100,cumulative:[{at:20,power:101},{at:600,power:200}]},after={power:230,powerReady:Infinity,total:60,cumulative:[{at:20,power:102},{at:600,power:230}]};
 const foundation=gangPowerBenefit(after,before,w,900);assert.equal(foundation.powerObjective,true);assert.equal(foundation.powerFoundation,true);assert.equal(foundation.powerSecondsSaved,0);
 assert.equal(gangPowerBenefit({...after,total:49},before,w,900).powerObjective,false);
 const extrapolated=gangPowerBenefit({...after,powerReady:3600},{...before,powerReady:7200},w,900);assert.equal(extrapolated.powerObjective,true);assert.equal(extrapolated.readinessExtrapolated,true);
 assert.ok(gangPreparationComparison({warfareReadySeconds:100,powerGain:1},{warfareReadySeconds:Infinity,powerGain:100})<0);
 assert.ok(gangPreparationComparison({warfareReadySeconds:Infinity,powerGain:100},{warfareReadySeconds:Infinity,powerGain:10})<0);
});
function crew(){
 const training={name:'Train Combat',difficulty:100,strWeight:25,defWeight:25,dexWeight:25,agiWeight:25},work={name:'Work',difficulty:0},war={name:'Territory Warfare',difficulty:5,strWeight:20,defWeight:20,dexWeight:20,agiWeight:20,hackWeight:15,chaWeight:5};
 const members=Object.fromEntries(Array.from({length:12},(_,i)=>{const name='M'+i;return [name,projectGangMember({name,task:'Work',str_exp:0,str_mult:1,str_asc_mult:1,earnedRespect:0,upgrades:[],augmentations:[]},null,0)];}));
 return {members,gang:{respect:10000,wantedLevel:1},training,tasks:{'Train Combat':training,Work:work,'Territory Warfare':war},names:['M0'],
 warfare:{active:true,power:1,rivalPower:.38,threshold:.75,territory:1/7,clashChance:0,powerFocus:true,powerPriority:true,preparation:{enabled:true,active:true},rivals:[{name:'R',power:.38,rate:0,territory:6/7,samples:4}],duty:gangWarfareDuty(timing)},
 horizonSeconds:900,windows:[20,60,120,200,300],evaluate:(m,g,t)=>({value:t==='Work'?1:0,money:t==='Work'?1:0,respect:0,wanted:0})};
}
test('actual crew forecast can fund verified preparation training while retaining productive members',()=>{
 const input=crew(),r=forecastGangCrewTraining(input),f=r.forecasts.M0;
 assert.equal(f.train,true);assert.equal(f.powerPreparation,true);assert.ok(f.warfareReadySeconds<f.baselineWarfareReadySeconds);assert.ok(f.production>=f.baseline*.5);
 const rows=Object.keys(input.members).map(name=>({name,value:1,resetAt:0,mandatory:false,permitted:true,forecast:r.forecasts[name]}));
 const plan=planGangTrainingBursts(rows,{},now,null,{growthFirst:true,preparation:true});assert.equal(plan.plans.M0,true);assert.equal(plan.episodes.M0.preparation,true);assert.ok(Object.values(plan.plans).some(v=>!v));
 const protectedCash=forecastGangCrewTraining({...input,goals:[{name:'equipmentFunding',resource:'money',amount:1000}],evaluate:(m,g,t)=>({value:t==='Work'?1:0,money:t==='Work'&&m.name==='M0'?12:0,respect:0,wanted:0})});assert.equal(protectedCash.forecasts.M0.train,false);
 assert.equal(forecastGangCrewTraining({...input,fixedTasks:{M0:'Work'}}).forecasts.M0,undefined);
 const distant=crew();distant.warfare.rivalPower=100;distant.warfare.rivals[0].power=100;
 const far=forecastGangCrewTraining(distant).forecasts.M0;assert.equal(far.train,true);assert.equal(far.readinessExtrapolated,true);assert.ok(far.warfareReadySeconds>distant.horizonSeconds);
 distant.warfare.rivals[0].rate=1;
 const foundation=forecastGangCrewTraining(distant).forecasts.M0;assert.equal(foundation.train,true);assert.equal(foundation.powerFoundation,true);assert.equal(foundation.warfareReadySeconds,Infinity);
});
test('preparation ranks fastest readiness before larger terminal power',()=>{
 const rows=['Fast','Large','Income'].map((name,i)=>({name,resetAt:0,mandatory:false,permitted:true,value:1,forecast:i===2?{train:false}:{train:true,gain:-1,powerPriority:true,powerPreparation:true,powerObjective:true,powerPaybackSeconds:20,powerGain:i===0?10:100,warfareReadySeconds:i===0?100:500,window:60,trainingTask:'Train Combat'}}));
 const result=planGangTrainingBursts(rows,{},now,null,{growthFirst:true,preparation:true});assert.equal(result.plans.Fast,true);assert.equal(result.plans.Large,false);assert.equal(result.plans.Income,false);
});
test('ready phase releases optional preparation, preserving mandatory and ordinary training episodes',()=>{
 const episodes={Optional:{preparation:true,until:now+60000},Mandatory:{preparation:true,developmentCycle:true},Ordinary:{growthFirst:true}};
 const r=releaseGangPreparationTraining(episodes,{enabled:true,ready:true});assert.equal(r.changed,true);assert.deepEqual(Object.keys(r.episodes),['Mandatory','Ordinary']);
 assert.equal(releaseGangPreparationTraining(episodes,{enabled:true,known:false}).changed,false);
 assert.equal(releaseGangPreparationTraining(episodes,{enabled:false}).changed,true);assert.ok(episodes.Optional);
});
test('training-first retains preparation while bounded attrition requires an explicit forecast opt-in',()=>{
 assert.equal(planGangAttrition({w:{preparation:{enabled:true}}}).engage,false);
 assert.equal(warfareDecision({...gang,power:300},snapshot().gangs,.75).engage,true);
 assert.equal(warfareDecision({...gang,power:299},snapshot().gangs,.75).engage,false);
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(source,/\['training-first', true\]/);assert.match(source,/allowTrainingFirst:true/);assert.match(source,/released.changed\|\|JSON.stringify/);
 assert.match(source,/activeLease&&!options\['disable-attrition'\]/);assert.match(source,/prepareGangPowerPulse/);assert.match(source,/gangTraineePulse/);assert.match(source,/preparation:preparationFor\(status\)/);
});
test('serialized native power purchase cancels preparation quotes when readiness is already reached',()=>{
 const native=Function('return ('+gangPowerPurchaseAllowed.toString()+')')(),at=Date.now(),q={horizon:900,power:300,territory:.2,rivalPower:100,at,threshold:.75,faction:'Own',nodeReset:1,augReset:2,powerPriority:true,powerPreparation:true};
 const ns={getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),gang:{getGangInformation:()=>({...gang,power:300}),getAllGangInformation:()=>({R:{power:100,territory:.8}})}};
 assert.equal(native(ns,{powerQuote:q,powerPaybackSeconds:20}),false);
});
test('serialized native ascension rejects an expired preparation objective at the threshold',()=>{
 const native=Function('return ('+ascendGangMemberSafely.toString()+')')(),g={...gang,power:300,respect:100,wantedLevel:1};
 const w={active:true,faction:'Own',power:299,territory:.2,clashChance:0,rivalPower:100,threshold:.75,preparation:{active:true}};
 const economics={name:'M',expiresAt:Date.now()+5000,paybackSeconds:20,horizonSeconds:900,adaptive:true,warfare:w};
 const ns={gang:{getMemberNames:()=>['M'],getGangInformation:()=>g,getAscensionResult:()=>({str:2}),getAllGangInformation:()=>({Rival:{power:100,territory:.8}}),ascendMember:()=>assert.fail('readiness quote should be cancelled')}};
 assert.equal(native(ns,'M',['str'],1.05,.05,()=>[{name:'M'}],()=>true,economics),null);
});
