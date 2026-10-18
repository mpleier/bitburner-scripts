import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stockManipulationSnapshot,readStockManipulationSnapshot} from '../stock-policy.js';
import {planGangWantedCrew,planMarginalGangEquipment} from '../gang-policy.js';
import {sleeveWorkOutput,planSleeveWorkAugPurchase} from '../sleeve-work-policy.js';
import {planSleeveAugPurchase} from '../sleeve-development-policy.js';
const reset={lastNodeReset:10,lastAugReset:20},processes=[{pid:7,filename:'stockmaster.js'}];
const stocks=[{sym:'ABC',prob:.6,sharesLong:10,sharesShort:0}];
const snapshot=()=>stockManipulationSnapshot(stocks,7,reset,false,1000);
const read=(data,ps=processes,now=1000)=>readStockManipulationSnapshot(typeof data==='string'?data:JSON.stringify(data),reset,ps,['ABC'],now);
test('stock signals round-trip with producer, reset and real holdings',()=>{
 const s=snapshot();assert.equal(read(s).reason,'valid');assert.deepEqual(read(s).positions.ABC,stocks.map(({sym,...p})=>p)[0]);
 assert.equal(read(s,[{pid:7,filename:'/stockmaster.js'}]).reason,'valid');
});
test('stale, future and wrong-reset stock signals cannot drive real hacking',()=>{
 for(const [patch,reason]of [[{at:-60000},'stale-signal'],[{at:1001},'stale-signal'],[{at:NaN},'stale-signal'],[{augReset:21},'reset-mismatch'],[{nodeReset:11},'reset-mismatch']])assert.equal(read({...snapshot(),...patch}).reason,reason);
 assert.equal(read(snapshot(),processes,61000).reason,'valid');assert.equal(read(snapshot(),processes,61001).positions,null);
});
test('mock, exited and unrelated producers cannot authorize stock manipulation',()=>{
 assert.equal(read({...snapshot(),mock:true}).reason,'mock-signal');assert.equal(read({...snapshot(),mock:undefined}).reason,'mock-signal');
 assert.equal(read(snapshot(),[]).reason,'producer-exited');assert.equal(read(snapshot(),[{pid:7,filename:'other.js'}]).positions,null);
});
test('malformed, legacy and partial stock maps fail closed',()=>{
 for(const value of ['', '{',null,{ABC:stocks[0]},[],{...snapshot(),positions:{}}])assert.equal(read(value).positions,null);
 for(const p of [{prob:2},{prob:null},{sharesLong:-1},{sharesShort:.1},{sharesLong:'10'}])assert.equal(read({...snapshot(),positions:{ABC:{...stocks[0],...p}}}).reason,'invalid-or-missing-symbol');
});
test('no-HUD stock cleanup still validates ownership before removing its file',()=>{
 const s=readFileSync(new URL('../stockmaster.js',import.meta.url),'utf8');
 assert.ok(s.includes("JSON.parse(ns.read(file))?.pid===ns.pid"));
 assert.ok(s.indexOf('    ns.atExit(')>s.indexOf('hudElement = initializeHud();'));
 assert.match(s,/hudElement = initializeHud\(\);\s*}\s*ns.atExit/);
});
test('invalid stock directions are retired through recovery, and validated positions are consumed',()=>{
 const s=readFileSync(new URL('../daemon.js',import.meta.url),'utf8');
 assert.ok(s.includes('const updatedPositions=signal.positions;'));
 assert.ok(s.includes("reason:signal.reason"));assert.ok(s.includes("terminateScriptsManipulatingStock(ns,oldGrow,getTool('grow').name)"));
 assert.ok(s.includes('shouldManipulateGrow={};shouldManipulateHack={};serversWithOwnedStock=[];'));
 assert.ok(s.includes('if(!stockFocus&&loopingMode){'));assert.ok(s.includes("terminateScriptsManipulatingStock(ns,retireGrow,getTool('grow').name)"));
});
const rate=(name,value,wanted)=>({name,value,wanted,money:value*10,respect:value});
const beforeRates={A:[rate('Work',20,0),rate('Justice',0,-1)],B:[rate('Work',100,5),rate('Justice',0,-10)]};
test('gang allocation values gear that frees another member from wanted reduction',()=>{
 const before=planGangWantedCrew(beforeRates,{A:'Work',B:'Justice'},0);
 const after=planGangWantedCrew({...beforeRates,A:[rate('Work',20,0),rate('Justice',0,-10)]},{A:'Work',B:'Justice'},0);
 assert.equal(before.value,20);assert.equal(after.value,100);assert.equal(after.assignments.A.name,'Justice');assert.equal(after.assignments.B.name,'Work');
 assert.ok(after.wanted<=0);assert.equal(beforeRates.A[0].value,20);
});
test('whole-crew planner respects locked training and rejects infeasible assignments',()=>{
 const rates={A:[rate('Work',100,1),rate('Train',0,0)],B:[rate('Work',1,0)]};
 assert.equal(planGangWantedCrew(rates,{A:'Train',B:'Work'},0,'value',['A']).value,1);
 assert.equal(planGangWantedCrew({A:[rate('Work',1,2)]},{A:'Work'},0),null);
 assert.equal(planGangWantedCrew(rates,{},NaN),null);assert.equal(planGangWantedCrew({A:[]},{},0),null);
});
test('crew-aware equipment planning invalidates every member forecast after each purchase',()=>{
 const make=name=>({name,str_mult:1,str_asc_mult:1,str_exp:10000,upgrades:[],augmentations:[]});
 const members={A:make('A'),B:make('B')};
 const p=planMarginalGangEquipment({members,equipment:[{name:'gear',type:'Weapon',cost:1,stats:{str:2}}],crewAware:true,
  budgets:{available:100,equipmentLimit:100,augLimit:100,bootstrapBudget:0},
  evaluate:(m,e,crew)=>({moneyGain:crew.A.str_mult===1?1:0})});
 assert.equal(p.orders.length,1);assert.equal(p.orders[0].member,'A');assert.equal(members.A.str_mult,1);
});
const keys=['hacking','strength','defense','dexterity','agility','charisma'];
const sleeve=(xp=0)=>({shock:0,sync:100,skills:{...Object.fromEntries(keys.map(k=>[k,Math.max(1,Math.floor(32*Math.log(xp+534.6)-200))])),intelligence:1},
 exp:Object.fromEntries(keys.map(k=>[k,xp])),mults:Object.fromEntries([...keys,...keys.map(k=>k+'_exp'),'faction_rep','company_rep','work_money','bladeburner_analysis'].map(k=>[k,1]))});
const repWork={objective:'reputation',rates:p=>({reputation:p.skills.hacking*p.mults.faction_rep,hackExp:p.mults.hacking_exp})};
test('work projection compares continued skills with a reset and does not mutate the sleeve',()=>{
 const s=sleeve(1e9),original=structuredClone(s);
 const kept=sleeveWorkOutput(s,{},900,repWork,false),reset=sleeveWorkOutput(s,{},900,repWork,true);
 assert.ok(kept>reset);assert.deepEqual(s,original);
 assert.ok(sleeveWorkOutput(s,{faction_rep:20},900,repWork,true)>kept);
});
test('work XP and reputation use native cycles, shock, and sync rules',()=>{
 const s=sleeve(),xp={objective:'xp',rates:()=>({strExp:2})},rep={objective:'reputation',rates:()=>({reputation:2})};
 assert.equal(sleeveWorkOutput(s,{},100,xp),1000);assert.equal(sleeveWorkOutput({...s,sync:50}, {},100,xp),500);
 assert.equal(sleeveWorkOutput({...s,shock:50}, {},100,xp),500);
 assert.equal(sleeveWorkOutput({...s,sync:50}, {},100,rep),1000);
 assert.equal(sleeveWorkOutput(s,{},10000,xp),9000);
});
test('unknown XP, negative or nonfinite native work rates cannot authorize purchases',()=>{
 const s=sleeve();delete s.exp.hacking;
 assert.equal(sleeveWorkOutput(s,{},900,repWork),null);
 for(const reputation of [NaN,-1,Infinity])assert.equal(sleeveWorkOutput(sleeve(),{},900,{objective:'reputation',rates:()=>({reputation})}),null);
 assert.equal(sleeveWorkOutput(sleeve(),{},900,{objective:'xp',rates:()=>({strExp:-1})}),null);
});
test('native work batches require an actual benefit after rebuilding existing skills',()=>{
 const s=sleeve(1e9),offers=[{name:'Small',cost:1,stats:{faction_rep:1.01}}];
 const workForecast=(s,stats,seconds,reset)=>sleeveWorkOutput(s,stats,seconds,repWork,reset);
 assert.deepEqual(planSleeveAugPurchase({sleeve:s,offers,budget:10,objective:'reputation',workForecast}).names,[]);
 const p=planSleeveAugPurchase({sleeve:s,offers:[{name:'Useful',cost:1,stats:{faction_rep:20}}],budget:10,objective:'reputation',workForecast});
 assert.deepEqual(p.names,['Useful']);assert.ok(p.output>p.baseline*1.1);assert.equal(p.objective,'reputation');
});
const native=(task={type:'FACTION',factionName:'Test',factionWorkType:'hacking'},s=sleeve())=>({
 sleeve:{getSleeve:()=>s,getTask:()=>task},getPlayer:()=>({jobs:{Test:'Software Engineer'}}),
 singularity:{getFactionFavor:()=>100,getCompanyFavor:()=>100},enums:{GymType:{strength:'str'}},
 formulas:{work:{factionGains:p=>repWork.rates(p),companyGains:p=>({reputation:p.skills.hacking*p.mults.company_rep,hackExp:1}),
  gymGains:p=>({strExp:p.mults.strength_exp}),universityGains:p=>({hackExp:p.mults.hacking_exp})}},
 bladeburner:{getCity:()=> 'Sector-12',getCityChaos:()=>10}});
const nativePlan=(ns,offers,task=ns.sleeve.getTask(0))=>planSleeveWorkAugPurchase(ns,0,offers,100,{task,minBatch:1,levelMultipliers:{}},planSleeveAugPurchase,sleeveWorkOutput);
test('native faction and company work are valued with their own reputation multipliers',()=>{
 for(const [type,stat]of [['FACTION','faction_rep'],['COMPANY','company_rep']]){
  const task=type==='FACTION'?{type,factionName:'Test',factionWorkType:'hacking'}:{type,companyName:'Test'};
  const p=nativePlan(native(task),[{name:'Useful',cost:1,stats:{[stat]:20}}]);
  assert.deepEqual(p.names,['Useful']);assert.equal(p.model,'native-work-formulas');assert.equal(p.taskType,type);
 }
});
test('gym and university classes value XP multipliers through native work formulas',()=>{
 for(const [classType,key]of [['str','strength_exp'],['Computer Science','hacking_exp']]){
  const p=nativePlan(native({type:'CLASS',classType,location:'Test'}),[{name:'XP',cost:1,stats:{[key]:2}}]);
  assert.deepEqual(p.names,['XP']);assert.equal(p.objective,'xp');
 }
});
test('skill-rebuilding XP multipliers remain relevant to reputation forecasts',()=>{
 const p=nativePlan(native(),[{name:'XP',cost:1,stats:{hacking_exp:100}}]);
 assert.deepEqual(p.names,['XP']);
});
test('Bladeburner training and field analysis use action-specific benefits',()=>{
 const training=nativePlan(native({type:'BLADEBURNER',actionType:'General',actionName:'Training'}),[{name:'XP',cost:1,stats:{strength_exp:2}}]);
 assert.deepEqual(training.names,['XP']);assert.equal(training.model,'source-general-action');
 const field=nativePlan(native({type:'BLADEBURNER',actionType:'General',actionName:'Field Analysis'}),[{name:'Analysis',cost:1,stats:{bladeburner_analysis:3}}]);
 assert.deepEqual(field.names,['Analysis']);assert.equal(field.objective,'utility');
});
test('unknown contract outcomes and stat-independent Bladeburner jobs preserve skills',()=>{
 for(const task of [{type:'SUPPORT'},{type:'INFILTRATE'},{type:'BLADEBURNER',actionType:'Contracts',actionName:'Tracking'},
  {type:'BLADEBURNER',actionType:'General',actionName:'Recruitment'}])assert.deepEqual(nativePlan(native(task),[{name:'Stats',cost:1,stats:{strength:100}}]).names,[]);
});
test('missing native formulas, unavailable jobs and changed tasks defer without throwing',()=>{
 const n=native();n.formulas={};assert.match(nativePlan(n,[]).reason,/unavailable/);
 const changed=native();assert.match(nativePlan(changed,[],{type:'CRIME'}).reason,/Task changed/);
 const noJob=native({type:'COMPANY',companyName:'Other'});assert.match(nativePlan(noJob,[]).reason,/no longer/);
});
test('native sleeve work bridge can execute as a serialized temporary script',()=>{
 const execute=Function('return ('+planSleeveWorkAugPurchase.toString()+')')();
 const forecast=Function('return ('+sleeveWorkOutput.toString()+')')();
 const plan=Function('return ('+planSleeveAugPurchase.toString()+')')();
 const n=native(),p=execute(n,0,[{name:'Rep',cost:1,stats:{faction_rep:20}}],100,{task:n.sleeve.getTask(),minBatch:1},plan,forecast);
 assert.deepEqual(p.names,['Rep']);
});

test('crew forecast time budget preserves valid quotes and stops additional work',()=>{
 let time=0,calls=0;
 const m={name:'A',str_mult:1,str_asc_mult:1,str_exp:1000,upgrades:[],augmentations:[]};
 const p=planMarginalGangEquipment({members:{A:m},equipment:[{name:'one',type:'Weapon',cost:1,stats:{str:2}},{name:'two',type:'Weapon',cost:1,stats:{str:2}}],
  crewAware:true,maxPlanningMs:50,now:()=>time,budgets:{available:10,equipmentLimit:10,augLimit:10,bootstrapBudget:0},
  evaluate:()=>{calls++;time=100;return {moneyGain:1};}});
 assert.equal(calls,1);assert.equal(p.orders.length,1);assert.equal(p.diagnostics.timeLimited,true);
 assert.equal(p.diagnostics.skippedEvaluations,1);assert.equal(p.diagnostics.ineligible,0);assert.equal(p.diagnostics.planningMs,100);
});
test('feasible independent maximum needs no wanted repairs and retains mandatory assignments',()=>{
 const rates={A:[rate('Work',10,1),rate('Train',0,0)],B:[rate('Work',20,1)]};
 const p=planGangWantedCrew(rates,{A:'Train',B:'Work'},2,'value',['A']);
 assert.equal(p.value,20);assert.equal(p.assignments.A.name,'Train');assert.equal(p.wanted,1);
});

test('equipment cash payback cannot borrow future training stats or count crime income while training',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 const equipment=source.slice(source.indexOf('        const locked=myGangMembers.filter'),source.indexOf('        const bootstrapBudget=',source.indexOf('        const locked=myGangMembers.filter')));
 assert.ok(equipment.includes('const task=workTask(member.name)'));assert.ok(equipment.includes('const baseline=member,upgraded=projectGangMember(member,null,0,equip.stats)'));
 assert.equal(equipment.includes('const seconds=training?20:0'),false);
});
