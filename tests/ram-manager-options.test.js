import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeRamOptions,purchaseHomeRam} from '../Tasks/ram-manager.js';
import {getConfiguration} from '../helpers.js';
import {claimSpending} from '../spending-policy.js';
import {achievementActionAllowed} from '../achievement-policy.js';
import {publishInfrastructureCost} from '../early-game-policy.js';

test('RAM flags accept numeric strings from null-default reserve parsing',()=>{
 assert.deepEqual(normalizeRamOptions({budget:0.5,reserve:'4221139588.2931995'}),{budget:0.5,reserve:4221139588.2931995});
 assert.deepEqual(normalizeRamOptions({budget:'0.5',reserve:'1e9'}),{budget:0.5,reserve:1e9});
});
test('RAM options preserve zero reserves and the automatic null default',()=>{
 for(const reserve of [0,'0'])assert.deepEqual(normalizeRamOptions({budget:0,reserve}),{budget:0,reserve:0});
 for(const reserve of [null,undefined])assert.deepEqual(normalizeRamOptions({budget:1,reserve}),{budget:1,reserve:null});
});
test('RAM option normalization rejects invalid values without weakening bounds',()=>{
 for(const value of ['', ' ', 'bad', 'Infinity', '-1', -1, Infinity, NaN, true, false, [], {}, '1m']){
  assert.equal(normalizeRamOptions({budget:0.5,reserve:value}),null,String(value));
  assert.equal(normalizeRamOptions({budget:value,reserve:null}),null,String(value));
 }
 for(const value of [1.01,'2',null,undefined])assert.equal(normalizeRamOptions({budget:value,reserve:0}),null);
});
async function harness(args,config=''){
 const source=await readFile(new URL('../Tasks/ram-manager.js',import.meta.url),'utf8');
 const logs=[],files={};let money=10e9,ram=128,purchases=0,reads=0;
 const ns={args,pid:7,print:m=>logs.push(m),tprint:m=>logs.push(m),toast(){},getScriptName:()=> 'Tasks/ram-manager.js',read:p=>p==='Tasks/ram-manager.js.config.txt'?config:files[p]||'',write:(p,s)=>files[p]=s,
  isRunning:()=>true,getResetInfo:()=>({lastAugReset:1,lastNodeReset:1,bitNodeOptions:{}}),getPlayer:()=>({money}),getServerMaxRam:()=>ram,ps:()=>[],sleep:async()=>{},
  singularity:{getUpgradeHomeRamCost:()=>ram===128?1e9:20e9,upgradeHomeRam:()=>{money-=1e9;ram*=2;purchases++;return true;}},
  flags:schema=>{
   const values=Object.fromEntries(schema);
   for(let i=0;i<args.length;i+=2){const name=args[i].slice(2),initial=values[name];values[name]=typeof initial==='number'?Number(args[i+1]):String(args[i+1]);}
   return values;
  }};
 const getData=async(_ns,expression,_file,params=[])=>{reads++;return Function('ns','return ('+expression+')')({...ns,args:params});};
 const main=Function('getConfiguration','normalizeRamOptions','achievementActionAllowed','getNsDataThroughFile','purchaseHomeRam','claimSpending','publishInfrastructureCost','log','formatRam','formatMoney','argsSchema','max_ram',
  'return ('+source.slice(source.indexOf('export async function main')).replace('export ','')+')')(
  getConfiguration,normalizeRamOptions,achievementActionAllowed,getData,purchaseHomeRam,claimSpending,publishInfrastructureCost,(_ns,m)=>logs.push(m),String,String,[['budget',0.2],['reserve',null]],2**30);
 await main(ns);return {logs,files,purchases,reads,money,ram};
}
test('actual RAM entrypoint accepts scheduler numeric reserve arguments after native flag stringification',async()=>{
 const f=await harness(['--budget',0.5,'--reserve',4221139588.2931995]);assert.equal(f.purchases,1);assert.equal(f.ram,256);assert.ok(!f.logs.some(m=>m.startsWith('ERROR:')));assert.equal(f.money,9e9);
});
test('actual RAM entrypoint still enforces parsed reserve limits',async()=>{
 const f=await harness(['--budget',0.5,'--reserve',9.5e9]);assert.equal(f.purchases,0);assert.ok(!f.logs.some(m=>m.startsWith('ERROR:')));
});
test('actual RAM entrypoint supports a numeric-string config override',async()=>{
 const f=await harness([],JSON.stringify({budget:'0.5',reserve:'4221139588.2931995'}));assert.equal(f.purchases,1);
});
test('actual RAM entrypoint rejects invalid configuration before native purchase reads',async()=>{
 const f=await harness(['--budget',0.5,'--reserve','bad']);assert.equal(f.purchases,0);assert.equal(f.reads,0);assert.ok(f.logs.some(m=>m.includes('Received:')));
});
