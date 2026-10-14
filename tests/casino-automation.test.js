import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {casinoOptionsError,casinoHookArgs,casinoWager,casinoRoundDelta,parseDealerRank,blackjackShouldHit,casinoReactHandler,casinoUiEvent,stopCasinoCompetitors,casinoRetryPending} from '../casino-policy.js';
test('casino wager is a positive affordable integer and never exceeds the game limit',()=>{
 for(const [wallet,expected] of [[0,0],[.9,0],[1,1],[2,1],[100,90],[1e9,100e6],[NaN,0],[Infinity,0]])assert.equal(casinoWager(wallet),expected);
 assert.ok(casinoOptionsError({'save-sleep-time':-1,'click-sleep-time':5,'find-sleep-time':0}));
});
test('casino accounting uses actual earnings and distinguishes blackjack payout',()=>{
 assert.equal(casinoRoundDelta('win',100,1000,1150),150);
 assert.equal(casinoRoundDelta('win',100,undefined,undefined,true),150);
 assert.equal(casinoRoundDelta('win',100,undefined,undefined),100);
 assert.equal(casinoRoundDelta('lose',100,undefined,undefined),-100);
 assert.equal(casinoRoundDelta('tie',100,undefined,undefined),0);
});
test('dealer ranks are read as complete cards including tens, face cards and aces',()=>{
 for(const [rank,value] of [['10',10],['K',10],['Q',10],['J',10],['A',11],['2',2],['10♠',10]])assert.equal(parseDealerRank(rank),value);
 assert.throws(()=>parseDealerRank('-'));assert.throws(()=>parseDealerRank('Dealer'));
});
test('blackjack decisions handle hard hands, soft hands and basic mode',()=>{
 assert.equal(blackjackShouldHit('Count: 12',4),false);assert.equal(blackjackShouldHit('Count: 12',2),true);
 assert.equal(blackjackShouldHit('Count: 16',6),false);assert.equal(blackjackShouldHit('Count: 16',10),true);
 assert.equal(blackjackShouldHit('Count: 8 or 18',8),false);assert.equal(blackjackShouldHit('Count: 8 or 18',9),true);
 assert.equal(blackjackShouldHit('Count: 9 or 19',11),false);assert.equal(blackjackShouldHit('Count: 7 or 17',6),true);
 assert.equal(blackjackShouldHit('Count: 7 or 17',6,true),false);assert.throws(()=>blackjackShouldHit('Count: ?',6));
});
test('casino handlers use React property names instead of object insertion order',async()=>{
 let clicks=0,text='';const button={irrelevant:1,isConnected:true,__reactProps$random:{onClick:event=>{assert.equal(event.currentTarget,button);assert.equal(event.isTrusted,true);clicks++;},onChange:event=>{text=event.target.value;}}};
 await casinoUiEvent(button,'onClick');await casinoUiEvent(button,'onChange','123');assert.equal(clicks,1);assert.equal(text,'123');
 button.isConnected=false;assert.throws(()=>casinoReactHandler(button,'onClick'));
 assert.throws(()=>casinoReactHandler({disabled:true,__reactProps$x:{onClick(){}}},'onClick'));
});
test('casino supports current element Fiber props and rejects unrelated ancestor handlers',()=>{
 const button={};const handler=()=>{};button.__reactFiber$x={stateNode:button,memoizedProps:{onClick:handler}};
 assert.equal(casinoReactHandler(button,'onClick'),handler);
 button.__reactFiber$x.stateNode={};assert.throws(()=>casinoReactHandler(button,'onClick'));
});
test('casino cleanup preserves its own process, its helper, and Remote API connectivity',()=>{
 const killed=[];const processes=[{pid:1,filename:'casino.js'},{pid:2,filename:'Temp/helper.js'},{pid:3,filename:'remote-api-agent.js'},{pid:4,filename:'daemon.js'},{pid:5,filename:'remote-control/job.js'}];
 const ns={pid:2,ps:()=>processes,kill:pid=>{killed.push(pid);return true;}};
 assert.deepEqual(stopCasinoCompetitors(ns,1),[{pid:4,stopped:true}]);assert.deepEqual(killed,[4]);
 const generated=new Function('ns','pid','return ('+stopCasinoCompetitors.toString()+')(ns,pid)');assert.deepEqual(generated(ns,1),[{pid:4,stopped:true}]);
});
test('casino failure cooldown expires and does not affect the next augmentation reset',()=>{
 const record={mode:'failed',augReset:1,retryAt:200};
 assert.equal(casinoRetryPending(record,1,100),true);assert.equal(casinoRetryPending(record,1,200),false);assert.equal(casinoRetryPending(record,2,100),false);
});
test('casino integration refreshes controls, bounds retries, confirms travel and preserves remote files',async()=>{
 const source=await readFile(new URL('../casino.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/Object.keys\(button\)\[1\]|Object.keys\(input\)\[1\]|!ns.getPlayer\(\).city/);
 assert.match(source,/\['no-deleting-remote-files', true\]/);
 assert.match(source,/let midGameRetries = 0;\s*const roundStarted/);
 assert.match(source,/on-completion-script-args.*|unEscapeArrayArgs/);
 assert.match(source,/stopCasinoCompetitors.toString/);
});

test('casino completion hooks preserve typed arguments and reject invalid forwarded values',()=>{
 assert.deepEqual(casinoHookArgs(['["--x",42,true]']),['--x',42,true]);
 assert.deepEqual(casinoHookArgs(['"--x"',42,false]),['--x',42,false]);
 assert.throws(()=>casinoHookArgs([null]));assert.throws(()=>casinoHookArgs(['[invalid]']));
});
