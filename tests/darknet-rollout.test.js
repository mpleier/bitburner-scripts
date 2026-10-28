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
