import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {updateGangMeasurements,publishGangMeasurements,gangMeasurementFile} from '../gang-measurement-policy.js';
import {ascendGangMemberSafely,forecastGangCrewAscensions,projectGangMember} from '../gang-policy.js';
const keys=['hack','str','def','dex','agi','cha'],v=n=>Object.fromEntries(keys.map(k=>[k,n]));
const member=n=>({...v(n),...Object.fromEntries(keys.map(k=>[k+'_asc_mult',2])),task:'Train Combat',upgrades:[],augmentations:[]});
const input=(at=1000,extra={})=>({at,reset:{lastNodeReset:1,lastAugReset:2},ownerPid:7,faction:'F',members:{A:member(1)},lastReset:{A:1000},metrics:{power:100,respect:1000},cohort:'same',...extra});
const event=(name='A')=>({name,at:1000,success:true,reason:'ascended',recovery:{resetAt:1000,until:21000,original:v(5),expected:v(10),ascMults:v(2),augmentations:[]}});
function start(){return updateGangMeasurements(null,input(1000,{diagnostics:{passAt:1000,simulations:5,timeLimited:true,nativeAttempts:[event()]}}));}
test('recovery ledger compares an on-time observation with the actual forecast endpoint',()=>{
 const s=start(),before=structuredClone(s),r=updateGangMeasurements(s,input(21000,{members:{A:member(10)}}));
 assert.equal(r.completed[0].state,'measured');assert.equal(r.completed[0].statRatio,1);assert.deepEqual(r.completed[0].regained,{lowerSeconds:0,upperSeconds:20});assert.equal(r.recoveries.length,0);assert.deepEqual(s,before);
 const repeat=updateGangMeasurements(r,input(22000,{diagnostics:{nativeAttempts:[event()]}}));assert.equal(repeat.attempts,1);assert.equal(repeat.completed.length,1);
});
test('sparse, confounded and interrupted recoveries cannot calibrate the policy',()=>{
 const s=start();
 for(const patch of [{at:24000},{at:21000,members:{A:{...member(10),upgrades:['Weapon']}}},{at:21000,members:{A:{...member(10),augmentations:['Implant']}}}]){
  const r=updateGangMeasurements(s,{...input(21000,{members:{A:member(10)}}),...patch});assert.equal(r.completed[0].state,'inconclusive');assert.equal(r.completed[0].statRatio,null);
 }
 assert.equal(updateGangMeasurements(s,input(21000,{lastReset:{A:2000}})).completed[0].state,'interrupted');
 assert.equal(updateGangMeasurements(s,input(21000,{members:{}})).completed[0].state,'interrupted');
 const paused=updateGangMeasurements(s,input(10000,{members:{A:{...member(3),task:'Work'}}}));assert.equal(updateGangMeasurements(paused,input(21000,{members:{A:member(10)}})).completed[0].state,'inconclusive');
});
test('partial fast samples preserve other recoveries and whole-crew progression windows',()=>{
 const s=updateGangMeasurements(null,input(1000,{members:{A:member(1),B:member(1)},lastReset:{A:1000,B:1000},diagnostics:{nativeAttempts:[event(),event('B')]}}));
 const partial=updateGangMeasurements(s,input(11000,{partial:true,members:{A:member(6)},lastReset:{A:1000,B:1000}}));assert.equal(partial.recoveries.length,2);assert.deepEqual(partial.progress,s.progress);
 const done=updateGangMeasurements(partial,input(21000,{partial:true,members:{A:member(10)},lastReset:{A:1000,B:1000}}));assert.equal(done.completed.length,1);assert.equal(done.recoveries[0].name,'B');assert.deepEqual(done.completed[0].regained,{lowerSeconds:0,upperSeconds:10});
});
test('rejection and budget counters deduplicate passes and separate unknown worker outcomes',()=>{
 const diagnostics={passAt:1000,simulations:60,simulationLimited:true,nativeAttempts:[{name:'A',at:1000,success:false,reason:'cash-spent'},{name:'B',at:1000,success:false,reason:'worker-outcome-unknown'}]};
 const s=updateGangMeasurements(null,input(1000,{diagnostics})),again=updateGangMeasurements(s,input(2000,{diagnostics}));
 assert.equal(again.attempts,2);assert.equal(again.rejected,1);assert.equal(again.unknownOutcomes,1);assert.equal(again.reasons['cash-spent'],1);assert.equal(again.budget.searches,1);assert.equal(again.budget.simulationLimited,1);
 const next=updateGangMeasurements(again,input(3000,{diagnostics:{passAt:3000,simulations:10,timeLimited:true}}));assert.equal(next.budget.searches,2);assert.equal(next.budget.timeLimited,1);
});
test('equal-duration comparable windows distinguish gang cash, gang respect and faction reputation',()=>{
 const obs=(at,n)=>input(at,{metrics:{power:100+n*60,respect:1000-n*10,money:100+n*600,moneyAt:at,factionRep:50+n*120,repAt:at}});
 let s=updateGangMeasurements(null,obs(1000,0));s=updateGangMeasurements(s,obs(61000,1));s=updateGangMeasurements(s,obs(121000,2));
 assert.equal(s.progress.windows[0].gangCashPerSecond,10);assert.equal(s.progress.windows[0].factionRepPerSecond,2);assert.ok(s.progress.windows[0].respectPerSecond<0);assert.equal(s.progress.comparison.state,'observed');assert.equal(s.progress.comparison.causalSpeedGainKnown,false);
 for(const patch of [{cohort:'changed'},{ownerPid:8}])assert.equal(updateGangMeasurements(s,{...obs(181000,3),...patch}).progress.windows.length,0);
 const stale=updateGangMeasurements(s,input(181000,{metrics:{power:100,respect:100,money:1e12,moneyAt:1000}}));assert.equal(stale.progress.windows.at(-1).gangCashPerSecond,null);
 const recruited=updateGangMeasurements(s,input(181000,{members:{A:member(10),B:member(1)},cohort:'new-roster'}));assert.deepEqual(recruited.recruitments.at(-1).joined,['B']);assert.equal(recruited.progress.windows.length,0);
});
test('reset scope, stale saved state and malformed rows cannot reuse measurement evidence',()=>{
 const s=start();assert.equal(updateGangMeasurements(s,input(22000,{reset:{lastNodeReset:3,lastAugReset:4}})).attempts,0);
 assert.equal(updateGangMeasurements(s,input(4000000)).recoveries.length,0);
 const corrupt={...s,recoveries:[null,{name:'A',resetAt:1000,until:21000,expected:v(Infinity)}],completed:[null],progress:{signature:s.progress.signature,baseline:null,windows:[{at:1000,seconds:60,recruits:0}]}};
 const safe=updateGangMeasurements(corrupt,input(2000));assert.equal(safe.recoveries.length,0);assert.equal(safe.progress.windows.length,0);
 assert.equal(updateGangMeasurements(null,input(1000,{ownerPid:0})),null);
});
test('measurement persistence failures do not interrupt gang automation',async()=>{
 const messages=[];publishGangMeasurements.warningAt=-Infinity;
 const ns={read:()=>'{bad',write:async()=>{throw Error('unavailable');},print:m=>messages.push(m)};
 assert.equal(await publishGangMeasurements(ns,input(1000)),null);assert.equal(await publishGangMeasurements(ns,input(2000)),null);assert.equal(messages.length,1);
});
test('detailed native receipts preserve the legacy API and identify rejection without mutation',()=>{
 let allowed=false;const calls=[],ns={gang:{getMemberNames:()=>['A'],getGangInformation:()=>({respect:100}),getAscensionResult:()=>({str:2}),setTerritoryWarfare:()=>calls.push('warfare'),ascendMember:()=>({str:2}),setMemberTask:()=>true}};
 const native=Function('return ('+ascendGangMemberSafely.toString()+')')();
 assert.equal(native(ns,'A',['str'],1,0,()=>[{name:'A'}],()=>allowed),null);
 assert.equal(native(ns,'A',['str'],1,0,()=>[{name:'A'}],()=>allowed,null,true).reason,'control-blocked');assert.deepEqual(calls,[]);
 allowed=true;assert.equal(native(ns,'A',['str'],1,0,()=>[],()=>allowed,null,true).reason,'eligibility-changed');
 const receipt=native(ns,'A',['str'],1,0,()=>[{name:'A'}],()=>allowed,null,true);assert.equal(receipt.success,true);assert.equal(receipt.reason,'ascended');
 ns.gang.setMemberTask=()=>false;const unassigned=native(ns,'A',['str'],1,0,()=>[{name:'A'}],()=>allowed,null,true);assert.equal(unassigned.success,true);assert.equal(unassigned.reason,'ascended-training-unconfirmed');
 assert.equal(native(ns,'A',['str'],1,0,()=>[{name:'A'}],()=>allowed,{expiresAt:0},true).reason,'quote-expired-or-invalid');
});
test('forecast endpoint follows independent native XP math instead of the horizon terminal stats',()=>{
 const A=projectGangMember({name:'A',str_exp:10000,str_mult:1,str_asc_mult:1,task:'Work',upgrades:[],augmentations:[]},null,0),B={...A,name:'B'},training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
 const r=forecastGangCrewAscensions({members:{A,B},names:['A'],ascensions:{A:{member:{...A,str_exp:0,str_asc_mult:10},respectLoss:1}},gang:{respect:1000,wantedLevel:1},training,tasks:{'Train Combat':training,Work:{name:'Work',difficulty:1,strWeight:100,baseWanted:0}},windows:[20],horizonSeconds:900,evaluate:(m,g,t)=>({task:t,value:t==='Work'?m.str:0,money:t==='Work'?m.str:0,respect:0,wanted:0})});
 assert.equal(r.plans.length,1);const xp=20*5*Math.pow(100,.9)*100/1500*10,expected=Math.max(1,Math.floor(10*(32*Math.log(xp+534.5)-200)));
 assert.equal(r.plans[0].recoveryStats.str,expected);
});
test('controller requests bounded fast samples and consumes receipt.success explicitly',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(s,/mainLoop.lastRecoverySampleAt\?\?0\)>=1000/);assert.match(s,/if\(receipt\?\.success===true\)/);assert.match(s,/attempt.recovery=\{resetAt,until,expected:economics.recoveryStats/);assert.ok(s.includes('await publishGangMeasurements(ns,{reset:resetInfo'));assert.match(s,/ascensionMeasurements:measurements/);assert.equal(gangMeasurementFile,'tasks/gang-measurements.json');
});
test('executed native receipt handling never treats a rejection object as a successful ascension',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replace(/\r/g,''),start=source.indexOf('    for(const {name:member,economics} of plans){'),end=source.indexOf('\n}\n',start);
 for(const outcome of ['rejected','unknown','success']){
  const ns={pid:7},economics={trainingSeconds:20,trainingTask:'Train Combat',member:{...member(5),...Object.fromEntries(keys.map(k=>[k+'_asc_mult',1]))},recoveryStats:v(10)},saves=[];
  const ctx={ns,plans:[{name:'A',economics}],dictAscensionResults:{A:{str:2}},ascensionStats:['str'],ascensionDiagnostics:{},options:{'ascend-multi-threshold':1.05,'ascend-multi-threshold-spacing':.05},ascendGangMemberSafely,chooseGangAscensions:()=>[],gangMutationAllowed:()=>true,
   getNsDataThroughFile:async()=>{if(outcome==='unknown')throw Error('Lost reply');return {success:outcome==='success',reason:outcome==='success'?'ascended':'cash-spent'};},importantStats:['str'],isHackGang:false,log:()=>{},trainingEpisodes:{},trainingReference:[],trainingPlans:{},wantedPreparation:null,expectedAscensions:{},lastMemberReset:{},assignedTasks:{},gangTrainingTaskName:t=>t,ascensionRecoveries:{},plannedAscensions:new Set(['A']),saveGangTraining:async()=>saves.push(1)};
  vm.runInNewContext('globalThis.run=async()=>{'+source.slice(start,end)+'}',ctx);await ctx.run();
  assert.equal(saves.length,outcome==='success'?1:0);assert.equal(ctx.ascensionDiagnostics.nativeAttempts[0].success,outcome==='success');
  if(outcome==='unknown')assert.equal(ctx.ascensionDiagnostics.nativeAttempts[0].reason,'worker-outcome-unknown');
  if(outcome==='success')assert.equal(ctx.ascensionDiagnostics.nativeAttempts[0].recovery.expected.str,10);
 }
});
test('executed fast sampler requests only active recoveries at most once a second',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('async function mainLoop(ns)'),end=source.indexOf('    const myGangInfo=cycle.info;',start);let at=10000;const requests=[],samples=[];
 const ctx={Date:{now:()=>at},maintenanceRequested:()=>false,ascensionRecoveries:{A:{until:20000},B:{until:1000}},resetInfo:{lastNodeReset:1,lastAugReset:2},myGangFaction:'F',lastMemberReset:{A:1000},getNsDataThroughFile:async(_ns,_code,_file,args)=>{requests.push(JSON.parse(args[0]));return {recoveryMembers:{A:member(3)}};},publishGangMeasurements:async(_ns,data)=>samples.push(data)};
 vm.runInNewContext(source.slice(start,end)+'};globalThis.run=mainLoop;',ctx);await ctx.run({pid:7});at+=200;await ctx.run({pid:7});at+=1000;await ctx.run({pid:7});
 assert.deepEqual(requests,[['A'],[],['A']]);assert.equal(samples.length,2);assert.equal(samples[0].partial,true);
});
