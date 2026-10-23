import {captureAugmentationEconomics,augmentationEconomicsChange,invalidateAugmentationFunding} from '../augmentation-economics-policy.js';
import {captureAugmentationOwnership} from '../augmentation-ownership-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {factionForcedJoins,factionControlAllowed,factionPurchaseBatch} from '../faction-policy.js';

test('default forced invitations include Covenant and flat gang faction names',()=>{
 assert.deepEqual(factionForcedJoins(null,10,'',false,0),['The Covenant']);
 const names=factionForcedJoins(null,2,'',true,-54000);assert.equal(names.length,5);assert.ok(names.includes('Slum Snakes'));assert.ok(!names.includes('The Black Hand'));
 assert.deepEqual(factionForcedJoins([],10,'',true,-54000),[]);
 assert.deepEqual(factionForcedJoins('The_Covenant',1,'',false,0),['The Covenant']);
 assert.deepEqual(factionForcedJoins(null,2,'Slum Snakes',true,-54000),[]);
});

test('native focus guards reject pause, orphan, maintenance, other activities and protected work',()=>{
 const make=(values={},work=null,alive=true)=>({read:f=>values[f]||'',isRunning:()=>alive,currentWork:()=>work});
 assert.equal(factionControlAllowed(make(),1,'work-for-factions.js',true),true);
 assert.equal(factionControlAllowed(make({},null,false),1,'work-for-factions.js',true),false);
 assert.equal(factionControlAllowed(make({'remote-control/paused/work-for-factions.js.txt':'true'}),1,'work-for-factions.js',true),false);
 for(const file of ['tasks/activity-lock.json','tasks/automation-maintenance.json'])assert.equal(factionControlAllowed(make({[file]:JSON.stringify({ownerPid:2,expiresAt:200})}),1,'work-for-factions.js',true,100),false);
 for(const type of ['GRAFTING','CREATE_PROGRAM'])assert.equal(factionControlAllowed(make({},{type}),1,'work-for-factions.js',true),false);
 assert.equal(factionControlAllowed(make({},{type:'GRAFTING'}),1,'work-for-factions.js'),true);
});

function market(){let money=1000,rep=80,prices=[400,800],bought=[],donated=[];return {
 api:{player:()=>({money,mults:{faction_rep:2}}),rep:()=>rep,donate:(f,a)=>{donated.push(a);money-=a;return true;},price:()=>prices.shift(),buy:(f,a)=>{bought.push(a);money-=400;return true;}},bought,donated};}

test('augmentation purchases check each fresh price and preserve cash reserves',()=>{
 const m=market();assert.equal(factionPurchaseBatch(m.api,[{augmentation:'a'},{augmentation:'b'}],()=>true,()=>300),1);assert.deepEqual(m.bought,['a']);
 const stopped=market();assert.equal(factionPurchaseBatch(stopped.api,[{augmentation:'a'}],()=>false,()=>0),0);
});

test('augmentation purchases and donations reject malformed reserves and player cash',()=>{
 for(const donations of [false,true])for(const reserve of ['corrupt',NaN,Infinity,-1]){
  const m=market();
  assert.equal(factionPurchaseBatch(m.api,[{faction:'a',augmentation:'a',targetRep:80.001,repDonation:500}],()=>true,()=>reserve,donations),0);
  assert.deepEqual(m.bought,[]);assert.deepEqual(m.donated,[]);
 }
 for(const donations of [false,true])for(const cash of [NaN,Infinity,-1,undefined]){
  const m=market();m.api.player=()=>({money:cash,mults:{faction_rep:2}});
  assert.equal(factionPurchaseBatch(m.api,[{faction:'a',augmentation:'a',targetRep:80.001,repDonation:500}],()=>true,()=>0,donations),0);
  assert.deepEqual(m.bought,[]);assert.deepEqual(m.donated,[]);
 }
});

test('augmentation reserves accept empty files and numeric text, and recheck between purchases',()=>{
 const blank=market();assert.equal(factionPurchaseBatch(blank.api,[{augmentation:'a'}],()=>true,()=>''),1);
 const text=market();assert.equal(factionPurchaseBatch(text.api,[{augmentation:'a'}],()=>true,()=> '700'),0);
 const m=market();let calls=0;
 assert.equal(factionPurchaseBatch(m.api,[{augmentation:'a'},{augmentation:'b'}],()=>true,()=>++calls===1?'0':'corrupt'),1);
 assert.deepEqual(m.bought,['a']);
});

test('donations shrink with fresh reputation and skip zero gains or insufficient reserves',()=>{
 const m=market();const orders=[{faction:'a',targetRep:80.001,repDonation:1000}];
 assert.equal(factionPurchaseBatch(m.api,orders,()=>true,()=>0,true,1),1);assert.ok(m.donated[0]<=501);
 const blocked=market();assert.equal(factionPurchaseBatch(blocked.api,orders,()=>true,()=>900,true),0);
 const zero=market();assert.equal(factionPurchaseBatch(zero.api,orders,()=>true,()=>0,true,0),0);assert.deepEqual(zero.donated,[]);
 const done=market();assert.equal(factionPurchaseBatch(done.api,[{faction:'a',targetRep:75,repDonation:1000}],()=>true,()=>0,true),1);assert.deepEqual(done.donated,[]);
});

function load(source,context,append){vm.runInNewContext(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?$/gm,'').replaceAll('export async function','async function').replaceAll('export function','function')+append,context);}

test('serialized faction spending workers recheck reserve and parent ownership',async()=>{
 const source=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8'),m=market();
 const ns={pid:1,getResetInfo:()=>({lastAugReset:1,lastNodeReset:1,ownedAugs:{}}),getFavorToDonate:()=>150,isRunning:()=>true,read:f=>f==='reserve.txt'?'700':'',getPlayer:m.api.player,singularity:{getOwnedAugmentations:()=>[],getAugmentationPrice:m.api.price,purchaseAugmentation:m.api.buy}};
 const context={captureAugmentationOwnership,captureAugmentationEconomics,augmentationEconomicsChange,factionControlAllowed,factionPurchaseBatch,achievementActionAllowed:()=>true,getNsDataThroughFile:async(ns,expression,file,args)=>{assert.ok(args.every(a=>['number','boolean','string'].includes(typeof a)));ns.args=args;return vm.runInNewContext(expression,{ns});}};
 context.ns=ns;load(source,context,';ownershipSnapshot=captureAugmentationOwnership(ns);economicsSnapshot=captureAugmentationEconomics(ns,{augmentations:[],factions:[]});options={};bitNodeMults={FactionWorkRepGain:1};globalThis.execute=executeFactionPurchases;');
 assert.equal(await context.execute(ns,[{faction:'a',augmentation:'a'}]),0);assert.deepEqual(m.bought,[]);
});

test('serialized faction work cannot replace a graft that starts before execution',async()=>{
 const source=await readFile(new URL('../work-for-factions.js',import.meta.url),'utf8');let calls=0;
 const ns={pid:1,getScriptName:()=> 'work-for-factions.js',read:()=>'',isRunning:()=>true,singularity:{getCurrentWork:()=>({type:'GRAFTING'}),workForFaction:()=>{calls++;return true;}}};
 const context={factionControlAllowed,getNsDataThroughFile:async(ns,expression,file,args)=>{ns.args=args;return vm.runInNewContext(expression,{ns});}};
 load(source,context,';globalThis.command=factionWorkCommand;');
 assert.equal(await context.command(ns,'ns.singularity.workForFaction(ns.args[0],ns.args[1],ns.args[2])',['a','hacking',false]),false);assert.equal(calls,0);
});
