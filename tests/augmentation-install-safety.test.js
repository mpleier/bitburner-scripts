import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {augmentationInstallSafety,resumeAugmentationAutomation,liquidateAugmentationStocks,prepareAugmentationPurchases} from '../augmentation-install-policy.js';
import {priorityAugmentationReady} from '../autopilot-policy.js';

test('install safety preserves grafts and all Black Op aliases with SF6 or SF7 access',()=>{
 for(const type of ['BlackOps','Black Operations','BlackOp'])assert.equal(augmentationInstallSafety({getCurrentWork:()=>null,inBladeburner:()=>true,getCurrentAction:()=>({type})},true).allowed,false);
 assert.equal(augmentationInstallSafety({getCurrentWork:()=>({type:'GRAFTING'})},false).allowed,false);
 assert.equal(augmentationInstallSafety({getCurrentWork:()=>null},false).allowed,true);
 assert.equal(augmentationInstallSafety({getCurrentWork:()=>{throw Error('Missing SF4');}},false).allowed,false);
 const fn=Function('return ('+augmentationInstallSafety.toString()+')')();assert.equal(fn({getCurrentWork:()=>null,inBladeburner:()=>false},true).allowed,true);
});
const reset={lastAugReset:1,lastNodeReset:2};
test('recovery restores the original controller arguments, respects pauses and rejects a changed reset',()=>{
 const starts=[],saved=[{filename:'autopilot.js',threads:1,args:['--node-route','bb']},{filename:'daemon.js',threads:1,args:[]}];
 const ns={getResetInfo:()=>reset,read:()=>'',ps:()=>[],run:(...a)=>{starts.push(a);return 10;},print:()=>{}};
 assert.equal(resumeAugmentationAutomation(ns,saved,reset)[0].pid,10);assert.deepEqual(starts,[['autopilot.js',1,'--node-route','bb']]);
 ns.read=()=> 'true';assert.deepEqual(resumeAugmentationAutomation(ns,saved,reset),[]);
 ns.read=()=>'';assert.deepEqual(resumeAugmentationAutomation(ns,saved,{...reset,lastAugReset:0}),[]);
 ns.ps=()=>[{filename:'autopilot.js',pid:20}];assert.equal(resumeAugmentationAutomation(ns,saved,reset)[0].existing,true);
});
test('insufficient recovery RAM hands the controller off after ascend releases RAM',()=>{
 const spawn=[];const ns={getResetInfo:()=>reset,read:()=>'',ps:()=>[],run:()=>0,spawn:(...a)=>spawn.push(a),print:()=>{}};
 resumeAugmentationAutomation(ns,[{filename:'daemon.js',threads:1,args:['--no-tail-windows']}],reset);
 assert.deepEqual(spawn,[['daemon.js',1,'--no-tail-windows']]);
 assert.deepEqual(resumeAugmentationAutomation(ns,[{filename:'casino.js',threads:1,args:[]},{filename:'/Temp/command.js',threads:1,args:[]}],reset),[]);
});

async function fixture({blackOp=false,queued=false,failPurchase=false,allowSoft=false,commitBlocked=false,latePurchase=false,stockFailure=false,deferredPhase=null,missingReceipt=false,launchFailure=false}={}){
 let processes=[{filename:'ascend.js',pid:2,threads:1,args:[]},{filename:'autopilot.js',pid:1,threads:1,args:['--node-route','bb']},{filename:'remote-api-agent.js',pid:3,threads:1,args:[]}];
 let hasQueued=queued,work=null,action=blackOp?{type:'BlackOps'}:null,purchaseRuns=0;
 const starts=[],kills=[],commits=[],files={};
 const ns={pid:2,args:[],getScriptName:()=> 'ascend.js',getResetInfo:()=>reset,ps:()=>processes,isRunning:pid=>processes.some(p=>p.pid===pid),atExit:()=>{},disableLog:()=>{},print:()=>{},read:f=>files[f]||'',write:async(f,s)=>{files[f]=s;},sleep:async()=>{},kill:pid=>{kills.push(pid);processes=processes.filter(p=>p.pid!==pid);return true;},getServerMoneyAvailable:()=>100,
  run:(name,threads,...args)=>{starts.push([name,threads,...args]);if(stockFailure&&name==='stockmaster.js')return 0;if(name==='faction-manager.js'){purchaseRuns++;if(failPurchase)throw Error('purchase worker failed');if(launchFailure)return 0;
   const request=args[args.indexOf('--purchase-request')+1],phase=request?.split(':').at(-1);
   if(!missingReceipt)files['tasks/augmentation-purchase-result-2.json']=JSON.stringify({version:1,request,workerPid:10,augReset:1,nodeReset:2,at:Date.now(),planned:1,purchased:deferredPhase===phase?0:1,complete:deferredPhase!==phase});
   if(latePurchase&&purchaseRuns===2)hasQueued=true;}return 10;},spawn:()=>{},
  singularity:{getCurrentWork:()=>work,stopAction:()=>true,getOwnedAugmentations:all=>all&&hasQueued?['Base','Queued']:['Base'],checkFactionInvitations:()=>[],installAugmentations:()=>{commits.push('install');return false;},softReset:()=>{commits.push('soft');return false;}},
  bladeburner:{inBladeburner:()=>true,getCurrentAction:()=>action},stock:{hasTixApiAccess:()=>stockFailure,getPosition:()=>[1,0,0,0],purchaseWseAccount:()=>false,purchaseTixApi:()=>false}};
 const options={'prioritize-augmentations':false,'prioritize-home-ram':false,'allow-soft-reset':allowSoft,'install-augmentations':true,'max-wait-time':0,'stock-liquidation-attempts':2,'stock-liquidation-timeout':1000,'ticks-to-wait-for-additional-purchases':0};
 const source=(await readFile(new URL('../ascend.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm,'').replace(/export /g,'');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const deps={prepareAugmentationPurchases,augmentationInstallSafety,resumeAugmentationAutomation,liquidateAugmentationStocks,ensureFactionJoinPlan:async()=>{},factionJoinAllowed:()=>true,rankFactionInvites:x=>x,achievementActionAllowed:()=>true,prepareResetBackup:async()=>{if(commitBlocked)action={type:'Black Operations'};},beginTransition:async()=>true,endTransition:()=>{},log:()=>{},getConfiguration:()=>options,getFilePath:x=>x,getActiveSourceFiles:async()=>({4:3,6:1}),getStockSymbols:async()=>stockFailure?['X']:[],waitForProcessToComplete:async()=>{},runCommand:async()=>10,
 getNsDataThroughFile:async(_ns,code,_file,args=[])=>{const worker={...ns,pid:999,args};return new AsyncFunction('ns','return '+code)(worker);}};
 const main=Function(...Object.keys(deps),source+';return main;')(...Object.values(deps));
 return {ns,starts,kills,commits,run:()=>main(ns)};
}
test('executed ascend preserves a running SF6 Black Op before stopping any scripts',async()=>{
 const f=await fixture({blackOp:true});await f.run();assert.deepEqual(f.kills,[]);assert.deepEqual(f.commits,[]);assert.deepEqual(f.starts,[]);
});
test('executed ascend restores autopilot when no augmentations were purchased',async()=>{
 const f=await fixture();await f.run();assert.ok(f.kills.includes(1));assert.ok(!f.kills.includes(3));
 assert.ok(f.starts.some(a=>a[0]==='autopilot.js'&&a[2]==='--node-route'&&a[3]==='bb'));assert.deepEqual(f.commits,[]);
});
test('executed ascend restores autopilot after a purchase worker throws',async()=>{
 const f=await fixture({failPurchase:true});await assert.rejects(f.run(),/purchase worker failed/);assert.ok(f.starts.some(a=>a[0]==='autopilot.js'));
});
test('executed ascend rechecks Black Op protection at final commit',async()=>{
 const f=await fixture({queued:true,commitBlocked:true});await f.run();assert.deepEqual(f.commits,[]);assert.ok(f.starts.some(a=>a[0]==='autopilot.js'));
});
test('executed ascend rechecks queued augmentations after final purchases',async()=>{
 const f=await fixture({allowSoft:true,latePurchase:true});await f.run();assert.deepEqual(f.commits,['install']);assert.ok(f.starts.some(a=>a[0]==='autopilot.js'));
});
test('priority 4S bypass remains inside the protected install path',async()=>{
 const source=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 const condition=source.match(/if \((!priorityAugmentationReady[^\n]+)\) \{/)[1];
 const fn=Function('priorityAugmentationReady','options','facmanOutput','achievementActionAllowed','ns','have4STixApi','return '+condition);
 const options={'install-for-augs':["The Blade's Simulacrum"]},summary={installed_augs:[],awaiting_install_augs:["The Blade's Simulacrum"],affordable_augs:[]};
 assert.equal(fn(priorityAugmentationReady,options,summary,()=>true,{},false),false);
 assert.equal(fn(priorityAugmentationReady,options,{...summary,awaiting_install_augs:[]},()=>true,{},false),true);
 const path=source.slice(source.indexOf('async function shouldDelayInstall'),source.indexOf('let wasGrafting'));
 assert.ok(path.indexOf('checkIfGrafting')<path.indexOf('!priorityAugmentationReady'));assert.ok(path.includes('(unlockedSFs[6]||unlockedSFs[7])'));
});

test('executed ascend aborts bounded failed stock launches and restores automation',async()=>{
 const f=await fixture({stockFailure:true,queued:true});await f.run();
 assert.equal(f.starts.filter(a=>a[0]==='stockmaster.js').length,2);
 assert.deepEqual(f.commits,[]);assert.ok(!f.starts.some(a=>a[0]==='faction-manager.js'));
 assert.ok(f.starts.some(a=>a[0]==='autopilot.js'));
});


test('executed ascend rejects deferred and missing purchase results even with queued augmentations or soft reset permission',async()=>{
 for(const options of [{deferredPhase:'primary'},{missingReceipt:true},{launchFailure:true}]){
  const f=await fixture({queued:true,allowSoft:true,...options});await f.run();
  assert.deepEqual(f.commits,[]);assert.ok(!f.starts.some(a=>a[0]==='Tasks/ram-manager.js'));
  assert.equal(f.starts.filter(a=>a[0]==='faction-manager.js').length,1);
  assert.ok(f.starts.some(a=>a[0]==='autopilot.js'));
 }
});

test('executed ascend checks the final leftover purchase result before cleanup and installation',async()=>{
 const f=await fixture({queued:true,deferredPhase:'leftover'});await f.run();
 assert.deepEqual(f.commits,[]);assert.ok(!f.starts.some(a=>a[0]==='cleanup.js'));
 assert.equal(f.starts.filter(a=>a[0]==='faction-manager.js').length,2);
 assert.ok(f.starts.some(a=>a[0]==='autopilot.js'));
});

test('executed ascend permits installation after both purchase batches confirm completion',async()=>{
 const f=await fixture({queued:true});await f.run();assert.deepEqual(f.commits,['install']);
 assert.equal(f.starts.filter(a=>a[0]==='faction-manager.js').length,2);
});
