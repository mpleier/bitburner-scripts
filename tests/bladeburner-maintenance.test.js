import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bladeburnerRankRate,readBladeburnerMaintenance,planBladeburnerLevels,planBladeburnerTeams,probeBladeburnerCities,chooseBladeburnerCity,bladeburnerStaminaChance} from '../bladeburner-policy.js';
import {bladeburnerDifficulty} from '../bladeburner-action-data.js';
const base={time:1000,gain:10,loss:2};
const control={threshold:50,charisma:1000,time:60000,effect:{success:0,always:.1,positivePercent:0}};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,actual+' vs '+expected);

test('rank rate charges expected operation casualties at native recruitment time and probability',()=>{
 const p=.8,team=3,casualties=(p*2+(1-p)*team)/2;
 close(bladeburnerRankRate([p,p],{...base,team,recruitment:{chance:.5,time:2000}}),(p*10-(1-p)*2)/(1+casualties*4));
 assert.equal(bladeburnerRankRate([1,1],{...base,team:0,recruitment:null}),10);
 assert.equal(bladeburnerRankRate([1,1],{...base,team:1,recruitment:null}),0);
 assert.equal(bladeburnerRankRate([1,1],{...base,team:1,recruitment:{chance:0,time:1000}}),0);
 assert.equal(bladeburnerRankRate([1,1],{...base,team:NaN}),null);
});
test('chaos maintenance prices success-only growth, unconditional growth and passive decay',()=>{
 const fraction=(1000**.045+1)/100,added=.1-.0001;
 const cleanup=60000*Math.log1p(added/45)/-Math.log1p(-fraction);
 close(bladeburnerRankRate([1,1],{...base,chaosControl:control}),10000/(1000+cleanup));
 const successOnly={...control,effect:{success:.04,always:0,positivePercent:0}};
 assert.ok(bladeburnerRankRate([.5,.5],{...base,chaosControl:successOnly})<bladeburnerRankRate([.5,.5],base));
 assert.equal(bladeburnerRankRate([1,1],{...base,time:1000000,chaosControl:control}),.01);
});
test('invalid maintenance quotes cannot create fabricated precise rates',()=>{
 assert.equal(bladeburnerRankRate([1,1],{...base,chaosControl:{...control,charisma:NaN}}),null);
 assert.equal(bladeburnerRankRate([1,1],{...base,chaosControl:{...control,threshold:0}}),null);
 assert.equal(bladeburnerRankRate([1,1],{...base,chaosControl:{...control,charisma:0}}),0);
 assert.equal(bladeburnerRankRate([1,1],{...base,chaosControl:{...control,effect:{...control.effect,always:-1}}}),null);
});
test('passive stamina during recruitment and diplomacy avoids double recovery charges',()=>{
 const metrics={...base,staminaCost:2,staminaRegen:1,hrcRegen:1,team:2,recruitment:{chance:1,time:2000}};
 // One second of combat and one expected second recruiting already regenerate the cost.
 assert.equal(bladeburnerRankRate([1,1],metrics),5);
 const c={...base,staminaCost:2,staminaRegen:1,hrcRegen:1,chaosControl:control};
 const elapsed=10000/bladeburnerRankRate([1,1],{...base,chaosControl:control});
 const remaining=Math.max(0,2-elapsed/1000);
 close(bladeburnerRankRate([1,1],c),10000/(elapsed+remaining/2*1000));
});
test('native chaos metadata matches the fixed effects and conservative random reserve',()=>{
 assert.equal(bladeburnerDifficulty['Bounty Hunter'].chaos.success,.02);
 assert.equal(bladeburnerDifficulty.Retirement.chaos.success,.04);
 assert.equal(bladeburnerDifficulty['Sting Operation'].chaos.always,.1);
 assert.equal(bladeburnerDifficulty.Raid.chaos.positivePercent,.03);
 close(bladeburnerDifficulty.Assassination.chaos.positivePercent,15/1100);
 assert.deepEqual(bladeburnerDifficulty['Stealth Retirement Operation'].chaos,{success:0,always:0,positivePercent:0});
});
test('native maintenance helper retains unknowns instead of inventing recruitment or charisma',()=>{
 const api={getActionTime:(_type,name)=>name==='Diplomacy'?60000:1000,getActionEstimatedSuccessChance:()=>[.5,1]};
 const q=readBladeburnerMaintenance(api,1000,40);
 assert.equal(q.chaosControl.threshold,40);assert.equal(q.recruitment.chance,.5);
 assert.equal(readBladeburnerMaintenance(api,undefined).chaosControl,null);
 const missing=readBladeburnerMaintenance({},1000);assert.equal(missing.chaosControl,null);assert.equal(missing.recruitment,null);
});
function fixture(){
 const state={city:'Home',team:2,level:1};
 const api={getCity:()=>state.city,switchCity:city=>{state.city=city;return true;},getTeamSize:(type)=>type?state.team:5,setTeamSize:(_t,_n,n)=>{state.team=n;return n;},
 getActionCountRemaining:()=>10,getActionCurrentLevel:()=>state.level,getActionMaxLevel:()=>1,getActionAutolevel:()=>true,setActionLevel:(_t,_n,n)=>{state.level=n;},
 getActionTime:(_t,name)=>name==='Recruitment'?1000:name==='Diplomacy'?60000:1000,getActionEstimatedSuccessChance:(_t,name)=>name==='Recruitment'?[state.city==='Home'?.01:1,1]:[1,1],getActionRankGain:()=>10,getActionRankLoss:()=>0};
 return {api,state};
}
const actions={X:{base:125,factor:1,chaos:{success:0,always:0,positivePercent:0}}};
const recovery={stamina:[100,100],actions,regen:1000,hrc:1,maintenance:true,chaosControl:control,recruitment:{chance:1,time:1000}};
test('city selection charges its own native recruitment quote and restores state',()=>{
 const {api,state}=fixture();
 const rows=probeBladeburnerCities(api,['Home','Other'],[['X','Operations']],.99,()=>true,actions,bladeburnerRankRate,bladeburnerStaminaChance,recovery,planBladeburnerLevels);
 assert.equal(chooseBladeburnerCity(rows,'Home').city,'Other');
 assert.ok(rows[1].score>rows[0].score*10);
 assert.equal(state.city,'Home');assert.equal(state.team,2);assert.equal(state.level,1);
});
test('current-level city selection includes replacement costs with optimization disabled',()=>{
 const {api}=fixture();
 const rows=probeBladeburnerCities(api,['Home','Other'],[['X','Operations']],.99,()=>true,actions,bladeburnerRankRate,bladeburnerStaminaChance,recovery);
 assert.equal(chooseBladeburnerCity(rows,'Home').city,'Other');
});
test('squad planning charges replacements exactly once and keeps reserves untouched',()=>{
 const {api,state}=fixture();state.city='Other';api.getActionRankGain=()=>state.team?100:1;
 const plan=planBladeburnerTeams(api,[['X','Operations']],.99,bladeburnerRankRate,()=>true,planBladeburnerLevels,0,30,0,recovery,bladeburnerStaminaChance).X;
 assert.equal(plan.team,1);assert.equal(plan.metrics.team,1);assert.equal(plan.metrics.time,1000);
 close(plan.score,100/1.5);assert.equal(state.team,2);assert.equal(state.level,1);
 const solo=planBladeburnerTeams(api,[['X','Operations']],.99,bladeburnerRankRate,()=>true,planBladeburnerLevels,5,30,0,recovery,bladeburnerStaminaChance).X;
 assert.equal(solo.team,0);
});
test('maintenance helpers serialize independently for native workers',()=>{
 const rate=Function('return ('+bladeburnerRankRate.toString()+')')();
 assert.equal(rate([1,1],{...base,team:2,recruitment:{chance:1,time:2000}}),5);
 const read=Function('return ('+readBladeburnerMaintenance.toString()+')')();
 assert.equal(read({},0).recruitment,null);
});
test('production fallback action worker includes maintenance without taxing Black Ops',async()=>{
 const source=await readFile(new URL('../bladeburner.js',import.meta.url),'utf8');
 const literal=source.match(/actionMetrics=await getNsDataThroughFile\(ns,\s*(`[^`]+`)/)[1];
 const expression=Function('readBladeburnerMaintenance','bladeburnerStaminaChance','return '+literal)(readBladeburnerMaintenance,bladeburnerStaminaChance);
 const {api}=fixture();const rows=[['Retirement','Contracts'],['Sting Operation','Operations'],['Operation Typhoon','Black Operations']];
 const ns={bladeburner:api,getPlayer:()=>({skills:{charisma:1000}}),args:[JSON.stringify(rows),50,JSON.stringify(bladeburnerDifficulty)]};
 const result=Function('ns','return '+expression)(ns);
 assert.equal(result.Retirement.chaosControl.effect.success,.04);
 assert.equal(result['Sting Operation'].team,2);assert.equal(result['Sting Operation'].recruitment.chance,.01);
 assert.equal(result['Operation Typhoon'].team,undefined);assert.equal(result['Operation Typhoon'].chaosControl,undefined);
});

test('very high charisma cannot make cleanup slower when diplomacy clears all chaos',()=>{
 const ordinary=bladeburnerRankRate([1,1],{...base,chaosControl:control});
 const complete=bladeburnerRankRate([1,1],{...base,chaosControl:{...control,charisma:1000000}});
 assert.ok(complete>ordinary);assert.ok(complete<=10);
 close(complete,10000/(1000+60000*(.1-.0001)/45));
});
