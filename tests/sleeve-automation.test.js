import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bestSleeveCrime,sleeveCrimeChance,bestFactionWork,sleeveRepAssignments,purchaseSleeveAugBatch,sleeveTaskMatches,maximumSleeves,sleeveReserves,sleeveControlAllowed,sleeveOptionsError,sleeveAugSpendingBudget,sleeveBladeburnerSupport } from '../sleeve-policy.js';
import { expandSleeves } from '../sleeve-expansion.js';
const sleeve=(extra={})=>({shock:0,sync:100,skills:{hacking:100,strength:100,defense:100,dexterity:100,agility:100,charisma:100,intelligence:0},mults:{crime_success:1},...extra});
test('sleeve crime choice accounts for its own chance and expected money per second',()=>{
 const crimes={Mug:{difficulty:0.2,strength_success_weight:1,money:100,time:1000},Heist:{difficulty:10,strength_success_weight:1,money:1000,time:1000}};
 assert.equal(bestSleeveCrime(sleeve(),crimes),'Mug');
 assert.ok(sleeveCrimeChance(sleeve({mults:{crime_success:2}}),crimes.Mug)>sleeveCrimeChance(sleeve(),crimes.Mug));
 assert.equal(sleeveCrimeChance(sleeve(),undefined),0);
 assert.equal(sleeveCrimeChance(sleeve(),crimes.Mug,0),0);
});
test('faction work picks among supported types using each sleeve skills',()=>{
 assert.equal(bestFactionWork(sleeve({skills:{hacking:1000}}),['security','hacking']),'hacking');
 assert.equal(bestFactionWork(sleeve(),['field']),'field');
});
test('reputation assignments avoid duplicate factions and companies and exclude unready sleeves',()=>{
 const sleeves=[sleeve(),sleeve(),sleeve({shock:1}),sleeve({sync:50}),sleeve()];
 const targets=[{type:'FACTION',name:'CyberSec',workTypes:['hacking']},{type:'FACTION',name:'NiteSec',workTypes:['hacking']},{type:'COMPANY',name:'ECorp'}];
 const result=sleeveRepAssignments(sleeves,targets,{type:'FACTION',factionName:'NiteSec'},0,false);
 assert.equal(result[0].name,'NiteSec');assert.equal(result[1].name,'CyberSec');assert.equal(result[4].name,'ECorp');
 assert.equal(result[2],undefined);assert.equal(result[3],undefined);
 const bb=sleeveRepAssignments([sleeve(),sleeve(),sleeve(),sleeve(),sleeve()],targets,{},0,true);
 assert.equal(bb[1],undefined);assert.equal(bb[2],undefined);assert.equal(bb[3],undefined);
});
test('augmentation purchases report only successful spending and preserve freshly changed reserves',()=>{
 let money=100,reserve=20;const purchased=[];
 const ns={read:()=>String(reserve),getPlayer:()=>({money}),sleeve:{getSleeve:()=>({shock:0}),getSleevePurchasableAugs:()=>[{name:'A',cost:30},{name:'B',cost:40},{name:'Failed',cost:10}],purchaseSleeveAug:(_index,name)=>{if(name==='Failed')return false;money-=30;reserve=60;purchased.push(name);return true;}}};
 const receipt=purchaseSleeveAugBatch(ns,0,['A','B','Failed'],80,20);
 assert.deepEqual(receipt,{spent:30,purchased:['A']});assert.deepEqual(purchased,['A']);
 ns.sleeve.getSleeve=()=>({shock:0.01});assert.equal(purchaseSleeveAugBatch(ns,0,['A'],80,0).spent,0);
});
test('generated augmentation helper performs the same guarded purchases as the tested policy',()=>{
 const ns={args:[0,JSON.stringify(['A']),5,0],read:()=>'',getPlayer:()=>({money:10}),sleeve:{getSleeve:()=>({shock:0}),getSleevePurchasableAugs:()=>[{name:'A',cost:5}],purchaseSleeveAug:()=>true}};
 assert.ok(ns.args.every(arg=>['string','number','boolean'].includes(typeof arg)));
 const command=`(${purchaseSleeveAugBatch.toString()})(ns,ns.args[0],JSON.parse(ns.args[1]),ns.args[2],ns.args[3])`;
 assert.deepEqual(new Function('ns',`return ${command}`)(ns),{spent:5,purchased:['A']});
});
test('task reconciliation detects idle or externally changed work',()=>{
 assert.equal(sleeveTaskMatches({type:'RECOVERY'},'ns.sleeve.setToShockRecovery(ns.args[0])',[0]),true);
 assert.equal(sleeveTaskMatches({type:'CRIME',crimeType:'Mug'},'ns.sleeve.setToCommitCrime(ns.args[0],ns.args[1])',[0,'Homicide']),false);
 assert.equal(sleeveTaskMatches(null,'ns.sleeve.setToSynchronize(ns.args[0])',[0]),false);
});
test('sleeve expansion obeys SF10 capacity and buys smaller affordable memory increments',()=>{
 assert.equal(maximumSleeves({currentNode:10,ownedSF:new Map([[10,1]])}),7);assert.equal(maximumSleeves({currentNode:10,ownedSF:{10:2}}),8);
 let memory=90,money=15;
 const ns={getResetInfo:()=>({currentNode:10,ownedSF:{10:0}}),read:()=>'',getPlayer:()=>({money}),sleeve:{getNumSleeves:()=>6,getSleeve:()=>({memory}),getMemoryUpgradeCost:(_,amount)=>amount*10,upgradeMemory:(_,amount)=>{memory+=amount;money-=amount*10;}}};
 assert.equal(expandSleeves(ns).upgraded,1);assert.equal(memory,91);assert.equal(money,5);
 assert.equal(expandSleeves(ns,NaN).upgraded,0);
});
test('sleeve manager starts without SF2, has optional API guards and no training prompts',async()=>{
 const source=await readFile(new URL('../sleeve.js',import.meta.url),'utf8');
 const autopilot=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/ns\.prompt\(/);
 assert.match(source,/lastRerollTime\[i\].*>= rerollTime/);
 assert.match(source,/\['min-shock-recovery', 0\]/);
 assert.match(source,/\['enable-bladeburner-contracts', false\]/);
 assert.match(source,/\(7 in ownedSourceFiles\).*!playerInBladeburner/);
 assert.match(autopilot,/if \(\(10 in unlockedSFs\) && !findScript\('sleeve.js'\)\)/);
});

test('Bladeburner reconciliation preserves special task progress and compares the exact action',()=>{
 const command='ns.sleeve.setToBladeburnerAction(ns.args[0],ns.args[1],ns.args[2])';
 assert.equal(sleeveTaskMatches({type:'INFILTRATE'},command,[0,'Infiltrate Synthoids','']),true);
 assert.equal(sleeveTaskMatches({type:'SUPPORT'},command,[0,'Support main sleeve','']),true);
 assert.equal(sleeveTaskMatches({type:'BLADEBURNER',actionType:'General',actionName:'Diplomacy'},command,[0,'Diplomacy','']),true);
 assert.equal(sleeveTaskMatches({type:'BLADEBURNER',actionType:'General',actionName:'Field Analysis'},command,[0,'Diplomacy','']),false);
 assert.equal(sleeveTaskMatches({type:'BLADEBURNER',actionType:'Contracts',actionName:'Retirement'},command,[0,'Take on contracts','Retirement']),true);
 assert.equal(sleeveTaskMatches({type:'BLADEBURNER',actionType:'Contracts',actionName:'Tracking'},command,[0,'Take on contracts','Retirement']),false);
});
test('sleeve spending and training honor all explicit and global reserves',()=>{
 assert.deepEqual(sleeveReserves({reserve:100,'training-reserve':20},30),{reserve:100,trainingReserve:100});
 assert.deepEqual(sleeveReserves({reserve:20,'training-reserve':200},100),{reserve:100,trainingReserve:200});
 assert.deepEqual(sleeveReserves({reserve:NaN,'training-reserve':Infinity},'bad'),{reserve:0,trainingReserve:0});
 assert.deepEqual(purchaseSleeveAugBatch({},0,['A'],NaN,0),{spent:0,purchased:[]});
});
test('existing faction owners remain stable when a different sleeve follows the player',()=>{
 const targets=[{type:'FACTION',name:'CyberSec',workTypes:['hacking']},{type:'FACTION',name:'NiteSec',workTypes:['hacking']}];
 const tasks=[{type:'FACTION',factionName:'CyberSec'},{type:'FACTION',factionName:'NiteSec'}];
 const result=sleeveRepAssignments([sleeve(),sleeve()],targets,{type:'FACTION',factionName:'NiteSec'},0,false,tasks);
 assert.equal(result[0].name,'CyberSec');assert.equal(result[1].name,'NiteSec');
});
test('following the player works without extra reputation targets and skips unsupported factions',()=>{
 const target={type:'FACTION',name:'CyberSec',workTypes:['hacking']};
 const result=sleeveRepAssignments([sleeve()],[],{type:'FACTION',factionName:'CyberSec'},0,false,[],target);
 assert.equal(result[0].workType,'hacking');
 assert.deepEqual(sleeveRepAssignments([sleeve()],[],{type:'FACTION',factionName:'Bladeburners'},0,false),{});
 assert.equal(maximumSleeves({currentNode:1,ownedSF:{10:1}}),6);
 assert.equal(maximumSleeves({currentNode:10,ownedSF:{10:0}}),6);
});

test('gang preparation ranks successful karma per second rather than assuming failed crimes give karma',()=>{
 const crimes={Homicide:{difficulty:10,strength_success_weight:1,karma:3,money:45000,time:3000},Other:{difficulty:.1,strength_success_weight:1,karma:1,money:1,time:1000}};
 assert.equal(bestSleeveCrime(sleeve(),crimes,'karma'),'Other');
 assert.equal(bestSleeveCrime(sleeve(),crimes),'Homicide');
});
test('the follow sleeve can change employers when its target is free',()=>{
 const targets=[{type:'FACTION',name:'CyberSec',workTypes:['hacking']},{type:'FACTION',name:'NiteSec',workTypes:['hacking']}];
 const result=sleeveRepAssignments([sleeve(),sleeve()],targets,{type:'FACTION',factionName:'NiteSec'},0,false,[{type:'FACTION',factionName:'CyberSec'},null]);
 assert.equal(result[0].name,'NiteSec');assert.equal(result[1].name,'CyberSec');
});


test('sleeve settings reject invalid ratios, thresholds and purchase batch sizes',()=>{
 const o={'min-shock-recovery':0,'shock-recovery':.05,'homicide-chance-threshold':.5,'aug-budget':.1,'min-aug-batch':1,reserve:null,'training-reserve':null};
 for(const key of ['buy-cooldown','training-cap-seconds','failed-bladeburner-contract-cooldown','train-to-strength','train-to-defense','train-to-dexterity','train-to-agility','study-to-hacking','study-to-charisma'])o[key]=10;
 assert.equal(sleeveOptionsError(o),null);
 for(const patch of [{'aug-budget':2},{'training-cap-seconds':-1},{'min-aug-batch':.5},{'min-shock-recovery':101}])assert.ok(sleeveOptionsError({...o,...patch}));
});

test('augmentation batches recheck control and shock before every purchase',()=>{
 let shock=0,calls=0;
 const ns={read:()=>'',getPlayer:()=>({money:100}),sleeve:{getSleeve:()=>({shock}),getSleevePurchasableAugs:()=>[{name:'A',cost:5},{name:'B',cost:5}],purchaseSleeveAug:()=>{calls++;shock=1;return true;}}};
 assert.equal(purchaseSleeveAugBatch(ns,0,['A','B'],100,0,()=>true,()=>false).spent,0);
 assert.equal(purchaseSleeveAugBatch(ns,0,['A','B'],100,0).spent,5);assert.equal(calls,1);
});

test('native sleeve guards reject paused, orphaned and maintenance commands',()=>{
 const ns={isRunning:()=>true,read:()=>''};assert.equal(sleeveControlAllowed(ns,1,'sleeve.js'),true);
 assert.equal(sleeveControlAllowed({...ns,isRunning:()=>false},1,'sleeve.js'),false);
 assert.equal(sleeveControlAllowed({...ns,read:()=> 'true'},1,'sleeve.js'),false);
 assert.equal(sleeveControlAllowed({...ns,read:f=>f.includes('maintenance')?JSON.stringify({ownerPid:2,expiresAt:Date.now()+60000}):''},1,'sleeve.js'),false);
});

test('expansion checks persistent pauses even when called without its main loop',()=>{
 assert.deepEqual(expandSleeves({getResetInfo:()=>({currentNode:10}),read:f=>f.includes('paused/')?'true':''}),{available:false,bought:0,upgraded:0});
});

test('queued sleeve task assignment rechecks pause inside its native worker',async()=>{
 const source=await readFile(new URL('../sleeve.js',import.meta.url),'utf8');let calls=0;
 const ns={pid:1,read:f=>f.includes('paused/')?'true':'',isRunning:()=>true,sleeve:{setToCommitCrime:()=>{calls++;return true;}}};
 const context={sleeveControlAllowed,achievementActionAllowed:()=>true,log:()=>{},getNsDataThroughFile:async(ns,expression,file,args)=>{assert.ok(args.every(a=>['number','string','boolean'].includes(typeof a)));ns.args=args;return vm.runInNewContext(expression,{ns});}};
 vm.runInNewContext(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export async function','async function').replaceAll('export function','function')+';task=[];lastRerollTime=[];workByFaction={};globalThis.assign=setSleeveTask;',context);
 assert.equal(await context.assign(ns,0,'crime Mug','ns.sleeve.setToCommitCrime(ns.args[0],ns.args[1])',[0,'Mug']),false);assert.equal(calls,0);
});

test('training cap uses BitNode time and disabled augmentation modes skip purchases',async()=>{
 const source=await readFile(new URL('../sleeve.js',import.meta.url),'utf8');assert.match(source,/Date.now\(\) - reset.lastNodeReset/);
 assert.match(source,/sleeve.shock == 0 && !reset.bitNodeOptions\?\.disableSleeveExpAndAugmentation/);
 assert.match(source,/if\(receipt.purchased.length\)lastPurchaseTime/);assert.match(source,/actualTask:currentTasks\[i\]/);
});


test('sleeve augmentation planning respects current shared allowances and spending epochs',()=>{
 const plan={epoch:2,reset:5,ownerPid:1,expiresAt:Date.now()+60000,allowances:{sleeves:195e6}},files={'tasks/spending-plan.json':JSON.stringify(plan),'tasks/spending-usage.json':JSON.stringify({epoch:2,spent:{sleeves:50e6}})};
 const ns={read:f=>files[f]||'',isRunning:()=>true,getResetInfo:()=>({lastAugReset:5})};
 assert.equal(sleeveAugSpendingBudget(ns,550e6),145e6);
 files['tasks/spending-usage.json']=JSON.stringify({epoch:1,spent:{sleeves:195e6}});assert.equal(sleeveAugSpendingBudget(ns,550e6),195e6);
 assert.equal(sleeveAugSpendingBudget({...ns,isRunning:()=>false},550e6),550e6);
});

test('sleeve purchase diagnostics distinguish allocator deferrals from native rejections',()=>{
 const ns={read:()=>'',getPlayer:()=>({money:1e9}),sleeve:{getSleeve:()=>({shock:0}),getSleevePurchasableAugs:()=>[{name:'A',cost:550e6}],purchaseSleeveAug:()=>false}};
 const deferred=purchaseSleeveAugBatch(ns,6,['A'],600e6,0,()=>false,()=>true,true);
 assert.equal(deferred.spent,0);assert.match(deferred.skipped[0].reason,/shared spending allowance/);
 const rejected=purchaseSleeveAugBatch(ns,6,['A'],600e6,0,()=>true,()=>true,true);assert.equal(rejected.skipped[0].reason,'native purchase rejected');
});


test('Bladeburner support fills only a useful shortfall with healthy synchronized sleeves',()=>{
 const ready=[sleeve(),sleeve({shock:1}),sleeve({sync:99}),sleeve(),sleeve()];
 assert.deepEqual(sleeveBladeburnerSupport(ready,[],{state:'needs-recruitment',required:5,available:3}),[0,3]);
});

test('Bladeburner support retains existing sleeves and subtracts human team members',()=>{
 const ready=Array.from({length:5},()=>sleeve()),actual=[null,null,{type:'SUPPORT'},null,{type:'SUPPORT'}];
 assert.deepEqual(sleeveBladeburnerSupport(ready,actual,{state:'ready',required:4,available:5}),[2]);
 assert.deepEqual(sleeveBladeburnerSupport(ready,actual,{state:'ready',required:3,available:5}),[]);
});

test('active Black Ops keep existing healthy support without assigning unnecessary extras',()=>{
 const ready=[sleeve(),sleeve(),sleeve({shock:2})],actual=[null,{type:'SUPPORT'},{type:'SUPPORT'}];
 assert.deepEqual(sleeveBladeburnerSupport(ready,actual,{state:'protected-black-op'}),[1]);
});

test('missing or unusable Bladeburner plans never reserve support sleeves',()=>{
 for(const plan of [null,{state:'observing'},{state:'needs-recruitment',required:NaN,available:0}])
  assert.deepEqual(sleeveBladeburnerSupport([sleeve()],[],plan),[]);
});

test('sleeve priority retains recovery and explicit overrides before urgent team support',async()=>{
 const source=await readFile(new URL('../sleeve.js',import.meta.url),'utf8'),pick=source.slice(source.indexOf('async function pickSleeveTask'));
 assert.ok(pick.indexOf('if (sleeve.sync < 100)')<pick.indexOf('bladeburnerSupportSleeves.has(i)'));
 assert.ok(pick.indexOf('if (options.crime)')<pick.indexOf('bladeburnerSupportSleeves.has(i)'));
 assert.ok(pick.indexOf('bladeburnerSupportSleeves.has(i)')<pick.indexOf('if (canTrain)'));
 assert.match(source,/getActionEstimatedSuccessChance\("Contracts",c,i\)/);
 assert.match(source,/bladeburnerContractChances\[i\]\?\.\[contractName\]/);
 assert.match(source,/6 in ownedSourceFiles/);assert.doesNotMatch(source,/Player chance is too low/);
});


test('new Bladeburner support prefers spare sleeves before faction workers',()=>{
 assert.deepEqual(sleeveBladeburnerSupport([sleeve(),sleeve()],[{type:'FACTION'},{type:'INFILTRATE'}],{state:'needs-recruitment',required:1,available:0}),[1]);
});
