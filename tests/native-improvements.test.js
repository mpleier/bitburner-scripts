import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { nextBladeburnerProgressSkill,nextSkill } from '../bladeburner-policy.js';
import { sleeveCombatCrime,sleeveCombatWorker } from '../sleeve-development-policy.js';
import { darknetEconomics } from '../darknet-economics-policy.js';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('Cyber Edge has no fictitious direct chance benefit below or above the native half-stamina threshold',()=>{
 for(const staminaPct of [.1,.49,.5,.59,1]) {
  const context={target:'Operation Typhoon',rank:2500,requiredRank:2500,chance:[.5,.5],threshold:.99,staminaPct};
  assert.equal(nextBladeburnerProgressSkill(["Cyber's Edge"],{"Cyber's Edge":0},{"Cyber's Edge":1},100,{},context,nextSkill),null);
  assert.equal(nextBladeburnerProgressSkill(["Cyber's Edge",'Digital Observer'],{"Cyber's Edge":0,'Digital Observer':0},{"Cyber's Edge":1,'Digital Observer':10},100,{},context,nextSkill),'Digital Observer');
 }
 assert.equal(nextBladeburnerProgressSkill(["Cyber's Edge"],{"Cyber's Edge":0},{"Cyber's Edge":1},100,{},null,nextSkill),"Cyber's Edge");
});
test('manager and scout saved-password reconnection handle blank credentials, API failure and native token limit',async()=>{
 for(const file of ['darknet-manager.js','darknet-node.js']) {
  const source=read(file),a=source.indexOf('  const trySavedPassword = '),b=source.indexOf('  const authenticate = ',a);
  for(const scenario of ['success','blank','rejected','missing','stationary','long']) {
   let auth=0,connect=0;
   const ns={dnet:{connectToSession:()=>{connect++;return {success:scenario!=='rejected'};}}};
   if(scenario==='missing')delete ns.dnet.connectToSession;
   const reconnect=vm.runInNewContext(source.slice(a,b)+';trySavedPassword',{ns,tryPassword:async()=>{auth++;return {success:true};}});
   const result=await reconnect('target',scenario==='blank'?'':scenario==='long'?'x'.repeat(101):'saved',{isStationary:scenario==='stationary'});
   assert.equal(result.success,true);
   assert.equal(auth,['success','blank'].includes(scenario)?0:1,scenario);
   assert.equal(connect,['stationary','long','missing'].includes(scenario)?0:1,scenario);
  }
 }
});
const sleeve={shock:20,sync:100,skills:{strength:100,agility:100,intelligence:0},mults:{}};
const crimes={Strength:{time:1000,difficulty:1,strength_exp:10},Agility:{time:1000,difficulty:1,agility_exp:100}};
const player={skills:{strength:100,agility:100},exp:{strength:1000,agility:1000},mults:{strength:1,agility:1}};
test('targeted sleeve ranking follows pending Black Op stat weights rather than raw XP',()=>{
 assert.equal(sleeveCombatCrime(sleeve,crimes,0).name,'Agility');
 const context={player,metadata:{weights:{strength:1,agility:0},decays:{strength:.8,agility:.8}}};
 assert.equal(sleeveCombatCrime(sleeve,crimes,0,context).name,'Strength');
 assert.equal(sleeveCombatWorker([sleeve],crimes,[],0,context).name,'Strength');
 const expected=10*.25*.8*(1*.8*100**(-.2)*32/(1000+534.6));
 assert.ok(Math.abs(sleeveCombatCrime(sleeve,crimes,0,context).rate-expected)<1e-12);
});
test('native XP diminishing returns and zero level multipliers affect the sleeve crime choice',()=>{
 const context={player:{...player,exp:{strength:1e8,agility:1000}},metadata:{weights:{strength:.5,agility:.5},decays:{strength:.8,agility:.8}}};
 assert.equal(sleeveCombatCrime(sleeve,{...crimes,Strength:{...crimes.Strength,strength_exp:1000}},0,context).name,'Agility');
 assert.equal(sleeveCombatCrime(sleeve,crimes,0,{...context,levelMultipliers:{strength:0,agility:0}}),null);
 assert.equal(sleeveCombatCrime(sleeve,crimes,0,{...context,crimeExpMultiplier:0}),null);
});
test('targeted sleeve ranking retains unfinished crime until completion',()=>{
 const context={player,metadata:{weights:{strength:1,agility:.01},decays:{strength:.8,agility:.8}}};
 const task={type:'CRIME',crimeType:'Agility',cyclesWorked:99,cyclesNeeded:100};
 const result=sleeveCombatWorker([sleeve],crimes,[task],0,context);
 assert.equal(result.name,'Agility');assert.equal(result.completingCrime,true);
});
const now=1e7;
function observe(rate=0,lastCacheAt=0) {
 let state;
 for(let i=0;i<=12;i++)state=darknetEconomics(state,1000+rate*i*30,lastCacheAt>now+i*30000?0:lastCacheAt,42,now+i*30000);
 return state;
}
test('StormSeed economics measures two native cache cooldowns before allowing an unproductive refresh',()=>{
 let state=darknetEconomics(null,1000,0,42,now);assert.equal(state.allow,false);
 state=observe();assert.equal(state.allow,true);assert.equal(state.moneyPerSecond,0);
 state=observe(100);assert.equal(state.allow,false);assert.equal(state.moneyPerSecond,100);assert.equal(state.estimatedLostIncome,33000);
 state=observe(0,now+330000);assert.equal(state.allow,false);assert.match(state.reason,/cache/);
});
test('unknown, stale, reset or backwards native income evidence cannot authorize a storm',()=>{
 const state=observe();
 for(const value of [null,undefined,NaN,Infinity,-1])assert.equal(darknetEconomics(state,value,0,42,now+390000).allow,false);
 assert.equal(darknetEconomics(state,1000,0,43,now+390000).allow,false);
 assert.equal(darknetEconomics(state,1000,0,42,now+500000).allow,false);
 assert.equal(darknetEconomics(state,999,0,42,now+390000).allow,false);
});
test('economic telemetry and target metadata are integrated without parsing native formatted messages',()=>{
 assert.match(read('darknet-manager.js'),/const sources=ns.getMoneySources\(\).sinceInstall;totalIncome=sources.darknet;playerIncome=recurringPlayerIncome\(sources\)/);
 assert.match(read('darknet-manager.js'),/decision.launch&&!decision.state.economics.allow/);
 assert.match(read('darknet-node.js'),/lastCacheAt/);
 for(const file of ['darknet-loot.js','darknet-cache.js'])assert.match(read(file),/result\?\.success\) await ns.write\('tasks\/dnet-last-cache.json'/);
 assert.match(read('bladeburner.js'),/metadata:blackOpMetadata\[nextBlackOp\]/);
 assert.match(read('sleeve.js'),/metadata:record.metadata,player:playerInfo,speedWeight:\.25,levelMultipliers:combatLevelMultipliers/);
});
