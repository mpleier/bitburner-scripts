import test from 'node:test';
import assert from 'node:assert/strict';
import {treasuryPolicy,boostPurchaseBudget,corporationGrowthBudget,corporationOfficeUpkeepNeed,allocateCorporationUpkeep,corporationDevelopmentExpansion} from '../corporation-policy.js';
const info={funds:8e9,revenue:45000,expenses:34000};
test('growth capital can use retained cash and windfalls while preserving all holds',()=>{
 assert.equal(corporationGrowthBudget(info,1e9,0,10,true),1.05e9);
 assert.equal(corporationGrowthBudget(info,1e9,0,10,false),27500);
 assert.equal(corporationGrowthBudget({...info,funds:100e9},1e9,0,10,true),14.85e9);
 assert.equal(corporationGrowthBudget({...info,funds:1},1e9,0,10,true),0);
 for(const bank of [-1,NaN,Infinity])assert.equal(corporationGrowthBudget(info,1e9,bank,10,true),0);
});
test('cash-funded upkeep covers actual needs without draining reserves or recovery cash',()=>{
 const ordinary=treasuryPolicy(info),fast=treasuryPolicy(info,10,{developmentSpeed:true});
 assert.ok(fast.upkeepBudget>ordinary.upkeepBudget);assert.ok(fast.upkeepBudget<=.02*info.funds);
 assert.equal(treasuryPolicy({funds:1e6,revenue:0,expenses:1e6},10,{developmentSpeed:true}).upkeepBudget,0);
 const office={numEmployees:30,avgEnergy:95.5,avgMorale:95.5};
 const need=corporationOfficeUpkeepNeed(office);assert.equal(need.tea,15e6);assert.ok(need.party>0);
 const rows=[{key:'agri',office,product:false},{key:'tobacco',office,product:true}];
 const a=allocateCorporationUpkeep(rows,need.total);assert.ok(Math.abs(a.get('tobacco')-need.total)<.01);assert.equal(a.get('agri'),0);
 assert.ok([...allocateCorporationUpkeep(rows,1e6).values()].reduce((s,v)=>s+v,0)<=1e6);
 assert.equal(corporationOfficeUpkeepNeed({...office,avgEnergy:100,avgMorale:100}).total,0);
 assert.equal(corporationOfficeUpkeepNeed({...office,autoTea:true,autoParty:true}).total,0);
});
test('bootstrap boost allowance needs safe runway and keeps loss/recovery safeguards',()=>{
 const old=boostPurchaseBudget(info,1e9),fast=boostPurchaseBudget(info,1e9,0,10,{developmentSpeed:true});
 assert.equal(old,55000);assert.equal(fast,140e6);
 assert.equal(boostPurchaseBudget({funds:1e9,revenue:0,expenses:1e8},1e8,0,10,{developmentSpeed:true}),0);
 assert.equal(boostPurchaseBudget(info,info.funds,0,10,{developmentSpeed:true}),0);
});
test('HQ increments need native affordability and estimated payback or observed development acceleration',()=>{
 const base={size:30,cost:100e6,free:10e9};
 assert.equal(corporationDevelopmentExpansion({...base,profitPerSecond:20e6}).ready,true);
 assert.equal(corporationDevelopmentExpansion(base).ready,false);
 assert.equal(corporationDevelopmentExpansion({...base,remainingMs:600000}).ready,true);
 assert.equal(corporationDevelopmentExpansion({...base,remainingMs:10000}).ready,false);
 assert.equal(corporationDevelopmentExpansion({...base,cost:2e9,remainingMs:600000}).ready,false);
 assert.equal(corporationDevelopmentExpansion({...base,cost:Infinity,remainingMs:600000}).ready,false);
});
