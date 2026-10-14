import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isBlackOp,nextSkill,raidCities,recoveryRequired,optionsError,requiredBladeburnerTeam,prepareBladeburnerTeam} from '../bladeburner-policy.js';
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
 assert.ok(s.includes('(${bbMutationGuard}) ? ns.bladeburner.startAction'));
 assert.ok(s.includes('(${bbMutationGuard}) ? ns.bladeburner.switchCity'));
 assert.ok(s.includes('a!==nextBlackOp && minChance(a) > 0.5'));
 assert.ok(!s.includes('ns.alert('));assert.ok(s.includes('for(let purchases=0;purchases<100;purchases++)'));
});


test('recruitment only bridges reliable chances with a bounded small team',()=>{
 assert.equal(requiredBladeburnerTeam([.99,1],.99),0);
 const need=requiredBladeburnerTeam([.9,.91],.99);assert.ok(need>0&&need<=30);assert.ok(.9*(need+1)**.05>=.99);
 assert.equal(requiredBladeburnerTeam([.5,.9],.99),null);assert.equal(requiredBladeburnerTeam([.5,.51],.99),null);
 assert.equal(requiredBladeburnerTeam([NaN,1],.99),null);
});
test('teams are assigned minimally, or restored when they cannot unlock the action',()=>{
 let assigned=10;const api={getTeamSize:(type)=>type?assigned:3,setTeamSize:(_type,_name,n)=>(assigned=n),getActionEstimatedSuccessChance:()=>[.9,.91]};
 const plan=prepareBladeburnerTeam(api,'Operation X',.99,30,requiredBladeburnerTeam);assert.equal(plan.state,'needs-recruitment');assert.equal(assigned,3);
 api.getActionEstimatedSuccessChance=()=>[.1,.11];assigned=10;assert.equal(prepareBladeburnerTeam(api,'Operation X',.99,30,requiredBladeburnerTeam).state,'no-useful-team');assert.equal(assigned,10);
 api.getActionEstimatedSuccessChance=()=>[1,1];assert.equal(prepareBladeburnerTeam(api,'Operation X',.99,30,requiredBladeburnerTeam).required,0);assert.equal(assigned,0);
});
test('team options reject unbounded or invalid recruitment settings',()=>{
 const o={'success-threshold':.99,'low-stamina-pct':.5,'high-stamina-pct':.6,'chaos-recovery-threshold':50,'max-chaos':100,'training-limit':50,'reserved-action-count':200,'update-interval':2000};
 for(const patch of [{'team-cap':-1},{'team-cap':.5},{'recruitment-budget-minutes':Infinity},{'recruitment-budget-minutes':61}])assert.ok(optionsError({...o,...patch}));
});
