import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recordDarknetCache,mergeDarknetRewards,cacheRewardFile,cacheContextFile,cacheRewardReset} from '../darknet-reward-policy.js';
import {beginDarknetRefresh,observeDarknetRefresh,darknetRefreshEvidence,compareDarknetForecast} from '../darknet-refresh-policy.js';
import {sampleDarknetObservations,darknetCapabilityContext,darknetObservationFile} from '../darknet-observation-policy.js';
import {darknetEconomics} from '../darknet-economics-policy.js';
import {main as cacheMain} from '../darknet-cache.js';
import {main as lootMain} from '../darknet-loot.js';
const reset={lastNodeReset:7,lastAugReset:42},scope={reset:7,augReset:42,context:'same'},now=1e7;
const meta=(at=now)=>({host:'a',pid:9,at,reset});
test('native cache fields count noncash rewards separately without parsing messages or pricing shares',()=>{
 const r=recordDarknetCache(null,{success:true,money:50,stockShares:3,stockSymbol:'ECP',programName:'BruteSSH.exe',wseAccount:true,tixApiAccess:true,fourSigmaData:false,dataFilePaths:['a','b'],contractFilePaths:['c'],augmentationName:'Aug',karmaLoss:-4,message:'$999999'},meta());
 assert.deepEqual(r.totals,{money:50,shares:3,programs:1,stockAccess:2,dataFiles:2,contracts:1,augmentations:1,karma:4,unknown:0});assert.equal(r.opened,1);
 const unknown=recordDarknetCache(r,{success:true,karmaLoss:-2,message:'$999999'},meta(now+1));assert.equal(unknown.totals.money,50);assert.equal(unknown.totals.unknown,1);
 assert.equal(recordDarknetCache(r,{success:false,money:100},meta()),r);
 assert.equal(recordDarknetCache(r,{success:true,money:1},{...meta(now+2),reset:{...reset,lastAugReset:8}}).totals.money,1);
});
test('home reward merging is cumulative, bounded, reset-scoped and duplicate-safe',()=>{
 const reward=recordDarknetCache(null,{success:true,stockShares:3},meta()),report={host:'a',cacheRewards:reward};
 let s=mergeDarknetRewards(null,[report],reset,now);s=mergeDarknetRewards(s,[report,report],reset,now+1);assert.equal(s.totals.shares,3);
 const next=recordDarknetCache(reward,{success:true,stockShares:2},meta(now+2));s=mergeDarknetRewards(s,[{host:'a',cacheRewards:next}],reset,now+2);assert.equal(s.totals.shares,5);
 const wiped=recordDarknetCache(null,{success:true,stockShares:1},meta(now+3));s=mergeDarknetRewards(s,[{host:'a',cacheRewards:wiped}],reset,now+3);assert.equal(s.totals.shares,6);
 assert.equal(mergeDarknetRewards(s,[report],{...reset,lastAugReset:8},now+4).totals.shares,0);
 const seen=Object.fromEntries(Array.from({length:512},(_,i)=>['old'+i,{}]));assert.equal(mergeDarknetRewards({...s,seen},[report],reset,now+5).omitted,1);
 const bad=structuredClone(report);bad.cacheRewards.totals.shares=-1;assert.equal(mergeDarknetRewards(s,[bad],reset,now+5).totals.shares,6);
});
const forecast={netRate:1000,rebuildMs:60000};
const actual={recoveryMs:60000,windowMs:600000,gain:660000};
function history(predictions){return {samples:predictions.map((prediction,i)=>({...scope,at:now+i,complete:true,...actual,prediction}))};}
test('forecast feedback compares equivalent net-rate units and slower-than-forecast recovery',()=>{
 const good=compareDarknetForecast(forecast,actual);assert.equal(good.observedNetRate,1000);assert.equal(good.optimistic,false);
 assert.equal(compareDarknetForecast(forecast,{...actual,gain:330000}).optimistic,true);
 assert.equal(compareDarknetForecast(forecast,{...actual,recoveryMs:90000}).optimistic,true);
 for(const f of [null,{netRate:NaN,rebuildMs:60000},{netRate:1000,rebuildMs:0}])assert.equal(compareDarknetForecast(f,actual).comparable,false);
});
test('two optimistic results in the latest three suspend positive-income refresh, not zero-income recovery',()=>{
 const good=compareDarknetForecast(forecast,actual),bad=compareDarknetForecast(forecast,{...actual,gain:330000}),h=history([bad,bad,good]);
 const e=darknetRefreshEvidence(h,scope,now+10);assert.equal(e.suspended,true);assert.equal(e.ready,false);assert.equal(e.measuredReturns,true);
 let cash,zero;for(let t=0;t<=360000;t+=30000){cash=darknetEconomics(cash,1000+t/100,0,42,now+t,e);zero=darknetEconomics(zero,1000,0,42,now+t,e);}
 assert.equal(cash.allow,false);assert.match(cash.reason,/suspended/);assert.equal(zero.allow,true);
 const recovered=darknetRefreshEvidence(history([bad,good,good]),scope,now+10);assert.equal(recovered.suspended,false);assert.equal(recovered.ready,true);
 assert.equal(darknetRefreshEvidence(h,{...scope,context:'changed'},now+10).suspended,false);
 assert.equal(darknetRefreshEvidence(h,scope,now+21600010).suspended,false);
});
function observerFixture(count=3){
 const start=Date.now(),files=new Map(),player={skills:{charisma:100},mults:{dnet_money:1,crime_money:1,crime_success:1}},context=darknetCapabilityContext(reset,player);
 let clock=start,income=1000;const hosts=Array.from({length:count},(_,i)=>({host:'h'+i,pid:i+10}));
 const old=hosts.map(h=>({...h,pid:h.pid+100}));
 files.set('tasks/dnet-storm-state.json',JSON.stringify({reset:7,pending:{id:'id',host:'h0',at:start},refresh:beginDarknetRefresh({}, {id:'id',at:start,...scope,context,hosts:old,forecast})}));
 files.set('tasks/dnet-storm-result.json',JSON.stringify({id:'id',host:'h0',reset:7,at:start,success:true}));
 for(const h of hosts)files.set('tasks/dnet-survey-'+h.host+'.json',JSON.stringify({...h,at:start,lastCacheAt:0}));
 const remote=new Map(hosts.map(h=>[h.host,new Map()])),selected=[];
 const ns={getResetInfo:()=>reset,getPlayer:()=>player,getMoneySources:()=>({sinceInstall:{darknet:income}}),read:f=>files.get(f)||'',write:async(f,v)=>files.set(f,v),ls:(_host,prefix)=>[...files.keys()].filter(k=>k.startsWith(prefix)),ps:host=>hosts.filter(h=>h.host===host).map(h=>({filename:'darknet-node.js',pid:h.pid})),
 fileExists:(f,host)=>remote.get(host)?.has(f)||false,scp:async(f,to,from)=>{if(to!=='home')throw Error('must only copy reports to home');files.set(f,remote.get(from).get(f));return true;}};
 const query=async(_ns,code,_file,args)=>{selected.push(JSON.parse(args[0]));return await Function('ns','return '+code)({...ns,args});};
 return {ns,query,files,remote,hosts,selected,start,context,set(t,value=income){clock=start+t;income=value;},get clock(){return clock;}};
}
test('supervisor sampling continues independently of manager calls and never reseeds a completed dispatch',async()=>{
 const f=observerFixture(),original=Date.now;Date.now=()=>f.clock;
 try{
  await sampleDarknetObservations(f.ns,f.query);f.set(30000);await sampleDarknetObservations(f.ns,f.query);
  for(const h of f.hosts)f.files.set('tasks/dnet-survey-'+h.host+'.json',JSON.stringify({...h,at:f.start+60000,lastCacheAt:0}));
  f.set(60000,1100);await sampleDarknetObservations(f.ns,f.query);
  for(let t=90000;t<=690000;t+=30000){f.set(t,1100+t);await sampleDarknetObservations(f.ns,f.query);}
  const h=JSON.parse(f.files.get(darknetObservationFile));assert.equal(h.samples.length,1);assert.equal(h.active,undefined);assert.equal(h.lastDispatch,'id');assert.equal(h.samples[0].prediction.comparable,true);
 }finally{Date.now=original;}
});
test('native sampler rotates bounded reward pulls and reads rewards while scout surveys are stale',async()=>{
 const f=observerFixture(20),original=Date.now;Date.now=()=>f.clock;
 try{
  f.set(300000);const host=f.hosts[0].host,record=recordDarknetCache(null,{success:true,augmentationName:'Aug'},{host,pid:8,at:f.clock,reset});f.remote.get(host).set(cacheRewardFile(host),JSON.stringify(record));
  await sampleDarknetObservations(f.ns,f.query);f.set(330000);await sampleDarknetObservations(f.ns,f.query);
  assert.ok(f.selected.every(s=>s.length<=16));assert.equal(new Set(f.selected.flat()).size,20);
  assert.equal(JSON.parse(f.files.get('tasks/dnet-cache-rewards-summary.json')).totals.augmentations,1);
  assert.equal(JSON.parse(f.files.get('tasks/dnet-cache-rewards-summary.json')).pulls.checked,16);
 }finally{Date.now=original;}
});
test('native sampler rejects a reset that changes while its temporary query runs',async()=>{
 const f=observerFixture();await sampleDarknetObservations(f.ns,async()=>({reset:{...reset,lastAugReset:8},at:Date.now(),income:1000,rewards:[]}));assert.equal(f.files.has(darknetObservationFile),false);
});
test('first supervisor observation migrates existing current-run measurements without replaying old dispatch',async()=>{
 const f=observerFixture(),state=JSON.parse(f.files.get('tasks/dnet-storm-state.json'));
 state.refresh={samples:[{...scope,context:f.context,at:f.start,complete:true,...actual}]};f.files.set('tasks/dnet-storm-state.json',JSON.stringify(state));
 await sampleDarknetObservations(f.ns,f.query);const h=JSON.parse(f.files.get(darknetObservationFile));assert.equal(h.samples.length,1);assert.equal(h.active,undefined);
});
test('both cache openers preserve timestamps and publish native reward summaries',async()=>{
 for(const main of [cacheMain,lootMain]){
  const store=new Map([[cacheContextFile,JSON.stringify({nodeReset:7,augReset:42})]]),stop=Error('stop'),ns={pid:9,disableLog(){},getHostname:()=> 'a',getResetInfo:()=>reset,ls:()=>['x.cache'],read:f=>store.get(f)||'',write:async(f,v)=>store.set(f,v),print(){},sleep:async()=>{throw stop;},dnet:{openCache:()=>({success:true,stockShares:5}),phishingAttack:async()=>({success:false})}};
  if(main===lootMain)await assert.rejects(main(ns),e=>e===stop);else await main(ns);
  assert.equal(JSON.parse(store.get(cacheRewardFile('a'))).totals.shares,5);assert.ok(JSON.parse(store.get('tasks/dnet-last-cache.json')).at>0);
 }
});
test('supervisor owns observation writes and manager keeps only dispatch/evidence responsibilities',()=>{
 const manager=readFileSync(new URL('../darknet-manager.js',import.meta.url),'utf8'),supervisor=readFileSync(new URL('../reliability-manager.js',import.meta.url),'utf8');
 assert.doesNotMatch(manager,/observeDarknetRefresh/);assert.match(manager,/darknetObservationFile/);assert.match(manager,/forecast:evidence.measuredReturns/);
 assert.match(supervisor,/nextDarknetObservation=now\+30000/);assert.match(supervisor,/await sampleDarknetObservations/);
});

test('cache context is propagated and helper RAM contains no native reset lookup',()=>{
 assert.deepEqual(cacheRewardReset(JSON.stringify({nodeReset:7,augReset:42}),100),{lastNodeReset:7,lastAugReset:42});
 for(const value of ['', '{}', JSON.stringify({nodeReset:42,augReset:7}),JSON.stringify({nodeReset:7,augReset:101})])assert.throws(()=>cacheRewardReset(value,100));
 for(const file of ['darknet-loot.js','darknet-cache.js'])assert.doesNotMatch(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/ns\.getResetInfo/);
 for(const file of ['darknet-manager.js','darknet-node.js'])assert.match(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/tasks\/dnet-cache-context\.json/);
});
