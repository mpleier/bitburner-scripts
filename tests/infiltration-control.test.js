import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {playInfiltration} from '../infiltration-manager.js';
import {infiltrationRewardFaction} from '../infiltration-solvers.js';
const leaseFile='tasks/activity-lock.json';
function fixture(t,mode='victory'){
 const f={now:100000,visible:true,inputs:0,clicks:[],cancelled:0,selection:'none',requested:0,pending:null,hook:null};
 t.mock.method(Date,'now',()=>f.now);
 f.files=new Map([[leaseFile,JSON.stringify({kind:'infiltration',ownerPid:1,expiresAt:f.now+15000})]]);
 const state={maxLevel:1,gameStartTimestamp:-1,results:'',startInfiltration(){},stage:{onKey(){f.inputs++;f.visible=false;}},cancel(){f.cancelled++;if(f.active===state)f.visible=false;}};
 if(mode==='guard')Object.assign(state.stage,{phase:1,guardingEndTime:100});
 f.active=state;f.state=state;
 f.props={value:'none',children:[{props:{value:'CyberSec'}},{props:{value:'NiteSec'}}],onChange:e=>{f.requested++;f.pending={value:e.target.value,at:f.now+250};}};
 const sell={textContent:'Sell for $100',click(){f.clicks.push('money');f.visible=false;}},trade={textContent:'Trade for reputation',click(){f.clicks.push(f.props.value);f.visible=false;}};
 f.document={body:{textContent:mode==='victory'?'Infiltration successful!':''},querySelectorAll:s=>!f.visible?[]:s==='button'?(mode==='victory'?[sell,trade]:[]):s==='[role="combobox"]'?[{'__reactFiber$c':{memoizedProps:f.props}}]:[{'__reactFiber$r':{memoizedProps:{state:f.active}}}]};
 f.ns={pid:1,read:p=>f.files.get(p)||'',ps:()=>[],isRunning:()=>true,write:async(p,v)=>{f.files.set(p,v);if(f.writeHook)f.writeHook(p);},sleep:async ms=>{f.now+=ms;if(f.pending&&f.now>=f.pending.at)f.props.value=f.pending.value;if(f.hook)f.hook(ms);}};
 return f;
}
test('missing, expired, foreign, wrong-kind, corrupt and dead leases prevent guard input',async t=>{
 for(const change of [f=>f.files.delete(leaseFile),f=>f.files.set(leaseFile,JSON.stringify({kind:'infiltration',ownerPid:1,expiresAt:f.now})),f=>f.files.set(leaseFile,JSON.stringify({kind:'infiltration',ownerPid:2,expiresAt:f.now+15000})),f=>f.files.set(leaseFile,JSON.stringify({kind:'casino',ownerPid:1,expiresAt:f.now+15000})),f=>f.files.set(leaseFile,'bad-json'),f=>f.ns.isRunning=()=>false]){
  const f=fixture(t,'guard');change(f);const r=await playInfiltration(f.ns,f.document,f.state);assert.equal(r.status,'interrupted');assert.equal(f.inputs,0);assert.equal(f.clicks.length,0);
 }
});
test('a valid existing lease permits the guard response without refreshing files',async t=>{
 const f=fixture(t,'guard');let writes=0;f.writeHook=()=>writes++;
 await playInfiltration(f.ns,f.document,f.state);assert.equal(f.inputs,1);assert.equal(writes,0);
});
test('250ms faction rendering selects reputation once instead of cash',async t=>{
 const f=fixture(t),r=await playInfiltration(f.ns,f.document,f.state,'CyberSec');
 assert.equal(r.status,'completed');assert.equal(r.reward,'reputation');assert.equal(r.faction,'CyberSec');assert.deepEqual(f.clicks,['CyberSec']);assert.equal(f.requested,1);assert.equal(f.now,100250);
});
test('cash reward evidence uses only the native infiltration counter delta',async t=>{
 const f=fixture(t);f.ns.getMoneySources=()=>({sinceInstall:{infiltration:f.clicks.includes('money')?125:25,casino:1e10}});
 const r=await playInfiltration(f.ns,f.document,f.state);assert.equal(r.reward,'money');assert.equal(r.cashReward,100);
});
test('an unavailable faction uses a bounded cash fallback with an explicit reason',async t=>{
 const f=fixture(t);f.props.children=[{props:{value:'NiteSec'}}];
 const r=await playInfiltration(f.ns,f.document,f.state,'CyberSec');assert.equal(r.reward,'money');assert.equal(r.rewardFallback,'faction-not-confirmed');assert.equal(r.requestedFaction,'CyberSec');assert.equal(f.now,101500);assert.deepEqual(f.clicks,['money']);
});
test('losing ownership while the faction selector renders prevents reward collection',async t=>{
 const f=fixture(t);f.hook=()=>f.files.delete(leaseFile);
 const r=await playInfiltration(f.ns,f.document,f.state,'CyberSec');assert.equal(r.status,'interrupted');assert.deepEqual(f.clicks,[]);
});
test('replaced infiltration state cannot receive a stale reward click',async t=>{
 const f=fixture(t);const replacement={...f.state,stage:{onKey(){}}};f.hook=()=>{f.active=replacement;};
 const r=await playInfiltration(f.ns,f.document,f.state,'CyberSec');assert.equal(r.status,'interrupted');assert.deepEqual(f.clicks,[]);assert.equal(f.active,replacement);assert.equal(f.visible,true);
});
test('lease loss during a status write prevents the Start click',async t=>{
 const f=fixture(t,'intro');let starts=0;const original=f.document.querySelectorAll;f.document.querySelectorAll=s=>s==='button'?[{textContent:'Start',click(){starts++;f.visible=false;}}]:original(s);
 f.writeHook=p=>{if(p==='tasks/infiltration-status.json')f.files.delete(leaseFile);};
 const r=await playInfiltration(f.ns,f.document,f.state);assert.equal(r.status,'interrupted');assert.equal(starts,0);
});
test('reward metadata resolves only at victory and an expired resolver lease prevents collection',async t=>{
 const f=fixture(t,'guard');let resolved=0;
 await playInfiltration(f.ns,f.document,f.state,null,2/3,true,async()=>{resolved++;return 'CyberSec';});assert.equal(resolved,0);
 const victory=fixture(t);const r=await playInfiltration(victory.ns,victory.document,victory.state,null,2/3,true,async()=>{victory.now+=16000;return 'CyberSec';});
 assert.equal(r.status,'interrupted');assert.deepEqual(victory.clicks,[]);
});
test('slow reward metadata refreshes a still-owned lease before rendering waits',async t=>{
 const f=fixture(t);const r=await playInfiltration(f.ns,f.document,f.state,null,2/3,true,async()=>{f.now+=14800;return 'CyberSec';});
 assert.equal(r.status,'completed');assert.equal(r.reward,'reputation');assert.ok(JSON.parse(f.files.get(leaseFile)).expiresAt>f.now);
});
test('manual and automatic reward policy share working-faction inheritance and overrides',()=>{
 const player={factions:['CyberSec','NiteSec','Daedalus']},work={type:'FACTION',factionName:'NiteSec'};
 assert.equal(infiltrationRewardFaction({},player,work),'NiteSec');
 assert.equal(infiltrationRewardFaction({faction:'CyberSec'},player,work,'money'),'CyberSec');
 assert.equal(infiltrationRewardFaction({'money-only':true,faction:'CyberSec'},player,work,'reputation'),null);
 assert.equal(infiltrationRewardFaction({},player,work,'reputation'),'Daedalus');
 assert.equal(infiltrationRewardFaction({},player,work,'money'),null);
 assert.equal(infiltrationRewardFaction({faction:'Unknown'},player,work),null);
 assert.equal(infiltrationRewardFaction({},player,{type:'FACTION',factionName:'Unknown'}),null);
});
test('the real manual resolver inherits faction work and handles missing Source Files without querying',async()=>{
 const source=readFileSync(new URL('../infiltration-manager.js',import.meta.url),'utf8'),start=source.indexOf('export async function resolveInfiltrationReward('),end=source.indexOf('\nexport async function main(',start);
 const build=Function('getNsDataThroughFile','infiltrationRewardFaction','redPillInfiltrationChoices','readNodeRoutePlan',source.slice(start,end).replace('export async function','async function')+'return resolveInfiltrationReward;');
 let calls=0;const run=build(async()=>{calls++;return {type:'FACTION',factionName:'NiteSec'};},infiltrationRewardFaction,()=>[],()=>null),ns={getPlayer:()=>({factions:['NiteSec']})};
 assert.equal(await run(ns,{}, {4:3},null),'NiteSec');assert.equal(calls,1);
 assert.equal(await run(ns,{}, {},null),null);assert.equal(calls,1);
 const unavailable=build(async()=>{throw Error('Singularity unavailable');},infiltrationRewardFaction,()=>[],()=>null);
 assert.equal(await unavailable(ns,{}, {4:1},null),null);
 assert.match(source,/playInfiltration\(ns,document,active,faction,minDemand,true,\(\)=>resolveInfiltrationReward/);
 assert.match(source,/let faction = infiltrationRewardFaction\(options,player,work\)/);
});
