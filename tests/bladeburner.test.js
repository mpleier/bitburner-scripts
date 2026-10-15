import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isBlackOp,nextSkill,raidCities,recoveryRequired,optionsError,requiredBladeburnerTeam,prepareBladeburnerTeam,bladeburnerRecruitmentBudget,bladeburnerRankRate,rankBladeburnerActions,spendBladeburnerSkills,bladeburnerRecruitmentDecision,planBladeburnerLevels,startBladeburnerPlannedAction,bladeburnerWorkAllowed} from '../bladeburner-policy.js';
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
 assert.ok(s.includes('a!==nextBlackOp && minChance(a) > 0.5'));
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
