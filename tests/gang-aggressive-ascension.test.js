import test from 'node:test';
import assert from 'node:assert/strict';
import {aggressiveAscensionGate} from '../gang-aggressive-ascension-policy.js';
import {spendingPlan} from '../spending-policy.js';
const members=Object.fromEntries(Array.from({length:12},(_,i)=>['M'+i,{}]));
const base={enabled:true,gang:{territoryWarfareEngaged:false,territoryClashChance:0},members,now:10000};
test('aggressive pipeline starts with two and expands only with measured recovery',()=>{
 assert.equal(aggressiveAscensionGate(base).limit,2);
 const measurements={completed:[{at:9000,state:'measured',statRatio:1}]};assert.equal(aggressiveAscensionGate({...base,measurements}).limit,3);
 assert.equal(aggressiveAscensionGate({...base,recoveries:{A:{until:11000},B:{until:11000}}}).active,false);
});
test('recovery misses stop new aggressive resets and incomplete crews retain normal policy',()=>{
 assert.equal(aggressiveAscensionGate({...base,measurements:{completed:[{at:9000,state:'measured',statRatio:.8}]}}).limit,0);
 assert.equal(aggressiveAscensionGate({...base,members:{A:{}}}).limit,null);
 assert.equal(aggressiveAscensionGate({...base,gang:{territoryWarfareEngaged:true}}).active,false);
 assert.equal(aggressiveAscensionGate({...base,enabled:false}).active,false);
});
test('replacement cash earmark remains within unreserved shared funds',()=>{
 const p=spendingPlan({money:1e9,reserve:1e8,signals:{gangRecoveryCash:1e8}});assert.ok(p.allowances.gang>=1e8);assert.ok(Object.values(p.allowances).reduce((s,v)=>s+v,0)<=9e8+1);
});
