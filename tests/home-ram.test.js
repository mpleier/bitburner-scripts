import test from 'node:test';
import assert from 'node:assert/strict';
import {homeRamHeadroom,homeRamLaunchReserve,homeRamReserve,reclaimHomeRam} from '../home-ram-policy.js';

test('home headroom adapts to early-game and large homes and honors increased reserves',()=>{
 assert.equal(homeRamHeadroom(8),2);assert.equal(homeRamHeadroom(32),8);assert.equal(homeRamHeadroom(512),128);
 assert.equal(homeRamHeadroom(65536),1310.72);assert.equal(homeRamHeadroom(1e9),2048);
 assert.equal(homeRamHeadroom(512,256),256);assert.equal(homeRamHeadroom(32,100),32);assert.equal(homeRamHeadroom(NaN),0);
});

test('a stale reserve can never withhold the whole home from a launch',()=>{
 // Live: home-ram-reserve.txt held 2 TB against a 128 TB home (1.5 %, harmless), the node reset created a 128 GB
 // home, and the same file clamped to 128 — 100 % withheld, available 0, every manager needs-home-ram. The planned
 // headroom stays uncapped so home still grows toward the reserve; launches withhold at most half the machine.
 assert.equal(homeRamHeadroom(128,2048),128);
 assert.equal(homeRamLaunchReserve(128,2048),64);
 assert.equal(homeRamLaunchReserve(32,100),16);
 assert.equal(homeRamLaunchReserve(16,200),8);
 for(const [maximum,configured] of [[8,0],[32,100],[128,2048],[512,256],[1024,200],[65536,4096],[1e9,1e9]]){
  const withheld=homeRamLaunchReserve(maximum,configured);
  assert.ok(withheld<=maximum,'withheld exceeds the machine at '+maximum);
  assert.ok(withheld<=Math.max(homeRamHeadroom(maximum),maximum*.5),'withheld above the half ceiling at '+maximum);
  assert.ok(withheld>=homeRamHeadroom(maximum),'withheld below the adaptive floor at '+maximum);
  assert.ok(withheld<=homeRamHeadroom(maximum,configured),'withheld above the planned headroom at '+maximum);
 }
 // A reserve written for this home is withheld exactly, and the floor still applies on a tiny home.
 assert.equal(homeRamLaunchReserve(1024,200),200);
 assert.equal(homeRamLaunchReserve(1024,600),512);
 assert.equal(homeRamLaunchReserve(8),2);
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
