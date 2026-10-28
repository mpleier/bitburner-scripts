import test from 'node:test';
import assert from 'node:assert/strict';
import {recordDarknetCache,mergeDarknetRewards,darknetRewardProductivity,noncashRewardKeys} from '../darknet-reward-policy.js';
import {darknetEconomics} from '../darknet-economics-policy.js';
import {sampleDarknetObservations} from '../darknet-observation-policy.js';
const now=10000000,reset={lastNodeReset:42,lastAugReset:100};
function record(result,at=now,previous=null){return recordDarknetCache(previous,{success:true,...result},{host:'a',pid:7,at,reset});}
function report(reward,at=reward.at){return {host:'a',live:true,at,lastCacheAt:reward.at,cacheRewards:reward};}
function summary(result={money:1},at=now){const r=record(result,at);return mergeDarknetRewards(null,[report(r)],reset,at);}
function status(s,at=s.at){return darknetRewardProductivity(s,reset,at);}
test('typed noncash rewards protect a low-cash network without assigning dollar values',()=>{
 for(const [kind,result] of [['shares',{stockShares:5}],['programs',{programName:'BruteSSH.exe'}],['stockAccess',{tixApiAccess:true}],['dataFiles',{dataFilePaths:['clue.txt']}],['contracts',{contractFilePaths:['a.cct']}],['augmentations',{augmentationName:'Aug'}],['unknown',{message:'an unspecified reward'}]]){
  const s=summary(result),p=status(s);
  assert.equal(p.known,true,kind);assert.equal(p.productive,true,kind);assert.deepEqual(p.kinds,[kind]);
  assert.equal(s.totals.money,0);assert.equal(s.lastNoncashAt[kind],now);
 }
 assert.equal(status(summary({money:1,karmaLoss:-1})).productive,false);
});
test('cash-only rewards and duplicate surveys do not renew noncash protection',()=>{
 const first=record({programName:'BruteSSH.exe'});let s=mergeDarknetRewards(null,[report(first)],reset,now);
 const cash=record({money:1},now+300000,first);
 s=mergeDarknetRewards(s,[report(cash),report(cash)],reset,now+300000);
 assert.equal(s.lastNoncashAt.programs,now);assert.equal(status(s).productive,true);
 s=mergeDarknetRewards(s,[report(cash,now+360000)],reset,now+360000);
 assert.equal(status(s).known,true);assert.equal(status(s).productive,false);
 assert.equal(s.totals.programs,1);assert.equal(s.totals.money,1);
});
test('new noncash events renew protection and unseen epochs are counted once',()=>{
 const first=record({stockShares:1});let s=mergeDarknetRewards(null,[report(first)],reset,now);
 const next=record({stockShares:1},now+300000,first);
 s=mergeDarknetRewards(s,[report(next)],reset,now+300000);assert.equal(s.lastNoncashAt.shares,now+300000);
 const newEpoch=record({stockShares:1},now+330000);
 s=mergeDarknetRewards(s,[report(newEpoch)],reset,now+330000);assert.equal(s.totals.shares,3);
 s=mergeDarknetRewards(s,[report(newEpoch)],reset,now+340000);assert.equal(s.totals.shares,3);
});
test('a fresh collector does not imply that a recent cache receipt was collected',()=>{
 const r=record({money:1}),old=report(r),at=now+30000;
 let s=mergeDarknetRewards(null,[{...old,at,lastCacheAt:at}],reset,at);
 assert.equal(s.coverage.pendingHosts,1);assert.equal(status(s).known,false);
 s=mergeDarknetRewards(s,[{...old,at,lastCacheAt:at,cacheRewards:record({money:1},at,r)}],reset,at);
 assert.equal(status(s).known,true);assert.equal(status(s).productive,false);
 for(const bad of [{lastCacheAt:NaN},{lastCacheAt:at+1},{at:at-90001},{cacheRewards:null}]){
  const result=mergeDarknetRewards(null,[{...old,at,lastCacheAt:at,...bad}],reset,at);assert.equal(status(result).known,false);
 }
});
test('no-cache idle scouts are covered; old missing receipts expire conservatively',()=>{
 assert.equal(status(mergeDarknetRewards(null,[{host:'a',live:true,at:now,lastCacheAt:0}],reset,now)).known,true);
 assert.equal(status(mergeDarknetRewards(null,[{host:'a',live:true,at:now,lastCacheAt:now-360000}],reset,now)).known,true);
 assert.equal(status(mergeDarknetRewards(null,[],reset,now)).known,false);
});
test('stale, future, corrupt, reset and omitted evidence is unknown rather than empty',()=>{
 const good=summary();
 for(const patch of [{at:now-90001},{at:now+1},{nodeReset:43},{augReset:101},{omitted:1},{lastNoncashAt:{}},{coverage:null}])assert.equal(status({...good,...patch},now).known,false);
 assert.equal(darknetRewardProductivity(null,reset,now).known,false);
 const bad=summary();bad.lastNoncashAt.shares=now+1;assert.equal(status(bad).known,false);
 const next=mergeDarknetRewards(good,[],{...reset,lastAugReset:now},now);assert.ok(noncashRewardKeys.every(k=>next.lastNoncashAt[k]===0));
});
test('legacy aggregate migration protects existing noncash totals once, not every collector tick',()=>{
 const r=record({programName:'BruteSSH.exe'}),legacy=mergeDarknetRewards(null,[report(r)],reset,now);delete legacy.lastNoncashAt;
 let s=mergeDarknetRewards(legacy,[report(r,now+30000)],reset,now+30000);assert.equal(s.lastNoncashAt.programs,now);
 s=mergeDarknetRewards(s,[report(r,now+360000)],reset,now+360000);assert.equal(s.lastNoncashAt.programs,now);assert.equal(status(s).productive,false);
});
test('economic trial, measured replacement and zero-income refresh all honor noncash evidence',()=>{
 function run(rewardStatus,rate=1,evidence={}){let s;for(let t=0;t<=360000;t+=30000)s=darknetEconomics(s,1000+rate*t/1000,0,42,now+t,evidence,{ready:true,mode:'stalled',augReset:100,playerIncome:10000+1000*t/1000,rewardStatus});return s;}
 const productive={known:true,productive:true,reason:'Recent noncash Dark Net rewards: programs'};
 for(const rate of [0,1,100])assert.equal(run(productive,rate,{ready:true,samples:3,measuredRebuild:true,rebuildMs:60000,netRate:1000}).allow,false);
 assert.match(run(productive).reason,/noncash/);assert.equal(run({known:false,productive:false}).allow,false);
 assert.equal(run({known:true,productive:false}).allow,true);
});
test('supervisor pulls a native cache receipt and publishes protection through the real collector',async()=>{
 const original=Date.now;Date.now=()=>now;
 try{
  const r=record({stockShares:5}),rewardFile='tasks/dnet-cache-rewards-a.json';
  const files=new Map([['tasks/dnet-survey-a.json',JSON.stringify({host:'a',pid:7,at:now,lastCacheAt:now})]]);
  const ns={getResetInfo:()=>reset,getPlayer:()=>({skills:{charisma:100},mults:{dnet_money:1,crime_money:1,crime_success:1}}),
   getMoneySources:()=>({sinceInstall:{darknet:1000}}),ps:()=>[{pid:7,filename:'darknet-node.js'}],
   read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),ls:(_h,prefix)=>[...files.keys()].filter(f=>f.startsWith(prefix)),
   fileExists:(f,h)=>h==='a'&&f===rewardFile,scp:async(f,to,from)=>{assert.equal(to,'home');assert.equal(from,'a');assert.equal(f,rewardFile);files.set(f,JSON.stringify(r));return true;}};
  await sampleDarknetObservations(ns,async(_ns,code,_file,args)=>Function('ns','return '+code)({...ns,args}));
  const s=JSON.parse(files.get('tasks/dnet-cache-rewards-summary.json'));
  assert.equal(s.coverage.complete,true);assert.equal(status(s).productive,true);assert.deepEqual(status(s).kinds,['shares']);
 }finally{Date.now=original;}
});

test('explicit zero-cash caches do not renew unknown reward protection',()=>{
 const s=summary({money:0,karmaLoss:4});
 assert.equal(s.totals.karma,4);assert.equal(s.totals.unknown,0);
 assert.equal(status(s).productive,false);
 assert.equal(status(summary({karmaLoss:4,message:'unrecognized native reward'})).productive,true);
});
