import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseGangAscensions} from '../gang-policy.js';
const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8');
const value=name=>Number(source.match(new RegExp("\\['"+name+"', ([\\d.]+)\\]"))[1]);
test('controller admits two-percent ascensions through the existing adaptive economic screen',()=>{
 const base=value('ascend-multi-threshold'),spacing=value('ascend-multi-threshold-spacing');
 assert.equal(base,1.02);assert.equal(spacing,.01);
 const gang={respect:100,wantedLevel:1},names=['A','B','C'];
 const selected=chooseGangAscensions({A:{str:1.02,respect:100},B:{str:1.04,respect:100},C:{str:1.019,respect:0}},gang,names,['str'],base,spacing,12,true,true,true);
 assert.deepEqual(selected.map(c=>c.name),['B','A']);
 assert.equal(chooseGangAscensions({A:{str:1.02,respect:0}},gang,names,['str'],1.05,spacing,12,true,true,true).length,0);
});
test('legacy member spacing is smaller while adaptive mode treats member indexes equally',()=>{
 const names=Array.from({length:12},(_,i)=>'M'+i),results=Object.fromEntries(names.map(name=>[name,{str:1.04,respect:0}]));
 const adaptive=chooseGangAscensions(results,{respect:100},names,['str'],value('ascend-multi-threshold'),value('ascend-multi-threshold-spacing'),12,true,true,true);
 assert.equal(adaptive.length,12);
 const legacy=chooseGangAscensions(results,{respect:100},names,['str'],value('ascend-multi-threshold'),value('ascend-multi-threshold-spacing'),12,false,false,true);
 assert.ok(legacy.length>0&&legacy.length<12);
});
test('economic native validation, respect preference, recovery and fresh-crew execution remain wired',()=>{
 assert.match(source,/economicReview:true/);assert.match(source,/ignore-ascension-respect-loss', true/);
 assert.match(source,/ascendGangMemberSafely.toString/);assert.match(source,/gangAscensionAvailability/);
 assert.match(source,/await saveGangTraining\(ns\);break;/);
});
