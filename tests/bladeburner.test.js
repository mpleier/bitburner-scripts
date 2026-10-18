import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isBlackOp,nextSkill,nextBladeburnerProgressSkill,bladeburnerDevelopmentAction,raidCities,recoveryRequired,optionsError,requiredBladeburnerTeam,prepareBladeburnerTeam,bladeburnerRecruitmentBudget,bladeburnerRankRate,rankBladeburnerActions,spendBladeburnerSkills,bladeburnerRecruitmentDecision,bladeburnerRecruitmentTiming,planBladeburnerTeams,planBladeburnerLevels,startBladeburnerPlannedAction,bladeburnerWorkAllowed} from '../bladeburner-policy.js';
test('all Black Op type aliases are protected, including manual final operations',()=>{
 for(const type of ['BlackOps','Black Operations','BlackOp'])assert.equal(isBlackOp({type,name:'Operation Daedalus'}),true);
 assert.equal(isBlackOp(null),false);assert.equal(isBlackOp({type:'Operations'}),false);
});
test('skill weights rank affordable purchases without acting as a second price',()=>{
 assert.equal(nextSkill(['A','B'],{}, {A:10,B:11},10,{A:5}), 'A');
 assert.equal(nextSkill(['A','B'],{}, {A:12,B:8},10,{A:0.1}), 'B');
 assert.equal(nextSkill(['A','B'],{}, {A:10,B:8},20,{A:0.1}), 'A');
});
test('capped, unavailable and invalid skill costs cannot trap the purchase loop',()=>{
 assert.equal(nextSkill(['Overclock','A','B','C'],{Overclock:90},{Overclock:1,A:null,B:Infinity,C:0},100,{}),null);
 assert.equal(nextSkill(['Overclock'],{Overclock:91},{Overclock:1},100,{}),null);
});
test('raid candidates never include the best population city without an explicit override',()=>{
 const cities=['A','B','C'],pop={A:100,B:1000,C:10},communities={A:1,B:2,C:0};
 assert.deepEqual(raidCities(cities,pop,communities),['A']);
 assert.deepEqual(raidCities(cities,pop,communities,true),['A','B']);
 assert.deepEqual(raidCities(cities,pop,{A:0,B:2,C:0}),[]);
});
test('health and stamina recovery use hysteresis rather than switching every update',()=>{
 assert.deepEqual(recoveryRequired(0.4,0.4,{},0.5,0.6),{health:true,stamina:true});
 assert.deepEqual(recoveryRequired(0.8,0.55,{health:true,stamina:true},0.5,0.6),{health:true,stamina:true});
 assert.deepEqual(recoveryRequired(0.9,0.6,{health:true,stamina:true},0.5,0.6),{health:false,stamina:false});
});
test('invalid thresholds and update rates are rejected',()=>{
 const o={'success-threshold':0.99,'low-stamina-pct':0.5,'high-stamina-pct':0.6,'chaos-recovery-threshold':50,'max-chaos':100,'training-limit':50,'reserved-action-count':200,'update-interval':2000};
 assert.equal(optionsError(o),null);
 for(const patch of [{'success-threshold':2},{'update-interval':0},{'low-stamina-pct':0.7},{'max-chaos':1},{'training-limit':-1}])assert.ok(optionsError({...o,...patch}));
});
test('controller checks Black Ops before city selection and guards mutations in their worker',async()=>{
 const s=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.ok(s.indexOf('if(isBlackOp(observedAction))')<s.indexOf('const populationByCity'));
 assert.ok(s.includes('startBladeburnerPlannedAction.toString()'));
 assert.ok(s.includes('planBladeburnerLevels.toString()')); 
 assert.ok(s.includes('(${bbMutationGuard}) ? ns.bladeburner.switchCity'));
 assert.ok(s.includes('bladeburnerActionCandidates(candidateActions'));
 assert.ok(!s.includes('minChance(a) > 0.5'));
 assert.ok(!s.includes('ns.alert('));assert.ok(s.includes('spendBladeburnerSkills.toString()'));
});


test('recruitment only bridges reliable chances with a bounded small team',()=>{
 assert.equal(requiredBladeburnerTeam([.99,1],.99),0);
 const need=requiredBladeburnerTeam([.9,.91],.99);assert.ok(need>0&&need<=30);assert.ok(.9*(need+1)**.05>=.99);
 assert.equal(requiredBladeburnerTeam([.5,.9],.99),null);assert.equal(requiredBladeburnerTeam([.5,.51],.99),null);
 assert.equal(requiredBladeburnerTeam([NaN,1],.99),null);
});
test('teams are assigned minimally, or restored when they cannot unlock the action',()=>{
 let assigned=10;const api={getTeamSize:(type)=>type?assigned:3,setTeamSize:(_type,_name,n)=>(assigned=n),getActionEstimatedSuccessChance:()=>[.9*(assigned+1)**.05,.91*(assigned+1)**.05]};
 const plan=prepareBladeburnerTeam(api,'Operation X',.99,30,requiredBladeburnerTeam);assert.equal(plan.state,'needs-recruitment');assert.equal(assigned,3);
 api.getActionEstimatedSuccessChance=()=>[.1,.11];assigned=10;assert.equal(prepareBladeburnerTeam(api,'Operation X',.99,30,requiredBladeburnerTeam).state,'no-useful-team');assert.equal(assigned,10);
 api.getActionEstimatedSuccessChance=()=>[1,1];assert.equal(prepareBladeburnerTeam(api,'Operation X',.99,30,requiredBladeburnerTeam).required,0);assert.equal(assigned,0);
});
test('team options reject unbounded or invalid recruitment settings',()=>{
 const o={'success-threshold':.99,'low-stamina-pct':.5,'high-stamina-pct':.6,'chaos-recovery-threshold':50,'max-chaos':100,'training-limit':50,'reserved-action-count':200,'update-interval':2000};
 for(const patch of [{'team-cap':-1},{'team-cap':.5},{'recruitment-budget-minutes':Infinity},{'recruitment-budget-minutes':61}])assert.ok(optionsError({...o,...patch}));
});

test('team worker restores assignments after rejected or ineffective mutations',()=>{
 for(const reject of [true,false]){
  let assigned=2;
  const api={getTeamSize:type=>type?assigned:30,setTeamSize:(_t,_n,n)=>{if(reject&&n>2)return -1;return assigned=n;},getActionEstimatedSuccessChance:()=>[.9,.91]};
  assert.equal(prepareBladeburnerTeam(api,'X',.99,30,requiredBladeburnerTeam).state,'unavailable');assert.equal(assigned,2);
 }
});
test('casualties produce a new shortfall on the next team check',()=>{
 let available=30,assigned=0;
 const api={getTeamSize:type=>type?assigned:available,setTeamSize:(_t,_n,n)=>(assigned=n),getActionEstimatedSuccessChance:()=>[.9*(assigned+1)**.05,.91*(assigned+1)**.05]};
 assert.equal(prepareBladeburnerTeam(api,'X',.99,30,requiredBladeburnerTeam).state,'ready');
 available=1;assigned=1;assert.equal(prepareBladeburnerTeam(api,'X',.99,30,requiredBladeburnerTeam).state,'needs-recruitment');
});
test('rolling recruitment accounting retains restart usage and expires elapsed portions',()=>{
 let b=bladeburnerRecruitmentBudget(null,1,3600000,3000000,true);assert.equal(b.spentMs,600000);
 b=bladeburnerRecruitmentBudget(b,1,3600001);assert.equal(b.spentMs,600000);
 b=bladeburnerRecruitmentBudget(b,1,6900000);assert.equal(b.spentMs,300000);
 assert.equal(bladeburnerRecruitmentBudget(b,1,7200000).spentMs,0);
 assert.equal(bladeburnerRecruitmentBudget(b,2,6900000).spentMs,0);
});
test('recruitment accounting rejects future records and merges overlapping intervals',()=>{
 assert.equal(bladeburnerRecruitmentBudget({nodeReset:1,windowAt:1001,spentMs:50},1,1000).spentMs,0);
 const b=bladeburnerRecruitmentBudget({nodeReset:1,intervals:[[100,300],[200,400],[400,500],[0,2000],[NaN,200]]},1,1000);
 assert.equal(b.spentMs,400);assert.deepEqual(b.intervals,[[100,500]]);
 assert.equal(bladeburnerRecruitmentBudget(b,1,1100,1000,true).spentMs,500);
});
test('team mutation worker includes maintenance guard and exhausted recruitment can stop promptly',async()=>{
 const s=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.ok(s.includes('${maintenanceRequested.toString()}'));
 assert.ok(s.includes("currentAction.name==='Recruitment'&&(teamBudget.spentMs>="));
 assert.ok(!s.includes("options['update-interval']*3"));
});


test('rank scoring uses lower success chance, failure losses and duration',()=>{
 assert.equal(bladeburnerRankRate([.8,1],{time:2000,gain:10,loss:5}),3.5);
 assert.equal(bladeburnerRankRate([1,1],{time:0,gain:1,loss:0}),null);
 assert.deepEqual(rankBladeburnerActions(['Slow','Fast','Black'],{Slow:[1,1],Fast:[1,1],Black:[1,1]},
  {Slow:{time:10000,gain:10,loss:0},Fast:{time:1000,gain:2,loss:0},Black:{time:100000,gain:1,loss:0}},'Black',bladeburnerRankRate),['Black','Fast','Slow']);
});

test('wide success ranges size squads against the lower bound',()=>{
 const n=requiredBladeburnerTeam([.9,1],.99,30);assert.ok(n>0&&n<=30);assert.ok(.9*(n+1)**.05>=.99);
});

test('recruitment uses time budget instead of a fixed probability cutoff',()=>{
 const plan={state:'needs-recruitment',required:3,available:1};
 assert.equal(bladeburnerRecruitmentDecision(plan,[.4,.4],10000,100000).recruit,true);
 assert.equal(bladeburnerRecruitmentDecision(plan,[.4,.4],10000,40000).recruit,false);
 assert.equal(bladeburnerRecruitmentDecision(plan,[0,0],10000,60000).recruit,false);
 assert.equal(bladeburnerRecruitmentDecision({...plan,required:NaN},[1,1],10000,60000).recruit,false);
});

test('recruitment keeps a partly completed attempt when its remaining time fits',()=>{
 const plan={state:'needs-recruitment',required:2,available:1};
 assert.equal(bladeburnerRecruitmentDecision(plan,[1,1],30000,10000,25000).recruit,true);
 assert.equal(bladeburnerRecruitmentDecision(plan,[1,1],30000,4000,25000).recruit,false);
});

test('batched skill spending refreshes costs and stops on a fresh guard',()=>{
 let points=10,level=0;const api={getSkillPoints:()=>points,getSkillLevel:()=>level,getSkillUpgradeCost:()=>level+1,upgradeSkill:()=>{points-=++level;return true;}};
 assert.deepEqual(spendBladeburnerSkills(api,['A'],{},nextSkill,()=>level<2),['A','A']);assert.equal(points,7);
 assert.deepEqual(spendBladeburnerSkills(api,['A'],{},nextSkill,()=>false),[]);
});

function levelApi({maximum=10,current=8,safe=5}={}) {
 const state={level:current,auto:true,starts:0,changes:0};
 const api={getActionCurrentLevel:()=>state.level,getActionMaxLevel:()=>maximum,getActionAutolevel:()=>state.auto,
  setActionLevel:(_t,_n,l)=>{state.level=l;state.changes++;},setActionAutolevel:(_t,_n,a)=>{state.auto=a;},
  getActionEstimatedSuccessChance:()=>state.level<=safe?[1,1]:[.8,.9],getActionTime:()=>1000,
  getActionRankGain:()=>state.level,getActionRankLoss:()=>1,startAction:()=>{state.starts++;return true;},getRank:()=>100,getTeamSize:()=>10};
 return {api,state};
}

test('level planner finds the best safe level and restores live settings',()=>{
 const {api,state}=levelApi();const plans=planBladeburnerLevels(api,[['X','Operations']],.99,bladeburnerRankRate,()=>true);
 assert.equal(plans.X.level,5);assert.equal(plans.X.maxSafeLevel,5);assert.equal(state.level,8);assert.equal(state.auto,true);assert.equal(state.starts,0);
});

test('level planner compares throughput instead of automatically choosing the largest safe level',()=>{
 const {api,state}=levelApi({safe:10});api.getActionTime=()=>state.level===3?100:10000;
 assert.equal(planBladeburnerLevels(api,[['X','Contracts']],.99,bladeburnerRankRate,()=>true).X.level,3);
 assert.equal(state.level,8);
});

test('level planner bounds large searches and skips Black Ops',()=>{
 const {api,state}=levelApi({maximum:1000000,current:1,safe:1000000});
 const plan=planBladeburnerLevels(api,[['Black','Black Operations'],['X','Contracts']],.99,bladeburnerRankRate,()=>true);
 assert.equal(plan.Black,undefined);assert.equal(plan.X.level,1000000);assert.ok(plan.X.probes<100);assert.equal(state.level,1);
});

test('level planner restores on API errors and cancellation',()=>{
 const {api,state}=levelApi();api.getActionTime=()=>{throw Error('unavailable');};
 assert.throws(()=>planBladeburnerLevels(api,[['X','Operations']],.99,bladeburnerRankRate,()=>true),/unavailable/);assert.equal(state.level,8);
 const mock=levelApi();planBladeburnerLevels(mock.api,[['X','Operations']],.99,bladeburnerRankRate,()=>mock.state.changes<2);assert.equal(mock.state.level,8);assert.equal(mock.state.starts,0);
});

test('failed action starts restore level and autolevel; successful starts retain the planned level',()=>{
 const {api,state}=levelApi();api.startAction=()=>false;
 assert.equal(startBladeburnerPlannedAction(api,'Operations','X',{level:5},.99,0,0,()=>true),false);
 assert.equal(state.level,8);assert.equal(state.auto,true);
 api.startAction=()=>true;assert.equal(startBladeburnerPlannedAction(api,'Operations','X',{level:5},.99,0,0,()=>true),true);
 assert.equal(state.level,5);assert.equal(state.auto,false);
});

test('fresh unsafe chances, dead ownership, insufficient rank and full teams prevent starts',()=>{
 const {api,state}=levelApi();
 assert.equal(startBladeburnerPlannedAction(api,'Operations','X',{level:9},.99,0,0,()=>true),false);assert.equal(state.level,8);
 assert.equal(startBladeburnerPlannedAction(api,'Operations','X',{level:5},.99,0,0,()=>false),false);
 assert.equal(startBladeburnerPlannedAction(api,'Black Operations','Black',null,.99,200,0,()=>true),false);
 assert.equal(startBladeburnerPlannedAction(api,'General','Recruitment',null,.99,0,5,()=>true),false);assert.equal(state.starts,0);
});


test('level worker helpers serialize without hidden module dependencies',()=>{
 const mock=levelApi();
 const planner=new Function('api','actions','threshold','rate','allowed','return ('+planBladeburnerLevels.toString()+')(api,actions,threshold,rate,allowed)');
 const plan=planner(mock.api,[['X','Operations']],.99,bladeburnerRankRate,()=>true).X;
 const start=new Function('api','plan','allowed','return ('+startBladeburnerPlannedAction.toString()+')(api,"Operations","X",plan,.99,0,0,allowed)');
 assert.equal(start(mock.api,plan,()=>true),true);assert.equal(mock.state.level,5);
});

test('controller probes before selecting actions and gates changed levels on completion',async()=>{
 const s=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.ok(s.indexOf('planBladeburnerLevels.toString()')<s.indexOf('const contractChances'));
 assert.ok(s.includes("['disable-level-optimization',false]"));
 assert.ok(s.includes('bestActionName===currentAction.name&&!levelChange'));
 assert.ok(s.includes('Date.now()<currentTaskEndTime'));
 assert.ok(s.includes("tasks/bladeburner-levels.json"));
});


test('Simulacrum requires installation before concurrent player work is allowed',()=>{
 let installed=false;const api={getCurrentWork:()=>({type:'FACTION'}),getOwnedAugmentations:queued=>queued||installed?["The Blade's Simulacrum"]:[]};
 assert.equal(bladeburnerWorkAllowed(api),false);installed=true;assert.equal(bladeburnerWorkAllowed(api),true);
 assert.equal(bladeburnerWorkAllowed({...api,getCurrentWork:()=>null}),true);
});

test('unknown Singularity state waits unless busy checks were explicitly overridden',()=>{
 const api={getCurrentWork:()=>{throw Error('SF4 unavailable');}};
 assert.equal(bladeburnerWorkAllowed(api),false);assert.equal(bladeburnerWorkAllowed(api,true),true);
});

test('serialized Simulacrum guard notices augmentation grafts without a script restart',()=>{
 let installed=false;const guard=new Function('api','return ('+bladeburnerWorkAllowed.toString()+')(api)');
 const api={getCurrentWork:()=>({type:'COMPANY'}),getOwnedAugmentations:()=>installed?["The Blade's Simulacrum"]:[]};
 assert.equal(guard(api),false);installed=true;assert.equal(guard(api),true);
});

test('controller refreshes installed ownership and rechecks it before action start',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.match(source,/bladeburnerWorkAllowed.toString\(\)/);
 assert.match(source,/getOwnedAugmentations\(false\)/);
 assert.match(source,/tasks\/bladeburner-work.json/);
 assert.doesNotMatch(source,/haveSimulacrum = !\(4 in ownedSourceFiles\) \? true/);
 const faction=await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8');
 assert.match(faction,/lastSimulacrumCheck>=5000/);assert.match(faction,/6 in dictSourceFiles \|\| 7 in dictSourceFiles/);
});


function squadApi({total=8,recruitmentTime=10000,recruitmentChance=1,safe=10,previous=2}={}) {
 const {api,state}=levelApi({current:1,maximum:1,safe});state.team=previous;state.total=total;
 api.getTeamSize=type=>type?state.team:state.total;
 api.setTeamSize=(_t,_n,n)=>n>state.total?-1:(state.team=n);
 const originalChance=api.getActionEstimatedSuccessChance;
 api.getActionEstimatedSuccessChance=type=>type==='General'?[recruitmentChance,recruitmentChance]:originalChance();
 api.getActionTime=type=>type==='General'?recruitmentTime:1000;
 return {api,state};
}
const squadPlan=(api,reserve=0,cap=30,support=0,allowed=()=>true)=>
 planBladeburnerTeams(api,[['X','Operations']],.99,bladeburnerRankRate,allowed,planBladeburnerLevels,reserve,cap,support);

test('ordinary teams lose to solo work when casualty replacement is too expensive',()=>{
 const {api,state}=squadApi();api.getActionRankGain=()=>state.team?2:1;
 const plan=squadPlan(api).X;assert.equal(plan.team,0);assert.equal(state.team,2);assert.equal(state.level,1);
});

test('valuable ordinary teams account for native expected casualties and preserve probe settings',()=>{
 const {api,state}=squadApi({recruitmentTime:1000});api.getActionRankGain=()=>state.team?100:1;
 const plan=squadPlan(api).X;
 assert.equal(plan.team,1);assert.equal(plan.expectedCasualties,.5);assert.equal(plan.metrics.nativeTime,1000);
 assert.equal(plan.metrics.time,1500);assert.equal(state.team,2);assert.equal(state.level,1);assert.equal(state.auto,true);
});

test('team planning reserves the Black Op squad and excludes supporting sleeves',()=>{
 const {api,state}=squadApi({total:8,recruitmentTime:1});api.getActionRankGain=()=>1+100*state.team;
 assert.equal(squadPlan(api,5,30,2).X.team,1);
 assert.equal(squadPlan(api,6,30,2).X.team,0);
 assert.equal(squadPlan(api,5,30,null).X.team,0);
 assert.equal(squadPlan(api,0,0,0).X.team,0);
});

test('missing recruitment estimates and small throughput gains cannot spend recruits',()=>{
 const mock=squadApi({recruitmentTime:1});mock.api.getActionRankGain=()=>mock.state.team?1.05:1;
 assert.equal(squadPlan(mock.api).X.team,0);
 const noEstimate=squadApi({recruitmentChance:0});noEstimate.api.getActionRankGain=()=>100;
 assert.equal(squadPlan(noEstimate.api).X.team,0);
});

test('team planning restores assignments after cancellation and native probe errors',()=>{
 const {api,state}=squadApi();
 assert.deepEqual(squadPlan(api,0,30,0,()=>false),{});assert.equal(state.team,2);
 api.getActionRankGain=()=>{throw Error('probe failure');};
 assert.throws(()=>squadPlan(api),/probe failure/);assert.equal(state.team,2);assert.equal(state.level,1);
});

test('fresh reserves and unsafe chances reject starts and restore teams, levels and autolevel',()=>{
 const {api,state}=squadApi();state.level=8;
 assert.equal(startBladeburnerPlannedAction(api,'Operations','X',{level:1,team:3},.99,0,6,()=>true),false);
 assert.equal(state.team,2);assert.equal(state.level,8);assert.equal(state.auto,true);
 api.getActionEstimatedSuccessChance=()=>[.5,.9];
 assert.equal(startBladeburnerPlannedAction(api,'Operations','X',{level:1,team:1},.99,0,0,()=>true),false);
 assert.equal(state.team,2);assert.equal(state.level,8);assert.equal(state.auto,true);assert.equal(state.starts,0);
});

test('rejected and successful starts respectively restore and retain planned squads',()=>{
 const {api,state}=squadApi();api.startAction=()=>false;
 assert.equal(startBladeburnerPlannedAction(api,'Operations','X',{level:1,team:1},.99,0,0,()=>true),false);assert.equal(state.team,2);
 api.startAction=()=>true;
 assert.equal(startBladeburnerPlannedAction(api,'Operations','X',{level:1,team:1},.99,0,0,()=>true),true);assert.equal(state.team,1);
});

test('rejected assignment and late cancellation preserve the original team',()=>{
 const {api,state}=squadApi();const set=api.setTeamSize;
 api.setTeamSize=(t,n,count)=>count===1?-1:set(t,n,count);
 assert.equal(startBladeburnerPlannedAction(api,'Operations','X',{level:1,team:1},.99,0,0,()=>true),false);assert.equal(state.team,2);
 api.setTeamSize=set;let calls=0;
 assert.equal(startBladeburnerPlannedAction(api,'Operations','X',{level:1,team:1},.99,0,0,()=>++calls===1),false);assert.equal(state.team,2);
});

test('human recruitment yields to useful rank work, and requires a short early forecast',()=>{
 const yes={recruit:true,expectedMs:60000,reason:'Useful squad'};
 assert.equal(bladeburnerRecruitmentTiming(yes,10,true,1).recruit,false);
 assert.equal(bladeburnerRecruitmentTiming(yes,10,true,0).recruit,true);
 assert.equal(bladeburnerRecruitmentTiming(yes,10,false,0).recruit,false);
 assert.equal(bladeburnerRecruitmentTiming({...yes,expectedMs:120001},10,true,null).recruit,false);
 assert.equal(bladeburnerRecruitmentTiming({...yes,expectedMs:null},10,true,null).recruit,false);
 assert.equal(bladeburnerRecruitmentTiming({...yes,recruit:false},10,true,0).recruit,false);
 assert.equal(bladeburnerRecruitmentTiming(yes,0,false,1).recruit,true);
});

test('squad worker and recruitment gate serialize without hidden imports',()=>{
 const {api}=squadApi();
 const worker=new Function('api','rate','planner','return ('+planBladeburnerTeams.toString()+')(api,[["X","Operations"]],.99,rate,()=>true,planner,0,30,0)');
 assert.equal(worker(api,bladeburnerRankRate,planBladeburnerLevels).X.team,0);
 const timing=new Function('return ('+bladeburnerRecruitmentTiming.toString()+')')();
 assert.equal(timing({recruit:true,expectedMs:1},1,true,1).recruit,false);
});

test('malformed chance intervals cannot bypass the team estimate guard',()=>{
 assert.equal(requiredBladeburnerTeam([1,.5],.99),null);
 assert.equal(requiredBladeburnerTeam([-1,1],.99),null);
});


const blockedContext={target:'Operation Typhoon',rank:2500,requiredRank:2500,chance:[.5,.6],threshold:.99,staminaPct:1};
test('chance-blocked Black Ops bank points rather than buying unrelated cheap skills',()=>{
 const names=["Hands of Midas",'Tracer',"Blade's Intuition",'Digital Observer'];
 const levels=Object.fromEntries(names.map(n=>[n,0])),costs={"Hands of Midas":1,Tracer:1,"Blade's Intuition":100,'Digital Observer':100};
 assert.equal(nextBladeburnerProgressSkill(names,levels,costs,10,{},blockedContext,nextSkill),null);
 assert.equal(nextBladeburnerProgressSkill(names,levels,costs,100,{},blockedContext,nextSkill),'Digital Observer');
 assert.equal(nextBladeburnerProgressSkill(names,levels,costs,10,{}, {...blockedContext,rank:2000},nextSkill),'Hands of Midas');
 assert.equal(nextBladeburnerProgressSkill(names,levels,costs,10,{}, {...blockedContext,chance:[1,1]},nextSkill),'Hands of Midas');
});
test('progress skill choice uses native marginal multipliers and fresh stamina context',()=>{
 const names=["Blade's Intuition",'Digital Observer',"Cyber's Edge"];
 const costs=Object.fromEntries(names.map(n=>[n,10])),levels={"Blade's Intuition":0,'Digital Observer':100,"Cyber's Edge":0};
 assert.equal(nextBladeburnerProgressSkill(names,levels,costs,10,{},blockedContext,nextSkill),"Blade's Intuition");
 assert.equal(nextBladeburnerProgressSkill(["Cyber's Edge"],levels,costs,10,{},blockedContext,nextSkill),null);
 assert.equal(nextBladeburnerProgressSkill(["Cyber's Edge"],levels,costs,10,{}, {...blockedContext,staminaPct:.4},nextSkill),null); // Native stamina percentage is preserved by Cyber's Edge.
});
test('batched progress skill spending refreshes the context after each purchase',()=>{
 let level=0;const names=["Blade's Intuition","Hands of Midas"],api={getSkillPoints:()=>10-level,getSkillLevel:()=>0,getSkillUpgradeCost:()=>1,upgradeSkill:()=>{level++;return true;}};
 const choose=(...args)=>nextBladeburnerProgressSkill(...args,nextSkill);
 const result=spendBladeburnerSkills(api,names,{},choose,()=>level<2,()=>({...blockedContext,chance:level?[1,1]:[.5,.6]}));
 assert.equal(result[0],"Blade's Intuition");assert.equal(result.length,2);
});
test('chance development distinguishes rank gates, analysis, training budgets and explicit limits',()=>{
 const d={rank:2500,requiredRank:2500,chance:[.5,.6],remainingMs:120000};
 assert.equal(bladeburnerDevelopmentAction(d),'Training');
 assert.equal(bladeburnerDevelopmentAction({...d,chance:[.8,1]}),'Field Analysis');
 for(const patch of [{rank:2000},{remainingMs:29999},{enabled:false},{chance:[1,1]},{chance:[NaN,1]},{chance:[1,.5]}])assert.equal(bladeburnerDevelopmentAction({...d,...patch}),null);
});
test('development rolling budget keeps recent training across reloads and expires after ten minutes',()=>{
 let budget=bladeburnerRecruitmentBudget(null,1,1000000,880000,true,600000);assert.equal(budget.spentMs,120000);
 budget=bladeburnerRecruitmentBudget(budget,1,1000001,1000001,false,600000);assert.equal(budget.spentMs,120000);
 assert.equal(bladeburnerRecruitmentBudget(budget,1,1600000,1600000,false,600000).spentMs,0);
});
test('progress skill selector remains self-contained in the native helper',()=>{
 const choose=new Function('return ('+nextBladeburnerProgressSkill.toString()+')')();
 assert.equal(choose(["Hands of Midas"],{"Hands of Midas":0},{"Hands of Midas":1},10,{},blockedContext,nextSkill),null);
});
