import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {captureBladeburnerCityEnvironment as capture,bladeburnerCityEnvironmentChanged as changed,bladeburnerCityMaintenanceKey} from '../bladeburner-capability-policy.js';
import {bladeburnerRankSupply} from '../bladeburner-reserve-policy.js';
const anchor=()=>[['A',1000,10],['B',2000,20]];
test('one-percent population changes in either direction refresh city scores within the eligible set',()=>{
 const previous=anchor();for(const population of [990,1010,500,2000]){const current=anchor();current[0][1]=population;assert.equal(changed(previous,current),true);}
 for(const population of [990.1,1000,1009.9]){const current=anchor();current[0][1]=population;assert.equal(changed(previous,current),false);}
});
test('a one-point absolute chaos change refreshes regardless of population size or chaos direction',()=>{
 for(const chaos of [9,11,0,50]){const current=anchor();current[0][2]=chaos;assert.equal(changed(anchor(),current),true);}
 for(const chaos of [9.01,10,10.99]){const current=anchor();current[0][2]=chaos;assert.equal(changed(anchor(),current),false);}
});
test('small changes accumulate from the successful probe rather than the previous sample',()=>{
 const previous=anchor();for(const population of [1002,1004,1006,1008]){const current=anchor();current[0][1]=population;assert.equal(changed(previous,current),false);}
 const current=anchor();current[0][1]=1010;assert.equal(changed(previous,current),true);assert.deepEqual(previous,anchor());
 for(const chaos of [10.2,10.4,10.6,10.8]){const current=anchor();current[0][2]=chaos;assert.equal(changed(previous,current),false);}
 current[0][2]=11;assert.equal(changed(previous,current),true);
});
test('zero population transitions and changed eligible cities cannot reuse old estimates',()=>{
 assert.equal(changed([['A',0,0]],[['A',0,0]]),false);assert.equal(changed([['A',0,0]],[['A',.001,0]]),true);assert.equal(changed([['A',.001,0]],[['A',0,0]]),true);
 assert.equal(changed(anchor(),[['C',1000,10],['B',2000,20]]),true);assert.equal(changed(anchor(),[['A',1000,10]]),true);
});
test('anchors are immutable canonical copies of existing city data',()=>{
 const population={A:1000,B:2000,C:3000},chaos={A:10,B:20,C:30},cities=['B','A'],result=capture(cities,population,chaos);assert.deepEqual(result,anchor());assert.deepEqual(cities,['B','A']);population.A=9000;chaos.B=40;assert.deepEqual(result,anchor());assert.equal(changed(result,[...anchor()].reverse()),false);
});
test('missing, duplicate and malformed observations always prevent cache reuse',()=>{
 for(const value of [null,undefined,[],[['A',1000,10],['A',1000,10]],[['A',NaN,10]],[['A',1000,Infinity]],[['A',-1,10]],[['A',1000,-1]],[['A',1000,10,1]],[['',1000,10]],[null]]){assert.equal(changed(value,anchor()),true);assert.equal(changed(anchor(),value),true);}
 for(const [cities,population,chaos] of [[[],{},{}],[['A','A'],{A:1},{A:1}],[['A'],{},{}],[['A'],{A:-1},{A:1}],[['A'],{A:1},{A:NaN}],[[''],{'':1},{'':1}]])assert.equal(capture(cities,population,chaos),null);
});
test('executed controller detects environmental changes without changing maintenance, reserves or eligible cities',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=source.indexOf('        const cityEnvironment='),end=source.indexOf('            const rows=await',start),block=source.slice(start,end).replace(/if\(([^\n]+)\)\{\s*$/, 'globalThis.refresh=($1);');
 const c={captureBladeburnerCityEnvironment:capture,bladeburnerCityEnvironmentChanged:changed,bladeburnerCityMaintenanceKey,bladeburnerRankSupply,candidates:['A','B'],populationByCity:{A:1000,B:2000},chaosByCity:{A:10,B:20},cityState:{maintenance:{complete:true,accelerated:false,sleeves:null,stock:['Tracking','Investigation','Undercover Operation','Stealth Retirement Operation'].map(n=>[n,100])}},squadKey:'squad',developmentBudget:{spentMs:0},cityGrowthTarget:null,actions:[['Tracking','Contracts']],options:{'success-threshold':.99,'disable-level-optimization':false},rankReserves:{stealth:20,population:200,maxRank:1000,guardReady:true},rank:0,getCount:()=>201,currentCity:'A',cityPlanCache:null,Date:{now:()=>1000}};
 const run=()=>vm.runInNewContext('{'+block+';globalThis.cacheKey=key;globalThis.environment=cityEnvironment;}',c);
 assert.ok(start>0&&end>start);run();assert.equal(c.refresh,true);c.cityPlanCache={key:c.cacheKey,at:1000,environment:c.environment};run();assert.equal(c.refresh,false);
 c.populationByCity.A=1005;run();assert.equal(c.refresh,false);c.populationByCity.A=1010;run();assert.equal(c.refresh,true);
 c.populationByCity.A=1000;c.chaosByCity.B=21;run();assert.equal(c.refresh,true);c.chaosByCity.B=20;run();assert.equal(c.refresh,false);
 c.populationByCity.A=NaN;run();assert.equal(c.refresh,true);assert.deepEqual(Array.from(c.cityPlanCache.environment[0]),['A',1000,10]);
});
test('production saves the environmental anchor only with a new completed probe and retains age and guard limits',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');assert.equal((s.match(/environment:cityEnvironment/g)||[]).length,1);assert.match(s,/cityPlanCache=\{key,at:Date.now\(\),rows,environment:cityEnvironment,stats:cityStats\}/);assert.match(s,/bladeburnerCityEnvironmentChanged\(cityPlanCache.environment,cityEnvironment\)/);assert.match(s,/Date.now\(\)-cityPlanCache.at>=15000/);assert.ok(s.indexOf('if(isBlackOp(observedAction))')<s.indexOf('const cityEnvironment='));assert.ok(s.indexOf('const rows=await getNsDataThroughFile(ns,`(() => {const b=ns.bladeburner')<s.indexOf('environment:cityEnvironment'));
});

test('cancelled, partial, duplicate and malformed probe results do not establish a new cache anchor',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=s.indexOf('            if(!Array.isArray(rows)'),end=s.indexOf('\n        }',start),block=s.slice(start,end);
 assert.ok(start>0&&end>start);
 const valid=[{city:'A',score:0},{city:'B',score:1}];
 for(const rows of [null,[],[valid[0]],[valid[0],valid[0]],[valid[0],{city:'B',score:NaN}],[valid[0],{city:'B',score:-1}]]){
  const c={rows,candidates:['A','B'],key:'new',cityStats:[100,100,100,100,100,100,1],cityEnvironment:anchor(),cityPlanCache:{key:'old'},Date:{now:()=>1000}};
  vm.runInNewContext('try{'+block+'}catch{cityPlanCache=null;}',c);assert.equal(c.cityPlanCache,null);
 }
});
test('a complete probe including zero-score cities replaces the anchor after successful validation',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),start=s.indexOf('            if(!Array.isArray(rows)'),end=s.indexOf('\n        }',start),block=s.slice(start,end),environment=anchor(),rows=[{city:'A',score:0},{city:'B',score:1}],c={rows,candidates:['A','B'],key:'new',cityStats:[100,100,100,100,100,100,1],cityEnvironment:environment,cityPlanCache:{key:'old'},Date:{now:()=>1000}};
 vm.runInNewContext(block,c);assert.equal(c.cityPlanCache.key,'new');assert.equal(c.cityPlanCache.environment,environment);assert.equal(c.cityPlanCache.rows,rows);
});
