import test from 'node:test';
import assert from 'node:assert/strict';
import {gangPowerTrainingPriority,projectGangMember,forecastGangCrewTraining,gangWarfareDuty} from '../gang-policy.js';
const training={name:'Train Combat',difficulty:100,strWeight:25,defWeight:25,dexWeight:25,agiWeight:25};
const work={name:'Work',difficulty:0};
const tasks={'Train Combat':training,Work:work,'Train Hacking':{name:'Train Hacking',difficulty:100,hackWeight:100},'Territory Warfare':{name:'Territory Warfare',difficulty:5,strWeight:20,defWeight:20,dexWeight:20,agiWeight:20,hackWeight:15,chaWeight:5}};
function fixture(count=4){
 const members=Object.fromEntries(Array.from({length:count},(_,i)=>{const name='M'+i;return [name,projectGangMember({name,task:'Work',str_exp:0},null,0)];}));
 const pairs=[20,60,120,200,300,600,900].flatMap(seconds=>Object.keys(members).map(name=>({name,seconds,wait:0,trainingTask:training.name})));
 return {members,pairs,values:Object.fromEntries(Object.keys(members).map(n=>[n,1]))};
}
const order=(f,extra={})=>gangPowerTrainingPriority(f.pairs,f.members,extra.tasks||tasks,{},extra.values||f.values,extra.horizon||3600,extra.bonus||0);
test('power screening covers every member before a second duration and includes long trials',()=>{
 const f=fixture(12),p=order(f);assert.equal(new Set(p.slice(0,12).map(x=>x.name)).size,12);assert.equal(p.length,24);
 for(const name of Object.keys(f.members)){const trials=p.filter(x=>x.name===name);assert.equal(trials.length,2);assert.ok(trials.some(x=>x.seconds>=600));assert.ok(trials.some(x=>x.seconds<600));}
 assert.ok(p.every(x=>f.pairs.includes(x)));
});
test('screening charges for displaced output and does not equate weakest earnings with highest growth',()=>{
 const f=fixture();f.members.M1=projectGangMember({...f.members.M1,str_asc_mult:50,def_asc_mult:50,dex_asc_mult:50,agi_asc_mult:50},null,0);
 assert.equal(order(f)[0].name,'M1');
 const equal=fixture();equal.values.M0=1000;assert.notEqual(order(equal)[0].name,'M0');
});
test('natural work XP, not absolute trained stats, determines marginal improvement',()=>{
 const f=fixture();assert.deepEqual(order(f,{tasks:{...tasks,Work:{...training,name:'Work'}}}),[]);
});
test('unsupported, invalid and committed scenarios cannot enter the priority shortlist',()=>{
 const f=fixture(1),base=f.pairs[0];f.pairs=[{...base,seconds:NaN},{...base,seconds:901},{...base,seconds:3600},...['wait','mixed','preTraining','preWanted','repeatAt','sequence'].map(k=>({...base,[k]:1})),{...base,trainingTask:'Missing'},{...base,name:'Missing'}];
 assert.deepEqual(order(f),[]);assert.deepEqual(order(f,{horizon:Infinity}),[]);
});
test('explicit candidate windows remain authoritative and screening does not mutate inputs',()=>{
 const f=fixture();f.pairs=f.pairs.filter(x=>x.seconds===60);const before=structuredClone(f);const p=order(f);assert.equal(p.length,4);assert.ok(p.every(x=>x.seconds===60));assert.deepEqual(f,before);
});
function crew(extra={}){
 const {members}=fixture(4);
 return {members,training,tasks,gang:{respect:10000,wantedLevel:1},growthFirst:true,allowJointTraining:true,prioritizeWeakTraining:true,horizonSeconds:3600,maxSimulations:60,
 warfare:{active:true,power:1,rivalPower:100,threshold:.75,territory:1/7,clashChance:0,powerFocus:true,powerPriority:true,preparation:{enabled:true,active:true},rivals:[{name:'R',power:100,rate:0,territory:6/7,samples:4}],duty:gangWarfareDuty({detected:true,paddingMs:200,intervalMs:200,restoreMs:1})},
 evaluate:(m,g,t)=>({value:t==='Work'?1:0,money:t==='Work'?1:0,respect:0,wanted:0}),...extra};
}
test('real crew search considers long power windows under a bounded comparison budget',()=>{
 const r=forecastGangCrewTraining(crew({maxSimulations:12}));assert.ok(r.diagnostics.powerTrainingPriority.some(p=>p.seconds>=600));
 assert.equal(new Set(r.diagnostics.powerTrainingPriority.slice(0,4).map(p=>p.name)).size,4);assert.ok(r.diagnostics.simulations<=13);
 assert.ok(r.diagnostics.jointEvaluations>0);if(r.jointPlan)assert.ok(r.jointPlan.members.length<4);
});
test('manual assignments and disabled power priority retain their safeguards',()=>{
 const input=crew({fixedTasks:{M0:'Work'}}),r=forecastGangCrewTraining(input);assert.ok(r.diagnostics.powerTrainingPriority.every(p=>p.name!=='M0'));assert.equal(r.forecasts.M0,undefined);
 const balanced=forecastGangCrewTraining({...input,warfare:{...input.warfare,powerPriority:false}});assert.deepEqual(balanced.diagnostics.powerTrainingPriority,[]);
});
test('bonus time includes bounded game-time long alternatives without replacing explicit windows',()=>{
 const r=forecastGangCrewTraining(crew({bonusSeconds:24000}));assert.ok(r.diagnostics.powerTrainingPriority.some(p=>p.seconds<60));
 const explicit=forecastGangCrewTraining(crew({bonusSeconds:24000,windows:[60]}));assert.ok(explicit.diagnostics.powerTrainingPriority.every(p=>p.seconds===60));
});
test('imminent cash goals still veto optional training after power screening',()=>{
 const r=forecastGangCrewTraining(crew({goals:[{name:'cash',resource:'money',amount:1000}]}));assert.ok(Object.values(r.forecasts).every(f=>!f.train));assert.equal(r.jointPlan,null);
});
