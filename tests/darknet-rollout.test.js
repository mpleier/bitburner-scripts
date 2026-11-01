import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshDarknetScouts} from '../darknet-rollout.js';
test('rollout stops all verified outdated scouts before launching replacements',async()=>{
 const events=[],reports={a:{version:3,host:'a',pid:1,revision:'old'},b:{version:3,host:'b',pid:2,revision:'old'},stale:{version:3,host:'c',pid:99,revision:'old'},current:{version:3,host:'d',pid:4,revision:'new'}};
 const killed=new Set();
 const ns={ls:()=>Object.keys(reports),read:f=>JSON.stringify(reports[f]),ps:h=>killed.has({a:1,b:2,c:3,d:4}[h])?[]:[{filename:'darknet-node.js',pid:{a:1,b:2,c:3,d:4}[h]}],scp:async(f,h)=>{events.push(['copy',h]);return true;},kill:p=>{killed.add(p);events.push(['kill',p]);},exec:(f,h)=>{events.push(['start',h]);return 5;},print:()=>{}};
 assert.equal(await refreshDarknetScouts(ns,['darknet-node.js'],'new'),0);
 assert.deepEqual(events.filter(e=>e[0]!=='copy'),[['kill',1],['kill',2],['start','a'],['start','b']]);
});
test('failed launches remain pending and retry without needing an active scout',async()=>{
 const pending=new Set(['a']);let ready=false;
 const ns={ls:()=>[],ps:()=>[],scp:async()=>true,exec:()=>ready?1:0,print:()=>{}};
 assert.equal(await refreshDarknetScouts(ns,['darknet-node.js'],'new',pending),1);
 ready=true;assert.equal(await refreshDarknetScouts(ns,['darknet-node.js'],'new',pending),0);
});
test('failed upgrade copy leaves running scout untouched',async()=>{
 const ns={ls:()=>['a'],read:()=>JSON.stringify({version:3,host:'a',pid:1,revision:'old'}),ps:()=>[{filename:'darknet-node.js',pid:1}],scp:async()=>false,kill:()=>assert.fail('must not kill'),exec:()=>assert.fail('must not start')};
 assert.equal(await refreshDarknetScouts(ns,['darknet-node.js'],'new'),0);
});

test('rollout defers until in-flight stasis and cache helpers have finished',async()=>{
 const events=[];let helper=true,killed=false;
 const ns={ls:()=>['a'],read:()=>JSON.stringify({version:3,host:'a',pid:1,revision:'old'}),
  ps:()=>[...(killed?[]:[{filename:'darknet-node.js',pid:1}]),...(helper?[{filename:'darknet-stasis.js',pid:2}]:[])],
  write:()=>assert.fail('must not ask loot to yield while a helper is active'),
  scp:async(f)=>{events.push(Array.isArray(f)?'code':'request');return true;},
  kill:()=>{killed=true;events.push('kill');return true;},exec:()=>{events.push('start');return 3;},print:()=>{}};
 assert.equal(await refreshDarknetScouts(ns,['darknet-node.js'],'new'),0);
 assert.deepEqual(events,[]); // no copy, kill or launch while the helper is running
 helper=false;
 await refreshDarknetScouts(ns,['darknet-node.js'],'new');
 assert.ok(events.includes('kill')&&events.includes('start'));
});

 test('rollout waits for phishing completion before copying code or killing its scout',async()=>{
 const events=[],pending=new Set();let loot=true,scout=true;
 const ns={ls:()=>['r'],read:()=>JSON.stringify({version:3,host:'a',pid:1,revision:'old'}),ps:()=>[...(scout?[{filename:'darknet-node.js',pid:1}]:[]),...(loot?[{filename:'darknet-loot.js',pid:2}]:[])],
 write:async(f,v)=>{const request=JSON.parse(v);assert.equal(request.pid,2);assert.equal(request.purpose,'rollout');assert.ok(request.expiresAt>request.at);events.push('yield');},
 scp:async f=>{events.push(Array.isArray(f)?'code':'request');return true;},kill:p=>{assert.equal(p,1);scout=false;events.push('kill');},exec:()=>{events.push('start');return 3;},print:()=>{}};
 assert.equal(await refreshDarknetScouts(ns,['darknet-node.js','darknet-loot.js'],'new',pending),0);
 assert.deepEqual(events,['yield','request']);assert.equal(scout,true);
 loot=false;await refreshDarknetScouts(ns,['darknet-node.js','darknet-loot.js'],'new',pending);
 assert.ok(events.indexOf('code')>events.indexOf('request'));assert.ok(events.includes('kill'));assert.ok(events.includes('start'));
 });
