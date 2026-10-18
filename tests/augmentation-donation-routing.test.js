import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectAugmentationBasketDrop,augmentationDonationTopUp} from '../faction-policy.js';

const source=await readFile(new URL('../faction-manager.js',import.meta.url),'utf8');
const start=source.indexOf('function computeAugsRepReqDonationByFaction(');
const end=source.indexOf('/** @param {NS} ns',start);
class AugmentationData {
 constructor(name,reputation,provider){this.name=name;this.reputation=reputation;this.getFromJoined=()=>this.purchaseFaction||provider;}
}
const faction=(name,reputation,augmentations,extra={})=>({name,reputation,augmentations,joined:true,donationsUnlocked:true,...extra});
function plan(factions,items,replan=true){
 const data=Object.fromEntries(factions.map(f=>[f.name,f]));
 const donation=(a,f)=>Math.max(0,a.reputation-(typeof f==='string'?data[f]:f).reputation);
 const run=Function('AugmentationData','factionData','getReqDonationForAug','log','_ns',source.slice(start,end)+'return computeAugsRepReqDonationByFaction;');
 return run(AugmentationData,data,donation,()=>{},{ })(items,replan);
}

test('existing reputation is preserved even when an earlier donation faction also offers the augment',()=>{
 const items=[new AugmentationData('Seed',100,'Donor'),new AugmentationData('Free augment',1000,'Free')];
 assert.deepEqual(plan([faction('Donor',0,['Seed','Free augment']),faction('Free',1000,['Free augment'])],items),{Donor:100});
 assert.equal(items[1].getFromJoined(),'Free');
});

test('donations compare reputation gaps separately for each faction',()=>{
 const items=[new AugmentationData('Seed',100,'Low rep'),new AugmentationData('Target',1000,'High rep')];
 assert.deepEqual(plan([faction('Low rep',0,['Seed','Target']),faction('High rep',950,['Target'])],items),{'Low rep':100,'High rep':50});
 assert.equal(items[1].getFromJoined(),'High rep');
});

test('routing chooses the cheapest incremental provider instead of the first cheaper provider',()=>{
 const items=[new AugmentationData('A seed',10,'A'),new AugmentationData('B seed',90,'B'),new AugmentationData('Target',100,'C')];
 assert.deepEqual(plan([faction('A',0,['A seed','Target']),faction('B',0,['B seed','Target']),faction('C',0,['Target'])],items),{A:10,B:100});
 assert.equal(items[2].getFromJoined(),'B');
});

test('fully committed reputation has zero marginal cost and ties preserve the current provider',()=>{
 const items=[new AugmentationData('A seed',100,'A'),new AugmentationData('B seed',100,'B'),new AugmentationData('Target',50,'B')];
 const factions=[faction('A',0,['A seed','Target']),faction('B',0,['B seed','Target'])];
 assert.deepEqual(plan(factions,items),{A:100,B:100});assert.equal(items[2].getFromJoined(),'B');
 assert.deepEqual(plan(factions,items),{A:100,B:100});
});

test('routing rejects unjoined, donation-locked, and non-offering alternative providers',()=>{
 for(const extra of [{joined:false},{donationsUnlocked:false},{augmentations:['Seed']}]){
  const items=[new AugmentationData('Seed',100,'A'),new AugmentationData('Target',150,'B')];
  plan([faction('A',0,['Seed','Target'],extra),faction('B',0,['Target'])],items);
  assert.equal(items[1].getFromJoined(),'B');
 }
});

test('free reputation remains usable in factions that never permit donations',()=>{
 const items=[new AugmentationData('Target',10,'Bladeburners')];
 assert.deepEqual(plan([faction('Bladeburners',100,['Target'],{donationsUnlocked:false})],items),{});
 assert.equal(items[0].getFromJoined(),'Bladeburners');
});

test('provider assignments are rebuilt after removing the augmentation that funded a shared donation',()=>{
 const factions=[faction('A',90,['Target']),faction('B',0,['Seed','Target'])];
 const seed=new AugmentationData('Seed',100,'B'),target=new AugmentationData('Target',100,'A');
 assert.deepEqual(plan(factions,[seed,target]),{B:100});assert.equal(target.getFromJoined(),'B');
 assert.deepEqual(plan(factions,[target]),{A:10});assert.equal(target.getFromJoined(),'A');
 assert.deepEqual(plan(factions,[seed,target]),{B:100});assert.equal(target.getFromJoined(),'B');
 assert.deepEqual(plan(factions,[target]),{A:10});
});

test('replanning preserves the original selector and responds to newly available reputation',()=>{
 const factions=[faction('A',90,['Target']),faction('B',0,['Seed','Target'])];
 const seed=new AugmentationData('Seed',100,'B'),target=new AugmentationData('Target',100,'A'),selector=target.getFromJoined;
 plan(factions,[seed,target]);assert.equal(target.getFromJoined,selector);
 factions[0].reputation=100;
 assert.deepEqual(plan(factions,[seed,target]),{B:100});assert.equal(target.getFromJoined(),'A');
});

test('replanning leaves deliberately pinned NeuroFlux provider selectors intact',()=>{
 const target=new AugmentationData('NeuroFlux Governor',100,'B');
 target.getFromJoined=()=> 'B';const selector=target.getFromJoined;
 assert.deepEqual(plan([faction('A',90,['NeuroFlux Governor']),faction('B',0,['NeuroFlux Governor'])],[target]),{B:100});
 assert.equal(target.getFromJoined,selector);assert.equal(target.getFromJoined(),'B');
});

test('ordinary runtime providers consult the current basket assignment without replacing the selector',()=>{
 const start=source.indexOf('    getFromJoined() {'),end=source.indexOf('    /** @returns {string} A formatted row',start);
 const method=Function('strNF',`return ({${source.slice(start,end)}}).getFromJoined;`)('NeuroFlux Governor');
 const a={name:'Target',reputation:100,purchaseFaction:'Shared',joinedFactionsWithAug:()=>[{name:'Free',reputation:100}]};
 assert.equal(method.call(a),'Shared');delete a.purchaseFaction;assert.equal(method.call(a),'Free');
});

test('final cost reporting preserves committed ordinary and pinned NeuroFlux providers',()=>{
 const factions=[faction('A',90,['Target']),faction('B',0,['Seed','Target','NeuroFlux Governor'])];
 const seed=new AugmentationData('Seed',100,'B'),target=new AugmentationData('Target',100,'A');
 plan(factions,[seed,target]);assert.equal(target.getFromJoined(),'B');
 assert.deepEqual(plan(factions,[target],false),{B:100});assert.equal(target.getFromJoined(),'B');
 const nf=new AugmentationData('NeuroFlux Governor',50,'B');nf.getFromJoined=()=> 'B';
 // Ordinary A would be cheaper if reporting were to rebuild this basket.
 assert.deepEqual(plan(factions,[nf,target],false),{B:100});assert.equal(target.getFromJoined(),'B');
 assert.equal(nf.getFromJoined(),'B');
 assert.deepEqual(plan(factions,[target]),{A:10});assert.equal(target.getFromJoined(),'A');
});

test('final runtime summary requests cost reporting without provider replanning',()=>{
 assert.ok(source.includes('computeCosts(subsetSorted, reorder)'));
 assert.ok(source.includes('purchaseableAugs, true, false, false)'));
});

function previewPlanner(factions,{fail=false}={}){
 const data=Object.fromEntries(factions.map(f=>[f.name,f])),logs=[];
 const donation=(a,f)=>{
  if(fail&&a.name==='Broken')throw Error('donation lookup failed');
  return Math.max(0,a.reputation-(typeof f==='string'?data[f]:f).reputation);
 };
 const run=Function('AugmentationData','factionData','getReqDonationForAug','log','_ns',source.slice(start,end)+'return previewAugmentationDonationCost;');
 return {preview:run(AugmentationData,data,donation,(...args)=>logs.push(args),{}),logs};
}

test('candidate costs rebuild faction choices without changing any committed provider',()=>{
 const factions=[faction('A',90,['Target']),faction('B',0,['Seed','Target'])];
 const seed=new AugmentationData('Seed',100,'B'),target=new AugmentationData('Target',100,'A');
 plan(factions,[seed,target]);assert.equal(target.getFromJoined(),'B');
 const {preview,logs}=previewPlanner(factions);
 assert.equal(preview([seed,target]),100);assert.equal(preview([target]),10);
 assert.equal(target.getFromJoined(),'B');assert.equal(Object.hasOwn(seed,'purchaseFaction'),false);
 assert.deepEqual(logs,[]);assert.equal(preview([]),0);
});

test('budget cuts include donation savings unlocked by a different retained provider',()=>{
 const factions=[faction('A',90,['Target']),faction('B',0,['Seed','Target']),faction('C',0,['Other'])];
 const seed=new AugmentationData('Seed',100,'B'),target=new AugmentationData('Target',100,'A'),other=new AugmentationData('Other',50,'C');
 for(const a of [seed,target,other])Object.assign(a,{price:0,stats:{hacking:1.1},prereqs:[]});
 plan(factions,[seed,target,other]);const {preview}=previewPlanner(factions);
 const cut=selectAugmentationBasketDrop([seed,target,other],{priority:['Target'],donationCost:preview});
 assert.equal(cut.name,'Seed');assert.equal(cut.savings,90);
 assert.equal(target.getFromJoined(),'B');assert.equal(other.getFromJoined(),'C');
});

test('preview failures restore provider presence and exact property descriptors',()=>{
 const factions=[faction('A',90,['Target']),faction('B',0,['Seed','Target','Broken'])];
 const seed=new AugmentationData('Seed',100,'B'),target=new AugmentationData('Target',100,'A'),broken=new AugmentationData('Broken',200,'B');
 Object.defineProperty(target,'purchaseFaction',{value:'B',writable:true,enumerable:false,configurable:true});
 broken.purchaseFaction=undefined;
 const items=[seed,target,broken],before=items.map(a=>Object.getOwnPropertyDescriptor(a,'purchaseFaction'));
 const {preview}=previewPlanner(factions,{fail:true});
 assert.throws(()=>preview(items),/donation lookup failed/);
 assert.deepEqual(items.map(a=>Object.getOwnPropertyDescriptor(a,'purchaseFaction')),before);
 assert.equal(target.getFromJoined(),'B');
});

test('runtime candidate scoring uses the execution planner instead of frozen donation requirements',()=>{
 assert.ok(source.includes('countWeight,donationCost:previewAugmentationDonationCost'));
 assert.ok(!source.includes('const donationRequirements=new Map'));
});


test('future target donations charge only the increase over committed faction reputation',()=>{
 assert.equal(augmentationDonationTopUp([{faction:'A',requiredDonation:150}],{A:100}),50);
 assert.equal(augmentationDonationTopUp([{faction:'A',requiredDonation:50}],{A:100}),0);
 assert.equal(augmentationDonationTopUp([{faction:'A',requiredDonation:150}],{B:100}),150);
});

test('future target donation providers compete on incremental rather than standalone cost',()=>{
 const providers=[{faction:'A',requiredDonation:90},{faction:'B',requiredDonation:100}];
 const committed={B:95},before=JSON.stringify([providers,committed]);
 assert.equal(augmentationDonationTopUp(providers,committed),5);
 assert.equal(JSON.stringify([providers,committed]),before);
});

test('future target donation estimates retain free reputation but reject unavailable funding',()=>{
 assert.equal(augmentationDonationTopUp([{faction:'Locked',requiredDonation:null}]),null);
 assert.equal(augmentationDonationTopUp([{faction:'Free',requiredDonation:0}]),0);
 assert.equal(augmentationDonationTopUp([]),null);
 for(const requiredDonation of [null,undefined,Infinity,NaN,-1])
  assert.equal(augmentationDonationTopUp([{faction:'Bad',requiredDonation}]),null);
 for(const amount of [NaN,-1,Infinity])
  assert.equal(augmentationDonationTopUp([{faction:'Bad',requiredDonation:10}],{Bad:amount}),null);
});

test('runtime future target donations use eligible providers and committed basket credits',()=>{
 assert.ok(source.includes('donationCost+=augmentationDonationTopUp([{faction:choice.faction,requiredDonation:choice.totalDonation}],credits)'));
 assert.ok(source.includes("donationCost:f.donationsUnlocked&&!options['disable-donations']?getReqDonationForAug(item,f.name):null"));
 assert.ok(source.includes('const credits={...futureDonationPlan}'));
});
