import test from 'node:test';
import assert from 'node:assert/strict';
import {publishAugmentationPurchase,prepareAugmentationPurchases} from '../augmentation-install-policy.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const reset={lastAugReset:1,lastNodeReset:2};
function fixture({patch={},raw,runPid=9,stalled=false,current=reset}={}){
 let clock=1000;const files={},kills=[],starts=[];
 const ns={pid:4,getResetInfo:()=>current,write:async(f,v)=>{files[f]=v;},read:f=>files[f]||'',
 run:(...args)=>{starts.push(args);const request=args.at(-1);files['tasks/augmentation-purchase-result-4.json']=raw??JSON.stringify({version:1,request,workerPid:runPid,at:clock,augReset:1,nodeReset:2,planned:2,purchased:2,complete:true,...patch});return runPid;},
 isRunning:()=>stalled,kill:p=>kills.push(p),sleep:async(ms)=>{clock+=ms;}};
 return {ns,files,kills,starts,run:(args={})=>prepareAugmentationPurchases(ns,{reset,now:()=>clock,timeoutMs:500,...args})};
}
test('only a complete matching receipt from the launched worker authorizes the next stage',async()=>{
 assert.equal((await fixture().run()).ok,true);
 for(const patch of [{version:2},{request:'old'},{workerPid:8},{augReset:3},{nodeReset:3},{at:999},{at:1001},{planned:NaN},{purchased:-1},{purchased:3},{purchased:1},{complete:false}]){
  assert.equal((await fixture({patch}).run()).ok,false,JSON.stringify(patch));
 }
 for(const raw of ['','null','[]','broken'])assert.equal((await fixture({raw}).run()).ok,false);
 assert.equal((await fixture({current:{lastAugReset:2,lastNodeReset:2}}).run()).ok,false);
});
test('empty completed batches are valid and phase requests cannot reuse each other',async()=>{
 const f=fixture({patch:{planned:0,purchased:0}});assert.equal((await f.run()).ok,true);
 assert.equal((await f.run({phase:'leftover'})).ok,true);assert.notEqual(f.starts[0].at(-1),f.starts[1].at(-1));
 assert.deepEqual(f.starts[0].slice(-2),['--purchase-request','4:1000:primary']);
});
test('launch failure and bounded timeout reject installation and stop a stalled child',async()=>{
 assert.equal((await fixture({runPid:0}).run()).ok,false);
 const f=fixture({stalled:true});assert.equal((await f.run()).ok,false);assert.deepEqual(f.kills,[9]);
 assert.equal((await fixture().run({timeoutMs:0})).ok,false);
});
test('publisher binds results to a live reset-scoped request and keeps standalone runs independent',async()=>{
 const files={},ns={pid:9,getResetInfo:()=>reset,isRunning:p=>p===4,write:async(f,s)=>{files[f]=JSON.parse(s);}};
 await publishAugmentationPurchase(ns,'4:1000:primary',reset,{complete:true,purchased:2},2);
 assert.equal(files['tasks/augmentation-purchase-result-4.json'].complete,true);
 assert.equal(files['tasks/augmentation-purchase-result-4.json'].workerPid,9);
 await publishAugmentationPurchase(ns,'4:1001:leftover',reset,undefined,2);
 assert.equal(files['tasks/augmentation-purchase-result-4.json'].complete,false);
 const old=JSON.stringify(files);
 for(const request of ['', '../bad','0:1000:primary','5:1000:primary'])await publishAugmentationPurchase(ns,request,reset,{complete:true,purchased:0},0);
 await publishAugmentationPurchase(ns,'4:1000:primary',{lastAugReset:3,lastNodeReset:2},{complete:true,purchased:0},0);
 assert.equal(JSON.stringify(files),old);
});
test('actual purchase function reports a complete empty batch and retains partial counts',async()=>{
 const source=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8'),start=source.indexOf('async function purchaseDesiredAugs('),end=source.indexOf('/** @param {NS} ns',start);
 for(const [planned,purchased]of [[0,0],[2,1],[2,2]]){
  const context={isScriptPaused:()=>false,achievementActionAllowed:()=>true,options:{},purchaseFactionDonations:{},purchaseableAugs:Array.from({length:planned},()=>({name:'Target',getFromJoined:()=> 'A'})),
   getTotalCost:()=>100,getPlayerInfo:async()=>({money:1000}),stockValue:0,startingPlayerMoney:1000,executeFactionPurchases:async()=>purchased,log:()=>{},printToTerminal:false,formatMoney:String,getCostString:String};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const result=await context.purchaseDesiredAugs({getScriptName:()=> 'faction-manager.js'});
  assert.equal(result.complete,planned===purchased);assert.equal(result.purchased,purchased);
 }
});
