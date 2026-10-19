import {xpCapacityKey} from '../xp-capacity-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {routeRequiredExperience,nodeRouteSnapshotSource,estimateDaemonRoute,sampleRouteProgress} from '../node-route-policy.js';
const nativeSkill=(exp,mult)=>Math.max(1,Math.floor(mult*(32*Math.log(exp+534.6)-200)));
function snapshot(settings={}){
 const {api=.8,exp=1e6,skill=null,node=7}=settings;
 const multiplier=Object.hasOwn(settings,'multiplier')?settings.multiplier:.35;
 const capacityAt=Date.now();
 let calls=0;const skillMult=2,actual=skill??nativeSkill(exp,skillMult*(multiplier??api??.35));
 const player={exp:{hacking:exp,strength:100,defense:100,dexterity:100,agility:100},skills:{hacking:actual,strength:80,defense:80,dexterity:80,agility:80},
 mults:{hacking:skillMult,hacking_exp:1.4,strength:2,defense:2,dexterity:2,agility:2,faction_rep:1},money:1,factions:[]};
 const ns={getPlayer:()=>player,getResetInfo:()=>({ownedAugs:new Map([['The Red Pill',1]]),currentNode:node,lastAugReset:10,lastNodeReset:5}),
 getBitNodeMultipliers:()=>{calls++;if(api===null)throw Error('SF5 unavailable');return {HackingLevelMultiplier:api};},serverExists:()=>true,getServerRequiredHackingLevel:()=>200,read:()=>JSON.stringify({schemaVersion:1,state:'ready',ownerPid:50,nodeReset:5,augReset:10,at:capacityAt,signature:'xp-capacity-v1:a:b:1'}),ps:()=>[{pid:50,filename:'daemon.js',args:['--xp-only']}]};
 const values={StrengthLevelMultiplier:0,...(multiplier===undefined?{}:{HackingLevelMultiplier:multiplier})};
 const source=nodeRouteSnapshotSource(false,false,values),data=vm.runInNewContext(source,{ns});return {data,calls,source,player};
}
test('supplied BitNode multiplier is applied once and avoids the optional native API',()=>{
 const f=snapshot();assert.equal(f.data.hackMult,.7);assert.equal(f.calls,0);assert.equal(f.data.hackMultBasis,'bitnode-supplied');assert.ok(!f.source.includes('ns.getBitNodeMultipliers()'));
 const result=estimateDaemonRoute(f.data,{xpModes:{xp:{capacityKey:xpCapacityKey(f.data),at:f.data.at,rate:100,low:75,high:125}}});assert.equal(result.actionable,true);assert.ok(result.xpGap>0);assert.ok(Math.abs(result.xpGap-(routeRequiredExperience(200,.7)-f.player.exp.hacking))<1e-6);
});
test('without a supplied quote the native multiplier remains supported',()=>{
 const f=snapshot({multiplier:undefined,api:.5});assert.equal(f.calls,1);assert.equal(f.data.hackMult,1);assert.equal(f.data.hackMultBasis,'bitnode-native');
});
test('unavailable native API uses a conservative level-based bound',()=>{
 const f=snapshot({multiplier:undefined,api:null}),actual=.7;
 assert.equal(f.data.hackMultBasis,'skill-lower-bound');assert.ok(f.data.hackMult<=actual);assert.ok(routeRequiredExperience(200,f.data.hackMult)>=routeRequiredExperience(200,actual));
});
test('clamped level one cannot supply an inferred hacking multiplier',()=>{
 const f=snapshot({multiplier:undefined,api:null,skill:1});assert.equal(f.data.hackMult,null);assert.equal(f.data.hackMultBasis,'unavailable');
 assert.equal(estimateDaemonRoute(f.data).actionable,false);
});
test('zero multipliers are retained rather than treated as a default one',()=>{
 const f=snapshot({multiplier:0});assert.equal(f.data.hackMult,0);assert.equal(f.calls,0);assert.equal(f.data.combat.strength.mult,0);assert.equal(f.data.combat.strength.requiredExp,null);
 assert.equal(estimateDaemonRoute(f.data).etaMs,null);
});
test('experience inverse reaches the requested integer level for scaled and boosted skills',()=>{
 for(const multiplier of [.01,.35,.7,1,1.2,2,5,30])for(const goal of [1,2,10,100,200,1000]){
  const exp=routeRequiredExperience(goal,multiplier);
  if(exp===null){assert.ok(!Number.isFinite(Math.exp((goal/multiplier+200)/32)));continue;}
  assert.ok(Number.isFinite(exp)&&exp>=0);assert.ok(nativeSkill(exp,multiplier)>=goal);
 }
 for(const pair of [[1,0],[1,-1],[1,NaN],[Infinity,1],[1.5,1],[0,1]])assert.equal(routeRequiredExperience(...pair),null);
});
const sample={at:1000,exp:100,hackMult:.7,hackingMultiplier:2,xpMultiplier:1,skillModel:'bn-effective-v2',augReset:10,nodeReset:5,xpMode:'xp',worth:100};
function observed(){let state;for(let i=0;i<5;i++)state=sampleRouteProgress(state,{...sample,at:sample.at+i*15000,exp:100+i*1500});return state;}
test('XP-only multiplier changes and forecast model upgrades invalidate old measurements',()=>{
 for(const patch of [{xpMultiplier:1.01},{skillModel:'next-model'},{hackMult:.8}]){
  const result=sampleRouteProgress(observed(),{...sample,at:76000,exp:7600,...patch});assert.equal(result.samples.length,1);assert.equal(result.xpModes.xp,undefined);
 }
});
test('unchanged multipliers preserve a full dedicated XP measurement',()=>{
 const o=observed();assert.equal(o.xpModes.xp.rate,100);assert.equal(o.samples.length,5);
});
test('stale and future measurements or inverted ranges cannot become actionable ETAs',()=>{
 const s={hasRedPill:true,hacking:100,wdHack:200,hackMult:1,exp:1000,at:1000000};
 for(const measured of [{at:1,rate:100,low:75,high:125},{at:1000001,rate:100,low:75,high:125},{at:s.at,rate:100,low:101,high:125}])
  assert.equal(estimateDaemonRoute(s,{xpModes:{xp:measured}}).actionable,false);
});
test('inconsistent multiplier and XP cannot invent a zero-time completion before native hacking meets the target',()=>{
 const s={hasRedPill:true,hacking:100,wdHack:200,hackMult:100,exp:1e6};
 assert.equal(estimateDaemonRoute(s,{xpModes:{xp:{rate:100,low:75,high:125}}}).actionable,false);
 assert.equal(estimateDaemonRoute({...s,hacking:200}).phase,'backdoor');
});
