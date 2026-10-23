import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gangTerritorySample,forecastGangCrewAscensions,gangWarfareMemberEligible,gangWarfarePowerPerTick,gangWarfareContext,forecastGangCrewTraining,planGangTrainingBursts,ascendGangMemberSafely,projectGangMember} from '../gang-policy.js';
const stats=(name,value=95)=>Object.fromEntries([['name',name],...['hack','str','def','dex','agi','cha'].map(k=>[k,value])]);
function fixture(){
 const members=Object.fromEntries(['A','B'].map(name=>{const m={name,task:'Work'};for(const k of ['hack','str','def','dex','agi','cha'])Object.assign(m,{[k+'_exp']:k==='str'?0:1e6,[k+'_mult']:1,[k+'_asc_mult']:1});return [name,projectGangMember(m,null,0)];}));
 const training={name:'Train Combat',difficulty:100,strWeight:100,baseWanted:0};
 return {members,gang:{respect:1000,wantedLevel:1,respectGainRate:0},training,tasks:{Work:{name:'Work',difficulty:1,strWeight:100,baseWanted:0},'Train Combat':training},names:['A'],horizonSeconds:900,
  warfare:{active:true,power:1,rivalPower:1,threshold:.75,territory:.5,clashChance:0},
  evaluate:(m,g,t)=>{const value=t==='Work'?(m.str>=30?100:1):0;return {task:t,value,money:value,respect:0,wanted:0};}};
}
test('power per territory tick follows native six-stat and territory formulas',()=>{
 const members={A:stats('A'),B:stats('B')};
 assert.ok(Math.abs(gangWarfarePowerPerTick(members,.5)-.09)<1e-12);
 assert.ok(Math.abs(gangWarfarePowerPerTick(members,.5,0,['A'])-.045)<1e-12);
 assert.equal(gangWarfarePowerPerTick(members,.5,0,['A','B']),0);
 assert.ok(Math.abs(gangWarfarePowerPerTick({A:members.A},0)-.00018)<1e-12);
});
test('defense protection matches absolute and strongest-member thresholds',()=>{
 assert.equal(gangWarfareMemberEligible({def:99},1000,1),false);
 assert.equal(gangWarfareMemberEligible({def:100},1000,1),true);
 assert.equal(gangWarfareMemberEligible({def:1000},20000,1),false);
 assert.equal(gangWarfareMemberEligible({def:2000},20000,1),true);
 assert.equal(gangWarfareMemberEligible({def:1},20000,0),true);
 assert.equal(gangWarfareMemberEligible({},1000,1),false);
});
test('power projection excludes vulnerable members even if a locked veteran sets the defense threshold',()=>{
 const members={A:stats('A',20000),B:stats('B',1000)};
 assert.equal(gangWarfarePowerPerTick(members,.5,1,['A']),0);
 assert.ok(gangWarfarePowerPerTick(members,.5,0,['A'])>0);
 for(const patch of [{def:NaN},{hack:Infinity},{str:-1}])assert.equal(gangWarfarePowerPerTick({A:{...stats('A'),...patch}},.5),null);
});
test('fresh rival context ignores defeated rivals and protects newly enabled warfare',()=>{
 const now=10000,gang={faction:'Own',power:100,territory:.5,territoryClashChance:0,territoryWarfareEngaged:true};
 const snapshot={at:now-100,faction:'Own',gangs:{Own:{power:100,territory:.5},Rival:{power:10,territory:.5},Dead:{power:10000,territory:0}}};
 const r=gangWarfareContext(gang,snapshot,.75,now);
 assert.equal(r.active,true);assert.equal(r.rivalPower,10);assert.equal(r.clashChance,1);
 assert.equal(gangWarfareContext({...gang,territory:1},snapshot,.75,now).active,false);
 assert.equal(gangWarfareContext(gang,{...snapshot,at:now-45001},.75,now).active,false);
 assert.equal(gangWarfareContext(gang,{...snapshot,at:now+1},.75,now).active,false);
 assert.equal(gangWarfareContext(gang,{...snapshot,faction:'Other'},.75,now).active,false);
 assert.equal(gangWarfareContext(gang,{...snapshot,gangs:{Own:snapshot.gangs.Own}},.75,now).active,false);
});
test('profitable training cannot materially delay projected engagement readiness',()=>{
 const input=fixture(),before=structuredClone({...input,evaluate:undefined});
 assert.equal(forecastGangCrewTraining({...input,warfare:null}).forecasts.A.train,true);
 const r=forecastGangCrewTraining(input).forecasts.A;
 assert.equal(r.train,false);assert.equal(r.warfareBlocked,true);
 assert.ok(r.baselineWarfareReadySeconds>0);assert.ok(r.rejectedWarfare.readinessDelay>20);
 assert.deepEqual({...input,evaluate:undefined},before);
});
test('an ample existing power margin permits profitable training despite foregone power growth',()=>{
 const input=fixture();input.warfare.power=1000;
 const r=forecastGangCrewTraining(input).forecasts.A;
 assert.equal(r.train,true);assert.equal(r.warfareReadySeconds,0);
 assert.ok(r.projectedPower<r.baselinePower);assert.ok(r.maxWarfareChanceDrop<.01);
});
test('gang bonus time accelerates power accumulation in game time',()=>{
 const input=fixture();input.horizonSeconds=100;input.warfare.power=1000;input.tasks.Work.difficulty=0;
 input.evaluate=(m,g,t)=>({task:t,value:t==='Work'?1:0,money:0,respect:0,wanted:0});
 const a=forecastGangCrewTraining(input).forecasts.A,b=forecastGangCrewTraining({...input,bonusSeconds:2400}).forecasts.A;
 assert.ok(Math.abs((b.baselinePower-1000)/(a.baselinePower-1000)-25)<1e-7);
});
test('zero rival power and unreachable perfect thresholds do not produce NaN readiness',()=>{
 const input=fixture();input.warfare={...input.warfare,power:0,rivalPower:0,threshold:1};
 const a=forecastGangCrewTraining(input).forecasts.A;
 assert.ok(Number.isFinite(a.baselineWarfareReadySeconds));assert.ok(a.baselineWarfareReadySeconds>0);
 const b=forecastGangCrewTraining({...input,warfare:{...input.warfare,rivalPower:1}}).forecasts.A;
 assert.equal(b.baselineWarfareReadySeconds,Infinity);
});
test('unavailable warfare data and completed territory do not invent a development penalty',()=>{
 const input=fixture(),r=forecastGangCrewTraining({...input,warfare:{active:false,reason:'Territory complete'}});
 assert.equal(r.forecasts.A.train,true);assert.equal(r.forecasts.A.baselinePower,null);
 const bad=forecastGangCrewTraining({...input,warfare:{...input.warfare,power:NaN}});
 assert.equal(bad.diagnostics.baselineReady,false);assert.equal(bad.forecasts.A.train,false);
});
test('an optional training burst can be released when warfare readiness becomes limiting',()=>{
 const rows=['A','B'].map(name=>({name,resetAt:0,value:10,permitted:true,mandatory:false,forecast:{train:true,window:60,gain:100}}));
 const first=planGangTrainingBursts(rows,{},1000);rows[0].forecast={train:false,window:0,warfareBlocked:true};
 const next=planGangTrainingBursts(rows,first.episodes,5000);
 assert.equal(next.plans.A,false);assert.equal(next.reasons.A,'Preserve warfare readiness');
});
test('native ascension rejects changed rival power, own power and clash exposure',()=>{
 const calls=[],gang={respect:1000,wantedLevel:1,faction:'Own',power:100,territory:.5,territoryClashChance:0,territoryWarfareEngaged:false};
 const rival={power:10,territory:.5};
 const ns={gang:{getMemberNames:()=>['A','B'],getGangInformation:()=>gang,getAllGangInformation:()=>({Rival:rival}),getAscensionResult:()=>({str:2,respect:1}),getMemberInformation:()=>({str:100}),
  setTerritoryWarfare:()=>calls.push('warfare'),ascendMember:()=>{calls.push('ascend');return {};},setMemberTask:()=>calls.push('train')}};
 const economics={name:'A',expiresAt:Date.now()+5000,paybackSeconds:20,horizonSeconds:900,member:{str:100},ascension:{str:2},
  warfare:{active:true,faction:'Own',power:100,territory:.5,rivalPower:10,clashChance:0}};
 const invoke=()=>ascendGangMemberSafely(ns,'A',['str'],1.05,.05,()=>[{name:'A'}],()=>true,economics);
 rival.power=11;assert.equal(invoke(),null);rival.power=10;
 gang.power=110;assert.equal(invoke(),null);gang.power=100;
 gang.territoryWarfareEngaged=true;assert.equal(invoke(),null);gang.territoryWarfareEngaged=false;
 assert.deepEqual(calls,[]);assert.ok(invoke());assert.deepEqual(calls,['warfare','ascend','train']);
});
test('executed assignments protect a weak member on the first enabled warfare pulse',async()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8').replace(/\r/g,'');
 const start=source.indexOf('async function updateMemberActivities('),end=source.indexOf('\n/** @param {NS} ns',start);
 let orders=[];
 const getNsDataThroughFile=async(ns,code,path,args)=>{orders=JSON.parse(args[0]);return {deferred:false,failed:[],assigned:orders.length};};
 const build=Function('gangWarfareMemberEligible','getNsDataThroughFile',`const assignedTasks={Low:'Work',High:'Work'},memberNeedsTraining=()=>false,memberProtectedTask=()=>null,applyGangWorkOrders=()=>{},gangMutationAllowed=()=>true,log=()=>{};${source.slice(start,end)};return updateMemberActivities;`);
 const apply=build(gangWarfareMemberEligible,getNsDataThroughFile),members={Low:{name:'Low',def:50,task:'Work'},High:{name:'High',def:200,task:'Work'}};
 await apply({},members,'Territory Warfare',{territoryClashChance:0,territoryWarfareEngaged:true});
 assert.deepEqual(orders,[{name:'High',task:'Territory Warfare'}]);
 await apply({},members,'Territory Warfare',{territoryClashChance:0,territoryWarfareEngaged:false});assert.equal(orders.length,2);
});
test('startup and both development planners receive fresh rival observations',()=>{
 const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
 assert.match(source,/initialCycle.rivals/);assert.match(source,/bonusMs:cycle.bonusMs},cycle.others/);
 assert.match(source,/gangRivalsSnapshot=\{at:tick.at,faction:myGangFaction,gangs:rivals\}/);
 assert.match(source,/names:Object.keys\(ascensions\),ascensions,goals,warfare/);
 assert.match(source,/warfare:gangWarfareContext\(gang,lastOtherGangInfo/);
 assert.match(source,/crewSnapshot:members,cashAtQuote,warfare/);
});

test('fast native polling refreshes rival prices without changing the territory tick decision',()=>{
 const gangs={Own:{power:1,territory:.5},Rival:{power:2,territory:.5}};
 const first=gangTerritorySample(null,gangs,'Own',1000);
 const next=gangTerritorySample(first,gangs,'Own',1200);
 assert.equal(next.changed,false);assert.equal(next.at,1200);
 gangs.Rival.power=100;assert.equal(next.gangs.Rival.power,2);
 const context=gangWarfareContext({faction:'Own',power:1,territory:.5,territoryClashChance:0},next,.75,1300);
 assert.equal(context.active,true);assert.equal(context.rivalPower,2);
});
test('a profitable ascension is blocked when its recovery sacrifices near-term warfare readiness',()=>{
 const input=fixture(),retained={...input.members.A};
 for(const key of ['hack','str','def','dex','agi','cha']){retained[key+'_exp']=0;retained[key+'_asc_mult']=key==='str'?10:1;}
 input.ascensions={A:{member:retained,respectLoss:0}};
 assert.equal(forecastGangCrewAscensions({...input,warfare:null}).plans.length,1);
 const guarded=forecastGangCrewAscensions(input);
 assert.equal(guarded.plans.length,0);assert.equal(guarded.forecasts.A.warfareBlocked,true);
});

test('uncertain readiness beyond the modeled horizon cannot indefinitely block a profitable reset',()=>{
 const input=fixture(),retained={...input.members.A};
 for(const key of ['hack','str','def','dex','agi','cha']){retained[key+'_exp']=0;retained[key+'_asc_mult']=key==='str'?10:1;}
 input.ascensions={A:{member:retained,respectLoss:0}};input.warfare.rivalPower=1e6;
 const r=forecastGangCrewAscensions(input);
 assert.ok(r.forecasts.A.baselineWarfareReadySeconds>input.horizonSeconds);assert.equal(r.plans.length,1);
});
