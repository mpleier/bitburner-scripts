import test from 'node:test';import assert from 'node:assert/strict';
import {spendingPlan,claimSpending} from '../spending-policy.js';
import {soaCandidates,soaTick} from '../soa-manager.js';
import {rankGoOpponents} from '../go-policy.js';
import {matchingBackup} from '../reset-backup.js';
import {intelligenceSessionDecision} from '../intelligence-policy.js';
import {optimizeLayout,layoutScore} from '../stanek-optimizer.js';
test('spending allocations never exceed unreserved cash',()=>{for(const node of [1,10]){const p=spendingPlan({money:1000,reserve:300,node});assert.ok(Object.values(p.allowances).reduce((a,b)=>a+b,0)<=700.000001);}});
test('one-minute spending ledger coordinates repeated and competing managers',()=>{const files=new Map(),now=Date.now(),reset=7;files.set('tasks/spending-plan.json',JSON.stringify({epoch:1,reset,ownerPid:2,expiresAt:now+60000,allowances:{home:60,gang:20}}));
 const ns={read:p=>files.get(p)||'',write:(p,s)=>files.set(p,s),getPlayer:()=>({money:100}),ps:()=>[{pid:2}],getResetInfo:()=>({lastAugReset:reset})};
 assert.equal(claimSpending(ns,'home',40),true);assert.equal(claimSpending(ns,'home',21),false);assert.equal(claimSpending(ns,'gang',20),true);assert.equal(claimSpending(ns,'gang',1),false);files.set('reserve.txt','100');assert.equal(claimSpending(ns,'home',1),false);});
test('missing, stale and malformed plans retain normal reserve protection',()=>{const ns={getPlayer:()=>({money:100}),read:p=>p==='reserve.txt'?'20':'5'};assert.equal(claimSpending(ns,'home',81),false);assert.equal(claimSpending(ns,'home',50),true);assert.equal(claimSpending(ns,'home',Infinity),false);});
test('SoA planner skips owned and unmet prerequisites and rep requirements',()=>{assert.deepEqual(soaCandidates([{name:'a',price:1,rep:1,prerequisites:[]},{name:'b',price:2,rep:1,prerequisites:['a']},{name:'c',price:0,rep:3,prerequisites:[]}],[],2).map(a=>a.name),['a']);});
test('SoA manager rechecks special prices after each purchase',()=>{const owned=[],s={checkFactionInvitations:()=>[],getOwnedAugmentations:()=>owned,getFactionRep:()=>100,getAugmentationsFromFaction:()=>['a','b'],getAugmentationPrice:()=>owned.length?200:5,getAugmentationRepReq:()=>1,getAugmentationPrereq:()=>[],purchaseAugmentation:(f,n)=>{owned.push(n);return true;}};
 const ns={getResetInfo:()=>({currentNode:4}),getPlayer:()=>({money:100,factions:['Shadows of Anarchy']}),read:()=>'',singularity:s};assert.deepEqual(soaTick(ns).bought,['a']);});
test('Go picks bonus useful to the BitNode and responds to win evidence',()=>{assert.equal(rankGoOpponents({},'auto',9)[0].name,'Netburners');assert.equal(rankGoOpponents({},'reputation')[0].name,'Daedalus');const s={Daedalus:{wins:0,losses:1000}};assert.notEqual(rankGoOpponents(s,'reputation')[0].name,'Daedalus');assert.throws(()=>rankGoOpponents({},'invalid'));});
test('backup acknowledgements require the current request and actual bytes',()=>{assert.equal(matchingBackup({id:'a',status:'saved',bytes:4},'a'),true);assert.equal(matchingBackup({id:'a',status:'saved',bytes:4},'b'),false);assert.equal(matchingBackup({id:'a',status:'saved',bytes:0},'a'),false);});
test('intelligence sessions bound resets and protect progress',()=>{const data={state:{nodeReset:1,resets:3,startedAt:1000},reset:{lastNodeReset:1,lastAugReset:1000},intelligence:1,target:200,maxResets:4,maxMinutes:10,now:2000,invites:10};assert.equal(intelligenceSessionDecision(data),'farm');for(const changed of [{queued:true},{busy:true}])assert.equal(intelligenceSessionDecision({...data,...changed}),'protected-progress');assert.equal(intelligenceSessionDecision({...data,maxResets:3}),'complete');assert.equal(intelligenceSessionDecision({...data,now:2000000}),'complete');assert.equal(intelligenceSessionDecision({...data,invites:1}),'requires-faction-invitations');});
test('bounded Stanek optimizer produces legal current-grid layouts',async()=>{const defs=[{id:0,shape:[[true,true]],limit:1},{id:25,shape:[[true,true]],limit:1},{id:100,shape:[[true]],limit:2}];const r=await optimizeLayout(defs,3,2,1,async()=>{},5);assert.ok(r.fragments.length);assert.ok(Number.isFinite(layoutScore(r.fragments,defs,3,2)));assert.ok(r.steps<100000);assert.equal(layoutScore([{id:0,x:0,y:0,rotation:0},{id:25,x:0,y:0,rotation:0}],defs,3,2),-Infinity);assert.equal(layoutScore([{id:0,x:-1,y:0,rotation:0}],defs,3,2),-Infinity);});

test('generated spending workers remain expressions inside JSON.stringify',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {purchaseSleeveAugBatch,sleeveControlAllowed}=await import('../sleeve-policy.js');const {achievementActionAllowed}=await import('../achievement-policy.js');const {purchaseGangEquipment,gangMutationAllowed}=await import('../gang-policy.js');
 for(const [file,purchase] of [['sleeve.js',purchaseSleeveAugBatch],['gangs.js',purchaseGangEquipment]]){
  const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
  const raw=source.match(/`\(\(\) => \{ const claimSpending=\$\{claimSpending\.toString\(\)\}; return \([\s\S]*?\}\)\(\)`/)[0].slice(1,-1);
  const rendered=raw.replace('${claimSpending.toString()}',claimSpending.toString()).replace(/\$\{purchase\w+\.toString\(\)\}/,purchase.toString()).replace('${gangMutationAllowed.toString()}',gangMutationAllowed.toString()).replace('${sleeveControlAllowed.toString()}',sleeveControlAllowed.toString()).replace('${achievementActionAllowed.toString()}',achievementActionAllowed.toString());
  assert.doesNotThrow(()=>new Function('ns','return JSON.stringify('+rendered+');'));
 }
});
test('current Go status and all newly managed scripts use the narrow remote policy',async()=>{const {managedScripts,renderCommandJob}=await import('../remote-api-command.js');assert.ok(managedScripts.includes('soa-manager.js'));assert.ok(managedScripts.includes('go.js'));assert.ok(renderCommandJob({id:'test',expiresAt:Date.now()+1000,method:'automation.status',args:[]}).includes('tasks/reset-backup-status.json'));});

test('sleeve and gang purchases consult the injected shared cash allocator',async()=>{
 const {purchaseSleeveAugBatch,sleeveControlAllowed}=await import('../sleeve-policy.js');const {achievementActionAllowed}=await import('../achievement-policy.js');const {purchaseGangEquipment}=await import('../gang-policy.js');
 const bought=[];const ns={getPlayer:()=>({money:100}),read:()=>'',sleeve:{getSleeve:()=>({shock:0}),getSleevePurchasableAugs:()=>[{name:'a',cost:10}],purchaseSleeveAug:()=>{bought.push('sleeve');return true;}},gang:{getEquipmentCost:()=>10,purchaseEquipment:()=>{bought.push('gang');return true;}}};
 assert.equal(purchaseSleeveAugBatch(ns,0,['a'],100,0,()=>false).spent,0);
 assert.deepEqual(purchaseGangEquipment(ns,[{member:'m',equipmentName:'a'}],0,100,()=>false),[false]);assert.deepEqual(bought,[]);
});

test('completed BitNode departure takes priority over optional intelligence resets',async()=>{const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');assert.ok(source.indexOf('await checkIfBnIsComplete(ns, player);')<source.indexOf("if(options['intelligence-farming'])"));const farmer=await readFile(new URL('../farm-intelligence.js',import.meta.url),'utf8');assert.ok(farmer.lastIndexOf('getCurrentAction()')>farmer.indexOf("prepareResetBackup(ns,'intelligence session')"));assert.ok(farmer.includes('intelligenceUnlocked(reset)'));});

test('intelligence experience requires BN5 or permanent SF5 even with disabled active bonuses',async()=>{const {intelligenceUnlocked}=await import('../intelligence-policy.js');assert.equal(intelligenceUnlocked({currentNode:1,ownedSF:new Map()}),false);assert.equal(intelligenceUnlocked({currentNode:5}),true);assert.equal(intelligenceUnlocked({currentNode:1,ownedSF:new Map([[5,1]]),bitNodeOptions:{sourceFileOverrides:new Map([[5,0]])}}),true);});

test('export bonus workers support current and newer API names and await the export',async()=>{const {exportBonusCommand}=await import('../reset-backup.js');for(const modern of [false,true]){let available=true;const singularity={exportGame:async()=>{available=false;}};singularity[modern?'hasExportGameBonus':'exportGameBonus']=()=>available;
 const command=exportBonusCommand(modern),fn=new (Object.getPrototypeOf(async function(){}).constructor)('ns','return '+command+';');assert.equal(await fn({singularity}),'claimed');assert.equal(await fn({singularity}),'not-due');assert.equal(command.includes('hasExportGameBonus'),modern);}});
