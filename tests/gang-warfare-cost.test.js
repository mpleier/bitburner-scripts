import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangWarfareDuty,gangWarfareContext,forecastGangCrewTraining,forecastGangCrewAscensions,projectGangMember,projectGangWanted} from '../gang-policy.js';
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);
const timing={detected:true,paddingMs:200,intervalMs:200,restoreMs:0};
const pulse={name:'Territory Warfare',difficulty:5,hackWeight:15,strWeight:20,defWeight:20,dexWeight:20,agiWeight:20,chaWeight:5,baseWanted:0};
function fixture(){
 const members=Object.fromEntries(['A','B'].map(name=>{const m={name,task:'Work'};for(const k of ['hack','str','def','dex','agi','cha'])Object.assign(m,{[k+'_exp']:1e6,[k+'_mult']:1,[k+'_asc_mult']:1});return [name,projectGangMember(m,null,0)];}));
 const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
 return {members,gang:{respect:1000,wantedLevel:1,respectGainRate:0},training,tasks:{Work:{name:'Work',difficulty:0,baseWanted:0},'Train Combat':training,'Territory Warfare':pulse},
  warfare:{active:true,power:1e6,rivalPower:1,threshold:.75,territory:.5,clashChance:0,duty:gangWarfareDuty(timing)},
  horizonSeconds:100,maxSimulations:0,evaluate:(m,g,t)=>({task:t,value:t==='Work'?100:0,money:t==='Work'?100:0,respect:t==='Work'?10:0,wanted:0})};
}
test('even an instantaneous pulse replaces the native gains and XP batch',()=>{
 const duty=gangWarfareDuty({...timing,paddingMs:0,intervalMs:0});
 assert.equal(duty.normalFraction,.1);assert.equal(duty.bonusFraction,.25);
});
test('padding, polling and restore delays can displace additional normal/bonus batches',()=>{
 const duty=gangWarfareDuty({...timing,restoreMs:2100});
 assert.equal(duty.normalFraction,.2);assert.equal(duty.bonusFraction,1);
 const quick=gangWarfareDuty(timing);assert.equal(quick.normalFraction,.1);assert.equal(quick.bonusFraction,.5);
});
test('unknown phase or malformed timing leaves duty unavailable',()=>{
 for(const patch of [{detected:false},{paddingMs:-1},{intervalMs:NaN},{restoreMs:Infinity},{periodMs:0}])assert.equal(gangWarfareDuty({...timing,...patch}),null);
 assert.equal(gangWarfareDuty(null),null);
 assert.equal(gangWarfareDuty({...timing,restoreMs:1e8}).normalFraction,1);
});
test('fresh context carries timing only while territory development remains active',()=>{
 const gang={faction:'Own',power:1,territory:.5,territoryClashChance:0},snapshot={at:1,faction:'Own',gangs:{Rival:{power:1,territory:.5}}};
 assert.equal(gangWarfareContext(gang,snapshot,.75,1,timing).duty.normalFraction,.1);
 assert.equal(gangWarfareContext(gang,snapshot,.75,1).duty,null);
 assert.equal(gangWarfareContext({...gang,territory:1},snapshot,.75,1,timing).active,true);
});
test('normal production and respect lose pulse batches, external income remains available',()=>{
 const input=fixture(),before=structuredClone({...input,evaluate:undefined});
 const r=forecastGangCrewTraining(input),plain=forecastGangCrewTraining({...input,warfare:{...input.warfare,duty:null}});
 close(r.forecasts.A.baseline,18000);close(plain.forecasts.A.baseline,20000);
 close(r.diagnostics.baselineWarfareMemberGameSeconds,20);
 input.goals=[{name:'cash',resource:'money',amount:3800}];input.otherCashRate=200;
 close(forecastGangCrewTraining(input).forecasts.A.baselineMilestones.cash,10);
 assert.deepEqual({...input,evaluate:undefined,goals:undefined,otherCashRate:undefined},{...before,goals:undefined,otherCashRate:undefined});
});
test('bonus time changes batch duty as well as game-second speed',()=>{
 const input=fixture();input.bonusSeconds=2400;
 const r=forecastGangCrewTraining(input);
 close(r.forecasts.A.baseline,250000);close(r.diagnostics.baselineWarfareMemberGameSeconds,2500);
});
test('bonus exhaustion splits the duty model within the forecast',()=>{
 const input=fixture();input.bonusSeconds=240;
 const r=forecastGangCrewTraining(input);
 close(r.forecasts.A.baseline,2*100*(250*.5+90*.9));
 close(r.diagnostics.baselineWarfareMemberGameSeconds,2*(250*.5+90*.1));
});
test('XP comes from productive work and native warfare task, not uninterrupted crime',()=>{
 const input=fixture();input.tasks.Work={name:'Work',difficulty:100,strWeight:100,baseWanted:0};
 const r=forecastGangCrewTraining(input);
 close(r.diagnostics.baselineExperience.str,2*5/1500*(90*Math.pow(100,.9)*100+10*Math.pow(5,.9)*20));
 close(r.diagnostics.baselineExperience.hack,2*5/1500*10*Math.pow(5,.9)*15);
});
test('recovery training is not interrupted or charged for warfare time',()=>{
 const input=fixture();input.members={A:input.members.A};input.recoveryUntil={A:100};
 const r=forecastGangCrewTraining(input);
 close(r.diagnostics.baselineWarfareMemberGameSeconds,0);
 close(r.diagnostics.baselineExperience.str,5/1500*100*Math.pow(100,.9)*100);
 close(r.forecasts.A.baseline,0);
});
test('defense protection leaves vulnerable members producing during warfare pulses',()=>{
 const input=fixture();input.warfare.clashChance=1;input.members.A.def_exp=0;input.members.A=projectGangMember(input.members.A,null,0);
 const r=forecastGangCrewTraining(input);
 close(r.forecasts.A.baseline,19000);close(r.diagnostics.baselineWarfareMemberGameSeconds,10);
});
test('wanted-reduction headcount follows the displaced work fraction',()=>{
 const input=fixture();input.members={A:input.members.A};input.gang={respect:1e5,wantedLevel:100,respectGainRate:0};input.tasks.Work.baseWanted=-1;
 input.evaluate=(m,g,t)=>({value:t==='Work'?1:0,money:0,respect:0,wanted:0});
 close(forecastGangCrewTraining(input).forecasts.A.baselineWanted,projectGangWanted(100,0,.9,100,2));
});
test('terminal milestone rates switch duty when stored bonus time runs out',()=>{
 const input=fixture();input.horizonSeconds=10;input.bonusSeconds=480;input.goals=[{name:'cash',resource:'money',amount:100000}];
 // First twenty wall seconds earn 20*25*0.5*200; the remainder earns 0.9*200 per second.
 close(forecastGangCrewTraining(input).forecasts.A.baselineMilestones.cash,20+50000/180);
});
test('100% pulse duty cannot invent crime production or an unreachable cash ETA',()=>{
 const input=fixture();input.warfare.duty=gangWarfareDuty({...timing,restoreMs:1e5});input.goals=[{name:'cash',resource:'money',amount:1}];
 const r=forecastGangCrewTraining(input);close(r.forecasts.A.baseline,0);assert.equal(r.forecasts.A.baselineMilestones.cash,Infinity);
 close(r.diagnostics.baselineWarfareMemberGameSeconds,200);
});
test('active duty requires known warfare XP task and valid fractions',()=>{
 const input=fixture();delete input.tasks['Territory Warfare'];assert.equal(forecastGangCrewTraining(input).diagnostics.baselineReady,false);
 const invalid=fixture();invalid.warfare.duty.normalFraction=NaN;assert.equal(forecastGangCrewTraining(invalid).diagnostics.baselineReady,false);
});
test('controller planners and attrition receive confirmed phase, padding and measured restore time',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.equal((source.match(/detected:territoryTickDetected,paddingMs:territoryTickWaitPadding,intervalMs:updateInterval,restoreMs:postTickRestoreMs,periodMs:territoryTickTime/g)||[]).length,8);
});

function developmentFixture(){
 const input=fixture();input.horizonSeconds=900;input.maxSimulations=60;input.names=['A'];
 input.tasks.Work={name:'Work',difficulty:1,strWeight:100,baseWanted:0};
 for(const member of Object.values(input.members)){member.str_exp=0;Object.assign(member,projectGangMember(member,null,0));}
 input.evaluate=(m,g,t)=>{const value=t==='Work'?(m.str>=30?100:1):0;return {value,money:value,respect:0,wanted:0};};
 return input;
}
test('candidate training uses the same pulse accounting as its shared baseline',()=>{
 const input=developmentFixture(),r=forecastGangCrewTraining(input),plain=forecastGangCrewTraining({...input,warfare:{...input.warfare,duty:null}});
 assert.equal(r.forecasts.A.train,true);assert.ok(r.forecasts.A.production>r.forecasts.A.baseline);
 assert.notEqual(r.forecasts.A.gain,plain.forecasts.A.gain);
});
test('ascension and recovery forecasts include the same displaced work and warfare XP',()=>{
 const input=developmentFixture(),retained={...input.members.A};
 for(const k of ['hack','str','def','dex','agi','cha']){retained[k+'_exp']=0;retained[k+'_asc_mult']=k==='str'?10:1;}
 input.ascensions={A:{member:projectGangMember(retained,null,0),respectLoss:0}};
 const r=forecastGangCrewAscensions(input),plain=forecastGangCrewAscensions({...input,warfare:{...input.warfare,duty:null}});
 assert.equal(r.plans.length,1);assert.ok(r.plans[0].netGain>0);assert.notEqual(r.plans[0].netGain,plain.plans[0].netGain);
 assert.ok(r.diagnostics.baselineWarfareMemberGameSeconds>0);
});
