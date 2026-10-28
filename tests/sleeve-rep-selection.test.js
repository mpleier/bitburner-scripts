import test from 'node:test';
import assert from 'node:assert/strict';
import {sleeveRepAssignments,sleeveFactionRepScore,bestFactionWork} from '../sleeve-policy.js';
const sleeve=(skills={},mult=1)=>({shock:0,sync:100,skills:{hacking:100,strength:100,defense:100,dexterity:100,agility:100,charisma:100,intelligence:0,...skills},mults:{faction_rep:mult}});
const target={type:'FACTION',name:'Daedalus',priority:0,workTypes:['hacking','security','field']};
const plan=(sleeves,t=target,tasks=[],context={})=>sleeveRepAssignments(sleeves,[t],{},-1,false,tasks,null,true,context);
test('a new critical faction target selects the highest reputation score rather than lowest index',()=>{
 const sleeves=[sleeve({hacking:1000}),sleeve({hacking:500},3)],result=plan(sleeves);
 assert.equal(result[0],undefined);assert.equal(result[1].name,'Daedalus');assert.equal(result[1].selection,'highest-relative-reputation');
 assert.equal(result[1].relativeRepScore,sleeveFactionRepScore(sleeves[1],target.workTypes).score);
});
test('selection accounts for intelligence, reputation multipliers and supported work types',()=>{
 assert.equal(Object.keys(plan([sleeve({hacking:1000}),sleeve({hacking:900,intelligence:500})]))[0],'1');
 const sleeves=[sleeve({hacking:1000}),sleeve({hacking:100,strength:2000,defense:2000,dexterity:2000,agility:2000})];
 assert.equal(Object.keys(plan(sleeves,{...target,workTypes:['hacking']}))[0],'0');
 assert.equal(Object.keys(plan(sleeves,{...target,workTypes:['security']}))[0],'1');
});
test('SF15 charisma changes selection only when the effective source-file level enables it',()=>{
 const sleeves=[sleeve({hacking:1000,charisma:0}),sleeve({hacking:900,charisma:2000})],t={...target,workTypes:['hacking']};
 assert.equal(Object.keys(plan(sleeves,t,[],{sf15Level:2}))[0],'0');
 assert.equal(Object.keys(plan(sleeves,t,[],{sf15Level:3}))[0],'1');
});
test('existing eligible owners are retained even when another sleeve becomes faster',()=>{
 const sleeves=[sleeve(),sleeve({hacking:5000},5)],tasks=[{type:'FACTION',factionName:'Daedalus'},null];
 const p=plan(sleeves,target,tasks);assert.equal(p[0].selection,'retained-owner');assert.equal(p[1],undefined);
 for(const patch of [{shock:1},{sync:99}])assert.equal(Object.keys(plan([{...sleeves[0],...patch},sleeves[1]],target,tasks))[0],'1');
 assert.equal(Object.keys(plan(sleeves,target,tasks,{reservedSleeves:[0]}))[0],'1');
});
test('reservations and recovery eligibility outrank the largest candidate score',()=>{
 const sleeves=[sleeve(),sleeve({hacking:1e6}),{...sleeve({hacking:2e6}),shock:1},{...sleeve({hacking:3e6}),sync:0}];
 assert.equal(Object.keys(plan(sleeves,target,[],{reservedSleeves:[1]}))[0],'0');
});
test('equal scores use a deterministic tie and ordinary reputation work retains its policy',()=>{
 assert.equal(Object.keys(plan([sleeve(),sleeve()]))[0],'0');
 const p=sleeveRepAssignments([sleeve(),sleeve({hacking:10000})],[target],{},-1,false,[],null,false);
 assert.equal(p[0].name,'Daedalus');assert.equal(p[1],undefined);
});
test('invalid scores cannot outrank valid candidates and total uncertainty uses a disclosed stable fallback',()=>{
 for(const bad of [sleeve({hacking:NaN}),sleeve({intelligence:Infinity}),sleeve({},-1),sleeve({},NaN)]){
  assert.equal(sleeveFactionRepScore(bad,target.workTypes),null);
  assert.equal(Object.keys(plan([bad,sleeve()]))[0],'1');
 }
 const fallback=plan([{shock:0,sync:100,skills:{}},{shock:0,sync:100,skills:{}}]);
 assert.equal(fallback[0].selection,'fallback-no-score');assert.equal(fallback[0].relativeRepScore,null);
 assert.deepEqual(plan([sleeve()],{...target,workTypes:['unsupported']}),{});
});
// Independent expressions checked against official reputation.ts and intelligence.ts.
function oracle(p,types,{shareBonus=1,sf15Level=0}={}){
 const s=p.skills,combat=s.strength+s.defense+s.dexterity+s.agility,dark=sf15Level>=3?s.charisma:0;
 const rates={hacking:(s.hacking+s.intelligence/3+.1*dark)/975*shareBonus,
  security:.9*(combat+.3*dark+(s.hacking+s.intelligence)*shareBonus)/975/4.5,
  field:.9*(combat+s.charisma+(s.hacking+s.intelligence+.3*dark)*shareBonus)/975/5.5};
 const workType=[...types].sort((a,b)=>rates[b]-rates[a])[0];
 return {workType,score:rates[workType]*p.mults.faction_rep*(1+Math.pow(s.intelligence,.8)/600)};
}
test('relative scores agree with independent native expressions across stats, share, SF15 and multipliers',()=>{
 for(const hacking of [1,300,2000])for(const combat of [10,1000])for(const charisma of [0,2000])for(const intelligence of [0,100,500])for(const shareBonus of [1,3])for(const sf15Level of [0,3])for(const mult of [0,.5,3]){
  const p=sleeve({hacking,strength:combat,defense:combat,dexterity:combat,agility:combat,charisma,intelligence},mult),context={shareBonus,sf15Level};
  const expected=oracle(p,target.workTypes,context),actual=sleeveFactionRepScore(p,target.workTypes,context);
  assert.equal(actual.workType,expected.workType);assert.ok(Math.abs(actual.score-expected.score)<=Math.max(1e-12,expected.score*1e-12));
  assert.equal(bestFactionWork(p,target.workTypes,context),expected.workType);
 }
});
test('multiple critical factions get distinct sleeves while the current owner remains stable',()=>{
 const targets=[target,{...target,name:'Other'}],sleeves=[sleeve(),sleeve({hacking:2000}),sleeve({hacking:1000})];
 const result=sleeveRepAssignments(sleeves,targets,{},-1,false,[{type:'FACTION',factionName:'Other'}],null,true);
 assert.equal(result[1].name,'Daedalus');assert.equal(result[0].name,'Other');assert.equal(result[0].selection,'retained-owner');
 assert.equal(new Set(Object.values(result).map(r=>r.name)).size,2);
});
test('a newly ranked target cannot steal the fastest owner from another critical faction',()=>{
 const sleeves=[sleeve(),sleeve({hacking:5000}),sleeve({hacking:1000})],targets=[target,{...target,name:'Other'}];
 const result=sleeveRepAssignments(sleeves,targets,{},-1,false,[null,{type:'FACTION',factionName:'Other'}],null,true);
 assert.equal(result[1].name,'Other');assert.equal(result[1].selection,'retained-owner');assert.equal(result[2].name,'Daedalus');
});
