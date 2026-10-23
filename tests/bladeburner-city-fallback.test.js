import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {scoreBladeburnerCityFallback as cityScore} from '../bladeburner-city-fallback-policy.js';
import {createBladeburnerStaminaGrowth,bladeburnerStaminaGrowthSource,valueBladeburnerStaminaGrowth,rankBladeburnerStaminaGrowth} from '../bladeburner-growth-stamina-policy.js';
import {quotePlayerTrainingStamina} from '../player-training-stamina-policy.js';
import {combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining,applyBladeburnerTrainingBaseline} from '../combat-growth-policy.js';
import {probeBladeburnerCities,chooseBladeburnerCity,planBladeburnerLevels,readBladeburnerMaintenance,bladeburnerRankRate,bladeburnerStaminaChance} from '../bladeburner-policy.js';
const keys=['strength','defense','dexterity','agility','charisma','hacking','intelligence'];
const player={skills:Object.fromEntries(keys.map(k=>[k,100])),exp:Object.fromEntries(keys.map(k=>[k,1000])),mults:{bladeburner_stamina_gain:1e6},hp:{current:100,max:100}};
const metadata={baseDifficulty:100,weights:{strength:1},decays:{strength:1}},stock={Scarce:1,Steady:30,Local:30};
const context={metadata,player,growthSupply:stock,inferLevels:true},data=Object.fromEntries(Object.keys(stock).map(k=>[k,{base:1,factor:1}]));
const weights={Scarce:{strength:10},Steady:{strength:1},Local:{strength:1.1}},actions=Object.keys(stock).map(k=>[k,'Contracts']);
function fixture(){
 const state={city:'Home',level:1,auto:true},calls={};
 const api={getCity:()=>state.city,switchCity:c=>{state.city=c;return true;},getActionCountRemaining:(_t,n)=>n==='Scarce'?1:100,getActionCurrentLevel:()=>state.level,getActionMaxLevel:()=>2,getActionAutolevel:()=>state.auto,setActionLevel:(_t,_n,l)=>{state.level=l;},getActionEstimatedSuccessChance:(t,n)=>t==='General'||t==='Black Operations'?[1,1]:((state.city==='Home')===(n==='Local'))?[1,1]:[.1,.1],getActionTime:t=>t==='General'?30000:1000,getActionRankGain:()=>1,getActionRankLoss:()=>0,getSkillLevel:()=>0,getStamina:()=>[100,100],getTeamSize:()=>0,getBonusTime:()=>0};
 for(const [k,f]of Object.entries(api))api[k]=(...args)=>{calls[k]=(calls[k]||0)+1;return f(...args);};
 return {api,state,calls};
}
function probe(f,{combined=true,planner=planBladeburnerLevels,allowed=()=>true,scorer=null}={}){
 const growth=createBladeburnerStaminaGrowth(f.api,context,0,bladeburnerGrowthChoice,quotePlayerTrainingStamina,valueBladeburnerStaminaGrowth,30,rankBladeburnerStaminaGrowth,2);
 return probeBladeburnerCities(f.api,['Home','Other'],actions,.99,allowed,data,bladeburnerRankRate,bladeburnerStaminaChance,{stamina:[100,100],regen:1e6,hrc:1},planner,null,name=>(chance,m)=>bladeburnerCityGrowthScore(chance,m,data[name],weights[name],context,0,bladeburnerRankRate,growth,stock[name]),scorer??(combined?(candidates)=>cityScore(candidates,context,0,weights,data,growth,bladeburnerRankRate):null));
}
test('per-city fallback can change the winner while preserving original city and level',()=>{
 for(const planner of [null,planBladeburnerLevels]){
  const a=fixture(),b=fixture(),single=probe(a,{combined:false,planner}),combined=probe(b,{planner});
  assert.equal(chooseBladeburnerCity(single,'Home').city,'Home');assert.equal(chooseBladeburnerCity(combined,'Home').city,'Other');
  const row=combined.find(r=>r.city==='Other');assert.equal(row.action,'Scarce');assert.equal(row.level,1);assert.equal(row.fallback.second.name,'Steady');assert.equal(row.fallback.first.count,1);assert.equal(row.fallback.second.count,27);assert.ok(row.fallbackPairs<=64);
  assert.equal(b.state.city,'Home');assert.equal(b.state.level,1);assert.equal(b.state.auto,true);
 }
});
test('fallback scoring reuses native probes rather than adding API calls',()=>{
 const single=fixture(),combined=fixture();probe(single,{combined:false});probe(combined);
 assert.deepEqual(combined.calls,single.calls);
});
test('only eligible actions from the same city can form a pair',()=>{
 const rows=probe(fixture()),home=rows.find(r=>r.city==='Home');assert.equal(home.action,'Local');assert.equal(home.fallback,undefined);
 const other=rows.find(r=>r.city==='Other');assert.equal(other.fallback.first.name,'Scarce');assert.equal(other.fallback.second.name,'Steady');
});
test('callback errors and cancellation restore temporary city, levels and autolevel',()=>{
 for(const mode of ['throw','cancel']){
  const f=fixture();let allowed=true;
  const scorer=(_rows,city)=>{if(city==='Other'){if(mode==='throw')throw Error('fallback failed');allowed=false;}return null;};
  if(mode==='throw')assert.throws(()=>probe(f,{scorer,allowed:()=>allowed}),/fallback failed/);else assert.equal(probe(f,{scorer,allowed:()=>allowed}),null);
  assert.equal(f.state.city,'Home');assert.equal(f.state.level,1);assert.equal(f.state.auto,true);
 }
});
test('probe rejects a combined result that names an unquoted action or level',()=>{
 for(const patch of [{action:'Unavailable',level:1},{action:'Local',level:99},{action:'Scarce',level:1}]){
  const f=fixture(),rows=probe(f,{scorer:()=>({score:1e9,...patch})});assert.equal(rows[0].action,'Local');assert.ok(rows[0].score<1e9);assert.equal(f.state.city,'Home');
 }
});
function expression(){
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),literal=source.match(/const rows=await getNsDataThroughFile\(ns,(`[^`]+`),'\/Temp\/bladeburner-city-plan.txt'/)[1];
 const bindings={probeBladeburnerCities,bladeburnerRankRate,bladeburnerStaminaChance,planBladeburnerLevels,readBladeburnerMaintenance,bbMutationGuard:'true',combatXpValue,bladeburnerGrowthChoice,bladeburnerCityGrowthScore,quoteBladeburnerCityTraining,bladeburnerStaminaGrowthSource,scoreBladeburnerCityFallback:cityScore};
 return Function(...Object.keys(bindings),'return '+literal)(...Object.values(bindings));
}
function runWorker(f,{disabled=false,target=metadata,delay=2,supply=stock}={}){
 const args=[JSON.stringify(['Home','Other']),JSON.stringify(actions),.99,7,JSON.stringify(data),disabled,50,JSON.stringify(target),JSON.stringify(weights),'Target',30,JSON.stringify(supply),delay];
 return vm.runInNewContext(expression(),{ns:{args,bladeburner:f.api,isRunning:()=>true,getPlayer:()=>player}});
}
test('actual generated worker uses fallback, shared dependency source and configured switching delay',()=>{
 for(const disabled of [false,true]){
  const f=fixture(),rows=runWorker(f,{disabled});assert.equal(chooseBladeburnerCity(rows,'Home').city,'Other');assert.equal(rows[1].fallback.second.name,'Steady');assert.equal(rows[1].scoreBasis,'stamina-effective-competence');assert.equal(f.state.city,'Home');assert.equal(f.state.level,1);
  const slow=fixture();assert.equal(chooseBladeburnerCity(runWorker(slow,{disabled,delay:8}),'Home').city,'Home');
 }
});
test('rank-only and unavailable optional stamina retain original single-job city behavior',()=>{
 const rankOnly=runWorker(fixture(),{target:null});assert.ok(rankOnly.every(r=>r.objective==='rank'&&r.fallback===undefined));assert.equal(chooseBladeburnerCity(rankOnly,'Home').city,'Home');
 const f=fixture(),read=f.api.getSkillLevel;let cyber=0;f.api.getSkillLevel=name=>{if(name==="Cyber's Edge"&&++cyber===2)throw Error('Optional quote unavailable');return read(name);};
 const rows=runWorker(f);assert.ok(rows.every(r=>r.fallback===undefined));assert.equal(chooseBladeburnerCity(rows,'Home').city,'Home');assert.equal(f.state.city,'Home');
 const empty=runWorker(fixture(),{supply:{}});assert.ok(empty.every(r=>r.score===0));
});
test('winning Training baseline removes mission-pair diagnostics without mutating cached rows',()=>{
 const rows=probe(fixture()).map(r=>({...r,objective:'combat-xp'})),before=JSON.stringify(rows);
 const training={kind:'training',name:'Training',score:100,time:30000,hpRatio:1,stamina:[100,100],chance:[.2,.2],rawChance:[.2,.2]};
 const result=applyBladeburnerTrainingBaseline(rows,'Other',training,{enabled:true,remainingMs:120000,threshold:.99,lowStaminaPct:.5},()=> 'Training');
 assert.equal(result[1].action,'Training');assert.equal(result[1].fallback,undefined);assert.equal(result[1].fallbackPairs,undefined);assert.equal(JSON.stringify(rows),before);
});
test('city cache key changes with the configured switching interval',()=>{
 const source=readFileSync(new URL('../bladeburner.js',import.meta.url),'utf8'),line=source.split('\n').find(l=>l.includes('const key=JSON.stringify([cityGrowthTarget'));
 const key=delay=>{const c={cityGrowthTarget:'Target',candidates:['Home'],actions,options:{'update-interval':delay},maintenanceKey:'m',rankReserves:{},reserveSupply:[],currentCity:'Home',squadKey:'s',cityState:{},developmentBudget:{spentMs:0}};vm.runInNewContext(line+';globalThis.output=key;',c);return c.output;};
 assert.notEqual(key(2000),key(8000));
});
