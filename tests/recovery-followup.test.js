import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {main} from '../remote-api-agent.js';
test('restored monitor preserves a launched job even before its PID receipt is written',async()=>{
 const files={'remote-control/request.json':JSON.stringify({id:'x'}),'remote-control/results/x.json':JSON.stringify({id:'x',state:'running',pid:0})},stop=Error('stop');
 const ns={pid:2,args:[],disableLog(){},getHostname:()=> 'home',getScriptName:()=> 'remote-api-agent.js',print(){},ps:()=>[{pid:2,filename:'remote-api-agent.js'},{pid:10,filename:'remote-control/job.js',args:['[]','out','x']}],read:f=>files[f]||'',write:async(f,v)=>files[f]=v,isRunning:()=>false,sleep:async()=>{throw stop;}};
 await assert.rejects(main(ns),e=>e===stop);
 assert.equal(JSON.parse(files['remote-control/results/x.json']).state,'running');
 assert.deepEqual(JSON.parse(files['remote-control/heartbeat.json']).jobs,[{pid:10,commandId:'x'}]);
});
test('unrelated invitations and API latency cannot reset the absolute wait deadline',async()=>{
 const source=readFileSync(new URL('../work-for-factions.js',import.meta.url),'utf8'),start=source.indexOf('export async function factionInviteBackdoorReady('),end=source.indexOf('\n/** @param {NS} ns */',source.indexOf('export async function waitForFactionInvite(',start));
 let now=0,count=0;
 const run=Function('Date','requiredBackdoorByFaction','getNsDataThroughFile','checkFactionInvites','getPlayerInfo','formatDuration','tryJoinFaction','log','loopSleepInterval','waitForFactionInviteTime',source.slice(start,end).replaceAll('export async function','async function')+'return waitForFactionInvite;')({now:()=>now},{},async()=>true,async()=>{now+=200;return Array.from({length:++count},(_,i)=>'other'+i);},async()=>{now+=200;return {factions:[]};},String,async()=>true,()=>{},100,1000);
 assert.equal(await run({print(){},sleep:async ms=>{now+=ms;}},'wanted',1000),undefined);
 assert.ok(now<=2400);assert.ok(count>1);
});
