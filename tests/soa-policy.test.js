import test from 'node:test';
import assert from 'node:assert/strict';
import {soaCandidates,soaTick} from '../soa-manager.js';
import {wksAugmentation as wks,observeSoAInfiltration,readSoAInfiltrationIncome,soaInstallBenefit} from '../soa-policy.js';
import {progressionSpeed,augmentationResetDecision} from '../progression-speed-policy.js';
const reset={lastNodeReset:1,lastAugReset:2};
function buyer(){
 const files={},owned=[],calls=[];let money=2e6;
 const ns={getResetInfo:()=>({...reset,currentNode:4}),getPlayer:()=>({money,factions:['Shadows of Anarchy']}),read:f=>files[f]||'',isRunning:()=>true,ps:()=>[],
  singularity:{checkFactionInvitations:()=>[],getOwnedAugmentations:()=>[...owned],getFactionRep:()=>1e6,getAugmentationsFromFaction:()=>['SoA - Beauty of Aphrodite',wks],getAugmentationPrice:()=>1e6*7**owned.length,getAugmentationRepReq:()=>10000*1.3**owned.length,getAugmentationPrereq:()=>[],purchaseAugmentation:(_f,n)=>{money-=1e6*7**owned.length;owned.push(n);calls.push(n);return true;}}};
 return {ns,files,owned,calls};
}
test('SoA buys WKS before equal-priced puzzle aids, then rechecks the sevenfold price increase',()=>{
 const f=buyer(),r=soaTick(f.ns);assert.deepEqual(r.bought,[wks]);assert.equal(r.status,'waiting-for-money');assert.equal(r.next.price,7e6);
 assert.equal(soaCandidates([{name:wks,price:10,rep:1,prerequisites:[]},{name:'aid',price:1,rep:1,prerequisites:[]}],[],1)[0].name,wks);
 assert.equal(soaCandidates([{name:wks,price:10,rep:1,prerequisites:[]}],[wks],1).length,0);
});
test('maintenance, pause and achievement cash restrictions block SoA before any purchase',()=>{
 for(const file of ['tasks/automation-maintenance.json','remote-control/paused/soa-manager.js.txt','tasks/achievement-goals.json']){
  const f=buyer();f.files[file]=file.includes('paused')?'true':JSON.stringify({ownerPid:7,expiresAt:Date.now()+60000,nodeReset:1,deniedActions:['cashSpending']});
  assert.equal(soaTick(f.ns).status,'suspended');assert.deepEqual(f.calls,[]);
 }
 const f=buyer(),read=f.ns.read;f.ns.read=p=>{if(p==='tasks/spending-plan.json')f.files['tasks/automation-maintenance.json']=JSON.stringify({ownerPid:7,expiresAt:Date.now()+60000});return read(p);};
 assert.equal(soaTick(f.ns).status,'suspended');assert.deepEqual(f.calls,[]);
});
test('missing SF4 and unconfirmed native purchases terminate safely without a purchase loop',()=>{
 const f=buyer();f.ns.getResetInfo=()=>({...reset,currentNode:1,ownedSF:{}});assert.equal(soaTick(f.ns).status,'unavailable');assert.deepEqual(f.calls,[]);
 const g=buyer();let attempts=0;g.ns.singularity.purchaseAugmentation=()=>{attempts++;return true;};assert.equal(soaTick(g.ns).status,'purchase-unconfirmed');assert.equal(attempts,1);
});
function evidence(){
 let record=null;for(const at of [1000000,1020000,1040000])record=observeSoAInfiltration(record,{reset,ownerPid:7,at,automatic:true,result:{status:'completed',reward:'money',cashReward:1000,durationMs:10000}});
 const now=1040000,files={'tasks/soa-infiltration-income.json':JSON.stringify(record),'tasks/infiltration-status.json':JSON.stringify({pid:7,at:now,status:'waiting-for-entry'})};
 const ns={getResetInfo:()=>reset,read:f=>files[f]||'',ps:()=>[{pid:7,filename:'infiltration-manager.js'}]};
 return {record,now,files,ns};
}
test('repeated automatic cash completions measure conservative income including cooldowns',()=>{
 const f=evidence(),q=readSoAInfiltrationIncome(f.ns,f.now);assert.equal(q.rate,50);assert.equal(q.samples,3);
 for(const result of [{status:'completed',reward:'reputation',cashReward:1000,durationMs:10000},{status:'completed',reward:'money',cashReward:1000,durationMs:10000,manuallyStarted:true},{status:'completed',reward:'money',cashReward:null,durationMs:10000}])
  assert.equal(observeSoAInfiltration(null,{reset,ownerPid:7,at:f.now,result,automatic:true}).samples.length,0);
 assert.equal(observeSoAInfiltration(f.record,{reset:{...reset,lastAugReset:3},ownerPid:7,at:f.now}).samples.length,0);
});
test('paused manual stale reset-mismatched dead-owner and corrupt income evidence is ignored',()=>{
 for(const mutate of [f=>f.ns.ps=()=>[],f=>f.files['remote-control/paused/infiltration-manager.js.txt']='true',f=>f.files['tasks/infiltration-status.json']=JSON.stringify({pid:7,at:f.now,status:'running',manuallyStarted:true}),f=>f.files['tasks/infiltration-status.json']=JSON.stringify({pid:7,at:f.now,status:'prioritizing-bladeburner'}),f=>f.record.augReset=3,f=>f.record.samples[2].at=f.record.samples[1].at,f=>f.record.samples[1].cash=Infinity]){
  const f=evidence();mutate(f);f.files['tasks/soa-infiltration-income.json']=JSON.stringify(f.record);
  assert.equal(readSoAInfiltrationIncome(f.ns,f.now),null);
 }
 const f=evidence();assert.equal(readSoAInfiltrationIncome(f.ns,f.now+300001),null);
});
test('only queued uninstalled WKS receives a discounted income-share benefit',()=>{
 const f=evidence(),snapshot={...{nodeReset:1,augReset:2},soa:{installed:false,queued:true,infiltration:readSoAInfiltrationIncome(f.ns,f.now)}};
 assert.equal(soaInstallBenefit(snapshot,[{name:wks}],{nodeReset:1,augReset:2,now:f.now,cashRate:50}).gain,.125);
 for(const mutate of [s=>s.soa.installed=true,s=>s.soa.queued=false,s=>s.soa.infiltration.augReset=3,s=>s.soa.infiltration.at=f.now+1,s=>s.soa.infiltration.samples=2]){
  const s=structuredClone(snapshot);mutate(s);assert.equal(soaInstallBenefit(s,[{name:wks}],{nodeReset:1,augReset:2,now:f.now}).gain,0);
 }
});
test('WKS can justify an economic install without changing ordinary income forecasts or route protections',()=>{
 const f=evidence(),now=f.now,snapshot={at:now,augReset:2,nodeReset:1,worth:1e12,ready:[{name:wks,stats:{}}],targets:[],installedCount:40,requiredCount:30,resetEconomics:{known:true,replacementCost:0},soa:{installed:false,queued:true,infiltration:readSoAInfiltrationIncome(f.ns,now)}};
 const previous={at:now-60000,augReset:2,worth:1e12,fingerprint:JSON.stringify([wks]),lastGrowthAt:now-600000};
 const s=progressionSpeed({snapshot,previous,now,augReset:2,nodeReset:1,elapsed:6*3600000,homeRam:128});
 assert.equal(s.gain,.25);assert.equal(s.resetPaysBack,true);assert.equal(s.earlyInstall,true);assert.equal(s.observation.cashRate,0);
 assert.equal(augmentationResetDecision({requested:true,speed:s}).allowed,true);
 assert.equal(augmentationResetDecision({requested:true,speed:s,remainingMs:60000}).allowed,false);
 assert.equal(augmentationResetDecision({requested:true,speed:{...s,recoveryBlocked:true}}).allowed,false);
 const unknown=progressionSpeed({snapshot:{...snapshot,soa:undefined},previous,now,augReset:2,nodeReset:1,elapsed:6*3600000,homeRam:128});assert.equal(unknown.gain,0);assert.equal(unknown.resetPaysBack,false);
});
