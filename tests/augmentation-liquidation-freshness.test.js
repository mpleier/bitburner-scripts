import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {liquidateAugmentationStocks} from '../augmentation-install-policy.js';
import {freshFactionManagerOutput} from '../autopilot-policy.js';

test('empty stock portfolios need no worker, and failed launches stop at the attempt budget',async()=>{
 let launches=0,time=100;
 const ns={sleep:async n=>{time+=n;},isRunning:()=>false,kill:()=>{throw Error('Unexpected kill');}};
 const launch=()=>{launches++;return 0;};
 assert.equal((await liquidateAugmentationStocks(ns,{count:async()=>0,launch,now:()=>time})).ok,true);assert.equal(launches,0);
 const failed=await liquidateAugmentationStocks(ns,{count:async()=>2,launch,maxAttempts:3,now:()=>time});
 assert.equal(failed.ok,false);assert.equal(launches,3);assert.equal(failed.remaining,2);
});
test('hung liquidation children are stopped at the wall-time budget',async()=>{
 let time=0;const killed=[];
 const ns={sleep:async n=>{time+=n;},isRunning:()=>true,kill:pid=>killed.push(pid)};
 const r=await liquidateAugmentationStocks(ns,{count:async()=>1,launch:()=>9,timeoutMs:500,now:()=>time});
 assert.equal(r.ok,false);assert.equal(time,500);assert.deepEqual(killed,[9]);
});
test('completed workers still require fresh zero-position evidence',async()=>{
 let countCalls=0;
 const ns={sleep:async()=>{},isRunning:()=>false,kill:()=>{}};
 const result=await liquidateAugmentationStocks(ns,{count:async()=>++countCalls===1?1:0,launch:()=>10});assert.equal(result.ok,true);assert.equal(countCalls,2);
 assert.equal((await liquidateAugmentationStocks(ns,{count:async()=>NaN,launch:()=>10})).ok,false);
 assert.equal((await liquidateAugmentationStocks(ns,{count:async()=>1,launch:()=>0,maxAttempts:0})).ok,false);
});
const reset={lastAugReset:10,lastNodeReset:5},now=200000;
const summary={schemaVersion:1,at:199000,augReset:10,nodeReset:5,installed_augs:['Base'],installed_count:1,affordable_augs:['A','NeuroFlux Governor'],affordable_count_ex_nf:1,affordable_count_nf:1,awaiting_install_augs:['B'],awaiting_install_count_ex_nf:1,awaiting_install_count_nf:0,unpurchased_count:10,total_rep_cost:0,total_aug_cost:100};
test('only current-reset, current-schema and fresh faction summaries are accepted',()=>{
 assert.deepEqual(freshFactionManagerOutput(JSON.stringify(summary),reset,now),summary);
 for(const patch of [{schemaVersion:undefined},{augReset:9},{nodeReset:4},{at:now+1},{at:now-120001},{at:NaN}])assert.equal(freshFactionManagerOutput({...summary,...patch},reset,now),null);
 assert.equal(freshFactionManagerOutput('{bad',reset,now),null);assert.equal(freshFactionManagerOutput('',reset,now),null);
 assert.equal(freshFactionManagerOutput(summary,{},now),null);
});
test('malformed or inconsistent augmentation counts and costs cannot trigger resets',()=>{
 for(const patch of [{affordable_count_nf:2},{awaiting_install_count_ex_nf:0},{installed_count:2},{affordable_count_ex_nf:NaN},{total_aug_cost:Infinity},{total_rep_cost:-1},{awaiting_install_augs:null},{affordable_augs:[5]},{unpurchased_count:-1}])assert.equal(freshFactionManagerOutput({...summary,...patch},reset,now),null);
});
test('actual producer and consumer use reset metadata and a bounded refresh cadence',async()=>{
 const producer=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8');
 assert.ok(producer.includes('schemaVersion:1,at:Date.now(),augReset:resetInfo.lastAugReset,nodeReset:resetInfo.lastNodeReset'));
 const source=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 const body=source.match(/function getFactionManagerOutput\(ns\) \{([\s\S]*?)\n    \}/)[1];
 const read=Function('ns','freshFactionManagerOutput','resetInfo',"const factionManagerOutputFile='/Temp/affordable-augs.txt';"+body);
 assert.equal(read({read:()=>JSON.stringify({...summary,at:Date.now()})},freshFactionManagerOutput,reset).installed_count,1);
 assert.equal(read({read:()=>JSON.stringify({...summary,nodeReset:0})},freshFactionManagerOutput,reset),null);
 assert.ok(source.includes('nextFactionSummaryRefresh=Date.now()+31000'));
});
