import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {corporationGrowthPhase,corporationFundingGoal,corporationHashMilestone} from '../corporation-priority-policy.js';
import {executeCorporationGrowth} from '../corporation-policy.js';
import {investmentDecision} from '../corporation-lifecycle.js';
import {spendingPlan,augmentationCashReserve,claimSpending} from '../spending-policy.js';

test('mature profitable pricing releases income, while private or unsafe corporations retain growth priority',()=>{
 const info={public:true,funds:100e9,revenue:10e9,expenses:1e9},ctx={reserve:5e9,pricingReady:true};
 assert.equal(corporationGrowthPhase(info,ctx).active,false);
 for(const [i,c]of [[{...info,public:false},ctx],[info,{...ctx,pricingReady:false}],[{...info,funds:1e9},ctx],[{...info,expenses:20e9},ctx],[{...info,funds:NaN},ctx]])assert.equal(corporationGrowthPhase(i,c).active,true);
 assert.equal(corporationGrowthPhase(info,{enabled:false}).active,false);
});

test('private rounds all fit the independent ten-percent floor without relaxing public sales policy',()=>{
 let shares=1e9;
 for(const [round,amount]of [[1,100e6],[2,350e6],[3,250e6],[4,200e6]]){
  const d=investmentDecision({public:false,funds:0,revenue:0,expenses:0,numShares:shares,totalShares:1e9},{round,funds:100e9,shares:amount},null,.1,{reserve:1e9});
  assert.equal(d.accept,true);shares-=amount;
 }
 assert.equal(shares,100e6);
 const s=readFileSync(new URL('../corporation-manager.js',import.meta.url),'utf8');
 assert.match(s,/investmentDecision\(info,offer,financeHistory,investmentMinOwnership/);
 assert.match(s,/shareSale\(info, wallet, playerReserve, minOwnership/);
 assert.equal(investmentDecision({public:true},null,undefined).holdIPO,false);
});

test('corporation creation competes at low priority and is only reserved once affordable',()=>{
 const signals={corporationStartup:true,corporationGrowthPriority:true};
 const early=spendingPlan({money:100e9,homeRam:128,signals});
 assert.equal(early.corporationStartupReserve,0);
 assert.ok(early.allowances.home>0&&early.allowances.gang>0);
 assert.ok(early.allowances.corporation<5e9);
 const ready=spendingPlan({money:200e9,reserve:10e9,homeRam:128,signals});
 assert.ok(ready.allowances.corporation>=150e9);assert.equal(ready.corporationStartupReserve,150e9);
 assert.ok(Object.values(ready.allowances).reduce((n,v)=>n+v,0)<=190e9+.01);
 const gang=spendingPlan({money:100e9,homeRam:128,signals:{...signals,gangEquipmentPriority:{remainingCount:10,remainingCost:200e9}}});
 assert.ok(gang.allowances.gang>0);assert.equal(gang.corporationStartupReserve,0);
 const ram=spendingPlan({money:100e9,homeRam:32,signals:{...signals,essentialHomeRam:{target:128}}});assert.ok(ram.allowances.home>0);assert.equal(ram.corporationStartupReserve,0);
 const disabled=spendingPlan({money:200e9,homeRam:128,signals:{...signals,activeCategories:{corporation:false}}});assert.equal(disabled.corporationStartupReserve,0);
 const casino=spendingPlan({money:299999,homeRam:128,signals});assert.equal(casino.corporationStartupReserve,0);
});

test('serialized stock cash guard respects fresh startup holds without blocking the corporation claim',()=>{
 const at=Date.now(),p=spendingPlan({money:200e9,reserve:0,homeRam:128,epoch:at,ownerPid:7,reset:2,signals:{corporationStartup:true,corporationGrowthPriority:true}});
 const files={'tasks/spending-plan.json':JSON.stringify(p)};
 const ns={pid:7,args:[],read:f=>files[f]||'',write:(f,s)=>files[f]=s,getPlayer:()=>({money:200e9}),getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),ps:()=>[{pid:7,filename:'autopilot.js'}]};
 const guard=Function('return ('+augmentationCashReserve.toString()+')')();
 assert.equal(guard(ns),150e9);assert.equal(guard(ns,true),null);assert.equal(claimSpending(ns,'corporation',150e9),true);
 for(const mutate of [p=>p.expiresAt=at-1,p=>p.reset=3,p=>p.epoch=at+60000,p=>p.signals.corporationGrowthPriority=false]){
  const bad=structuredClone(p);mutate(bad);files['tasks/spending-plan.json']=JSON.stringify(bad);assert.equal(guard(ns),0);
 }
});

test('near-term capital hold stops repeated small purchases but spends surplus and restores progress when funded',()=>{
 let cash=1000;const bought=[];
 const plan=(label,cost,score)=>({label,cost,score,run:()=>{cash-=cost;bought.push(label);return true;}});
 const plans=[plan('important',1000,10),plan('small',100,1)],info={funds:1000,revenue:10,expenses:0};
 const goal=corporationFundingGoal(plans,info,100,900);assert.equal(goal.protect,true);assert.ok(goal.waitSeconds<120);
 const held=executeCorporationGrowth(plans,900,()=>cash,100,()=>true,{hold:goal});assert.deepEqual(bought,[]);assert.equal(held.remaining,900);assert.equal(held.decisions[1].state,'growth-reserved');
 cash=1200;executeCorporationGrowth(plans,1100,()=>cash,100,()=>true);assert.deepEqual(bought,['important']);
 assert.equal(corporationFundingGoal(plans,{funds:1000,revenue:0,expenses:1},100,900).protect,false);
 assert.equal(corporationFundingGoal([plan('remote',1e12,10)],info,100,900),null);
 assert.equal(corporationFundingGoal(plans,info,100,900,{enabled:false}),null);
});

test('funding skips an unreachable top plan and protects the next reachable expansion',()=>{
 const plan=(label,cost,score,priority=0)=>({label,cost,score,priority});
 const goal=corporationFundingGoal([plan('Buy Export',20e9,1,10),plan('Expand Agri',9e9,.5)],{funds:1e9,revenue:1000,expenses:0},100e6,500e6);
 assert.equal(goal.label,'Expand Agri');assert.equal(goal.cost,9e9);
});
test('hash milestones require a single reward to cross a quoted funding or retained-research target',()=>{
 const ctx={funds:100e9,reserve:5e9,fundCost:100,researchCost:200},fund={label:'HQ',cashGap:1e9};
 assert.equal(corporationHashMilestone(fund,[],ctx).action,'Sell for Corporation Funds');
 assert.equal(corporationHashMilestone({...fund,cashGap:1e9+1},[],ctx),null);
 const research=[{division:'Tobacco',name:'Market-TA.II',cost:100000,points:99001}];
 const goal=corporationHashMilestone(fund,research,ctx);assert.equal(goal.action,'Exchange for Corporation Research');assert.equal(goal.gap,999);
 assert.equal(corporationHashMilestone(null,research,{...ctx,researchCost:5001}),null);
 assert.equal(corporationHashMilestone(fund,research,{...ctx,funds:1}),null);
});

test('multi-purchase corporate quotes include escalating prices and reject excessive sequences',()=>{
 const fund={label:'New city',cost:9.02e9,cashGap:3.1e9},ctx={funds:7e9,reserve:.7e9,quote:(_a,n)=>100*n+5*n*(n-1)};
 const p=corporationHashMilestone(fund,[],ctx);assert.equal(p.purchases,4);assert.equal(p.totalHashes,460);
 assert.equal(corporationHashMilestone({...fund,cashGap:16e9+1},[],ctx),null);
 assert.equal(corporationHashMilestone(fund,[],{...ctx,maxHashes:459}),null);
 assert.equal(corporationHashMilestone(fund,[],{...ctx,quote:()=>5001}),null);
 assert.equal(corporationHashMilestone(fund,[],{...ctx,quote:()=>{throw Error('quote unavailable');}}),null);
 const research=corporationHashMilestone(null,[{division:'Tobacco',name:'Lab',points:7000,cost:20000}],ctx);assert.equal(research.purchases,13);assert.equal(research.target,20000);
 assert.equal(corporationHashMilestone(fund,[],{...ctx,remainingBudget:()=>({purchases:3,hashes:5000})}),null);
 assert.equal(corporationHashMilestone(fund,[],{...ctx,remainingBudget:()=>({purchases:16,hashes:459})}),null);
});

test('repeated-cycle funding reaches a valuable upgrade instead of continually spending its savings',()=>{
 function simulate(protect){
  let cash=20e9,bank=12e9,done=false;
  for(let seconds=10;seconds<=300;seconds+=10){
   cash+=1e9;bank=Math.min(cash-5e9,bank+.75e9);
   const plans=[{label:'target',cost:20e9,score:10,run:()=>{cash-=20e9;done=true;return true;}},{label:'small',cost:1e9,score:1,run:()=>{cash-=1e9;return true;}}];
   const goal=corporationFundingGoal(plans,{funds:cash,revenue:100e6,expenses:0},5e9,bank,{enabled:protect});
   bank=executeCorporationGrowth(plans,bank,()=>cash,5e9,()=>true,{hold:goal}).remaining;
   if(done)return seconds;
  }
  return null;
 }
 assert.equal(simulate(true),110);assert.equal(simulate(false),null);
});
