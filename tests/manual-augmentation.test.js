import {captureAugmentationEconomics,augmentationEconomicsChange,invalidateAugmentationFunding} from '../augmentation-economics-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {captureAugmentationOwnership} from '../augmentation-ownership-policy.js';
import {freshFactionManagerOutput} from '../autopilot-policy.js';
import {factionPurchaseBatch,factionControlAllowed} from '../faction-policy.js';
const reset={lastAugReset:10,lastNodeReset:5,ownedAugs:{Base:1,'NeuroFlux Governor':7}};
function fixture(){
 const f={reset:{...reset,ownedAugs:{...reset.ownedAugs}},installed:['Base','NeuroFlux Governor'],queued:['Manual','NeuroFlux Governor','NeuroFlux Governor'],calls:[],purchases:[]};
 f.ns={pid:3,getResetInfo:()=>{f.calls.push('reset');return f.reset;},getPlayer:()=>({money:1e9,mults:{faction_rep:1},factions:[]}),getFavorToDonate:()=>150,read:()=>'',write(){},getScriptName:()=> 'faction-manager.js',isRunning:()=>true,
  singularity:{getOwnedAugmentations:p=>{f.calls.push(p?'owned':'installed');return p?[...f.installed,...f.queued]:[...f.installed];},getAugmentationPrice:()=>100,purchaseAugmentation:(faction,a)=>{f.purchases.push(a);return true;}}};
 return f;
}
function summary(s){return {schemaVersion:1,at:s.at,augReset:10,nodeReset:5,ownershipSignature:s.signature,installed_augs:s.installed,installed_count:s.installed.length,
 affordable_augs:['Next'],affordable_count_ex_nf:1,affordable_count_nf:0,awaiting_install_augs:s.queued,awaiting_install_count_ex_nf:1,awaiting_install_count_nf:2,unpurchased_count:10,total_rep_cost:0,total_aug_cost:100};}
test('serialized ownership capture reads reset, installed and queued ownership without yielding',()=>{
 const f=fixture(),capture=Function('return ('+captureAugmentationOwnership.toString()+')')(),s=capture(f.ns);
 assert.equal(s.complete,true);assert.deepEqual(f.calls,['reset','installed','owned']);assert.deepEqual(s.queued,['Manual','NeuroFlux Governor','NeuroFlux Governor']);assert.equal(s.levels.find(([n])=>n==='NeuroFlux Governor')[1],7);
});
test('queue extraction is a multiset difference, preserving repeated NeuroFlux without assuming list order',()=>{
 const f=fixture();f.ns.singularity.getOwnedAugmentations=p=>p?['NeuroFlux Governor','Manual','Base','NeuroFlux Governor','NeuroFlux Governor']:f.installed;
 assert.deepEqual(captureAugmentationOwnership(f.ns).queued,['Manual','NeuroFlux Governor','NeuroFlux Governor']);
});
test('manual purchases, grafts, same-count replacements and installed NF levels change the ownership fingerprint',()=>{
 for(const change of [f=>f.queued.push('Purchased'),f=>f.installed.push('Grafted'),f=>f.queued[0]='Replacement',f=>f.reset.ownedAugs['NeuroFlux Governor']++]){
  const f=fixture(),before=captureAugmentationOwnership(f.ns);change(f);assert.notEqual(captureAugmentationOwnership(f.ns).signature,before.signature);
 }
 const f=fixture(),before=captureAugmentationOwnership(f.ns);f.installed.reverse();f.queued.reverse();assert.equal(captureAugmentationOwnership(f.ns).signature,before.signature);
});
test('unavailable source files and malformed native lists never masquerade as an empty queue',()=>{
 const f=fixture();f.ns.singularity.getOwnedAugmentations=()=>{throw Error('SF4 unavailable');};let s=captureAugmentationOwnership(f.ns);assert.equal(s.complete,false);assert.equal(s.queued,null);assert.deepEqual(s.installed,['Base','NeuroFlux Governor']);
 s=captureAugmentationOwnership(f.ns,false);assert.equal(s.complete,false);
 const g=fixture();g.ns.singularity.getOwnedAugmentations=p=>p?[]:g.installed;assert.equal(captureAugmentationOwnership(g.ns).complete,false);
 const h=fixture();h.reset.ownedAugs={Base:1};assert.equal(captureAugmentationOwnership(h.ns).complete,false);
});
test('a fresh summary becomes unusable immediately after manual ownership changes',()=>{
 const f=fixture(),s=captureAugmentationOwnership(f.ns),output=summary(s),now=s.at+1;
 assert.equal(freshFactionManagerOutput(output,reset,now,120000,s),output);
 for(const change of [f=>f.queued.push('Purchased'),f=>f.installed.push('Grafted'),f=>f.reset.ownedAugs['NeuroFlux Governor']++]){
  const g=fixture();change(g);assert.equal(freshFactionManagerOutput(output,reset,now,120000,captureAugmentationOwnership(g.ns)),null);
 }
 assert.equal(freshFactionManagerOutput({...output,ownershipSignature:undefined},reset,now,120000,s),null);
 assert.equal(freshFactionManagerOutput(output,reset,now,120000,{...s,complete:false}),null);
 assert.equal(freshFactionManagerOutput({...output,awaiting_install_augs:['Other','NeuroFlux Governor','NeuroFlux Governor']},reset,now,120000,s),null);
});
function purchaseHarness(f){
 const source=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');
 const stripped=source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export async function','async function').replaceAll('export function','function');
 const context={ns:f.ns,captureAugmentationOwnership,captureAugmentationEconomics,augmentationEconomicsChange,factionControlAllowed,factionPurchaseBatch,achievementActionAllowed:()=>true,
 getNsDataThroughFile:async(ns,expression,file,args)=>{ns.args=args;return vm.runInNewContext(expression,{ns});}};
 vm.runInNewContext(stripped+';ownershipSnapshot=captureAugmentationOwnership(ns);economicsSnapshot=captureAugmentationEconomics(ns,{augmentations:[],factions:[]});options={};bitNodeMults={FactionWorkRepGain:1};globalThis.buy=executeFactionPurchases;',context);return context;
}
test('actual serialized purchase and donation workers reject ownership changes before spending',async()=>{
 for(const donation of [false,true]){
  const f=fixture(),h=purchaseHarness(f);f.queued.push('Manual purchase');
  assert.equal(await h.buy(f.ns,[{faction:'A',augmentation:'Next',targetRep:100,repDonation:100}],donation),-1);assert.deepEqual(f.purchases,[]);
 }
 const f=fixture(),h=purchaseHarness(f);assert.equal(await h.buy(f.ns,[{faction:'A',augmentation:'Next'}]),1);assert.deepEqual(f.purchases,['Next']);
});
function workHarness(){
 const f=fixture();let now=100000,signature='initial',broken=false;const logs=[],calls=[];
 const ns={print:s=>logs.push(s)};
 const source=readFileSync(new URL('../work-for-factions.js',import.meta.url),'utf8'),start=source.indexOf('async function checkAugmentationOwnership('),end=source.indexOf('// Reputation loops otherwise',start),probe=source.slice(start,end);
 const context={captureAugmentationOwnership,Date:{now:()=>now},getNsDataThroughFile:async()=>{calls.push(now);if(broken)throw Error('RAM');return {complete:true,signature};}};
 vm.runInNewContext('let augmentationOwnershipSignature="initial",augmentationOwnershipChanged=false,lastOwnershipProbeAt=100000,ownershipProbeWarned=false;const loopSleepInterval=5000;'+probe+';globalThis.probe=checkAugmentationOwnership;',context);
 return {ns,calls,logs,probe:()=>context.probe(ns),set:v=>{now=v.now??now;signature=v.signature??signature;broken=v.broken??broken;}};
}
test('ownership probes detect manual changes during a long work loop and latch until reassessment',async()=>{
 const h=workHarness();assert.equal(await h.probe(),false);h.set({now:105000,signature:'manual'});assert.equal(await h.probe(),true);h.set({now:106000,signature:'initial'});assert.equal(await h.probe(),true);assert.deepEqual(h.calls,[105000]);
});
test('ownership probe failures retain work, warn once and retry after the cooldown',async()=>{
 const h=workHarness();h.set({now:105000,broken:true});assert.equal(await h.probe(),false);h.set({now:110000});await h.probe();assert.equal(h.logs.length,1);h.set({now:115000,broken:false,signature:'changed'});assert.equal(await h.probe(),true);
});
test('producer rechecks ownership before publication and autopilot refreshes before consuming a plan',()=>{
 const f=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');const publish=f.indexOf('await ns.write(output_file, JSON.stringify({');assert.ok(publish>f.indexOf('const finalOwnership='));assert.ok(f.indexOf('ownershipSignature:ownershipSnapshot.signature',publish)>publish);
 const a=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8');const start=a.indexOf('async function maybeInstallAugmentations('),fresh=a.indexOf('await updateCachedData(ns);',start),consume=a.indexOf('let facman = getFactionManagerOutput',start);assert.ok(fresh>start&&fresh<consume);assert.match(a,/false,1,0,true/);
 const w=readFileSync(new URL('../work-for-factions.js',import.meta.url),'utf8');assert.match(w,/if\(augmentationOwnershipSignature&&await checkAugmentationOwnership\(ns\)\)return true/);assert.match(w,/await loadStartupData\(ns\);scope=1/);
});
test('executed autopilot ownership refresh clears stale plans and cash goals after manual purchases',async()=>{
 const f=fixture(),source=readFileSync(new URL('../autopilot.js',import.meta.url),'utf8'),start=source.indexOf('    async function updateCachedData('),end=source.indexOf('    /**',start+10),body=source.slice(start,end),files={};
 const original=captureAugmentationOwnership(f.ns);f.queued.push('New manual');const changed=captureAugmentationOwnership(f.ns);
 files['tasks/augmentation-wait-plan.json']=JSON.stringify({ownerPid:3,augReset:10,nodeReset:5,active:true,startedAt:100,expiresAt:999999});
 files['tasks/spending-plan.json']=JSON.stringify({ownerPid:3,reset:10,allowances:{home:100},signals:{augmentationCashTarget:{name:'New manual',cost:100},route:'bladeburner'}});
 const ns={pid:3,read:p=>files[p]||'',write:(p,s)=>files[p]=s};
 let fail=false;const context={captureAugmentationOwnership,invalidateAugmentationFunding,installedAugmentationsFromReset:r=>Object.keys(r.ownedAugs),getNsDataThroughFile:async(ns,expr)=>{if(expr==='ns.getResetInfo()')return f.reset;if(fail)throw Error('RAM');return changed;},ns,original};
 vm.runInNewContext('let augmentationOwnership=original,installedAugmentations=[],playerInstalledAugCount=0,reservedPurchase=1000,installCountdown=1000,installWindowStarted=1000,installCountdownResets=1,nextFactionSummaryRefresh=999999,augmentationWaitWindow=null; const unlockedSFs={4:1},factionManagerOutputFile="summary";'+body+';globalThis.refresh=updateCachedData;globalThis.state=()=>({augmentationOwnership,reservedPurchase,installCountdown,nextFactionSummaryRefresh,installedAugmentations});',context);
 await context.refresh(ns);assert.equal(context.state().reservedPurchase,0);assert.equal(context.state().installCountdown,0);assert.equal(files.summary,'');
 assert.equal(JSON.parse(files['tasks/augmentation-wait-plan.json']).active,false);const plan=JSON.parse(files['tasks/spending-plan.json']);assert.equal(plan.signals.augmentationCashTarget,null);assert.equal(plan.allowances.home,100);assert.equal(plan.signals.route,'bladeburner');
 fail=true;await assert.doesNotReject(()=>context.refresh(ns));assert.equal(context.state().augmentationOwnership.complete,false);assert.ok(context.state().installedAugmentations.includes('Base'));
});
