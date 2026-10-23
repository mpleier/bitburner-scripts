import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {applyBladeburnerTrainingBaseline,quoteBladeburnerCityTraining,bladeburnerGrowthChoice} from '../combat-growth-policy.js';
import {bladeburnerDevelopmentAction,chooseBladeburnerCity} from '../bladeburner-policy.js';
const rows=()=>[{city:'Home',score:.0001,objective:'combat-xp',action:'A',level:1},{city:'Other',score:.0002,objective:'combat-xp',action:'B',level:2}];
const training={kind:'training',name:'Training',score:.0003,time:30000,chance:[.5,.5],rawChance:[.5,.5],stamina:[100,100],hpRatio:1};
const settings={rank:5000,requiredRank:5000,threshold:.99,remainingMs:120000,trainingEnabled:true,enabled:true,lowStaminaPct:.5};
const apply=(r=rows(),t=training,s=settings)=>applyBladeburnerTrainingBaseline(r,'Home',t,s,bladeburnerDevelopmentAction);
test('available Training prevents an inferior mission move without mutating cached city rows',()=>{
 const cached=rows(),updated=apply(cached);assert.equal(chooseBladeburnerCity(updated,'Home').city,'Home');
 assert.equal(updated[0].action,'Training');assert.equal(updated[0].level,null);assert.equal(cached[0].score,.0001);assert.equal(cached[0].action,'A');
});
test('a mission city must beat both the Training baseline and the switching margin',()=>{
 const r=rows();r[1].score=.000306;assert.equal(chooseBladeburnerCity(apply(r),'Home').city,'Home');
 r[1].score=.00031;assert.equal(chooseBladeburnerCity(apply(r),'Home').city,'Other');
});
test('Training can anchor the current city when no safe productive mission is available',()=>{
 const r=rows().map(x=>({...x,score:0,action:null,level:null}));
 assert.equal(chooseBladeburnerCity(apply(r),'Home').action,'Training');assert.equal(chooseBladeburnerCity(apply(r,null),'Home'),null);
});
test('rolling budget and training limits are checked every pass outside the cached quote',()=>{
 const r=rows();assert.equal(chooseBladeburnerCity(apply(r),'Home').city,'Home');
 for(const patch of [{remainingMs:29999},{remainingMs:NaN},{trainingEnabled:false},{enabled:false},{rank:4999}])
  assert.equal(chooseBladeburnerCity(apply(r,training,{...settings,...patch}),'Home').city,'Other');
 assert.equal(chooseBladeburnerCity(apply(r,training,{...settings,remainingMs:30000}),'Home').city,'Home');
});
test('health, stamina and immediate Black Op/analysis priorities retain their gates',()=>{
 for(const patch of [{hpRatio:.49},{hpRatio:null},{stamina:[49,100]},{chance:[1,1],rawChance:[1,1]},{chance:[.5,1]},{stamina:[90,100],rawChance:[1,1],chance:[.98,.98]}])
  assert.equal(chooseBladeburnerCity(apply(rows(),{...training,...patch}),'Home').city,'Other');
});
test('rank scoring, excluded current cities and malformed native quotes are left unchanged',()=>{
 const rank=rows().map(r=>({...r,objective:'rank'}));assert.equal(apply(rank),rank);
 const excluded=rows().filter(r=>r.city!=='Home');assert.equal(apply(excluded),excluded);
 for(const t of [null,{...training,score:NaN},{...training,time:Infinity},{...training,kind:'mission'},{...training,rawChance:[]},{...training,chance:[NaN,1]}]){
  const r=rows();assert.equal(apply(r,t),r);
 }
});
test('native Training quote is read-only and unavailable optional APIs fail gracefully',()=>{
 const context={metadata:{baseDifficulty:125,weights:{strength:1},decays:{strength:.8}},player:{skills:{strength:100},exp:{strength:1000},mults:{strength_exp:2},hp:{current:100,max:100}}};
 const api={getStamina:()=>[100,100],getActionEstimatedSuccessChance:(type,target)=>{assert.equal(type,'Black Operations');assert.equal(target,'Blocked');return [.5,.5];},getActionTime:(type,action)=>{assert.equal(type,'General');assert.equal(action,'Training');return 30000;}};
 const forecast=(chance,stamina,difficulty)=>{assert.equal(difficulty,125);return chance;};
 const quote=vm.runInNewContext('('+quoteBladeburnerCityTraining.toString()+')');
 const q=quote(api,'Blocked',context,forecast,bladeburnerGrowthChoice);assert.equal(q.kind,'training');assert.equal(q.rates.strength,2);assert.equal(q.hpRatio,1);assert.equal(q.time,30000);
 assert.equal(quote({...api,getActionTime:()=>{throw Error('Source File unavailable');}},'Blocked',context,forecast,bladeburnerGrowthChoice),null);
 assert.equal(quote(api,null,context,forecast,bladeburnerGrowthChoice),null);
});
test('production applies the baseline after the cache and shares the action budget',()=>{
 const s=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8');
 assert.equal((s.match(/const developmentBudget=/g)||[]).length,1);
 assert.ok(s.indexOf('const developmentBudget=')<s.indexOf('const cityGrowthTarget='));
 assert.match(s,/applyBladeburnerTrainingBaseline\(cityPlanCache.rows,currentCity/);
 assert.match(s,/chooseBladeburnerCity\(cityRows,currentCity\)/);
 assert.match(s,/remainingMs:120000-developmentBudget.spentMs/g);
 assert.match(s,/trainingBaseline=context\?/);
});
