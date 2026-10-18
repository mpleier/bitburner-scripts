import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {collectBackdoorMetadata,shortcutBackdoorRoutes} from '../backdoor-policy.js';

test('metadata worker reads each distinct host once and copies only required fields',()=>{
 const calls=[],ns={getHackingLevel:()=>100,getServer:h=>{calls.push(h);return {requiredHackingSkill:50,hasAdminRights:true,backdoorInstalled:h==='a',purchasedByPlayer:false,get unused(){throw Error('Must not enumerate native properties');}};}};
 const result=collectBackdoorMetadata(ns,['a','a','b']);assert.deepEqual(calls,['a','b']);assert.equal(result.hacking,100);
 assert.deepEqual(result.byHost.a,{requiredHackingSkill:50,hasAdminRights:true,backdoorInstalled:true,purchasedByPlayer:false});
});
test('metadata collection isolates missing hosts and malformed requirements',()=>{
 const r=collectBackdoorMetadata({getHackingLevel:()=>1,getServer:h=>{if(h==='offline')throw Error('missing');return h==='invalid'?{}:{requiredHackingSkill:1,hasAdminRights:true};}},['offline','good','invalid']);
 assert.deepEqual(Object.keys(r.byHost),['good']);assert.equal(r.errors.length,2);
});
test('metadata serialization is standalone and preserves native snapshot fields',()=>{
 const fn=new Function('ns','hosts','return ('+collectBackdoorMetadata.toString()+')(ns,hosts)');
 const result=JSON.parse(JSON.stringify(fn({getHackingLevel:()=>50,getServer:()=>({requiredHackingSkill:50,hasAdminRights:true})},['CSEC'])));
 assert.equal(result.byHost.CSEC.requiredHackingSkill,50);assert.equal(result.byHost.CSEC.hasAdminRights,true);
});
test('shortcut routes use the deepest installed backdoor without modifying original paths',()=>{
 const routes={home:['home'],a:['home','a'],b:['home','a','b'],target:['home','a','b','c','target']},before=structuredClone(routes);
 const result=shortcutBackdoorRoutes(routes,{a:{backdoorInstalled:true},c:{backdoorInstalled:true}});
 assert.deepEqual(result.target,['home','c','target']);assert.deepEqual(result.b,['home','a','b']);assert.deepEqual(routes,before);
 assert.notEqual(result.a,routes.a);
});
test('absent or false metadata leaves original routes intact',()=>{
 const routes={target:['home','a','target']};assert.deepEqual(shortcutBackdoorRoutes(routes,{a:{backdoorInstalled:false}}),routes);
 assert.deepEqual(shortcutBackdoorRoutes(routes,{}),routes);
});
test('manager batches metadata and retains the original route retry',async()=>{
 const s=await readFile(new URL('../Tasks/backdoor-all-servers.js',import.meta.url),'utf8');
 assert.match(s,/collectBackdoorMetadata.toString\(\)/);assert.match(s,/shortcuts\[server\].length<routes\[server\].length/);
 assert.doesNotMatch(s,/getServers-where-not-backdoorInstalled/);
});
