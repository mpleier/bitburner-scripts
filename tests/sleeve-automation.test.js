import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bestSleeveCrime,sleeveCrimeChance,bestFactionWork,sleeveRepAssignments,purchaseSleeveAugBatch,sleeveTaskMatches,maximumSleeves,sleeveReserves } from '../sleeve-policy.js';
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
