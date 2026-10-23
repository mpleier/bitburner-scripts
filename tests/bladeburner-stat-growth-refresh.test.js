import {captureBladeburnerPlanningState} from '../bladeburner-snapshot-readers.js';
import {bladeburnerCombinedSnapshotSource} from '../bladeburner-snapshot-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {captureBladeburnerStatAnchor as capture,bladeburnerStatsChanged as changed} from '../bladeburner-capability-policy.js';
const names=['hacking','strength','defense','dexterity','agility','charisma','intelligence'];
const stats=()=>Object.fromEntries(names.map(name=>[name,1000]));
const anchor=()=>capture(stats());
function nativeFixture(){
 const player={skills:stats(),exp:{strength:0},money:10,entropy:0,mults:{}},ns={getPlayer:()=>player,getResetInfo:()=>({lastNodeReset:1,lastAugReset:2,ownedAugs:new Map()}),bladeburner:{getSkillNames:()=>[],getCity:()=> 'A',getCityEstimatedPopulation:()=>100,getCityCommunities:()=>1,getCityChaos:()=>0}};
 const snapshot=()=>vm.runInNewContext('('+bladeburnerCombinedSnapshotSource+')(ns,["A"])',{ns});
 return {player,ns,snapshot};
}
test('one-percent growth or reduction in any relevant stat invalidates the city anchor',()=>{
 for(const name of names){const current=stats();current[name]=1010;assert.equal(changed(anchor(),capture(current)),true);current[name]=990;assert.equal(changed(anchor(),capture(current)),true);current[name]=1009;assert.equal(changed(anchor(),capture(current)),false);current[name]=991;assert.equal(changed(anchor(),capture(current)),false);}
});
test('small stat gains accumulate against the probe anchor rather than each sample',()=>{
 const previous=anchor(),current=stats();for(const strength of [1002,1004,1006,1008]){current.strength=strength;assert.equal(changed(previous,capture(current)),false);}current.strength=1010;assert.equal(changed(previous,capture(current)),true);assert.deepEqual(previous,anchor());
});
test('native stat capture ignores cash and raw XP without requiring optional APIs',()=>{
 const f=nativeFixture(),before=capture(f.snapshot().stats);f.player.money=1e12;f.player.exp.strength=1e9;f.ns.singularity=new Proxy({},{get:()=>{throw Error('Optional Source File');}});assert.equal(changed(before,capture(f.snapshot().stats)),false);f.player.skills.strength=1010;assert.equal(changed(before,capture(f.snapshot().stats)),true);
});
test('city snapshot and stat anchors are independent copies of player levels',()=>{
 const f=nativeFixture(),data=f.snapshot(),saved=capture(data.stats);f.player.skills.strength=2000;assert.equal(data.stats.strength,1000);data.stats.dexterity=2000;assert.equal(saved[names.indexOf('dexterity')],1000);assert.equal(capture(f.snapshot().stats)[1],2000);
});
test('missing and malformed native stats or saved anchors cannot authorize reuse',()=>{
 for(const value of [null,undefined,{}, {...stats(),strength:NaN},{...stats(),agility:-1},{...stats(),intelligence:Infinity},{...stats(),charisma:'1000'}])assert.equal(capture(value),null);
 for(const value of [null,undefined,[],[1,2],Array(7).fill(NaN),Array(7).fill(-1),Array(8).fill(1),Array(7).fill('1')]){assert.equal(changed(value,anchor()),true);assert.equal(changed(anchor(),value),true);}
});
test('zero intelligence remains cacheable but a zero-to-positive change triggers refresh',()=>{
 const current=stats();current.intelligence=0;const before=capture(current);assert.equal(changed(before,capture(current)),false);current.intelligence=1;assert.equal(changed(before,capture(current)),true);assert.equal(changed(capture(current),before),true);
});
test('executed controller preserves stable city plans and invalidates them after cumulative growth or unknown stats',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('        const cityStats='),end=source.indexOf('        const cityEnvironment=',start),block=source.slice(start,end),saved={marker:'city',stats:anchor()},level={marker:'level'},c={captureBladeburnerStatAnchor:capture,bladeburnerStatsChanged:changed,cityState:{stats:stats()},cityPlanCache:saved,levelPlanCache:level};
 assert.ok(start>0&&end>start);const run=()=>vm.runInNewContext('{'+block+'}',c);run();assert.equal(c.cityPlanCache,saved);c.cityState.stats.strength=1005;run();assert.equal(c.cityPlanCache,saved);c.cityState.stats.strength=1010;run();assert.equal(c.cityPlanCache,null);assert.equal(c.levelPlanCache,level);
 c.cityPlanCache=saved;c.cityState.stats=null;run();assert.equal(c.cityPlanCache,null);
});
test('only complete city results can commit the new stat anchor',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('            if(!Array.isArray(rows)'),end=source.indexOf('\n        }',start),block=source.slice(start,end),cityStats=anchor(),context=rows=>({rows,candidates:['A'],key:'new',cityEnvironment:[['A',1000,0]],cityStats,cityPlanCache:{key:'old',stats:Array(7).fill(500)},Date:{now:()=>1000}});
 const good=context([{city:'A',score:0}]);vm.runInNewContext(block,good);assert.equal(good.cityPlanCache.stats,cityStats);
 const bad=context(null);vm.runInNewContext('try{'+block+'}catch{cityPlanCache=null;}',bad);assert.equal(bad.cityPlanCache,null);
});
test('stat refresh runs after protected-action guards and inside city planning without another worker',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');assert.ok(source.indexOf('if(isBlackOp(observedAction))')<source.indexOf('const cityStats='));assert.ok(source.indexOf('if(!goToCity&&Date.now()>currentTaskEndTime)try')<source.indexOf('const cityStats='));assert.match(source,/stats:cityStats/);assert.match(source,/Date.now\(\)-cityPlanCache.at>=15000/);
 assert.ok(!source.slice(source.indexOf('const cityStats='),source.indexOf('const cityEnvironment=')).includes('getNsDataThroughFile'));
});
