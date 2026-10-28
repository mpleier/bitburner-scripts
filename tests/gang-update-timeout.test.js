import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../gangs.js',import.meta.url),'utf8'),start=source.indexOf('async function waitForGameUpdate('),end=source.indexOf('\n/**',start),body=source.slice(start,end);
const old={moneyGainRate:100,respectGainRate:10,wantedLevelGainRate:1,wantedLevel:100,updateObserved:true,assignmentsVerified:true,updateCycles:10};
function fixture(){
 let now=100000,reads=0,updates=0,resolve,reject;
 const timers=[],cleared=[];
 const wait=Function('getNsDataThroughFile','setTimeout','clearTimeout','Date','return ('+body+')')(
  async()=>{reads++;return {moneyGainRate:0,respectGainRate:0,wantedLevelGainRate:0,wantedLevel:1};},
  (callback,delay)=>{timers.push({callback,delay});return timers.length-1;},id=>cleared.push(id),{now:()=>now});
 const ns={gang:{nextUpdate:()=>{updates++;return new Promise((yes,no)=>{resolve=yes;reject=no;});}}};
 return {ns,wait,timers,cleared,get reads(){return reads;},get updates(){return updates;},get resolve(){return resolve;},get reject(){return reject;},setNow:n=>now=n};
}
test('a stalled update returns within the five-second deadline without starting another native query',async()=>{
 const f=fixture(),result=f.wait(f.ns,old,{A:'Train Combat'});
 assert.equal(f.updates,1);assert.equal(f.reads,0);assert.equal(f.timers[0].delay,5000);
 f.setNow(105000);f.timers[0].callback();const info=await result;
 assert.equal(info.updateObserved,false);assert.equal(info.assignmentsVerified,false);assert.equal(info.updateWaitReason,'timeout');assert.equal(info.updateCycles,undefined);assert.equal(info.moneyGainRate,100);assert.equal(f.reads,0);assert.deepEqual(f.cleared,[0]);
 assert.equal(old.updateObserved,true);assert.equal(old.updateCycles,10);
});
test('a native update before the deadline cancels the timer, including timer handle zero',async()=>{
 const f=fixture(),result=f.wait(f.ns,old);f.setNow(104999);f.resolve(2000);
 const info=await result;assert.equal(info.updateObserved,true);assert.equal(info.updateCycles,10);assert.equal(f.reads,1);assert.deepEqual(f.cleared,[0]);
 f.timers[0].callback();await Promise.resolve();assert.equal(info.updateObserved,true);assert.equal(f.reads,1);
});
test('a native callback processed at or after the deadline cannot bypass the timeout',async()=>{
 for(const now of [105000,106000]){
  const f=fixture(),result=f.wait(f.ns,old);f.setNow(now);f.resolve(2000);const info=await result;
  assert.equal(info.updateObserved,false);assert.equal(info.updateWaitReason,'timeout');assert.equal(f.reads,0);assert.deepEqual(f.cleared,[0]);
 }
});
test('late native completion after timeout cannot validate the old result or trigger an extra read',async()=>{
 const f=fixture(),result=f.wait(f.ns,old);f.timers[0].callback();const info=await result;
 f.resolve(2000);await Promise.resolve();await Promise.resolve();assert.equal(info.updateObserved,false);assert.equal(f.reads,0);
});
test('late rejection after timeout is consumed and does not create an unhandled failure',async()=>{
 const f=fixture(),result=f.wait(f.ns,old);f.timers[0].callback();assert.equal((await result).updateObserved,false);
 f.reject(Error('Late source-file failure'));await Promise.resolve();await Promise.resolve();assert.equal(f.reads,0);
});
test('rejected and synchronously throwing native APIs leave no timer behind and remain unverified',async()=>{
 const f=fixture(),result=f.wait(f.ns,old);f.reject(Error('Source File unavailable'));assert.equal((await result).updateObserved,false);assert.deepEqual(f.cleared,[0]);
 const g=fixture();g.ns.gang.nextUpdate=()=>{throw Error('No API');};assert.equal((await g.wait(g.ns,old)).updateObserved,false);assert.equal(g.timers.length,0);assert.deepEqual(g.cleared,[]);
});
test('each wait owns its deadline so late completion cannot contaminate a later attempt',async()=>{
 const f=fixture(),first=f.wait(f.ns,old);const late=f.resolve;f.timers[0].callback();assert.equal((await first).updateObserved,false);
 const second=f.wait(f.ns,old);late(2000);await Promise.resolve();assert.equal(f.reads,0);f.resolve(5000);
 const info=await second;assert.equal(info.updateObserved,true);assert.equal(info.updateCycles,25);assert.equal(f.reads,1);assert.deepEqual(f.cleared,[0,1]);
});
test('deadline handling does not poll or use Netscript blocking sleep, and timeout guards remain intact',()=>{
 assert.doesNotMatch(body,/while\s*\(|ns.sleep|ns.asleep/);assert.match(body,/finally\{if\(timer!==undefined\)clearTimeout\(timer\);\}/);
 assert.match(source,/myGangInfo.updateObserved===true&&\(\(expectedWanted/);
 assert.match(source,/if\(myGangInfo.updateObserved===false\)return/);
});
