import test from 'node:test';
import assert from 'node:assert/strict';
import {gangCrimeTrainingHints} from '../gang-policy.js';
const train={name:'Train Hacking'},project=(m,t,s)=>({...m,trained:s});
function run(crimes,{baseline=0,horizon=900,reverse=false}={}){
 let calls=0;const list=[...crimes,{name:'Train Hacking'}];if(reverse)list.reverse();
 const tasks=Object.fromEntries(list.map(t=>[t.name,t]));
 const hints=gangCrimeTrainingHints({member:{trained:0},tasks,gang:{},horizonSeconds:horizon,project,
  evaluate:(m,g,name)=>{calls++;if(!name)return {value:baseline};const t=tasks[name];return {value:m.trained>=(t?.unlock??Infinity)?t.yield:0};}});
 return {hints,calls};
}
const crime=(name,yieldValue,unlock=60)=>({name,baseMoney:1,yield:yieldValue,unlock});
test('promising crimes beyond the old first thirty-two candidates reach the probe shortlist',()=>{
 const crimes=[...Array.from({length:40},(_,i)=>crime('Decoy'+String(i).padStart(2,'0'),1)),crime('Z-Best',1000,120)];
 const r=run(crimes);assert.equal(r.hints[0].crime,'Z-Best');assert.equal(r.hints[0].duration,120);assert.ok(r.hints[0].estimatedGain>0);assert.ok(r.calls<=497);
 assert.deepEqual(run(crimes,{reverse:true}).hints,r.hints);
});
test('ranking trades later unlock value against lost productive time',()=>{
 const r=run([crime('Soon',10,20),crime('Later',100,200)]);assert.equal(r.hints[0].crime,'Later');assert.equal(r.hints[0].duration,200);
 const late=run([crime('Soon',80,20),crime('Later',100,300)]);assert.equal(late.hints[0].crime,'Soon');
});
test('opportunity cost filters weak unlocks without losing short profitable training',()=>{
 assert.deepEqual(run([crime('Worse',9)],{baseline:10}).hints,[]);
 const early=run([crime('Small',12,20)],{baseline:10,horizon:600});assert.equal(early.hints[0].duration,20);assert.equal(early.hints[0].estimatedGain,960);
});
test('catalogue size and malformed projections remain bounded and cannot invent benefit',()=>{
 const r=run(Array.from({length:200},(_,i)=>crime('C'+String(i).padStart(3,'0'),i+1)));assert.ok(r.calls<=497);assert.ok(r.hints.length<=3);
 assert.deepEqual(run([crime('Invalid',NaN),crime('Infinite',Infinity)]).hints,[]);
});

test('all three training tasks share the bounded ranking and probe allowance',()=>{
 let calls=0;const crimes=Array.from({length:64},(_,i)=>crime('C'+i,1)),tasks=Object.fromEntries([...crimes,...['Train Combat','Train Hacking','Train Charisma'].map(name=>({name}))].map(t=>[t.name,t]));
 const hints=gangCrimeTrainingHints({member:{trained:0},tasks,gang:{},horizonSeconds:900,project,evaluate:(m,g,name)=>{calls++;return {value:name&&tasks[name]?.baseMoney&&m.trained>0?1:0};}});
 assert.equal(hints.length,3);assert.equal(calls,497);
});
