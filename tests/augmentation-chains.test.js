import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {augmentationPrerequisiteChain,futureAugmentationBasketCost,chooseNeuroFluxFaction,augmentationDonationTopUp} from '../faction-policy.js';
import {progressionSpeed,estimateMixedAugmentationWait,pruneAugmentationDonationNeeds,deduplicateAugmentationRequirements} from '../progression-speed-policy.js';

const faction=(name,rep=0,donationsUnlocked=true)=>({name,reputation:rep,donationsUnlocked});
const aug=(name,prereqs=[],extra={})=>({name,prereqs,price:10,reputation:100,stats:{hacking:2},desired:true,joinedFactionsWithAug:()=>[faction('A')],...extra});
const catalog=(...items)=>Object.fromEntries(items.map(a=>[a.name,a]));

test('prerequisite closure deduplicates shared roots and excludes owned or ready gains',()=>{
 const data=catalog(aug('Root'),aug('A',['Root']),aug('B',['Root']),aug('Target',['A','B']));
 assert.deepEqual(augmentationPrerequisiteChain('Target',data).map(a=>a.name),['Root','A','B','Target']);
 assert.deepEqual(augmentationPrerequisiteChain('Target',data,{owned:['Root'],ready:['A']}).map(a=>a.name),['B','Target']);
 assert.equal(augmentationPrerequisiteChain('Target',data,{ready:['Target']}),null);
});

test('missing, cyclic, excluded and invalid prerequisite chains cannot delay installation',()=>{
 for(const data of [
  catalog(aug('Target',['Missing'])),
  catalog(aug('Target',['A']),aug('A',['Target'])),
  catalog(aug('Target',['Bad']),aug('Bad',[],{price:NaN})),
  catalog(aug('Target',['NeuroFlux Governor']),aug('NeuroFlux Governor'))
 ])assert.equal(augmentationPrerequisiteChain('Target',data),null);
 const data=catalog(aug('Target',['Root']),aug('Root'));
 assert.equal(augmentationPrerequisiteChain('Target',data,{allowed:a=>a.name!=='Root'}),null);
});

const source=readFileSync(new URL('../faction-manager.js',import.meta.url),'utf8');
const expression=source.match(/targets:(Object.values[\s\S]*?\.filter\(Boolean\))\};/)[1];
const build=Function('augmentationData','readyAugs','purchaseableAugs','simulatedOwnedAugmentations','purchaseFactionDonations','omitAugs','options',
 'preNeuroFluxPlan','augsAwaitingInstall','augmentationPrerequisiteChain','futureAugmentationBasketCost','chooseNeuroFluxFaction','augmentationDonationTopUp','getReqDonationForAug',
 "const strNF='NeuroFlux Governor',readySet=new Set(readyAugs),priorityAugs=options.priorityAugs||[],augCountMult=1.9;"+
 source.slice(source.indexOf('        const preserveOptionalNeuroFlux='),source.indexOf('        let resetEconomics='))+'return '+expression);
function targets(data,{ready=[],items=[],owned=[],donations={},omit=[],options={},preNF=null,queued=[]}={}){
 return build(data,ready,items,owned,donations,omit,options,preNF,[...queued,...ready.filter(name=>!items.some(a=>a.name===name))],augmentationPrerequisiteChain,futureAugmentationBasketCost,chooseNeuroFluxFaction,augmentationDonationTopUp,
  (item,name)=>Math.max(0,item.reputation-item.joinedFactionsWithAug().find(f=>f.name===name).reputation));
}

test('executed snapshot includes all chain prices, compounded gains and shared donation top-ups',()=>{
 const root=aug('Root',[],{desired:false}),target=aug('Target',['Root'],{price:100,reputation:150});
 const [plan]=targets(catalog(root,target),{donations:{A:50}});
 assert.deepEqual(plan.chain,['Root','Target']);assert.equal(plan.stats.hacking,4);
 assert.equal(plan.cost,futureAugmentationBasketCost([root],target,{donations:50}));
 assert.equal(plan.donationCost,100); // 150 maximum, less the already committed 50.
 assert.equal(plan.requirements.length,2);assert.equal(plan.directCost,null);
 assert.equal(Object.hasOwn(root,'purchaseFaction'),false);
});

test('executed snapshot excludes inaccessible or omitted prerequisites and preserves ready pricing',()=>{
 const root=aug('Root',[],{desired:false}),target=aug('Target',['Root']);
 assert.deepEqual(targets(catalog(root,target),{omit:['Root']}),[]);
 assert.deepEqual(targets(catalog({...root,joinedFactionsWithAug:()=>[]},target)),[]);
 const [plan]=targets(catalog(root,target),{ready:['Root'],items:[root]});
 assert.deepEqual(plan.chain,['Target']);assert.equal(plan.stats.hacking,2);
 assert.equal(plan.cost,futureAugmentationBasketCost([root],target));
});

test('executed chain donations preserve free providers and reject disabled or locked donations',()=>{
 const root=aug('Root',[],{desired:false}),target=aug('Target',['Root']);
 const data=catalog(root,target);
 assert.equal(targets(data,{options:{'disable-donations':true}})[0].donationCost,null);
 root.joinedFactionsWithAug=target.joinedFactionsWithAug=()=>[faction('A',200,false)];
 assert.equal(targets(data,{options:{'disable-donations':true}})[0].donationCost,0);
 root.joinedFactionsWithAug=()=>[faction('A',0,false)];
 assert.equal(targets(data)[0].donationCost,null);
});

function estimate(requirements,{donationCost=null}={}){
 const now=2e6,augReset=2;
 const snapshot={at:now,augReset,worth:1000,ready:[],reputation:{A:0,B:0},
  targets:[{name:'Target',cost:100,rep:10,factions:['A'],requirements,donationCost,stats:{hacking:2}}]};
 const previous={augReset,at:now-60000,worth:940,reputation:{A:-60,B:-120}};
 return progressionSpeed({snapshot,previous,now,augReset,homeRam:1024});
}
test('chain ETA requires every prerequisite and shares reputation work within a faction',()=>{
 assert.equal(estimate([{rep:100,factions:['A']},{rep:150,factions:['A']}]).next.eta,150000);
 assert.equal(estimate([{rep:100,factions:['A']},{rep:200,factions:['B']}]).next.eta,200000);
 assert.equal(estimate([{rep:100,factions:['Unavailable']},{rep:1,factions:['A']}]).next.eta,null);
 assert.equal(estimate([{rep:100,factions:['Unavailable']}],{donationCost:0}).next.eta,0);
});

test('missing prerequisite chains cannot borrow the final targets reputation eligibility',()=>{
 const root=aug('Root',[],{desired:false,reputation:200,joinedFactionsWithAug:()=>[faction('B',0,false)]});
 const target=aug('Target',['Root'],{reputation:10,joinedFactionsWithAug:()=>[faction('A',100,false)]});
 const [plan]=targets(catalog(root,target));
 assert.equal(plan.donationCost,null);
 assert.deepEqual(plan.requirements.map(({rep,factions})=>({rep,factions})),[{rep:200,factions:['B']},{rep:10,factions:['A']}]);
});


const requirement=(faction,rep,donation)=>({rep,factions:[faction],providers:[{faction,requiredDonation:donation}]});
const mixed=overrides=>estimateMixedAugmentationWait({cost:100,worth:100,cashRate:1,reputation:{A:0,B:0},repRates:{A:1,B:1},...overrides});

test('mixed strategy beats both all-work and all-donation estimates',()=>{
 const result=mixed({requirements:[requirement('A',10,1000),requirement('B',1000,10)]});
 assert.equal(result.seconds,10);assert.equal(result.donationCost,10);
 assert.deepEqual(result.workByFaction,{A:10});assert.deepEqual(result.donationsByFaction,{B:10});
 assert.equal(result.reputationSeconds,10);assert.equal(result.cashSeconds,10);
});

test('mixed strategy handles a work-only faction paired with an unmeasured donation faction',()=>{
 const requirements=[requirement('A',100,100),requirement('B',100,null)];
 const result=mixed({requirements,repRates:{A:0,B:1}});
 assert.equal(result.seconds,100);assert.equal(result.workByFaction.B,100);
 assert.equal(result.donationsByFaction.A,100);
});

test('mixed strategy shares committed donations and repeated faction requirements exactly once',()=>{
 const result=mixed({requirements:[requirement('A',60,60),requirement('A',120,120),requirement('B',10,null)],
  repRates:{A:0,B:1},plannedDonations:{A:100}});
 assert.equal(result.donationCost,20);assert.equal(result.seconds,20);
 assert.deepEqual(result.donationsByFaction,{A:120});
 const work=mixed({requirements:[requirement('A',100,null),requirement('A',150,null),requirement('B',100,null)]});
 assert.equal(work.reputationSeconds,250);
});

test('mixed strategy never borrows unmeasured income, reputation rates or another factions budget',()=>{
 assert.equal(mixed({requirements:[requirement('A',10,10)],cashRate:0,repRates:{A:0,B:0}}),null);
 assert.equal(mixed({requirements:[requirement('A',10,null)],repRates:{A:0}}),null);
 const funded=mixed({requirements:[requirement('A',10,10)],worth:110,cashRate:0,repRates:{A:0}});
 assert.equal(funded.seconds,0);
 const separate=mixed({requirements:[requirement('A',10,10)],plannedDonations:{B:100},repRates:{A:0}});
 assert.equal(separate.donationCost,10);
});

test('mixed planning rejects malformed inputs and does not mutate snapshots',()=>{
 const requirements=[requirement('A',100,50)],input={requirements,plannedDonations:{A:20}};
 const before=JSON.stringify(input);mixed(input);assert.equal(JSON.stringify(input),before);
 for(const override of [{cost:NaN},{worth:-1},{cashRate:-1},{plannedDonations:{A:-1}},
  {plannedDonations:null},{requirements:[{...requirements[0],providers:{}}]},
  {requirements:[{...requirements[0],rep:NaN}]},{requirements:[]}])
  assert.equal(mixed({...input,...override}),null);
 const foreign=mixed({requirements:[{rep:100,factions:['A'],providers:[{faction:'B',requiredDonation:0}]}],repRates:{A:0}});
 assert.equal(foreign,null);
});

test('mixed search stays bounded and exposes when alternatives have been pruned',()=>{
 const requirements=Array.from({length:12},(_,i)=>requirement('F'+i,10,10));
 const reputation=Object.fromEntries(requirements.map(r=>[r.factions[0],0]));
 const repRates=Object.fromEntries(requirements.map(r=>[r.factions[0],1]));
 const result=mixed({requirements,reputation,repRates});
 assert.equal(result.searchLimited,true);
 assert.ok(Number.isFinite(result.seconds));assert.ok(result.seconds<=120);
 assert.equal(result.reputationSeconds,Object.values(result.workByFaction).reduce((s,t)=>s+t,0));
 assert.equal(result.donationCost,Object.values(result.donationsByFaction).reduce((s,t)=>s+t,0));
});

test('executed snapshot publishes per-provider donation options, including locks and existing reputation',()=>{
 const root=aug('Root',[],{desired:false,joinedFactionsWithAug:()=>[faction('B',0,false)]});
 const target=aug('Target',['Root'],{joinedFactionsWithAug:()=>[faction('A',50)]});
 const [plan]=targets(catalog(root,target),{donations:{A:20}});
 assert.deepEqual(plan.requirements[0].providers,[{faction:'B',canDonate:false,requiredDonation:null}]);
 assert.deepEqual(plan.requirements[1].providers,[{faction:'A',canDonate:true,requiredDonation:50}]);
 assert.deepEqual(plan.plannedDonations,{A:20});
 const [disabled]=targets(catalog(root,target),{options:{'disable-donations':true}});
 assert.equal(disabled.requirements[1].providers[0].requiredDonation,null);assert.equal(disabled.requirements[1].providers[0].canDonate,false);
});

test('progression wait estimate selects a feasible mixed chain when both old strategies are impossible',()=>{
 const now=2e6,augReset=2;
 const snapshot={at:now,augReset,worth:100,ready:[],reputation:{A:0,B:60},
  targets:[{name:'Target',cost:100,rep:100,factions:['A'],requirements:[
   requirement('B',160,null),requirement('A',100,100)],donationCost:null,stats:{hacking:2}}]};
 const previous={augReset,at:now-60000,worth:40,reputation:{A:0,B:0}};
 const result=progressionSpeed({snapshot,previous,now,augReset,homeRam:1024});
 assert.equal(result.next.eta,100000);assert.equal(result.next.funding.donationCost,100);
 assert.equal(result.next.cashTarget,200);assert.equal(result.waitCandidate.cashTarget,200);
 assert.equal(result.next.funding.workByFaction.B,100);
 assert.equal(result.waitCandidate.funding.donationsByFaction.A,100);
});


const futureDeclarations=source.slice(source.indexOf('        const preserveOptionalNeuroFlux='),source.indexOf('        let resetEconomics='));
const futureState=Function('purchaseableAugs','purchaseFactionDonations','preNeuroFluxPlan','priorityAugs','augsAwaitingInstall',
 "const strNF='NeuroFlux Governor';"+futureDeclarations+'return {items:futurePurchaseAugs,donations:futureDonationPlan,ready:futureReadyAugs};');

test('future snapshot costs and donation credits exclude optional NF before any saving wait exists',()=>{
 const joined=()=>[faction('A',100)];
 const ordinary=aug('Ready',[],{price:10,desired:false,stats:{strength:10},joinedFactionsWithAug:joined});
 const nf=aug('NeuroFlux Governor',[],{price:500,desired:false,stats:{strength:1.01},joinedFactionsWithAug:joined});
 const target=aug('Target',[],{price:1500,stats:{strength:10},joinedFactionsWithAug:joined});
 const data=catalog(ordinary,nf,target),items=[ordinary,nf],preNF={augmentations:[ordinary],donations:{}};
 const [plan]=targets(data,{ready:['Ready','NeuroFlux Governor'],items,preNF,donations:{A:300}});
 assert.equal(plan.cost,1519);assert.deepEqual(plan.plannedDonations,{});assert.equal(plan.donationCost,0);
 assert.equal(items.length,2);assert.equal(preNF.augmentations.length,1);
 const [pinned]=targets(data,{ready:['Ready','NeuroFlux Governor'],items,preNF,options:{priorityAugs:['NeuroFlux Governor']}});
 assert.ok(pinned.cost>plan.cost);
});

test('pre-NF target evaluation discovers a bounded wait hidden by optional purchases',()=>{
 const joined=()=>[faction('A',100)],ordinary=aug('Ready',[],{price:10,desired:false,stats:{strength:10},joinedFactionsWithAug:joined}),
  nf=aug('NeuroFlux Governor',[],{price:500,desired:false,stats:{strength:1.01},joinedFactionsWithAug:joined}),
  target=aug('Target',[],{price:1500,stats:{strength:10},joinedFactionsWithAug:joined});
 const data=catalog(ordinary,nf,target),items=[ordinary,nf],ready=['Ready','NeuroFlux Governor'],preNF={augmentations:[ordinary],donations:{}};
 const [plan]=targets(data,{ready,items,preNF}),[old]=targets(data,{ready,items});
 const now=2e6,augReset=2,snapshot={at:now,augReset,worth:1000,reputation:{A:100},
  ready:items.map(a=>({name:a.name,stats:a.stats})),waitReady:[{name:ordinary.name,stats:ordinary.stats}],
  resetEconomics:{known:true,replacementCost:0},targets:[plan]};
 const previous={augReset,at:now-60000,worth:940,reputation:{A:100}};
 const result=progressionSpeed({snapshot,previous,now,augReset,combat:true,homeRam:1024});
 assert.equal(result.waitCandidate.name,'Target');assert.equal(result.waitCandidate.etaMs,519000);
 const hidden=progressionSpeed({snapshot:{...snapshot,targets:[old]},previous,now,augReset,combat:true,homeRam:1024});
 assert.equal(hidden.waitCandidate,null);
});

test('future basket retains queued NF and explicit NF priorities without mutating either plan',()=>{
 const ordinary=aug('Ready'),nf=aug('NeuroFlux Governor'),items=[ordinary,nf],donations={A:100};
 const pre={augmentations:[ordinary],donations:{A:10}},queued=['NeuroFlux Governor'];
 const result=futureState(items,donations,pre,[],queued);
 assert.deepEqual(result.ready,['NeuroFlux Governor','Ready']);assert.equal(result.donations.A,10);
 assert.deepEqual(futureState(items,donations,pre,['NeuroFlux Governor'],queued).ready,['NeuroFlux Governor','Ready','NeuroFlux Governor']);
 assert.deepEqual(futureState(items,donations,null,[],queued).items,items);
 assert.deepEqual(queued,['NeuroFlux Governor']);assert.equal(donations.A,100);
});

test('wait-gain comparison discounts NF levels forgone while keeping the full install-now benefit',()=>{
 const now=2e6,augReset=2,ordinary={name:'Ready',stats:{strength:10}},
  optional=Array.from({length:100},()=>({name:'NeuroFlux Governor',stats:{strength:1.01}}));
 const snapshot={at:now,augReset,worth:1000,reputation:{A:100},ready:[ordinary,...optional],waitReady:[ordinary],
  resetEconomics:{known:true,replacementCost:0},targets:[{name:'Target',cost:1060,rep:100,factions:['A'],stats:{strength:2}}]};
 const previous={augReset,at:now-60000,worth:940,reputation:{A:100}};
 const evaluate=s=>progressionSpeed({snapshot:s,previous,now,augReset,combat:true,homeRam:1024});
 const realistic=evaluate(snapshot),overcounted=evaluate({...snapshot,waitReady:undefined});
 assert.equal(realistic.gain,overcounted.gain);
 assert.equal(realistic.waitCandidate,null);assert.equal(overcounted.waitCandidate.name,'Target');
});

test('invalid or fabricated wait baskets cannot invent gains or duplicate queued levels',()=>{
 const now=2e6,augReset=2,ordinary={name:'Ready',stats:{strength:10}},nf={name:'NeuroFlux Governor',stats:{strength:1.01}};
 const snapshot={at:now,augReset,worth:1000,reputation:{A:100},ready:[ordinary,nf],
  resetEconomics:{known:true,replacementCost:0},targets:[{name:'Target',cost:1060,rep:100,factions:['A'],stats:{strength:10}}]};
 const previous={augReset,at:now-60000,worth:940,reputation:{A:100}};
 const evaluate=waitReady=>progressionSpeed({snapshot:{...snapshot,waitReady},previous,now,augReset,combat:true,homeRam:1024});
 for(const value of [null,[ordinary,nf,nf],[{name:'Invented',stats:{strength:1000}}]])
  assert.equal(evaluate(value).waitCandidate,null);
 const actual=evaluate([ordinary]),tampered=evaluate([{name:'Ready',stats:{strength:1000}}]);
 assert.equal(actual.waitCandidate.combinedGain,tampered.waitCandidate.combinedGain);
});

test('runtime captures the ordinary basket before NF and clears it when a faction-manager run restarts',()=>{
 assert.ok(source.indexOf('preNeuroFluxPlan={augmentations:purchaseableAugs.slice()')<source.indexOf('while (nfPurchased < 200)'));
 assert.ok(source.includes('purchaseableAugs = []; preNeuroFluxPlan=null;'));
 assert.ok(source.includes('waitReady:futureReadyAugs.map'));
});


test('partial reputation plus donation halves a balanced single-faction funding wait',()=>{
 const plan=mixed({requirements:[requirement('A',100,100)]});
 assert.equal(plan.seconds,50);assert.equal(plan.reputationSeconds,50);assert.equal(plan.cashSeconds,50);
 assert.equal(plan.workTargets.A,50);assert.equal(plan.donationCost,50);assert.equal(plan.donationsByFaction.A,50);
});

test('partial work uses measured rate balance and rounds residual donation quotes upward',()=>{
 const plan=mixed({requirements:[requirement('A',100,200)],repRates:{A:2},cashRate:10});
 assert.ok(plan.seconds<20);assert.ok(plan.seconds>=100/7);
 assert.ok(plan.workTargets.A>0&&plan.workTargets.A<100);
 assert.equal(plan.donationCost,Math.ceil(200*(1-plan.workTargets.A/100)));
 assert.ok(plan.seconds>=plan.workByFaction.A);
 assert.ok(plan.seconds>=plan.donationCost/10);
});

test('partial work retains committed credits and can fund a remaining bill without future cash income',()=>{
 const credited=mixed({requirements:[requirement('A',100,200)],plannedDonations:{A:100}});
 assert.ok(credited.seconds>=100/3&&credited.seconds<=34);
 assert.equal(credited.donationCost,Math.max(0,credited.donationsByFaction.A-100));
 const funded=mixed({requirements:[requirement('A',100,200)],cashRate:0,worth:200});
 assert.equal(funded.seconds,50);assert.equal(funded.donationCost,100);assert.equal(funded.workTargets.A,50);
});

test('partial choices require measured work and a permitted donation quote',()=>{
 const locked=mixed({requirements:[requirement('A',100,null)]});
 assert.equal(locked.seconds,100);assert.deepEqual(locked.donationsByFaction,{});
 const unmeasured=mixed({requirements:[requirement('A',100,100)],repRates:{A:0}});
 assert.equal(unmeasured.seconds,100);assert.deepEqual(unmeasured.workTargets,{});
 const noFutureCash=mixed({requirements:[requirement('A',100,100)],cashRate:0});
 assert.equal(noFutureCash.seconds,100);assert.equal(noFutureCash.donationCost,0);
});

test('small quotes never turn rounded partial donations into fictitious free reputation',()=>{
 const plan=mixed({requirements:[requirement('A',100,1)],repRates:{A:100}});
 assert.equal(plan.seconds,1);
 for(const donation of Object.values(plan.donationsByFaction))assert.ok(Number.isInteger(donation)&&donation>=1);
});

test('partial work respects shared requirements and never mutates the underlying quotes',()=>{
 const requirements=[requirement('A',50,50),requirement('A',100,100)],before=JSON.stringify(requirements);
 const plan=mixed({requirements});
 assert.ok(plan.seconds<=50);
 for(const requirement of requirements){
  const repCovered=(plan.workTargets.A||0)+100*(plan.donationsByFaction.A||0)/100;
  assert.ok(repCovered>=requirement.rep);
 }
 assert.equal(JSON.stringify(requirements),before);
});

test('partial funding reaches wait selection with a partial absolute goal and a reduced cash reserve',()=>{
 const now=2e6,augReset=2,ready=[{name:'Ready',stats:{strength:10}}];
 const snapshot={at:now,augReset,worth:100,ready,reputation:{A:60},resetEconomics:{known:true,replacementCost:0},
  targets:[{name:'Target',cost:100,rep:160,factions:['A'],requirements:[requirement('A',160,100)],donationCost:100,stats:{strength:10}}]};
 const previous={augReset,at:now-60000,worth:40,reputation:{A:0}};
 const result=progressionSpeed({snapshot,previous,now,augReset,combat:true,homeRam:1024});
 assert.equal(result.waitCandidate.etaMs,50000);assert.equal(result.waitCandidate.cashTarget,150);
 assert.equal(result.waitCandidate.funding.workTargets.A,110);
 assert.equal(result.waitCandidate.funding.donationCost,50);
});


test('later faction work reprices an earlier donated requirement instead of freezing its old bill',()=>{
 const plan=mixed({requirements:[requirement('A',150,150),requirement('A',100,null)]});
 assert.equal(plan.seconds,100);assert.equal(plan.workTargets.A,100);
 assert.equal(plan.donationsByFaction.A,50);assert.equal(plan.donationCost,50);
});

test('shared donation repricing gives the same final bill when requirement order is reversed',()=>{
 const requirements=[requirement('A',150,150),requirement('A',100,null)];
 const forward=mixed({requirements}),reverse=mixed({requirements:[...requirements].reverse()});
 assert.equal(forward.seconds,reverse.seconds);
 assert.deepEqual(forward.workTargets,reverse.workTargets);
 assert.deepEqual(forward.donationsByFaction,reverse.donationsByFaction);
});

test('later work can remove an earlier donation entirely even when no future cash is measured',()=>{
 const plan=mixed({requirements:[requirement('A',100,100),requirement('A',150,null)],cashRate:0});
 assert.equal(plan.seconds,150);assert.equal(plan.donationCost,0);
 assert.equal(plan.workTargets.A,150);assert.equal(plan.donationsByFaction.A||0,0);
});

test('repriced shared bills subtract each factions existing donation commitment only once',()=>{
 const plan=mixed({requirements:[requirement('A',150,150),requirement('A',150,150),requirement('A',100,null)],
  plannedDonations:{A:30}});
 assert.equal(plan.donationsByFaction.A,50);assert.equal(plan.donationCost,20);
 assert.equal(plan.seconds,100);
});

test('work and committed donations never reduce another factions remaining reputation bill',()=>{
 const plan=mixed({requirements:[requirement('A',150,150),requirement('B',100,null)],repRates:{A:0,B:1},
  plannedDonations:{B:200}});
 assert.equal(plan.donationsByFaction.A,150);assert.equal(plan.donationCost,150);
 assert.equal(plan.workTargets.B,100);assert.equal(plan.seconds,150);
});

test('repricing retains upward rounding and original quotes remain unchanged',()=>{
 const requirements=[requirement('A',150,151),requirement('A',100,null)],before=JSON.stringify(requirements);
 const plan=mixed({requirements});
 assert.equal(plan.workTargets.A,100);assert.equal(plan.donationsByFaction.A,51);
 assert.equal(plan.donationCost,Math.ceil(151*(150-100)/150));
 assert.equal(JSON.stringify(requirements),before);
});

test('shared work savings propagate to the selected wait cash reservation',()=>{
 const now=2e6,augReset=2,ready=[{name:'Ready',stats:{strength:10}}];
 const snapshot={at:now,augReset,worth:100,ready,reputation:{A:60},resetEconomics:{known:true,replacementCost:0},
  targets:[{name:'Target',cost:100,rep:210,factions:['A'],requirements:[
   requirement('A',210,150),requirement('A',160,null)],donationCost:null,stats:{strength:10}}]};
 const previous={augReset,at:now-60000,worth:40,reputation:{A:0}};
 const result=progressionSpeed({snapshot,previous,now,augReset,combat:true,homeRam:1024});
 assert.equal(result.waitCandidate.etaMs,100000);
 assert.equal(result.waitCandidate.funding.workTargets.A,160);
 assert.equal(result.waitCandidate.funding.donationCost,50);
 assert.equal(result.waitCandidate.cashTarget,150);
});


test('donation pruning removes satisfied, free and duplicate requirements without changing source objects',()=>{
 const paid={rep:50,baseline:0,amount:50},active={rep:100,baseline:0,amount:100},free={rep:200,baseline:0,amount:0};
 const needs=[paid,active,{...active},free],before=JSON.stringify(needs);
 const result=pruneAugmentationDonationNeeds(needs,50);
 assert.deepEqual(result,[active]);assert.equal(result[0],active);
 assert.equal(JSON.stringify(needs),before);
 assert.deepEqual(pruneAugmentationDonationNeeds([paid],50),[]);
 assert.equal(pruneAugmentationDonationNeeds([active],50)[0],active);
});

test('a higher requirement with no smaller donation slope subsumes weaker same-faction quotes',()=>{
 const lower={rep:50,baseline:0,amount:50},higher={rep:100,baseline:0,amount:100},
  duplicatePrice={rep:100,baseline:0,amount:90};
 assert.deepEqual(pruneAugmentationDonationNeeds([lower,higher,duplicatePrice],0),[higher]);
 assert.deepEqual(pruneAugmentationDonationNeeds([higher,lower,duplicatePrice],25),[higher]);
});

test('crossing donation curves and unknown or differing baselines retain their distinct obligations',()=>{
 const early={rep:100,baseline:0,amount:300},late={rep:200,baseline:0,amount:200},
  unknown={rep:100,baseline:null,amount:50},different={rep:200,baseline:10,amount:200};
 assert.deepEqual(pruneAugmentationDonationNeeds([early,late,unknown,different],0),[early,late,unknown,different]);
 assert.equal(pruneAugmentationDonationNeeds([unknown],1000)[0],unknown);
});

const remainingBill=(needs,earned)=>Math.max(0,...needs.map(n=>
 Number.isFinite(n.baseline)&&n.rep>n.baseline
  ?Math.ceil(n.amount*Math.max(0,Math.min(1,(n.rep-Math.max(n.baseline,earned))/(n.rep-n.baseline))))
  :n.amount));

test('pruned quotes preserve rounded maximum bills over future work across deterministic varied inputs',()=>{
 let seed=73;const next=()=>((seed=(seed*1664525+1013904223)>>>0)%1000);
 for(let sample=0;sample<60;sample++){
  const needs=Array.from({length:6},()=>({rep:10+next()%200,baseline:[0,3,7,null][next()%4],amount:next()%400}));
  const earned=next()%150,pruned=pruneAugmentationDonationNeeds(needs,earned);
  for(let future=earned;future<=350;future+=7)
   assert.equal(remainingBill(pruned,future),remainingBill(needs,future),JSON.stringify({needs,earned,future}));
 }
});

test('canonical funding states drop fulfilled obligations and report duplicate search work removed',()=>{
 const requirements=[...Array.from({length:5},()=>requirement('A',100,100)),requirement('A',100,null)];
 const plan=mixed({requirements});
 assert.equal(plan.seconds,100);assert.equal(plan.donationCost,0);
 assert.ok(plan.searchStats.removedNeeds>0);assert.ok(plan.searchStats.merged>0);
 assert.deepEqual(plan.donationsByFaction,{});
});

test('pruned and unpruned funding searches agree while pruning evaluates fewer shared-quote alternatives',async()=>{
 const raw=readFileSync(new URL('../progression-speed-policy.js',import.meta.url),'utf8').replace(/from\s+(['\"])(\.[^'\"]+)\1/g,(_all,_quote,path)=>'from '+JSON.stringify(new URL(path,new URL('../progression-speed-policy.js',import.meta.url)).href));
 const control=raw.replace('const needs=pruneAugmentationDonationNeeds(original,goals.get(faction)??reputation[faction]);','const needs=original;');
 assert.notEqual(raw,control);
 const {estimateMixedAugmentationWait:unpruned}=await import('data:text/javascript;base64,'+Buffer.from(control).toString('base64'));
 const input={cost:100,worth:100,cashRate:1,reputation:{A:0},repRates:{A:1},
  requirements:[...Array.from({length:5},()=>requirement('A',100,100)),requirement('A',100,null),requirement('A',101,null)]};
 const before=unpruned(input),after=estimateMixedAugmentationWait(input);
 assert.equal(after.seconds,before.seconds);assert.equal(after.donationCost,before.donationCost);
 assert.deepEqual(after.workTargets,before.workTargets);
 assert.ok(after.searchStats.evaluated<before.searchStats.evaluated,JSON.stringify({before:before.searchStats,after:after.searchStats}));
});


test('requirement deduplication ignores list order, duplicate providers and disabled donation entries',()=>{
 const a={rep:100,factions:['A','B'],providers:[{faction:'A',requiredDonation:10},{faction:'B',requiredDonation:null}]};
 const b={rep:100,factions:['B','A','A'],providers:[{faction:'A',requiredDonation:10},{faction:'A',requiredDonation:10}]};
 const before=JSON.stringify([a,b]),result=deduplicateAugmentationRequirements([a,b]);
 assert.deepEqual(result,[a]);assert.equal(result[0],a);assert.equal(JSON.stringify([a,b]),before);
});

test('different rep thresholds, faction access and donation quotes remain separate requirements',()=>{
 const a=requirement('A',100,100),differentRep=requirement('A',101,100),
  differentFaction=requirement('B',100,100),differentQuote=requirement('A',100,101),
  locked=requirement('A',100,null),free=requirement('A',100,0);
 const input=[a,differentRep,differentFaction,differentQuote,locked,free];
 assert.deepEqual(deduplicateAugmentationRequirements(input),input);
});

test('deduplication rejects malformed requirements before generating any funding states',()=>{
 for(const bad of [null,{rep:NaN,factions:['A']},{rep:-1,factions:['A']},{rep:100,factions:[]},
  {rep:100,factions:['A',null]},{rep:100,factions:['A'],providers:{}}]){
  assert.equal(deduplicateAugmentationRequirements([requirement('A',100,100),bad]),null);
  assert.equal(mixed({requirements:[requirement('A',100,100),bad]}),null);
 }
});

test('duplicate requirements preserve funding targets and shared credits without extra work',()=>{
 const a=requirement('A',100,100),b=requirement('B',200,null);
 const once=mixed({requirements:[a,b],plannedDonations:{A:20}});
 const repeated=mixed({requirements:[a,a,b,{...a},b],plannedDonations:{A:20}});
 assert.equal(repeated.seconds,once.seconds);assert.equal(repeated.donationCost,once.donationCost);
 assert.deepEqual(repeated.workTargets,once.workTargets);
 assert.deepEqual(repeated.donationsByFaction,once.donationsByFaction);
 assert.equal(repeated.searchStats.evaluated,once.searchStats.evaluated);
 assert.equal(repeated.searchStats.deduplicatedRequirements,3);
});

test('deduplicated funding search matches an uncollapsed control with fewer evaluations',async()=>{
 const raw=readFileSync(new URL('../progression-speed-policy.js',import.meta.url),'utf8').replace(/from\s+(['\"])(\.[^'\"]+)\1/g,(_all,_quote,path)=>'from '+JSON.stringify(new URL(path,new URL('../progression-speed-policy.js',import.meta.url)).href));
 const control=raw.replace('const uniqueRequirements=deduplicateAugmentationRequirements(requirements);','const uniqueRequirements=requirements;');
 assert.notEqual(raw,control);
 const {estimateMixedAugmentationWait:uncollapsed}=await import('data:text/javascript;base64,'+Buffer.from(control).toString('base64'));
 const input={cost:100,worth:100,cashRate:1,reputation:{A:0},repRates:{A:1},
  requirements:[...Array.from({length:5},()=>requirement('A',100,100)),requirement('A',100,null)]};
 const before=uncollapsed(input),after=estimateMixedAugmentationWait(input);
 assert.equal(after.seconds,before.seconds);assert.equal(after.donationCost,before.donationCost);
 assert.deepEqual(after.workTargets,before.workTargets);
 assert.ok(after.searchStats.evaluated<before.searchStats.evaluated,JSON.stringify({before:before.searchStats,after:after.searchStats}));
 assert.equal(after.searchStats.deduplicatedRequirements,4);
});


test('already attained faction reputation skips funding choices but retains the augmentation cash bill',()=>{
 const plan=mixed({requirements:[requirement('A',100,null)],reputation:{A:100},cost:200,worth:100,cashRate:1});
 assert.equal(plan.seconds,100);assert.equal(plan.cashSeconds,100);assert.equal(plan.reputationSeconds,0);
 assert.equal(plan.donationCost,0);assert.deepEqual(plan.workTargets,{});
 assert.equal(plan.searchStats.evaluated,0);assert.equal(plan.searchStats.satisfiedRequirements,1);
});

test('all satisfied requirements need no work even when donations are locked or rates are unmeasured',()=>{
 const requirements=[requirement('A',100,null),requirement('B',150,null)];
 const plan=mixed({requirements,reputation:{A:100,B:200},repRates:{},cashRate:0});
 assert.equal(plan.seconds,0);assert.deepEqual(plan.donationsByFaction,{});
 assert.equal(plan.searchStats.satisfiedRequirements,2);assert.equal(plan.searchStats.evaluated,0);
 assert.equal(mixed({requirements,reputation:{A:100,B:200},repRates:{},cashRate:0,cost:101}),null);
});

test('sufficient rep from any offering faction counts, but unrelated or unknown reputation cannot satisfy a requirement',()=>{
 const offered={rep:100,factions:['A','B'],providers:[{faction:'A',requiredDonation:100},{faction:'B',requiredDonation:null}]};
 const plan=mixed({requirements:[offered],reputation:{A:0,B:100},repRates:{}});
 assert.equal(plan.seconds,0);assert.equal(plan.searchStats.satisfiedRequirements,1);
 for(const current of [null,undefined,NaN,Infinity,-1,99.99]){
  const pending=mixed({requirements:[requirement('A',100,100)],reputation:{A:current,B:1000},repRates:{}});
  assert.equal(pending.searchStats.satisfiedRequirements,0);
  assert.equal(pending.donationCost,100);
 }
});

test('mixed fulfilled and pending requirements retain only necessary work and preserve shared budgets',()=>{
 const requirements=[requirement('A',100,0),requirement('B',200,null)],before=JSON.stringify(requirements);
 const plan=mixed({requirements,reputation:{A:100,B:0},plannedDonations:{A:20},repRates:{B:2}});
 assert.equal(plan.seconds,100);assert.deepEqual(plan.workTargets,{B:200});
 assert.equal(plan.searchStats.satisfiedRequirements,1);
 assert.equal(JSON.stringify(requirements),before);
});

test('fulfilled-requirement preprocessing matches an unfiltered control while avoiding state expansion',async()=>{
 const raw=readFileSync(new URL('../progression-speed-policy.js',import.meta.url),'utf8').replace(/from\s+(['\"])(\.[^'\"]+)\1/g,(_all,_quote,path)=>'from '+JSON.stringify(new URL(path,new URL('../progression-speed-policy.js',import.meta.url)).href));
 const control=raw.replace('for(const requirement of pendingRequirements){','for(const requirement of uniqueRequirements){');
 assert.notEqual(raw,control);
 const {estimateMixedAugmentationWait:unfiltered}=await import('data:text/javascript;base64,'+Buffer.from(control).toString('base64'));
 const input={cost:200,worth:100,cashRate:1,reputation:{A:1000},repRates:{A:0},
  requirements:[requirement('A',100,0),requirement('A',200,0),requirement('A',300,0)]};
 const before=unfiltered(input),after=estimateMixedAugmentationWait(input);
 assert.equal(after.seconds,before.seconds);assert.equal(after.donationCost,before.donationCost);
 assert.deepEqual(after.workTargets,before.workTargets);
 assert.equal(after.searchStats.evaluated,0);assert.ok(before.searchStats.evaluated>0);
});


test('planned donations satisfy reputation access without removing their reserved cash from the base bill',()=>{
 const plan=mixed({requirements:[requirement('A',100,100)],plannedDonations:{A:100},
  cost:250,worth:100,cashRate:10,repRates:{}});
 assert.equal(plan.seconds,15);assert.equal(plan.cashSeconds,15);
 assert.equal(plan.donationCost,0);assert.deepEqual(plan.workTargets,{});
 assert.equal(plan.searchStats.donationCoveredRequirements,1);assert.equal(plan.searchStats.evaluated,0);
 assert.equal(mixed({requirements:[requirement('A',100,100)],plannedDonations:{A:100},
  cost:250,worth:100,cashRate:0,repRates:{}}),null);
});

test('one committed faction donation covers multiple augmentations without being consumed or charged twice',()=>{
 const requirements=[requirement('A',80,80),requirement('A',100,100)],plannedDonations={A:100};
 const before=JSON.stringify({requirements,plannedDonations});
 const plan=mixed({requirements,plannedDonations,cost:200,worth:100,cashRate:1});
 assert.equal(plan.seconds,100);assert.equal(plan.donationCost,0);
 assert.equal(plan.searchStats.donationCoveredRequirements,2);assert.equal(plan.searchStats.evaluated,0);
 assert.equal(JSON.stringify({requirements,plannedDonations}),before);
});

test('insufficient, unrelated, unavailable or non-offering donation providers cannot bypass work planning',()=>{
 for(const overrides of [
  {requirements:[requirement('A',100,100)],plannedDonations:{A:99}},
  {requirements:[requirement('A',100,100)],plannedDonations:{B:100}},
  {requirements:[requirement('A',100,null)],plannedDonations:{A:100}},
  {requirements:[{rep:100,factions:['A'],providers:[{faction:'B',requiredDonation:50}]}],plannedDonations:{B:100}}
 ]){
  const plan=mixed(overrides);assert.equal(plan.searchStats.donationCoveredRequirements,0);
  assert.ok(plan.searchStats.evaluated>0);
 }
});

test('donation-covered preprocessing leaves other factions necessary work and credits intact',()=>{
 const plan=mixed({requirements:[requirement('A',100,100),requirement('B',50,null)],
  plannedDonations:{A:100},cost:200,worth:200,cashRate:0,repRates:{B:1}});
 assert.equal(plan.seconds,50);assert.deepEqual(plan.workTargets,{B:50});assert.equal(plan.donationCost,0);
 assert.equal(plan.searchStats.donationCoveredRequirements,1);
 assert.equal(plan.searchStats.satisfiedRequirements,0);
});

test('donation-covered preprocessing matches an unfiltered control and avoids redundant choices',async()=>{
 const raw=readFileSync(new URL('../progression-speed-policy.js',import.meta.url),'utf8').replace(/from\s+(['\"])(\.[^'\"]+)\1/g,(_all,_quote,path)=>'from '+JSON.stringify(new URL(path,new URL('../progression-speed-policy.js',import.meta.url)).href));
 const control=raw.replace('for(const requirement of pendingRequirements){','for(const requirement of outstandingRequirements){');
 assert.notEqual(raw,control);
 const {estimateMixedAugmentationWait:unfiltered}=await import('data:text/javascript;base64,'+Buffer.from(control).toString('base64'));
 const input={cost:250,worth:100,cashRate:1,reputation:{A:0},repRates:{A:0},plannedDonations:{A:100},
  requirements:[requirement('A',80,80),requirement('A',100,100)]};
 const before=unfiltered(input),after=estimateMixedAugmentationWait(input);
 assert.equal(after.seconds,before.seconds);assert.equal(after.donationCost,before.donationCost);
 assert.deepEqual(after.workTargets,before.workTargets);
 assert.equal(after.searchStats.evaluated,0);assert.ok(before.searchStats.evaluated>0);
 assert.equal(after.searchStats.donationCoveredRequirements,2);
});
