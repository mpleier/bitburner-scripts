import test from 'node:test';
import assert from 'node:assert/strict';
import {homeRamHeadroom,homeRamReserve,reclaimHomeRam} from '../home-ram-policy.js';

test('home headroom adapts to early-game and large homes and honors increased reserves',()=>{
 assert.equal(homeRamHeadroom(8),2);assert.equal(homeRamHeadroom(32),8);assert.equal(homeRamHeadroom(512),128);
 assert.equal(homeRamHeadroom(65536),1310.72);assert.equal(homeRamHeadroom(1e9),2048);
 assert.equal(homeRamHeadroom(512,256),256);assert.equal(homeRamHeadroom(32,100),32);assert.equal(homeRamHeadroom(NaN),0);
});
function mock(){let used=500;const killed=[],processes=[{pid:1,filename:'Remote/share.js',threads:10},{pid:2,filename:'/Temp/stanek.js.charge.js',threads:10},{pid:3,filename:'Remote/hack-target.js',threads:10},{pid:4,filename:'corporation-manager.js',threads:10},{pid:5,filename:'remote-api-agent.js',threads:10}];
 return {killed,ns:{pid:99,read:()=>'',getServerMaxRam:()=>512,getServerUsedRam:()=>used,ps:()=>processes,getScriptRam:()=>10,kill:pid=>{killed.push(pid);used-=100;return true;}}};}

test('home recovery reclaims only disposable workers in priority order',()=>{
 const {ns,killed}=mock();assert.equal(reclaimHomeRam(ns,180),true);assert.deepEqual(killed,[1,2]);
});

test('home recovery protects managers and connectivity when disposable RAM is insufficient',()=>{
 const {ns,killed}=mock();assert.equal(reclaimHomeRam(ns,450),false);assert.deepEqual(killed,[1,2,3]);
});

test('impossible requests and sufficient free RAM do not kill workers',()=>{
 const {ns,killed}=mock();assert.equal(reclaimHomeRam(ns,513),false);assert.equal(reclaimHomeRam(ns,10),true);assert.deepEqual(killed,[]);
 assert.equal(homeRamReserve({...ns,read:()=> '256'}),256);
});


test('home recovery never kills its caller and respects failed kill attempts',()=>{
 const {ns,killed}=mock();ns.pid=1;ns.kill=pid=>{killed.push(pid);return false;};
 assert.equal(reclaimHomeRam(ns,200),false);assert.deepEqual(killed,[2,3]);
});
