import test from 'node:test';
import assert from 'node:assert/strict';
import {main,lootResizeRequested} from '../darknet-loot.js';
const now=100000;
const request=(fields={})=>JSON.stringify({pid:42,at:now,expiresAt:now+45000,...fields});
test('resize requires a fresh request for this worker',()=>{
 assert.equal(lootResizeRequested(request(),42,now),true);
 for(const text of ['',request({pid:43}),request({at:now+1}),request({expiresAt:now}),request({at:now-46000}),request({expiresAt:now+46000})])assert.equal(lootResizeRequested(text,42,now),false);
});
test('loot finishes phishing before honoring a resize request',async()=>{
 let complete=false,read=false;
 const ns={pid:42,disableLog(){},getHostname:()=> 'a',ls:()=>[],print(){},
  dnet:{async phishingAttack(){await Promise.resolve();complete=true;return {success:true};}},
  read(){assert.equal(complete,true);read=true;const at=Date.now();return JSON.stringify({pid:42,at,expiresAt:at+45000});},
  sleep(){assert.fail('should yield to the scout after completed action');}};
 await main(ns);assert.equal(read,true);
});
