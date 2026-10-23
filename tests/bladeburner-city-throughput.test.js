import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {probeBladeburnerCities,chooseBladeburnerCity,bladeburnerRankRate,bladeburnerStaminaChance,nextBladeburnerProgressSkill,nextSkill} from '../bladeburner-policy.js';
const data={A:{base:125,factor:1.02},B:{base:250,factor:1.04}};
const recovery={stamina:[100,100],regen:1,hrc:1};
function fixture(chances={Home:1,Other:1}){
 const state={city:'Home',calls:[],count:1,level:1};
 const api={getCity:()=>state.city,switchCity:city=>{state.calls.push(city);state.city=city;return true;},getActionCountRemaining:()=>state.count,getActionCurrentLevel:()=>state.level,
  getActionEstimatedSuccessChance:()=>[chances[state.city],chances[state.city]],getActionTime:()=>1000,getActionRankGain:()=>10,getActionRankLoss:()=>2};
 return {api,state};
}
const sample=(api,allowed=()=>true,actions=[['A','Contracts']])=>probeBladeburnerCities(api,['Home','Other'],actions,.99,allowed,data,bladeburnerRankRate,bladeburnerStaminaChance,recovery);

test('city probes use native chances and always restore original city',()=>{
 const {api,state}=fixture({Home:.9,Other:1});const rows=sample(api);
 assert.equal(state.city,'Home');assert.deepEqual(state.calls,['Other','Home']);
 const cost=.285*(125**.28+125/650);
 assert.equal(rows[0].score,0);assert.equal(rows[1].score,10/(1+Math.max(0,cost-1)/2));
 assert.equal(chooseBladeburnerCity(rows,'Home').city,'Other');
});
test('city choice stays on ties and requires a meaningful improvement',()=>{
 assert.equal(chooseBladeburnerCity([{city:'Other',score:10},{city:'Home',score:10}],'Home').city,'Home');
 assert.equal(chooseBladeburnerCity([{city:'Home',score:10},{city:'Other',score:10.2}],'Home').city,'Home');
 assert.equal(chooseBladeburnerCity([{city:'Home',score:10},{city:'Other',score:10.4}],'Home').city,'Other');
});
test('city ranking includes recovery costs and exhausted work cannot win',()=>{
 const {api,state}=fixture();
 api.getActionTime=()=>state.city==='Home'?2000:1000;
 api.getActionCurrentLevel=()=>state.city==='Home'?1:500;
 const rows=sample(api);
 assert.ok(rows[0].score>rows[1].score);
 state.count=.99;assert.ok(sample(api).every(r=>r.score===0));
});
test('probe cancellation restores city and never returns a partial plan',()=>{
 const {api,state}=fixture();let calls=0;
 const result=sample(api,()=>++calls<5);
 assert.equal(result,null);assert.equal(state.city,'Home');
 const blocked=fixture();assert.equal(sample(blocked.api,()=>false),null);assert.deepEqual(blocked.state.calls,[]);
});
test('native errors and rejected switches restore the original city',()=>{
 const {api,state}=fixture();api.getActionTime=()=>{if(state.city==='Other')throw Error('native failure');return 1000;};
 assert.throws(()=>sample(api),/native failure/);assert.equal(state.city,'Home');
 const x=fixture();x.api.switchCity=()=>false;
 assert.throws(()=>sample(x.api),/City probe rejected/);assert.equal(x.state.city,'Home');
});
test('restoration failures cannot be reported as successful probes',()=>{
 const {api,state}=fixture();api.switchCity=city=>{if(city==='Home')return false;state.city=city;return true;};
 assert.throws(()=>sample(api),/restore the original/);
});
test('unknown data, invalid levels and Black Ops do not enter city ranking',()=>{
 const {api,state}=fixture();
 assert.ok(sample(api,()=>true,[['Unknown','Operations'],['A','Black Operations']]).every(r=>r.score===0));
 state.level=NaN;assert.ok(sample(api).every(r=>r.score===0));
 assert.equal(state.city,'Home');
});
test('city choice rejects malformed and unavailable observations',()=>{
 for(const rows of [null,[],[{city:'X',score:NaN}],[{city:'X',score:-1}],[{city:'X',score:0}]])assert.equal(chooseBladeburnerCity(rows,'Home'),null);
 assert.equal(chooseBladeburnerCity([{city:'X',score:10}],'Home',NaN),null);
});
test('city helpers serialize without module dependencies',()=>{
 const probe=Function('return ('+probeBladeburnerCities.toString()+')')();
 const choose=Function('return ('+chooseBladeburnerCity.toString()+')')();
 const {api}=fixture();const rows=probe(api,['Home','Other'],[['A','Contracts']],.99,()=>true,data,bladeburnerRankRate,bladeburnerStaminaChance,recovery);
 assert.equal(choose(rows,'Home').city,'Home');
});
const skills=['Overclock','Digital Observer','Tracer'];
const levels={Overclock:80,'Digital Observer':0,Tracer:0};
const costs={Overclock:10,'Digital Observer':10,Tracer:10};
const context={skills:{agility:1000,dexterity:1000},mults:{bladeburner_stamina_gain:1},maxStaminaMultiplier:1,threshold:.99,stamina:[10000,10000]};
const a={type:'Contracts',difficulty:100000,gain:10,loss:1,chance:1};
const b={type:'Operations',difficulty:100000,gain:10000,loss:1,chance:.96};
const select=actions=>nextBladeburnerProgressSkill(skills,levels,costs,100,{}, {...context,throughputs:actions},nextSkill);
test('skill selection values unlocking better work rather than speeding up only the current action',()=>{
 assert.equal(select([a]),'Overclock');
 assert.equal(select([a,b]),'Digital Observer');
 assert.equal(select([b,a]),'Digital Observer');
});
test('a high-reward unsafe action cannot justify an upgrade that leaves it unsafe',()=>{
 assert.equal(select([a,{...b,chance:.1}]),'Overclock');
});
test('multiple action values use the best available rate rather than adding mutually exclusive work',()=>{
 assert.equal(select([a,b,b,b,b]),select([a,b]));
 assert.equal(select([null,a,{...b,difficulty:NaN}]),select([a]));
});
test('production city worker has bounded cadence, guard, native helper and restoration path',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.match(source,/Date.now\(\)-cityPlanCache.at>=15000/);
 assert.match(source,/probeBladeburnerCities.toString/);
 assert.match(source,/applyBladeburnerTrainingBaseline\(cityPlanCache.rows,currentCity/);
 assert.match(source,/chooseBladeburnerCity\(cityRows,currentCity\)/);
 assert.ok(source.indexOf('if(isBlackOp(observedAction))')<source.indexOf('probeBladeburnerCities.toString'));
 assert.match(source,/await spendSkillPoints\(ns,unreservedActions.filter/);
});
