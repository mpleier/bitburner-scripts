import test from 'node:test';
import assert from 'node:assert/strict';
import {gangDevelopmentDominated,gangCrimeTrainingHints,forecastGangEquipmentDevelopment,projectGangMember} from '../gang-policy.js';
const trajectory=(total,power=0)=>({total,money:total,respectEarned:10,power,powerReady:100,eta:{goal:50},cumulative:[{at:20,total:total/2,power},{at:100,total,power}]});
test('dominance proof requires complete aligned trajectories and every protected dimension',()=>{
 const equipment=trajectory(100,5),free=trajectory(110,6),c={cost:10,costWeight:1,powerEnabled:true};assert.equal(gangDevelopmentDominated(equipment,free,c),true);
 for(const patch of [{respectEarned:0},{money:1},{power:4},{powerReady:200},{eta:{goal:60}},{cumulative:[{at:21,total:110,power:6},{at:100,total:110,power:6}]},{cumulative:[]}])assert.equal(gangDevelopmentDominated(equipment,{...free,...patch},c),false);
 assert.equal(gangDevelopmentDominated(equipment,{...free,cumulative:[{at:20,total:50,power:4},{at:100,total:110,power:6}]},c),false);
 assert.equal(gangDevelopmentDominated(equipment,free,{...c,cost:NaN}),false);
});
const combat={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0},hacking={name:'Train Hacking',difficulty:100,hackWeight:100,baseWanted:0};
function fixture(){const keys=['hack','str','def','dex','agi','cha'],m=projectGangMember({name:'A',task:'Work',...Object.fromEntries(keys.flatMap(k=>[[k+'_exp',1000],[k+'_mult',1],[k+'_asc_mult',1]]))},null,0),threshold=projectGangMember(m,hacking,150).hack;
 const tasks={Work:{name:'Work',difficulty:0,baseMoney:1},Crime:{name:'Crime',difficulty:10,baseMoney:10,hackWeight:100},'Train Combat':combat,'Train Hacking':hacking};
 return {members:{A:m,B:{...m,name:'B'}},name:'A',stats:{str:1.01},gang:{respect:1000,wantedLevel:1},training:combat,tasks,horizonSeconds:900,
  evaluate:(m,g,t)=>{const value=t==='Crime'?(m.hack>threshold?10000:0):t==='Work'?m.str:0;return {value,money:value,respect:0,wanted:0};},compareFreeTraining:true,extendedWindows:true,alternateTrainingTasks:true,cost:1,costWeight:1,maxSimulations:17};}
test('an early rejection uses two completed trajectories and cannot approve a purchase',()=>{
 const f=fixture(),r=forecastGangEquipmentDevelopment({...f,cost:1e9,earlyReject:true,maxSimulations:2});assert.equal(r.verified,true);assert.equal(r.comparison.allowed,false);assert.equal(r.comparison.earlyRejected,true);assert.equal(r.comparison.checks,0);assert.equal(r.diagnostics.simulations,2);
 assert.equal(forecastGangEquipmentDevelopment({...f,cost:1e9,earlyReject:false,maxSimulations:2}),null);
});
test('crime hints derive a training window from an actual locked crime projection',()=>{
 const f=fixture(),hints=gangCrimeTrainingHints({member:f.members.A,tasks:f.tasks,gang:f.gang,evaluate:f.evaluate,project:projectGangMember,horizonSeconds:900});
 assert.equal(hints.length,1);assert.equal(hints[0].task,'Train Hacking');assert.equal(hints[0].crime,'Crime');assert.equal(hints[0].duration,200);
 const guided=forecastGangEquipmentDevelopment({...f,crimeGuidedWindows:true});assert.equal(guided.comparison.freeTrainingTask,'Train Hacking');assert.equal(guided.comparison.freeTrainingSeconds,200);
 const generic=forecastGangEquipmentDevelopment(f);assert.ok(guided.comparison.freeProduction>generic.comparison.freeProduction);assert.equal(guided.comparison.checks,generic.comparison.checks);
});
test('malformed optional data and insufficient horizons cannot invent training hints',()=>{
 const f=fixture(),base={member:f.members.A,tasks:f.tasks,gang:f.gang,evaluate:f.evaluate,project:projectGangMember,horizonSeconds:900};
 for(const patch of [{member:null},{horizonSeconds:40},{bonusSeconds:NaN},{tasks:{}},{evaluate:()=>({value:NaN})},{project:()=>{throw Error('unavailable');}}])assert.deepEqual(gangCrimeTrainingHints({...base,...patch}),[]);
 const locked=forecastGangEquipmentDevelopment({...f,crimeGuidedWindows:true,fixedTasks:{A:'Work'}});assert.deepEqual(locked.comparison.crimeHints,[]);assert.equal(locked.comparison.checks,0);
});
