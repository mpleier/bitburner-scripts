import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangPowerFocus,gangPowerBenefit,gangTerritoryProjection,gangTraineePulse,gangPowerPurchaseAllowed,gangPowerAscensionWeights} from '../gang-power-policy.js';
import {forecastGangCrewTraining,forecastGangCrewAscensions,projectGangMember,gangWarfareDuty,gangWarfareContext,planGangGrowthTraining,rankGangEquipment,planMarginalGangEquipment,purchaseGangEquipment,applyGangWorkOrders} from '../gang-policy.js';
const duty=gangWarfareDuty({detected:true,paddingMs:200,intervalMs:200,restoreMs:1});
function fixture(){
 const training={name:'Train Combat',difficulty:100,strWeight:25,defWeight:25,dexWeight:25,agiWeight:25},work={name:'Work',difficulty:0,strWeight:100},war={name:'Territory Warfare',difficulty:5,strWeight:20,defWeight:20,dexWeight:20,agiWeight:20,hackWeight:15,chaWeight:5};
 const members=Object.fromEntries(Array.from({length:12},(_,i)=>{const name='M'+i;return [name,projectGangMember({name,task:'Work',str_exp:0,str_mult:1,str_asc_mult:1,earnedRespect:0,upgrades:[],augmentations:[]},null,0)];}));
 return {members,gang:{respect:10000,wantedLevel:1},training,tasks:{'Train Combat':training,Work:work,'Territory Warfare':war},names:['M0'],
  warfare:{active:true,power:1,rivalPower:100,threshold:.75,territory:1/7,clashChance:0,powerFocus:true,rivals:[{power:100,rate:.01,territory:6/7,samples:4}],duty},
  horizonSeconds:900,windows:[20,60,120,200,300],evaluate:(m,g,t)=>({value:t==='Work'?1:0,money:t==='Work'?1:0,respect:0,wanted:0})};
}
test('power focus requires known phase and strongest rival growth, and stops at safe clashes',()=>{
 const {warfare:w}=fixture();assert.equal(gangPowerFocus(w),true);
 for(const patch of [{duty:null},{power:300},{threshold:1},{rivals:[{power:100,samples:2}]},{active:false}])assert.equal(gangPowerFocus({...w,...patch}),false);
});
test('explicit money focus and legacy mode can disable power objectives without disabling warfare safeguards',()=>{
 const gang={faction:'Own',power:1,territory:1/7,territoryClashChance:0},snapshot={at:9000,faction:'Own',gangs:{Own:{power:1,territory:1/7},Rival:{power:100,territory:6/7}},powerHistory:{Rival:[1,1,1]}};
 const timing={detected:true,paddingMs:200,intervalMs:200,restoreMs:1,periodMs:20000};
 assert.equal(gangWarfareContext(gang,snapshot,.75,10000,timing).powerFocus,true);
 const disabled=gangWarfareContext(gang,snapshot,.75,10000,{...timing,powerFocusEnabled:false});assert.equal(disabled.powerFocus,false);assert.equal(disabled.active,true);
});
test('power-only training can trade a bounded amount of income for verified fixed-territory power payback',()=>{
 const input=fixture(),r=forecastGangCrewTraining(input),f=r.forecasts.M0;
 assert.equal(f.train,true);assert.equal(f.powerObjective,true);assert.ok(f.gain<0);assert.ok(f.production>=f.baseline*.9);
 assert.ok(f.projectedPower>f.baselinePower);assert.ok(f.powerPaybackSeconds<=input.horizonSeconds);assert.match(f.reason,/power payback/);
 assert.equal(f.cumulative,undefined);assert.equal(r.diagnostics.powerFocus,true);
 assert.equal(forecastGangCrewTraining({...input,warfare:{...input.warfare,powerFocus:false}}).forecasts.M0.train,false);
});
test('power training retains augmentation cash and recruitment milestone gates',()=>{
 const input=fixture();input.goals=[{name:'cash',resource:'money',amount:1000}];input.evaluate=(m,g,t)=>({value:t==='Work'?1:0,money:t==='Work'&&m.name==='M0'?12:0,respect:0,wanted:0});
 assert.equal(forecastGangCrewTraining(input).forecasts.M0.train,false);
 input.evaluate=(m,g,t)=>({value:t==='Work'?1:0,money:0,respect:t==='Work'&&m.name==='M0'?12:0,wanted:0});input.goals=[{name:'recruit',resource:'respect',amount:1000}];
 assert.equal(forecastGangCrewTraining(input).forecasts.M0.train,false);
});
test('power development requires a completed persistent payback and rejects excessive output loss',()=>{
 const w=fixture().warfare,b={power:10,powerReady:100,total:100,cumulative:[{at:20,power:2},{at:100,power:10}]};
 const a={power:20,powerReady:50,total:95,cumulative:[{at:20,power:3},{at:100,power:20}]};
 assert.equal(gangPowerBenefit(a,b,w,100).powerObjective,true);
 for(const patch of [{total:89},{cumulative:[]},{power:NaN},{power:9}])assert.equal(gangPowerBenefit({...a,...patch},b,w,100).powerObjective,false);
 const relapse={...a,cumulative:[{at:20,power:3},{at:100,power:5}]};assert.equal(gangPowerBenefit(relapse,b,w,100).powerObjective,false);
});
test('group and single training schedulers accept verified power gains with negative cash utility',()=>{
 const input=fixture(),f=forecastGangCrewTraining(input).forecasts.M0;
 const rows=Object.values(input.members).map(m=>({name:m.name,value:1,resetAt:0,permitted:true,mandatory:false,forecast:m.name==='M0'?f:{train:false}}));
 assert.equal(planGangGrowthTraining(rows,{},10000).plans.M0,true);
 const joint={verified:true,gain:-1,powerObjective:true,powerPaybackSeconds:100,members:[{name:'M0',window:20,trainingTask:'Train Combat'},{name:'M1',window:20,trainingTask:'Train Combat'}]};
 const r=planGangGrowthTraining(rows,{},10000,joint);assert.equal(r.plans.M0,true);assert.equal(r.plans.M1,true);assert.equal(Object.values(r.plans).filter(Boolean).length,2);
});
test('power training search remains bounded and interrupted trajectories are not promoted',()=>{
 const input=fixture();let time=0;const r=forecastGangCrewTraining({...input,maxPlanningMs:10,now:()=>time++});
 assert.equal(r.diagnostics.timeLimited,true);assert.equal(r.forecasts.M0.train,false);
});
test('territory scenario compounds only after the safe threshold and conserves territory bounds',()=>{
 const w=fixture().warfare,low=gangTerritoryProjection(w,[{at:900,power:10}]);assert.equal(low.territory,w.territory);
 const high=gangTerritoryProjection({...w,power:10000},[{at:300,power:11000},{at:900,power:13000}]);
 assert.ok(high.territory>w.territory&&high.territory<=1);assert.ok(Number.isFinite(high.power));assert.equal(high.limited,false);
 assert.equal(gangTerritoryProjection({...w,rivals:[{power:0,rate:0,territory:1}]},[{at:20,power:10}]),null);
 assert.equal(gangTerritoryProjection(w,[{at:NaN,power:10}]),null);
});
test('territory scenario includes loss of power from expected failed clashes',()=>{
 const w={...fixture().warfare,power:300,threshold:.5,rivals:[{power:100,rate:0,territory:6/7,samples:4}]};
 const r=gangTerritoryProjection(w,[{at:20,power:300}]);assert.ok(r.power<300);assert.ok(r.territory>w.territory);
});
test('territory scenario has a hard computation bound including large bonus time',()=>{
 const w=fixture().warfare,r=gangTerritoryProjection(w,[{at:1000000,power:10000}],1e9);assert.equal(r.limited,true);
});
test('selected trainees can pulse only at zero clash risk and acceptable training cost',()=>{
 const input=fixture(),m=projectGangMember({...input.members.M0,str_exp:100000,def_exp:100000,dex_exp:100000,agi_exp:100000},null,0);
 assert.equal(gangTraineePulse(m,input.training,input.warfare,60,0,projectGangMember),true);
 for(const patch of [{clashChance:.01},{clashChance:1},{duty:{normalFraction:.9,bonusFraction:.9}},{active:false}])
  assert.equal(gangTraineePulse(m,input.training,{...input.warfare,...patch},60,0,projectGangMember),false);
 assert.equal(gangTraineePulse(m,{name:'Work'},input.warfare,60,0,projectGangMember),false);
 assert.equal(gangTraineePulse(m,input.training,input.warfare,60,0,(m,t)=>({...m,str_exp:t?1e9:m.str_exp})),false);
});
test('native assignment rechecks residual risk before interrupting a trainee',()=>{
 const events=[],ns={gang:{getGangInformation:()=>({territoryWarfareEngaged:false,territoryClashChance:.01}),getMemberInformation:()=>({task:'Train Combat'}),setMemberTask:()=>events.push(1)}};
 const native=Function('return ('+applyGangWorkOrders.toString()+')')();
 assert.equal(native(ns,[{name:'M0',task:'Territory Warfare',trainingPulse:true}],()=>true,1).deferred,true);assert.deepEqual(events,[]);
});
test('power equipment is ranked by immediate power per dollar within lifetime and progression budget',()=>{
 const a={member:'A',equipmentName:'A',type:'Weapon',cost:10,powerObjective:true,powerGainPerTick:2,powerPaybackSeconds:20,powerQuote:{}},b={...a,equipmentName:'B',cost:20,powerGainPerTick:8};
 const r=rankGangEquipment([a,b],900,{bootstrapBudget:100});assert.equal(r[0].equipmentName,'B');assert.equal(r[0].reason,'power');
 assert.deepEqual(rankGangEquipment([{...a,lifetimeSeconds:10}],900,{bootstrapBudget:100}),[]);
 assert.deepEqual(rankGangEquipment([a],900,{bootstrapBudget:1}),[]);
 assert.deepEqual(rankGangEquipment([{...a,items:[{},{}]}],900,{bootstrapBudget:100}),[]);
});
function nativeFixture(){
 const now=Date.now(),reset={lastNodeReset:1,lastAugReset:2},gang={faction:'Own',power:100,territory:.2},m=projectGangMember({name:'M0',...Object.fromEntries(['hack','str','def','dex','agi','cha'].flatMap(k=>[[k+'_exp',10000],[k+'_mult',1],[k+'_asc_mult',1]])),upgrades:[],augmentations:[]},null,0);
 const q={at:now,horizon:900,power:100,territory:.2,rivalPower:100,threshold:.75,faction:'Own',nodeReset:1,augReset:2};
 const order={member:'M0',equipmentName:'Gear',cost:10,powerPaybackSeconds:20,powerQuote:q};
 const ns={getPlayer:()=>({money:10000}),read:()=>'',getResetInfo:()=>reset,gang:{getGangInformation:()=>gang,getAllGangInformation:()=>({Own:gang,Rival:{power:100,territory:.8}}),getMemberInformation:()=>m,getEquipmentStats:()=>({str:2})}};
 return {now,reset,gang,m,q,order,ns};
}
test('native serialized power purchase validates current owner scope and real equipment skill gain',()=>{
 const f=nativeFixture(),native=Function('return ('+gangPowerPurchaseAllowed.toString()+')')();assert.equal(native(f.ns,f.order),true);
 f.m.upgrades.push('Gear');assert.equal(native(f.ns,f.order),false);
});
test('native power purchase rejects stale, future, reset, horizon and territorial changes',()=>{
 for(const patch of [{at:Date.now()-6000},{at:Date.now()+10000},{augReset:3},{horizon:NaN},{territory:.5},{rivalPower:50}]){
  const f=nativeFixture();Object.assign(f.q,patch);assert.equal(gangPowerPurchaseAllowed(f.ns,f.order),false);
 }
 const f=nativeFixture();f.gang.power=1000;assert.equal(gangPowerPurchaseAllowed(f.ns,f.order),false);
});
test('native equipment batches fail closed without a power validator',()=>{
 const ns={getPlayer:()=>({money:100}),read:()=>'',gang:{getEquipmentCost:()=>10,purchaseEquipment:()=>{throw Error('must not buy');}}};
 const r=purchaseGangEquipment(ns,[{reason:'power',member:'M0',equipmentName:'Gear',cost:10}],0,100,()=>true,()=>true,true);
 assert.equal(r[0].reason,'power-quote-changed');
});
test('controller wiring preserves protected recovery, uses all-stat eligibility and native purchase guards',()=>{
 const s=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');assert.match(s,/gangPowerAscensionWeights\(eligibilityMembers/);assert.match(s,/gangPowerPurchaseAllowed.toString/);
 assert.match(s,/!options.manualTasks\?\.\[name\]&&!activeWantedPreparation\(name\)/);assert.match(s,/!\(ascensionRecoveries\[name\]\?\.until>at\)/);
 assert.match(s,/powerFocus:warfare.powerFocus===true/);
});
test('power ascension compares against working and training without a reset',()=>{
 const input=fixture(),keys=['hack','str','def','dex','agi','cha'];
 for(const [name,m]of Object.entries(input.members))input.members[name]=projectGangMember({...m,...Object.fromEntries(keys.map(k=>[k+'_exp',10000]))},null,0);
 const retained=projectGangMember({...input.members.M0,...Object.fromEntries(keys.flatMap(k=>[[k+'_exp',0],[k+'_asc_mult',10]]))},null,0);
 const r=forecastGangCrewAscensions({...input,ascensions:{M0:{member:retained,respectLoss:1}}});
 assert.equal(r.plans.length,1);assert.equal(r.plans[0].powerObjective,true);assert.ok(r.plans[0].netGain<0);assert.ok(r.plans[0].paybackSeconds<=900);
 const unchanged=forecastGangCrewAscensions({...input,ascensions:{M0:{member:input.members.M0,respectLoss:1}}});assert.deepEqual(unchanged.plans,[]);
});
test('all six stats contribute to power ascension eligibility while normal crime weights remain unchanged',()=>{
 const fallback={A:{str:20}},members={A:{hack:1000,str:100,def:100,dex:100,agi:100,cha:100}};
 assert.equal(gangPowerAscensionWeights(members,fallback,false),fallback);
 const weights=gangPowerAscensionWeights(members,fallback,true).A;assert.deepEqual(Object.keys(weights),['hack','str','def','dex','agi','cha']);assert.equal(weights.hack,1000);assert.equal(weights.cha,100);
});
test('focused equipment selection values cheap items and prefers power per dollar over price order',()=>{
 const m=fixture().members.M0,equipment=[{name:'A',type:'Weapon',cost:10,stats:{str:2}},{name:'B',type:'Weapon',cost:20,stats:{str:4}}];let calls=0;
 const r=planMarginalGangEquipment({members:{M0:m},equipment,evaluate:(m,e)=>{calls++;return {powerObjective:true,powerGainPerTick:e.name==='B'?8:2,powerPaybackSeconds:20,powerQuote:{}};},horizon:900,
  powerFocus:true,cheapCash:10000,cheapEligibility:()=>true,maxPurchases:1,budgets:{available:1000,equipmentLimit:1000,augLimit:1000,bootstrapBudget:1000}});
 assert.equal(calls,2);assert.equal(r.orders[0].equipmentName,'B');assert.equal(r.orders[0].reason,'power');assert.equal(r.diagnostics.cheapFastTracked,0);
});
test('native power quotes recheck the one-percent unreserved cash limit',()=>{
 const f=nativeFixture();f.ns.getPlayer=()=>({money:100});assert.equal(gangPowerPurchaseAllowed(f.ns,f.order),false);
 f.ns.getPlayer=()=>({money:10000});f.q.reserve=9999;assert.equal(gangPowerPurchaseAllowed(f.ns,f.order),false);
});
test('native power equipment purchases retain shared budget and temporary lifetime checks',()=>{
 const f=nativeFixture(),purchases=[],claims=[];f.ns.gang.getEquipmentCost=()=>10;f.ns.gang.purchaseEquipment=(name,item)=>{purchases.push(item);return true;};
 const order={...f.order,reason:'power',type:'Weapon',cost:10,lifetimeExpiresAt:Date.now()+100000};
 const native=Function('return ('+purchaseGangEquipment.toString()+')')();
 const denied=native(f.ns,[order],0,100,()=>false,()=>true,true,1,gangPowerPurchaseAllowed);assert.equal(denied[0].reason,'shared-budget');assert.deepEqual(purchases,[]);
 const expired=native(f.ns,[{...order,lifetimeExpiresAt:Date.now()+1000}],0,100,()=>true,()=>true,true,1,gangPowerPurchaseAllowed);assert.equal(expired[0].reason,'equipment-lifetime-changed');
 const ok=native(f.ns,[order],0,100,(ns,category,cost)=>{claims.push([category,cost]);return true;},()=>true,true,1,gangPowerPurchaseAllowed);
 assert.equal(ok[0].success,true);assert.deepEqual(claims,[['gang',10]]);assert.deepEqual(purchases,['Gear']);
});
test('trainee pulse forecast and execution retain the same protected manual and recovery roles',()=>{
 const input=fixture(),m=projectGangMember({...input.members.M0,...Object.fromEntries(['hack','str','def','dex','agi','cha'].map(k=>[k+'_exp',100000]))},null,0);
 input.members.M0=m;input.windows=[60];input.warfare.traineePulses=true;
 const pulsed=forecastGangCrewTraining(input).forecasts.M0;
 const locked=forecastGangCrewTraining({...input,warfare:{...input.warfare,traineePulses:false}}).forecasts.M0;
 // Both options can be rejected by the objective, but a verified pulse must never invent XP gains.
 assert.ok(Number.isFinite(pulsed.baselinePower));assert.equal(pulsed.baselinePower,locked.baselinePower);
 const fixed=forecastGangCrewTraining({...input,fixedTasks:{M0:'Train Combat'}});assert.equal(fixed.forecasts.M0,undefined);
});
