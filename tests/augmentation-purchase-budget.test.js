import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {augmentationPurchaseBudget,extendNeuroFluxOrder,optimizeAugmentationOrder} from '../faction-policy.js';
const aug=(name,price,prereqs=[])=>({name,price,prereqs,getFromJoined:()=> 'Faction'});
const bill=items=>items.reduce((sum,a,i)=>sum+a.price*1.9**i,0);
test('spendable augmentation budget subtracts reserves once and fails closed on malformed inputs',()=>{
 assert.equal(augmentationPurchaseBudget(1000,200,'300'),900);
 assert.equal(augmentationPurchaseBudget(100,0,'200'),0);
 assert.equal(augmentationPurchaseBudget(100,0,''),100);
 for(const reserve of ['broken',Infinity,NaN,-1])assert.equal(augmentationPurchaseBudget(100,0,reserve),0);
 for(const [cash,stocks] of [[NaN,0],[100,Infinity],[-1,0],[100,-1]])assert.equal(augmentationPurchaseBudget(cash,stocks,0),0);
});
test('actual basket planner drops unaffordable items using reserved cash before optional NeuroFlux',async()=>{
 const source=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');
 const start=source.indexOf('async function managePurchaseableAugs('),end=source.indexOf('\n};',start)+3;
 const items=[aug('A',600),aug('B',100)];
 const context={augmentationPurchaseBudget,options:{'neuroflux-disabled':true},getPlayerInfo:async()=>({money:1000,factions:[]}),
 getReqDonationForAug:()=>0,augCountMult:1.9,strNF:'NeuroFlux Governor',stockValue:0,priorityAugs:[],augmentationData:{},readNodeRoutePlan:()=>({selected:'hacking'}),bitNode:1,bitNodeMults:{},ownedAugmentations:[],
 simulatedOwnedAugmentations:[],ownershipSnapshot:{},filterMissingPrereqs:(_ns,a)=>a,computeCosts:a=>[{},0,bill(a)],
 readAugmentationReputationContext:()=>null,readCombatGrowthContext:()=>null,selectAugmentationBasketDrop:a=>a.at(-1),previewAugmentationDonationCost:()=>0,
 estimateMixedAugmentationWait:()=>null,sortAugs:(_ns,a)=>a,getCostString:String,log:()=>{},augmentationCashReserve:()=>null,
 manageFilteredSubset:()=>{},numAugsAwaitingInstall:0};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 await context.managePurchaseableAugs({read:()=> '300'},[],items);
 assert.deepEqual(Array.from(context.purchaseableAugs,a=>a.name),['A']);
 assert.ok(bill(context.purchaseableAugs)<=700);
});
test('new NeuroFlux levels can reorder ordinary augmentations and make a formerly rejected basket affordable',()=>{
 const ordinary=aug('Ordinary',105),first=aug('NeuroFlux Governor',100),next=aug('NeuroFlux Governor',114);
 const committed=[ordinary,first],ordered=extendNeuroFluxOrder(committed,next);
 assert.equal(bill([...committed,next]),706.54);assert.ok(Math.abs(bill(ordered)-695.65)<1e-8);
 assert.ok(bill(ordered)<=700);assert.ok(bill([...committed,next])>700);
 assert.deepEqual(ordered,[first,next,ordinary]);assert.deepEqual(committed,[ordinary,first]);
});
test('NeuroFlux reorder retains prerequisites, object identity and pinned faction choices',()=>{
 const root=aug('Root',1),child=aug('Child',105,['Root']),first=aug('NeuroFlux Governor',100),next=aug('NeuroFlux Governor',114);
 first.getFromJoined=()=> 'A';next.getFromJoined=()=> 'B';
 const result=extendNeuroFluxOrder([root,child,first],next);
 assert.ok(result.indexOf(root)<result.indexOf(child));assert.ok(result.indexOf(first)<result.indexOf(next));
 assert.deepEqual(result.filter(a=>a.name==='NeuroFlux Governor').map(a=>a.getFromJoined()),['A','B']);
 assert.ok(bill(result)<=bill([root,child,first,next]));
});

