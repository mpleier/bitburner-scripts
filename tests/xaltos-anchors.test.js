import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAnchorReplacement,advanceAnchorRequest,anchorIdentity,anchorControlAllowed} from '../darknet-anchor-policy.js';
import {main as stasis} from '../darknet-stasis.js';
const now=100000;
const row=(host,depth)=>({host,depth,at:now,live:true,busy:false,isStationary:false,hasSession:true,maxRam:64,neighbours:[],caches:0,contracts:0,modelId:'NIL',passwordLength:0,passwordFormat:'numeric',data:''});
const rows=()=>[row('old',2),row('deep',20),row('new',12)];
test('anchor ranking replaces redundant shallow anchors and supports blank credentials',()=>{
 const p=chooseAnchorReplacement(rows(),['old','deep'],2,new Map([['new','']]),now);assert.equal(p.source,'old');assert.equal(p.target,'new');assert.ok(p.scoreGain>20);
});
test('a rooted native scout can prepare a replacement without a session tied to the parent PID',()=>{
 const r=rows();r[2].hasSession=false;r[2].rooted=true;assert.equal(chooseAnchorReplacement(r,['old','deep'],2,new Map([['new','']]),now).target,'new');
 r[2].rooted=false;assert.equal(chooseAnchorReplacement(r,['old','deep'],2,new Map([['new','']]),now),null);
});
test('anchor ranking preserves story, deepest, busy and unobserved anchors',()=>{
 for(const patch of [{isStationary:true},{modelId:'(The Labyrinth)'},{busy:true},{caches:1},{contracts:1},{live:false},{at:now-90001}]){const r=rows();Object.assign(r[0],patch);assert.equal(chooseAnchorReplacement(r,['old','deep'],2,new Map([['new','']]),now),null);}
 assert.equal(chooseAnchorReplacement(rows(),['old','deep'],2,new Map(),now),null);assert.equal(chooseAnchorReplacement(rows(),['old'],1,new Map([['new','']]),now),null);
});
test('transaction waits for prepare settlement, uses matching receipts and rolls back failed apply',()=>{
 let r={id:'x',source:'old',target:'new',phase:'prepare',at:now,expiresAt:now+180000};
 const receipt=(phase,host,success=true)=>({id:'x',phase,host,at:now+40000,success});
 assert.equal(advanceAnchorRequest(r,{...receipt('prepare','new'),at:now},['old','deep'],now),r);
 r=advanceAnchorRequest(r,receipt('prepare','new'),['old','deep'],now+40000);assert.equal(r.phase,'release');
 assert.equal(advanceAnchorRequest(r,receipt('apply','new'),['deep'],now+40000),r);
 r=advanceAnchorRequest(r,receipt('release','old'),['deep'],now+40000);assert.equal(r.phase,'apply');
 r=advanceAnchorRequest(r,receipt('apply','new',false),['deep'],now+40000);assert.equal(r.phase,'rollback');
 assert.equal(advanceAnchorRequest(r,receipt('rollback','old'),['old','deep'],now+40000).phase,'done');
});
test('lost receipts reconcile native links; rollback failure becomes visible and bounded',()=>{
 const r={id:'x',source:'old',target:'new',phase:'apply',at:now,expiresAt:now+10};assert.equal(advanceAnchorRequest(r,null,['new','deep'],now+20).phase,'done');
 const rollback=advanceAnchorRequest(r,null,['deep'],now+20);assert.equal(rollback.phase,'rollback');assert.equal(advanceAnchorRequest(rollback,null,['deep'],rollback.expiresAt+1).phase,'blocked');
});
test('native helper cannot remove a mismatched, expired or deepest anchor',async()=>{
 const base={...row('old',2),id:'x',owner:1,nodeReset:1,augReset:2,source:'old',target:'new',phase:'release',at:Date.now()-100,expiresAt:Date.now()+60000,sourceIdentity:anchorIdentity(row('old',2))};
 for(const change of [{sourceIdentity:'wrong'},{expiresAt:0},{sourceIdentity:anchorIdentity(row('old',20)),nativeDepth:20}]){
  const r={...base,...change},files=new Map([['tasks/dnet-anchor-request.json',JSON.stringify(r)],['tasks/dnet-cache-context.json',JSON.stringify({nodeReset:1,augReset:2})]]);let mutations=0;
  const ns={args:['x','release'],getHostname:()=> 'old',ls:()=>[],read:f=>files.get(f)||'',fileExists:()=>false,scp:async()=>true,isRunning:()=>true,ps:()=>[{filename:'darknet-node.js'}],write:async(f,v)=>files.set(f,v),dnet:{getServerDetails:h=>row(h,h==='old'?(change.nativeDepth||2):20),getStasisLinkedServers:()=>['old','deep'],setStasisLink:async()=>{mutations++;}}};await stasis(ns);assert.equal(mutations,0);
 }
});
test('copied pause and maintenance controls prevent anchor mutations',async()=>{
 const ns={fileExists:()=>true,scp:async()=>true,getHostname:()=> 'x',read:()=> 'true'};assert.equal(await anchorControlAllowed(ns),false);
 ns.read=f=>f.endsWith('.txt')?'false':JSON.stringify({expiresAt:Date.now()+10000,ownerPid:2});ns.isRunning=()=>true;assert.equal(await anchorControlAllowed(ns),false);
});
test('actual helper prepares, releases, applies and restores anchors with native receipts',async()=>{
 let linked=['old','deep'];const files=new Map();let mutations=0;
 const base={id:'native',owner:1,nodeReset:1,augReset:2,source:'old',target:'new',sourceIdentity:anchorIdentity(row('old',2)),targetIdentity:anchorIdentity(row('new',12))};
 for(const phase of ['prepare','release','apply','rollback']){
  if(phase==='rollback')linked=['deep'];
  const self=['prepare','apply'].includes(phase)?'new':'old',r={...base,phase,at:Date.now()-100,expiresAt:Date.now()+180000};
  files.set('tasks/dnet-anchor-request.json',JSON.stringify(r));files.set('tasks/dnet-cache-context.json',JSON.stringify({nodeReset:1,augReset:2}));
  const ns={args:['native',phase],getHostname:()=>self,ls:()=>[],read:f=>files.get(f)||'',fileExists:()=>false,scp:async()=>true,isRunning:()=>true,hasRootAccess:()=>true,ps:()=>[{filename:'darknet-node.js'}],write:async(f,v)=>files.set(f,v),dnet:{getServerDetails:h=>row(h,h==='old'?2:h==='deep'?20:12),getStasisLinkedServers:()=>linked,setStasisLink:async add=>{mutations++;linked=add?[...linked,self]:linked.filter(h=>h!==self);return {success:true};}}};
  await stasis(ns);const receipt=JSON.parse(files.get('tasks/dnet-anchor-receipt.json'));assert.equal(receipt.phase,phase);assert.equal(receipt.success,true);
 }
 assert.equal(mutations,3);
});
