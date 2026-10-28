import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {optimizedOfficeJobs,productReplacementReady,scoreCorporationGrowth} from '../corporation-policy.js';
import {investmentDecision} from '../corporation-lifecycle.js';
const source=readFileSync(new URL('../corporation-manager.js',import.meta.url),'utf8');
test('small material offices research without losing production roles or exceeding headcount',()=>{
 const office={numEmployees:3};
 for(let cycle=0;cycle<5;cycle++){
  const jobs=optimizedOfficeJobs(office,false,false,false,{protectResearch:true,researchPulse:cycle===0});
  assert.equal(jobs.reduce((a,b)=>a+b),3);assert.equal(jobs[0],1);assert.equal(jobs[1],1);
  assert.equal(jobs[4],cycle===0?1:0);assert.equal(jobs[2],cycle===0?0:1);
 }
 for(const [products,recovering,context]of [[true,false,{protectResearch:true}],[false,true,{protectResearch:true}],[false,false,{protectResearch:false}]])assert.equal(optimizedOfficeJobs(office,products,false,recovering,{...context,researchPulse:true})[4],0);
});
test('old age does not justify a same-strength replacement, real improvements still do',()=>{
 const p={product:{designInvestment:10e6},investment:10e6,at:1,now:1e8,developmentMs:1000,baselineResearch:100,research:100,baselineEmployees:9,employees:9};
 assert.equal(productReplacementReady(p),false);assert.equal(productReplacementReady({...p,investment:12e6}),true);assert.equal(productReplacementReady({...p,research:125}),true);assert.equal(productReplacementReady({...p,employees:12}),true);
 assert.equal(productReplacementReady({...p,product:{}}),false);
});
test('investment timeout cannot override missing milestones except imminent operating insolvency',()=>{
 const info={public:false,funds:1e9,revenue:1000,expenses:500,numShares:1e9,totalShares:1e9},offer={round:1,shares:1e8,funds:10e9};
 const first=investmentDecision(info,offer,null,.5,{now:1,stageReady:false});
 assert.equal(investmentDecision(info,offer,first.history,.5,{now:2000000,stageReady:false}).accept,false);
 assert.equal(investmentDecision(info,offer,first.history,.5,{now:2000000,stageReady:true}).accept,true);
 assert.equal(investmentDecision({...info,funds:100,expenses:2000},offer,first.history,.5,{now:100,stageReady:false}).accept,true);
});
test('three weak sales cycles defer production but retain sales improvements and storage relief',()=>{
 const plans=['production','sales','storage'].map(kind=>({label:kind,cost:100,score:1,market:{kind,division:'T'}}));
 const row={ready:true,division:'T',profitPerSecond:100,sellThrough:.7,pressure:.99,backlog:false,samples:Array.from({length:3},()=>({sellThrough:.7}))};
 assert.deepEqual(scoreCorporationGrowth(plans,{locations:{a:row}}).map(p=>p.label),['sales','storage']);
 assert.equal(scoreCorporationGrowth(plans,{locations:{a:{...row,samples:[{sellThrough:1},{sellThrough:.7},{sellThrough:.7}]}}}).length,3);
});
test('executed expansion requires full package funds and repairs existing sites first',()=>{
 const body=source.slice(source.indexOf('  const expand = '),source.indexOf('  const createDivision = '));
 let cash=6e9,warehouses=new Set(['A']),cities=['A'],plans=[];
 const ctx={constants:{},reserve:1e8,hasUnlock:()=>true,funds:()=>cash,safe:(_s,fn)=>fn(),capitalPurchase:(...args)=>plans.push(args),c:{getDivision:()=>({cities}),hasWarehouse:(_d,city)=>warehouses.has(city),expandCity:(_d,city)=>cities.push(city),purchaseWarehouse:(_d,city)=>warehouses.add(city)}};
 vm.createContext(ctx);vm.runInContext(body+';globalThis.expandSite=expand;',ctx);
 ctx.expandSite('D','B');assert.equal(plans.length,0);
 cash=20e9;warehouses.clear();ctx.expandSite('D','B');assert.equal(plans.length,0);
 warehouses.add('A');ctx.expandSite('D','B');assert.equal(plans[0][1],9.02e9);assert.equal(plans[0][2](),true);assert.ok(warehouses.has('B'));assert.deepEqual(cities,['A','B']);
 assert.equal(plans[0][2](),false);
});
test('research context ignores office-only cities without reading their materials',()=>{
 const body=source.slice(source.indexOf('  const researchContext='),source.indexOf('  const staffingGoals='));
 const reads=[],ctx={researchContexts:new Map(),researchSamples:new Map(),upkeepHistory:new Map(),upkeepAllocations:new Map(),options:{'development-speed':true},cycleSeconds:10,growthBank:0,reserve:0,funds:()=>0,growthMarket:{locations:{a:{division:'Agri',ready:true,sellThrough:1}}},safe:(_s,fn)=>fn(),corporationResearchRate:()=>0,corporationUpkeepResearchValues:()=>({}),productInvestment:()=>0,c:{hasWarehouse:(_d,city)=>city==='Sector-12',getIndustryData:()=>({scienceFactor:.5,requiredMaterials:{Water:1},aiCoreFactor:.2}),getOffice:()=>({employeeProductionByJob:{Engineer:100}}),getMaterial:(_d,city)=>{reads.push(city);assert.equal(city,'Sector-12');return {stored:1,quality:1};},hasResearched:()=>false}};
 vm.createContext(ctx);vm.runInContext(body+';globalThis.inspect=researchContext;',ctx);
 const r=ctx.inspect('Agri',{cities:['Sector-12','Aevum'],makesProducts:false,products:[],researchPoints:10,lastCycleRevenue:1,lastCycleExpenses:0});
 assert.equal(r.valid,true);assert.equal(r.salesReady,true);assert.equal(r.qualityRows.length,1);assert.equal(reads.length,2);
});
