import {extendNeuroFluxOrder} from '../faction-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {augmentationCashReserve} from '../spending-policy.js';
import {futureAugmentationBasketCost} from '../faction-policy.js';
import {sharedAugmentationDonationCost,chooseNeuroFluxFaction,selectAugmentationBasketDrop} from '../faction-policy.js';

test('NeuroFlux consumes existing reputation before donations and switches provider as requirements grow',()=>{
 const factions=[{name:'Free',rep:100,donationCost:null},{name:'Donor',rep:0,donationCost:50}];
 assert.equal(chooseNeuroFluxFaction(factions,100).faction,'Free');
 assert.equal(chooseNeuroFluxFaction(factions,114).faction,'Donor');
 assert.equal(chooseNeuroFluxFaction(factions,114).additionalDonation,50);
});
test('NeuroFlux accounts for committed donations without paying them twice',()=>{
 const factions=[{name:'A',rep:0,donationCost:100},{name:'B',rep:0,donationCost:40}];
 const c=chooseNeuroFluxFaction(factions,50,{A:90});assert.equal(c.faction,'A');assert.equal(c.totalDonation,100);assert.equal(c.additionalDonation,10);
 assert.equal(chooseNeuroFluxFaction([{name:'A',rep:0,donationCost:100},{name:'Free',rep:50,donationCost:null}],50,{A:100}).faction,'Free');
 assert.equal(chooseNeuroFluxFaction([{name:'Unknown',rep:0,donationCost:null}],50),null);
 assert.equal(chooseNeuroFluxFaction([{name:'Broken',rep:0,donationCost:Infinity}],50),null);
 assert.equal(chooseNeuroFluxFaction(factions,NaN),null);
});
const aug=(name,price,stats={},prereqs=[])=>({name,price,stats,prereqs});
test('basket cuts preserve value for the selected route rather than automatically dropping the highest price',()=>{
 const items=[aug('Combat',100,{strength:2}),aug('Hack',90,{hacking:2})];
 assert.equal(selectAugmentationBasketDrop(items,{route:'bladeburner'}).name,'Hack');
 assert.equal(selectAugmentationBasketDrop(items,{route:'hacking'}).name,'Combat');
 assert.equal(items.length,2);
});
test('basket cuts count all dependent losses and preserve protected milestones',()=>{
 const items=[aug('Root',100),aug('Child',50,{hacking:10},['Root']),aug('Other',20,{hacking:1.01})];
 assert.equal(selectAugmentationBasketDrop(items).name,'Other');
 const protectedCut=selectAugmentationBasketDrop(items,{priority:['Child']});assert.equal(protectedCut.name,'Other');assert.ok(protectedCut.remaining.some(a=>a.name==='Root'));
 assert.equal(selectAugmentationBasketDrop(items,{priority:['Root','Child','Other']}),null);
});
test('count-building and zero-price baskets still yield finite progress',()=>{
 const items=[aug('Costly filler',100),aug('Cheap filler',1)];
 assert.equal(selectAugmentationBasketDrop(items,{countWeight:.05}).name,'Costly filler');
 assert.equal(selectAugmentationBasketDrop([aug('Free',0)]).name,'Free');
 assert.equal(selectAugmentationBasketDrop([]),null);
});
test('actual NF loop fixes a provider per level and charges cumulative donations once',async()=>{
 const source=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8');
 const start=source.indexOf('    while (nfPurchased < 200)'),end=source.indexOf('    log(ns, `With ${formatMoney(budget)}',start);
 const loop=source.slice(start,end);
 const factions=[{name:'Free',reputation:12,donationsUnlocked:false},{name:'Donor',reputation:0,donationsUnlocked:true}];
 const factionData=Object.fromEntries(factions.map(f=>[f.name,f]));
 const augNf={name:'NeuroFlux Governor',price:1,reputation:10,stats:{},prereqs:[],joinedFactionsWithAug:()=>factions};
 class AugmentationData{constructor(name,rep,price){this.name=name;this.displayName=name;this.price=price;}}
 const fn=Function('extendNeuroFluxOrder','chooseNeuroFluxFaction','factionData','augNf','AugmentationData','log','formatMoney','formatNumberShort','getCostString',`
  let ns={},options={},purchaseableAugs=[],purchaseFactionDonations={},budget=100,nfCountMult=1.14,augCountMult=1.9,nfAppendPosition=0;
  let nfPurchased=0,nextNfLevel=1,totalAugCost=0,totalRepCost=0,nextUpNf;
  const getTotalCost=items=>items.reduce((sum,a,i)=>sum+a.price*augCountMult**i,0);
  const getReqDonationForRep=(rep,f)=>Math.max(0,rep-f.reputation);
  `+loop+`return {providers:purchaseableAugs.map(a=>a.getFromJoined()),donations:purchaseFactionDonations,totalRepCost};`);
 const result=fn(extendNeuroFluxOrder,chooseNeuroFluxFaction,factionData,augNf,AugmentationData,()=>{},String,String,(a,b)=>a+b);
 assert.deepEqual(result.providers.slice(0,2),['Free','Free']);assert.ok(result.providers.slice(2).every(n=>n==='Donor'));assert.ok(result.providers.length>2);
 assert.equal(result.totalRepCost,result.donations.Donor);assert.ok(Math.abs(result.donations.Donor-10*1.14**(result.providers.length-1))<1e-9);
});
test('runtime trimming uses the selected route and pins NF clones to the chosen faction',async()=>{
 const s=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8');
 assert.ok(s.includes('const selectedRoute=readNodeRoutePlan(ns)?.selected'));
 assert.ok(s.includes('route:selectedRoute,multiplier:augCountMult,countWeight'));
 assert.ok(s.includes("countWeight=selectedRoute!=='bladeburner'"));
 assert.ok(s.includes('nfClone.getFromJoined=()=>choice.faction'));
 assert.ok(!s.includes('b.price - a.price)[0]'));
});

test('basket cuts include released donations and retain shared reputation costs',()=>{
 const a=aug('A',10,{hacking:1.1}),b=aug('B',9,{hacking:1.1}),c=aug('C',8,{hacking:1.1});
 const items=[a,b,c],requirements=new Map([[a,{faction:'Shared',amount:1000}],[b,{faction:'Shared',amount:100}],[c,{faction:'Other',amount:200}]]);
 const donationCost=list=>sharedAugmentationDonationCost(list,requirements);
 assert.equal(donationCost(items),1200);
 assert.equal(donationCost([a]),1000);
 assert.equal(donationCost([b,c]),300);
 assert.equal(selectAugmentationBasketDrop(items,{donationCost}).name,'A');
 assert.equal(donationCost(items),1200); // Rejected candidates never alter provider data.
 assert.throws(()=>donationCost([aug('Unknown',0)]),/donation requirement/);
});

test('donation-only cuts count prerequisite closures and protect shared priority donations',()=>{
 const root=aug('Root',0,{hacking:1.01}),child=aug('Child',0,{hacking:1.01},['Root']),other=aug('Other',0,{hacking:1.01});
 const requirements=new Map([[root,{faction:'Shared',amount:100}],[child,{faction:'Shared',amount:900}],[other,{faction:'Other',amount:1}]]);
 const donationCost=list=>sharedAugmentationDonationCost(list,requirements);
 const cut=selectAugmentationBasketDrop([root,child,other],{donationCost,priority:['Child']});
 assert.equal(cut.name,'Other');assert.equal(cut.savings,1);
 assert.equal(selectAugmentationBasketDrop([root,child,other],{donationCost}).name,'Child');
});

test('actual NF loop prices insertion and shifted ordinary purchases before accepting',async()=>{
 const source=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8');
 const start=source.indexOf('    while (nfPurchased < 200)'),end=source.indexOf('    log(ns, `With ${formatMoney(budget)}',start);
 const run=Function('extendNeuroFluxOrder','chooseNeuroFluxFaction','budget',`
  const ns={},options={},nfCountMult=1.14,augCountMult=1.9,nfAppendPosition=-1;
  const factionData={Free:{name:'Free',reputation:1e9,donationsUnlocked:false}};
  const augNf={name:'NeuroFlux Governor',price:50,reputation:10,stats:{},prereqs:[],joinedFactionsWithAug:()=>[factionData.Free]};
  let purchaseableAugs=[{name:'Expensive',price:100},{name:'Cheap',price:1}],purchaseFactionDonations={};
  class AugmentationData{constructor(name,rep,price){this.name=name;this.displayName=name;this.price=price;}}
  const getTotalCost=items=>items.reduce((sum,a,i)=>sum+a.price*augCountMult**i,0);
  let nfPurchased=0,nextNfLevel=1,totalAugCost=getTotalCost(purchaseableAugs),totalRepCost=0,nextUpNf;
  const log=()=>{},formatNumberShort=String,getCostString=(a,b)=>a+b;
  `+source.slice(start,end)+`return {nfPurchased,totalAugCost,actual:getTotalCost(purchaseableAugs),names:purchaseableAugs.map(a=>a.name)};`);
 const below=run(extendNeuroFluxOrder,chooseNeuroFluxFaction,198.60);assert.equal(below.nfPurchased,0);
 const one=run(extendNeuroFluxOrder,chooseNeuroFluxFaction,198.62);assert.equal(one.nfPurchased,1);
 assert.ok(Math.abs(one.totalAugCost-198.61)<1e-9);assert.equal(one.totalAugCost,one.actual);
 assert.deepEqual(one.names,['Expensive','NeuroFlux Governor','Cheap']);
 const more=run(extendNeuroFluxOrder,chooseNeuroFluxFaction,2000);assert.ok(more.nfPurchased>1);assert.equal(more.totalAugCost,more.actual);assert.ok(more.actual<=2000);
});


async function nfFundingGate(){
 const source=(await readFile(new URL('../faction-manager.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 const declaration=source.match(/    const neuroFluxFundingGoal=.*;/)[0];
 const start=source.indexOf("    if (options['neuroflux-disabled']) return;",source.indexOf('// NEXT STEP: Add as many NeuroFlux'));
 const end=source.indexOf('    const augNf =',start);
 assert.ok(start>0&&end>start);
 return Function('ns','options','priorityAugs','augmentationCashReserve','outputRows','append',
  "const strNF='NeuroFlux Governor';"+declaration+source.slice(start,end)+'append();');
}
function waitFixture(){
 const now=Date.now(),wait={schemaVersion:1,active:true,ownerPid:7,nodeReset:1,augReset:3,startedAt:now-1000,at:now,expiresAt:now+60000,
  plan:{name:'Valuable target',at:now,worthWaiting:true,deadline:now+60000,cashTarget:1000}};
 let processes=[{pid:7,filename:'autopilot.js'}];
 const ns={read:f=>f==='tasks/augmentation-wait-plan.json'?JSON.stringify(wait):'',getResetInfo:()=>({lastNodeReset:1,lastAugReset:3}),ps:()=>processes};
 return {wait,ns,setProcesses:p=>processes=p};
}

test('executed NF gate holds optional levels only during a fresh active augmentation funding wait',async()=>{
 const gate=await nfFundingGate(),f=waitFixture(),rows=[];let appended=0;
 gate(f.ns,{},[],augmentationCashReserve,rows,()=>appended++);
 assert.equal(appended,0);assert.ok(rows[0].includes('Valuable target'));
 f.wait.active=false;gate(f.ns,{},[],augmentationCashReserve,rows,()=>appended++);
 assert.equal(appended,1);
});

test('expired, stale, orphaned or foreign-reset waits cannot indefinitely suppress NeuroFlux',async()=>{
 const gate=await nfFundingGate();
 for(const patch of [{expiresAt:1},{at:Date.now()-120001},{augReset:2},{nodeReset:2},{active:false},{schemaVersion:0}]){
  const f=waitFixture();Object.assign(f.wait,patch);let appended=false;
  gate(f.ns,{},[],augmentationCashReserve,[],()=>appended=true);assert.equal(appended,true);
 }
 const f=waitFixture();f.setProcesses([]);let appended=false;
 gate(f.ns,{},[],augmentationCashReserve,[],()=>appended=true);assert.equal(appended,true);
});

test('explicit NF priority bypasses optional saving holds but the disable option still wins',async()=>{
 const gate=await nfFundingGate(),f=waitFixture();let appended=0;
 gate(f.ns,{},['NeuroFlux Governor'],augmentationCashReserve,[],()=>appended++);
 assert.equal(appended,1);
 gate(f.ns,{'neuroflux-disabled':true},['NeuroFlux Governor'],augmentationCashReserve,[],()=>appended++);
 assert.equal(appended,1);
});

test('unreadable or incomplete wait receipts preserve normal NeuroFlux planning',async()=>{
 const gate=await nfFundingGate(),f=waitFixture();let appended=0;
 gate({...f.ns,read:()=>'{broken'}, {},[],augmentationCashReserve,[],()=>appended++);
 f.wait.plan.cashTarget=null;gate(f.ns,{},[],augmentationCashReserve,[],()=>appended++);
 assert.equal(appended,2);
});

test('growing available cash cannot add optional NF to the selected future bill during the hold',async()=>{
 const gate=await nfFundingGate(),f=waitFixture();
 const ordinary=aug('Ordinary',10),target=aug('Valuable target',100),basket=[ordinary],queued=['NeuroFlux Governor'];
 const before=futureAugmentationBasketCost(basket,target),queuedBefore=[...queued];
 for(const extraLevels of [1,5,20])gate(f.ns,{},[],augmentationCashReserve,[],
  ()=>basket.push(...Array.from({length:extraLevels},(_,i)=>aug('NeuroFlux Governor',20*1.14**i))));
 assert.equal(futureAugmentationBasketCost(basket,target),before);
 assert.deepEqual(basket,[ordinary]);assert.deepEqual(queued,queuedBefore);
 const inflated=futureAugmentationBasketCost([ordinary,aug('NeuroFlux Governor',20)],target);
 assert.ok(inflated>before);
});

test('held NF planning still displays the full ordinary basket and the next desired augmentation',async()=>{
 const source=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8');
 assert.ok(source.includes("'Unique Affordable', purchaseableAugs, omitOptionalNeuroFlux"));
 assert.ok(source.includes('if (nextUpAug && omitOptionalNeuroFlux) outputRows.push(nextUpAug)'));
 assert.ok(source.indexOf('if(neuroFluxFundingGoal)')<source.indexOf('const augNf = augmentationData[strNF]'));
});
