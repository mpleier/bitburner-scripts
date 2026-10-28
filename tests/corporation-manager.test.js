import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../corporation-manager.js';

/** Run a real manager cycle against a minimal game API, then stop at nextUpdate. */
async function cycle({ exportCost = 20e9, cash = 3e12, wallet = 100, nodeCost = 3,
    products = [], upgradeCosts = {}, lastProductAt = 0, playerReserve = 0, office = null, expenses = 0, revenue = 0, phases = [], advertCost = Infinity, salePrice = 'MP', extraDivision = null, material = {}, warehouse = {}, warehouseCost = Infinity, smartSupply = true, researchPoints = 0, researchCost = Infinity, researched = [], researchNames = [],industryCosts = {}, maintaining = false, industryNames = [], savedGrowthBank = null, officeStepCost=Infinity, omitDivisions=[],divisionProfit=0,productData={},scienceFactor=undefined,researchSample=null,marketSample=null,researchCosts={},researchFail=null,upkeepSample=null, publicCompany=false, valuation=0, ownedShares=1e9, offer=null, dividendRate=0, managerOptions={}, hashes=0, hashCosts={}, calibrationSample=null, productMetricSample=null, initialUpgradeLevels={}, advertFailure=false, recoverySample=null, divisionAwareness=0, divisionPopularity=0, advertCostAfterWilsonQuote=null, initialAdvertCounts={}, warehouseAvailable=null, productHistorySample=null } = {}) {
  const stop = new Error('test cycle complete');
  const files={};
  const calls = { inputs: [], research: [], expanded: [], industries: [], exports: [], products: [], retired: [], nodes: 0, upgrades: [], logs: [], unlocks: [], tea: [], parties: [], jobs: [], adverts: [], sales: [], dividends: [], investments: [], hashes: [], sequence: [] };
  const unlocked = new Set(['Warehouse API', 'Smart Supply']);
  if (office) unlocked.add('Office API');
  if (!smartSupply) unlocked.delete('Smart Supply');
  let phaseIndex = 0;
  const cities = ['Sector-12', 'Aevum', 'Volhaven', 'Chongqing', 'New Tokyo', 'Ishima'];
  const divisions = Object.fromEntries(['Agri', 'Chem', 'Dining'].map(name => [name, {
    name, industry: name === 'Agri' ? 'Agriculture' : name === 'Chem' ? 'Chemical' : 'Restaurant', cities, products: name === 'Dining' ? [...products] : [], researchPoints,
    numAdVerts:initialAdvertCounts[name]||0,awareness:divisionAwareness,popularity:divisionPopularity,makesProducts: name === 'Dining', maxProducts: 3,lastCycleRevenue:divisionProfit,lastCycleExpenses:0,
  }]));
  for(const name of omitDivisions)delete divisions[name];
  if (extraDivision) divisions[extraDivision.name] = { cities, products: [], researchPoints, maxProducts: 3, ...extraDivision };
  let funds = cash, money = wallet;const levels={...initialUpgradeLevels};let currentAdvertCost=advertCost;
  const researchByDivision=new Map();
  const researchSet=division=>{if(!researchByDivision.has(division))researchByDivision.set(division,new Set(researched));return researchByDivision.get(division);};
  const c = {
    getConstants: () => ({industryNames, dividendMaxRate: 1, researchNamesBase: researchNames }),
    hasCorporation: () => true,
    getCorporation: () => ({ name: 'Test Corp', funds, divisions: Object.keys(divisions), valuation, public: publicCompany, numShares:ownedShares,totalShares:1e9,dividendRate,revenue, expenses, prevState: phases[phaseIndex] }),
    acceptInvestmentOffer:()=>{calls.investments.push(offer.round);funds+=offer.funds;ownedShares-=offer.shares;return true;},
    issueDividends:rate=>{dividendRate=rate;calls.dividends.push(rate);},
    getDivision: name => ({ ...divisions[name], products: [...divisions[name].products] }),
    expandIndustry: (industry,name)=>{funds-=industryCosts[industry]||0;divisions[name]={name,industry,cities:['Sector-12'],products:[],maxProducts:3,makesProducts:industry==='Tobacco',researchPoints:0};calls.industries.push({industry,name});},
    getIndustryData: industry => ({ scienceFactor,advertisingFactor:.2,startingCost:industryCosts[industry]||0,requiredMaterials: industry === 'Agriculture' ? { Water: 0.5, Chemicals: 0.2 } : industry === 'Chemical' ? { Water: 0.5, Plants: 1 } : industry === 'Restaurant' ? { Food: 1, Water: 0.5 } : { Water: 0.2 }, producedMaterials: industry === 'Water Utilities' ? ['Water'] : industry === 'Chemical' ? ['Chemicals'] : industry === 'Agriculture' ? ['Plants','Food'] : [] }),
    hasUnlock: name => unlocked.has(name),
    getUnlockCost: name => name === 'Export' ? exportCost : Infinity,
    purchaseUnlock: name => {
      if (funds < exportCost) throw new Error('unaffordable unlock');
      funds -= exportCost; unlocked.add(name); calls.unlocks.push(name);
    },
    hasWarehouse: (d,city) => warehouseAvailable?warehouseAvailable(d,city):true,
    getWarehouse: () => ({ size: 100, sizeUsed: 0, ...warehouse }),
    getUpgradeWarehouseCost: () => warehouseCost,
    upgradeWarehouse: division => { funds -= warehouseCost; calls.upgrades.push('warehouse:'+division); },
    setSmartSupply: () => {},
    getMaterial: () => ({ stored: 1e9, marketPrice: 1, productionAmount: 1, desiredSellPrice: salePrice, ...material }),
    getMaterialData: () => ({ size: 1, baseMarkup: 3.75 }),
    buyMaterial: (...args) => calls.inputs.push(args), sellMaterial: (...args) => calls.sales.push(args), sellProduct: () => {},
    getOffice: () => office ? {...office} : null, getOfficeSizeUpgradeCost: (_d,_c,add) => add===3?officeStepCost:Infinity,
    upgradeOfficeSize: (division,city,add) => {funds-=officeStepCost;office.size+=add;calls.upgrades.push('office:'+division+'/'+city+':'+add);},
    hireEmployee:()=>{if(office.numEmployees>=office.size)return false;office.numEmployees++;return true;},
    setJobAssignment: (...args) => { calls.jobs.push(args); return true; },
    buyTea: (division,city) => { const cost=office.numEmployees*500000;if(cost>funds)throw new Error('unaffordable tea');funds-=cost;calls.tea.push({division,city,cost});return true; },
    throwParty: (division,city,cost) => {if(cost*office.numEmployees>funds)throw new Error('unaffordable party');funds-=cost*office.numEmployees;calls.parties.push(cost);return 1+cost/1e7;},
    hasResearched: (division, name) => researchSet(division).has(name), getResearchCost: (_d,n) => researchCosts[n]??researchCost,
    research: (division, name) => {if(name===researchFail)throw Error('research rejected');const cost=researchCosts[name]??researchCost;if(divisions[division].researchPoints<cost)throw Error('insufficient points');calls.research.push({ division, name });researchSet(division).add(name);divisions[division].researchPoints-=cost;},
    expandCity: (division, city) => { divisions[division].cities.push(city); calls.expanded.push({division,city}); },
    getHireAdVertCost: () => currentAdvertCost, hireAdVert: division => {if(advertFailure===true||advertFailure===division)throw Error('native advert failure');funds-=currentAdvertCost;divisions[division].numAdVerts++;calls.adverts.push(division);calls.sequence.push('advert:'+division);},
    getInvestmentOffer: () => offer,
    getUpgradeLevel: name => levels[name]||0,
    getUpgradeLevelCost: name => {if(name==='Wilson Analytics'&&advertCostAfterWilsonQuote!==null)currentAdvertCost=advertCostAfterWilsonQuote;return upgradeCosts[name]??Infinity;},
    levelUpgrade: name => {
      funds -= upgradeCosts[name]; levels[name]=(levels[name]||0)+1;calls.upgrades.push(name);calls.sequence.push('upgrade:'+name);
    },
    getProduct: (_division, _city, name) => ({ name, developmentProgress: 100, effectiveRating: Number(name.match(/\d+$/)?.[0]) || 0,...productData }),
    discontinueProduct: (division, name) => {
      calls.retired.push(name); divisions[division].products = divisions[division].products.filter(product => product !== name);
    },
    makeProduct: (division, city, name, design, marketing) => {
      if (divisions[division].products.includes(name)) throw new Error('duplicate product');
      divisions[division].products.push(name); funds -= design + marketing;
      calls.products.push({ city, name, cost: design + marketing });
    },
    exportMaterial: (...args) => {
      if (!unlocked.has('Export')) throw new Error('Export not unlocked');
      calls.exports.push(args);
    },
    nextUpdate: async () => { phaseIndex++; if(phaseIndex>=phases.length)throw stop; },
  };
  const ns = {
    corporation: c, pid: 1, ps: () => [{pid:1,filename:'corporation-manager.js',args:[]}], flags:schema=>({...Object.fromEntries(schema),...managerOptions}),
    getResetInfo: () => ({ currentNode: 3, ownedSF: new Map([[9, 1]]), lastNodeReset: 1 }),
    getScriptName: () => 'corporation-manager.js',
    isRunning: () => true,
    read: file => files[file]??(file==='tasks/corporation-product-metrics.json'&&productMetricSample?JSON.stringify({nodeReset:1,corporation:'Test Corp',divisions:productMetricSample,productsByDivision:productHistorySample}):file==='tasks/corporation-upgrade-calibration.json'&&calibrationSample?JSON.stringify(calibrationSample):file==='tasks/corporation-research-state.json'&&(researchSample||upkeepSample)?JSON.stringify({nodeReset:1,corporation:'Test Corp',upkeep:Object.fromEntries(Object.keys(divisions).map(name=>[name,upkeepSample])),divisions:Object.fromEntries(Object.keys(divisions).map(name=>[name,researchSample]))}):file==='tasks/corporation-growth-market.json'&&marketSample?JSON.stringify(marketSample):file==='tasks/corporation-lifecycle.json'&&(savedGrowthBank!==null||recoverySample)?JSON.stringify({nodeReset:1,corporation:'Test Corp',growthBank:savedGrowthBank,advertisingRecovery:recoverySample}):file === 'tasks/automation-maintenance.json' && maintaining ? JSON.stringify({ownerPid:2,expiresAt:Date.now()+10000}) : file === 'reserve.txt' ? String(playerReserve) : JSON.stringify({ at: lastProductAt, nodeReset: 1, corporation: 'Test Corp' })),
    write: async (file,data) => {files[file]=data;},
    getPlayer: () => ({ money }),
    format: { number: String },
    disableLog: () => {}, print: text => calls.logs.push(text), tprint: () => {},
    sleep: async () => { throw stop; },
    hacknet: {
      numNodes: () => calls.nodes, getPurchaseNodeCost: () => nodeCost,
      purchaseNode: () => { money -= nodeCost; return calls.nodes++; },
      getNodeStats: () => ({ level: 1, ram: 1, cores: 1, cache: 4, hashCapacity: 100 }),
      numHashes: () => hashes, hashCost: a => hashCosts[a]??Infinity, hashCapacity:()=>10000,
      spendHashes:a=>{const cost=hashCosts[a];if(!(hashes>=cost))return false;hashes-=cost;calls.hashes.push(a);if(a==='Sell for Corporation Funds')funds+=1e9;else if(a==='Exchange for Corporation Research')for(const d of Object.values(divisions))d.researchPoints+=1000;return true;},
      getLevelUpgradeCost: () => nodeCost,
      getRamUpgradeCost: () => nodeCost,
      getCoreUpgradeCost: () => nodeCost,
      upgradeLevel: () => { money -= nodeCost; },
      upgradeRam: () => { money -= nodeCost; },
      upgradeCore: () => { money -= nodeCost; },
    },
  };
  await assert.rejects(main(ns), error => error === stop);
  return { calls, funds, money, files };
}

test('real manager accepts the final private round using its independent growth ownership floor',async()=>{
 const {calls,files}=await cycle({cash:1e6,ownedShares:300e6,offer:{round:4,funds:100e9,shares:200e6},managerOptions:{'manage-shares':false}});
 assert.deepEqual(calls.investments,[4]);const status=JSON.parse(files['tasks/corporation-status.json']);
 assert.equal(status.minOwnership,.5);assert.equal(status.investmentMinOwnership,.1);
 const strict=await cycle({cash:1e9,ownedShares:300e6,offer:{round:4,funds:100e9,shares:200e6},managerOptions:{'investment-min-ownership':.5}});assert.deepEqual(strict.calls.investments,[]);
});
test('real capital planner buys a beneficial Wilson pair in order without duplicate upgrades or adverts',async()=>{
 const {calls,files}=await cycle({cash:8e9,advertCost:1e9,upgradeCosts:{'Wilson Analytics':1e6},divisionAwareness:1e6,divisionPopularity:1e6});
 assert.equal(calls.upgrades.filter(n=>n==='Wilson Analytics').length,1);
 const first=calls.sequence.indexOf('upgrade:Wilson Analytics'),ad=calls.sequence.findIndex(s=>s.startsWith('advert:'));assert.ok(first>=0&&ad>first);
 assert.equal(new Set(calls.adverts).size,calls.adverts.length);
 const status=JSON.parse(files['tasks/corporation-status.json']);assert.ok(status.growthDecisions.some(d=>d.advertisingReceipt?.state==='purchased'));
 assert.equal(status.advertisingRecovery.length,0);
});
test('real controller persists a partial Wilson purchase then resumes advertising without another Wilson',async()=>{
 const options={cash:8e9,advertCost:1e9,upgradeCosts:{'Wilson Analytics':1e6},divisionAwareness:1e6,divisionPopularity:1e6};
 const partial=await cycle({...options,advertFailure:true});
 const saved=JSON.parse(partial.files['tasks/corporation-lifecycle.json']).advertisingRecovery;
 assert.equal(partial.calls.upgrades.filter(n=>n==='Wilson Analytics').length,1);assert.ok(saved.length>=1&&saved.length<=3);
 const resumed=await cycle({...options,initialUpgradeLevels:{'Wilson Analytics':1},recoverySample:saved});
 assert.ok(!resumed.calls.upgrades.includes('Wilson Analytics'));assert.ok(saved.every(([name])=>resumed.calls.adverts.includes(name)));
 assert.deepEqual(JSON.parse(resumed.files['tasks/corporation-lifecycle.json']).advertisingRecovery,[]);
});
test('real controller does not buy Wilson when the next advertisement pair has inferior estimated value',async()=>{
 const {calls}=await cycle({cash:20e9,advertCost:1e9,upgradeCosts:{'Wilson Analytics':1e9},divisionAwareness:1e6,divisionPopularity:1e6});
 assert.ok(calls.adverts.length>0);assert.ok(!calls.upgrades.includes('Wilson Analytics'));
});
test('real controller shares Wilson across three planned divisions even when individual pairs do not qualify',async()=>{
 const {calls,files}=await cycle({cash:8e9,advertCost:1e9,upgradeCosts:{'Wilson Analytics':250e6},divisionAwareness:1e6,divisionPopularity:1e6});
 const status=JSON.parse(files['tasks/corporation-status.json']),group=status.growthDecisions.find(d=>d.advertisingReceipt?.state==='purchased');
 assert.equal(group.advertisingBundle.advertisements.length,3);assert.equal(group.advertisingBundle.cost,3.25e9);
 assert.equal(calls.upgrades.filter(n=>n==='Wilson Analytics').length,1);assert.deepEqual([...calls.adverts].sort(),['Agri','Chem','Dining']);
 assert.ok(calls.sequence.indexOf('upgrade:Wilson Analytics')<calls.sequence.findIndex(s=>s.startsWith('advert:')));
});
test('real multi-division recovery persists only unfinished adverts and resumes them without another Wilson',async()=>{
 const options={cash:8e9,advertCost:1e9,upgradeCosts:{'Wilson Analytics':250e6},divisionAwareness:1e6,divisionPopularity:1e6};
 const partial=await cycle({...options,advertFailure:'Agri'}),status=JSON.parse(partial.files['tasks/corporation-status.json']),decision=status.growthDecisions.find(d=>d.advertisingReceipt?.state==='partial');
 assert.equal(decision.advertisingReceipt.advertisementsPurchased.length,1);assert.equal(decision.advertisingReceipt.pending.length,2);
 const saved=JSON.parse(partial.files['tasks/corporation-lifecycle.json']).advertisingRecovery;assert.equal(saved.length,2);
 const initialAdvertCounts=Object.fromEntries(decision.advertisingReceipt.advertisementsPurchased.map(n=>[n,1]));
 const resumed=await cycle({...options,initialUpgradeLevels:{'Wilson Analytics':1},initialAdvertCounts,recoverySample:saved});
 assert.ok(!resumed.calls.upgrades.includes('Wilson Analytics'));assert.ok(saved.every(([name])=>resumed.calls.adverts.includes(name)));
 assert.deepEqual(JSON.parse(resumed.files['tasks/corporation-lifecycle.json']).advertisingRecovery,[]);
});
test('real standalone fallback refuses an advertisement whose native price rose after planning',async()=>{
 const {calls}=await cycle({cash:8e9,omitDivisions:['Agri','Chem'],advertCost:1e9,advertCostAfterWilsonQuote:2e9,upgradeCosts:{'Wilson Analytics':1e6},divisionAwareness:1e6,divisionPopularity:1e6});
 assert.ok(!calls.adverts.includes('Dining'));assert.ok(!calls.upgrades.includes('Wilson Analytics'));
});
test('real product planner records its native development delay while preserving the first product',async()=>{
 const employeeProductionByJob={Operations:1000,Engineer:1000,Management:1000};
 const {files,calls}=await cycle({cash:8e9,office:{size:30,numEmployees:30,avgEnergy:100,avgMorale:100,employeeJobs:{},employeeProductionByJob}});
 assert.ok(calls.products.length>0);const status=JSON.parse(files['tasks/corporation-status.json']),decision=status.growthDecisions.find(d=>d.label.startsWith('Develop Dining/'));
 assert.equal(decision.delayedReturn.state,'estimated');assert.equal(decision.delayedReturn.bootstrap,true);assert.ok(decision.delayedReturn.delayMs>30000);
});
test('real advertising planner waits for the first product using its known creation office',async()=>{
 const office={size:30,numEmployees:30,avgEnergy:100,avgMorale:100,employeeJobs:{},employeeProductionByJob:{Operations:1000,Engineer:1000,Management:1000}};
 const {files}=await cycle({cash:8e9,office,products:['Dining-1'],productData:{developmentProgress:50},advertCost:100e6,productMetricSample:{Dining:{name:'Dining-1',city:'Aevum',startedAt:Date.now()-60000}}});
 const status=JSON.parse(files['tasks/corporation-status.json']),decision=status.growthDecisions.find(d=>d.label==='Hire AdVert (Dining)');
 assert.equal(decision.delayedReturn.state,'estimated');assert.ok(decision.delayedReturn.delayMs>30000);assert.ok(decision.delayedReturn.factor<1);
});
test('real controller applies learned immediate-upgrade evidence and persists uncalibrated purchase quotes',async()=>{
 const at=Date.now(),key=JSON.stringify(['Smart Factories','production']);
 const calibrationSample={schemaVersion:1,scope:JSON.stringify([1,null,'Test Corp']),at,stats:{[key]:[1,2,3].map(n=>({at:at-n*1000,ratio:0}))}};
 const marketSample={scope:JSON.stringify([1,'Test Corp']),at,locations:{'Agri/Aevum':{division:'Agri',city:'Aevum',ready:true,profitPerSecond:1e6,sellThrough:1,backlog:false,pressure:.1}}};
 const {calls,files}=await cycle({cash:8e9,upgradeCosts:{'Smart Factories':100e6},calibrationSample,marketSample});assert.ok(calls.upgrades.includes('Smart Factories'));
 const status=JSON.parse(files['tasks/corporation-status.json']),decision=status.growthDecisions.find(d=>d.label==='Level Smart Factories');
 assert.equal(decision.calibration.factor,.75);assert.ok(decision.calibrationQuote.expected>0);
 assert.equal(status.calibration.learnedUpgrades,1);
 const saved=JSON.parse(files['tasks/corporation-upgrade-calibration.json']);assert.ok(saved.events.some(d=>d.calibrationQuote?.key===key));assert.equal(saved.pending,null);
});
test('real manager retains profit while developing and releases dividends after maturity',async()=>{
 const active=await cycle({publicCompany:true,dividendRate:.2,cash:1e15,revenue:1e9});assert.deepEqual(active.calls.dividends,[0]);
 const mature=await cycle({publicCompany:true,cash:1e15,wallet:100e9,revenue:1e9,products:['Dining-1'],researched:['Market-TA.II'],managerOptions:{'manage-shares':false}});
 assert.deepEqual(mature.calls.dividends,[.05]);assert.equal(JSON.parse(mature.files['tasks/corporation-status.json']).growthPriority,false);
});
test('real hash worker crosses a retained research threshold, not merely the sticker price',async()=>{
 const target='Exchange for Corporation Research';
 const ready=await cycle({cash:100e9,wallet:1e12,researchPoints:9900,researchCost:5000,hashes:200,hashCosts:{[target]:200}});
 assert.deepEqual(ready.calls.hashes,[target]);const goal=JSON.parse(ready.files['tasks/corporation-hash-goal.json']);assert.equal(goal.milestone.gap,100);
 const pool=await cycle({cash:100e9,wallet:1e12,researchPoints:4900,researchCost:5000,hashes:200,hashCosts:{[target]:200}});assert.deepEqual(pool.calls.hashes,[]);
});
test('real hash worker can complete a foundation funding gap above its old emergency threshold',async()=>{
 const target='Sell for Corporation Funds';
 const {calls,files}=await cycle({cash:2e9,wallet:1e12,exportCost:2.1e9,hashes:100,hashCosts:{[target]:100},managerOptions:{'manage-shares':false}});
 assert.deepEqual(calls.hashes,[target]);const status=JSON.parse(files['tasks/corporation-status.json']);
 assert.equal(status.growthGoal.label,'Buy Export');assert.equal(status.hashMilestone.gap,320e6);
});

test('corporation unlocks Export before setting up supply routes', async () => {
  const { calls } = await cycle();
  assert.deepEqual(calls.unlocks, ['Export']);
  assert.equal(calls.exports.length, 18);
  assert.ok(!calls.logs.some(line => /Export not unlocked/.test(line)));
});

test('unaffordable Export waits without repeatedly attempting illegal routes', async () => {
  const { calls } = await cycle({ exportCost: 1e16 });
  assert.equal(calls.exports.length, 0);
  assert.equal(calls.unlocks.length, 0);
  assert.ok(!calls.logs.some(line => /Export not unlocked/.test(line)));
});

test('a division-wide product is created once despite six active cities', async () => {
  const { calls } = await cycle();
  assert.equal(calls.products.length, 1);
  assert.equal(calls.products[0].cost, 29.95e9);
  assert.ok(!calls.logs.some(line => /duplicate product/.test(line)));
});

test('product naming avoids an existing name after a previous product was discontinued', async () => {
  const { calls } = await cycle({ products: ['Apex Dining 2'] });
  assert.equal(calls.products.length, 1);
  assert.equal(calls.products[0].name, 'Apex Dining 3');
});

test('node purchases and upgrades share one 5% wallet allowance', async () => {
  const { calls, money } = await cycle({ wallet: 100, nodeCost: 3 });
  assert.equal(calls.nodes, 1);
  assert.equal(money, 97);
});

test('at product capacity the manager replaces only the weakest completed managed product', async () => {
  const { calls } = await cycle({ productData:{designInvestment:10e6}, products: ['Apex Dining 1', 'Apex Dining 2', 'Apex Dining 3'] });
  assert.deepEqual(calls.retired, ['Apex Dining 1']);
  assert.equal(calls.products.length, 1);
  assert.equal(calls.products[0].name, 'Apex Dining 4');
});

test('full divisions with custom product names are left intact', async () => {
  const { calls } = await cycle({ products: ['Custom A', 'Custom B', 'Custom C'] });
  assert.deepEqual(calls.retired, []);
  assert.deepEqual(calls.products, []);
});

test('a saved product cooldown prevents immediate retirement after a manager restart', async () => {
  const { calls } = await cycle({ products: ['Apex Dining 1', 'Apex Dining 2', 'Apex Dining 3'], lastProductAt: Date.now() });
  assert.deepEqual(calls.retired, []);
  assert.deepEqual(calls.products, []);
});

test('corporation Hacknet spending does not touch a fully reserved wallet', async () => {
 const {calls,money}=await cycle({wallet:100,playerReserve:100,nodeCost:3});
 assert.equal(calls.nodes,0); assert.equal(money,100);
});
test('corporation Hacknet budget is based on unreserved funds', async () => {
 const {calls,money}=await cycle({wallet:100,playerReserve:80,nodeCost:3});
 assert.equal(calls.nodes,0); assert.equal(money,100);
 const partial=await cycle({wallet:100,playerReserve:40,nodeCost:3});
 assert.equal(partial.calls.nodes,1); assert.equal(partial.money,97);
});

test('cash recovery avoids unaffordable upkeep and assigns interns',async()=>{
 const {calls,money}=await cycle({cash:438596,expenses:214491,office:{size:15,numEmployees:15,avgEnergy:75,avgMorale:75,employeeJobs:{}}});
 assert.equal(calls.tea.length,0);assert.equal(calls.parties.length,0);
 assert.ok(calls.jobs.some(args=>args[2]==='Intern'&&args[3]===4));
 assert.ok(!calls.logs.some(line=>/unaffordable tea|unaffordable party/.test(line)));
});
test('discretionary corporation actions run once per full cycle, plus startup',async()=>{
 const {calls}=await cycle({phases:['PURCHASE','PRODUCTION','EXPORT','SALE','START','PURCHASE'],advertCost:1});
 assert.equal(calls.adverts.length,6);
});
test('material pricing replaces excessive percentage premiums after restart',async()=>{
 const {calls}=await cycle({salePrice:'MP*3'});
 assert.ok(calls.sales.length>0);assert.equal(calls.sales[0][4],'MP');
});

test('manual material sales use quality markup and skip warehouses blocked by unsold output',async()=>{
 const {calls}=await cycle({warehouse:{sizeUsed:95},warehouseCost:1e6,material:{quality:9.075,stored:5314,productionAmount:133,actualSellAmount:0.06}});
 assert.equal(calls.sales[0][4],'MP+2.42');
 assert.equal(calls.upgrades.includes('warehouse:Agri'),false);
});
test('warehouse expansion retains the operating reserve',async()=>{
 const {calls}=await cycle({cash:100e6,expenses:4e6,warehouse:{sizeUsed:95},warehouseCost:50e6,material:{stored:0,actualSellAmount:1}});
 assert.equal(calls.upgrades.some(name=>name.startsWith('warehouse:')),false);
});


test('existing product divisions receive managed development while custom names stay intact', async () => {
  const { calls } = await cycle({ extraDivision: { name: 'Other Products', industry: 'Tobacco', makesProducts: true } });
  assert.equal(calls.products.filter(product => product.name === 'Other Products Auto 1').length, 1);
});

test('existing product divisions retire only their weakest managed product', async () => {
  const { calls } = await cycle({ productData:{designInvestment:10e6}, extraDivision: { name: 'Other Products', industry: 'Tobacco', makesProducts: true,
    products: ['Custom Brand', 'Other Products Auto 5', 'Other Products Auto 7'] } });
  assert.deepEqual(calls.retired, ['Other Products Auto 5']);
  assert.ok(calls.products.some(product => product.name === 'Other Products Auto 8'));
});

test('existing material industries sell their industry-specific output', async () => {
  const { calls } = await cycle({ extraDivision: { name: 'Water Works', industry: 'Water Utilities', makesProducts: false } });
  assert.equal(calls.sales.filter(args => args[0] === 'Water Works' && args[2] === 'Water').length, 6);
});

test('restart preserves existing export routes instead of attempting duplicates', async () => {
  const { calls } = await cycle({ material: { exports: ['Agri', 'Chem', 'Dining'].map(division => ({division, city:'Sector-12'})) } });
  assert.equal(calls.exports.length, 15);
  assert.ok(calls.exports.every(args => args[1] !== 'Sector-12'));
});
test('products begin before the old two-trillion cash gate when affordable', async () => {
  const { calls } = await cycle({ cash: 10e9 });
  assert.equal(calls.products.length, 1);
  assert.ok(calls.products[0].cost < 1e9);
});
test('manual recipe purchasing supports Chemical and Restaurant without Smart Supply', async () => {
  const { calls } = await cycle({ cash: 100e6, smartSupply:false, material:{stored:0,marketPrice:1,productionAmount:10} });
  assert.ok(calls.inputs.some(args=>args[0]==='Chem' && args[2]==='Plants' && args[3]>0));
  assert.ok(calls.inputs.some(args=>args[0]==='Dining' && args[2]==='Food' && args[3]>0));
});
test('research requires its parent and covers extra research once priorities are finished', async () => {
  const order=['Hi-Tech R&D Laboratory','AutoBrew','AutoPartyManager','Market-TA.I','Market-TA.II','Self-Correcting Assemblers','Drones','Drones - Assembly','Drones - Transport','Overclock','Sti.mu'];
  const {calls}=await cycle({researchPoints:100, researchCost:10, researched:order});
  assert.ok(calls.research.some(item=>item.name==='Automatic Drug Administration'));
  assert.ok(calls.research.some(item=>item.name==='Go-Juice'));
  assert.ok(calls.research.findIndex(item=>item.name==='Automatic Drug Administration')<calls.research.findIndex(item=>item.name==='Go-Juice'));
});
test('existing divisions expand into missing cities', async () => {
  const {calls}=await cycle({extraDivision:{name:'Other',industry:'Water Utilities',cities:['Sector-12']}});
  assert.equal(calls.expanded.filter(item=>item.division==='Other').length,5);
});


test('market research is purchased as a pair without draining its quality reserve',async()=>{
 const {calls}=await cycle({researchPoints:100,researchCost:10,researched:['Hi-Tech R&D Laboratory']});
 assert.ok(calls.research.some(r=>r.name==='Market-TA.I'));assert.ok(calls.research.some(r=>r.name==='Market-TA.II'));
 const waiting=await cycle({researchPoints:30,researchCost:10,researched:['Hi-Tech R&D Laboratory']});
 assert.equal(waiting.calls.research.length,0);
});


test('Tobacco is bootstrapped before opening additional Restaurant capacity',async()=>{
 const {calls}=await cycle({cash:100e9,industryCosts:{Tobacco:20e9,Restaurant:10e9}});
 assert.ok(calls.industries.some(d=>d.industry==='Tobacco'));
});

test('maintenance clears persistent orders before starting a corporation growth cycle',async()=>{
 const {calls}=await cycle({maintaining:true});
 assert.equal(calls.products.length,0);assert.equal(calls.unlocks.length,0);assert.equal(calls.nodes,0);
 assert.ok(calls.inputs.length>0);assert.ok(calls.inputs.every(args=>args[3]===0));
});
test('self-funded corporation creation cannot consume the player reserve',async()=>{
 const stop=Error('stop'),calls=[];
 const ns={pid:1,ps:()=>[],getScriptName:()=> 'corporation-manager.js',getResetInfo:()=>({currentNode:1,ownedSF:new Map([[3,1]])}),read:f=>f==='reserve.txt'?'5000000000':'',write:async()=>{},print:()=>{},tprint:()=>{},disableLog:()=>{},getPlayer:()=>({money:152e9}),sleep:async()=>{throw stop;},corporation:{getConstants:()=>({}),hasCorporation:()=>false,getCorporation:()=>null,canCreateCorporation:self=>self?'Success':'Use seed money outside BN3',createCorporation:()=>calls.push('created')}};
 await assert.rejects(main(ns),e=>e===stop);assert.deepEqual(calls,[]);
});

test('useful automatic upkeep research is bought after TA.II instead of being skipped',async()=>{
 const {calls}=await cycle({upkeepSample:[30000,20000,10000].map(age=>({at:Date.now()-age,tea:15000000,party:0})),office:{size:30,numEmployees:30,avgEnergy:75,avgMorale:75,employeeJobs:{}},researchPoints:100,researchCost:10,researched:['Hi-Tech R&D Laboratory','Market-TA.I','Market-TA.II']});
 assert.ok(calls.research.some(r=>r.name==='AutoBrew'));
});
test('custom product creation uses escaped names and shared growth capital',async()=>{
 const {calls}=await cycle({extraDivision:{name:'A+B [works]',industry:'Tobacco',makesProducts:true,products:['A+B [works] Auto 2']}});
 assert.ok(calls.products.some(p=>p.name==='A+B [works] Auto 3'));
});

test('selective expansion supplies an unmet recipe instead of opening a cheaper unrelated industry',async()=>{
 const {calls}=await cycle({revenue:1e9,industryNames:['Real Estate','Water Utilities'],industryCosts:{'Real Estate':1e9,'Water Utilities':20e9},extraDivision:{name:'Tobacco',industry:'Tobacco',makesProducts:true},researched:['Hi-Tech R&D Laboratory','Market-TA.I','Market-TA.II']});
 assert.ok(calls.industries.some(x=>x.industry==='Water Utilities'));assert.ok(!calls.industries.some(x=>x.industry==='Real Estate'));
});
test('shared growth budget leaves product slots intact when replacement cannot be funded',async()=>{
 const {calls}=await cycle({cash:15e6,savedGrowthBank:1,products:['Apex Dining 1','Apex Dining 2','Apex Dining 3']});
 assert.equal(calls.retired.length,0);assert.equal(calls.products.length,0);assert.equal(calls.upgrades.length,0);
});

test('controller preserves material R&D while its pricing research is pending',async()=>{
 const {calls}=await cycle({office:{size:15,numEmployees:15,avgEnergy:100,avgMorale:100,employeeJobs:{}},researched:['Hi-Tech R&D Laboratory']});
 const assignments=calls.jobs.filter(args=>args[0]==='Agri'&&args[2]==='Research & Development'&&args[3]>0);
 assert.ok(assignments.length>0);assert.ok(assignments.every(args=>args[3]>=3));
});

test('Tobacco and custom product divisions receive adverts through the shared planner',async()=>{
 for(const name of ['Tobacco','Custom Products']){
  const {calls}=await cycle({advertCost:1,extraDivision:{name,industry:'Tobacco',makesProducts:true}});
  assert.ok(calls.adverts.includes(name));
 }
});

import {readFile} from 'node:fs/promises';

test('upgrade ranking sees storage pressure from every existing division',async()=>{
 const source=await readFile(new URL('../corporation-manager.js',import.meta.url),'utf8');
 assert.ok(source.indexOf('for (const division of divisions().filter')<source.indexOf('if (Date.now() - lastUpgrade >= 30_000)'));
});

test('Tobacco starts before Chemical and laboratory research when retained capital is sufficient',async()=>{
 const {calls}=await cycle({cash:30e9,savedGrowthBank:1,omitDivisions:['Chem','Dining'],industryCosts:{Tobacco:20e9,Chemical:70e9}});
 assert.ok(calls.industries.some(d=>d.industry==='Tobacco'));assert.ok(!calls.industries.some(d=>d.industry==='Chemical'));
});
test('Chemical starts below the old four-times-cost gate without a laboratory',async()=>{
 const {calls}=await cycle({cash:90e9,savedGrowthBank:1,omitDivisions:['Chem'],extraDivision:{name:'Tobacco',industry:'Tobacco',makesProducts:true},industryCosts:{Chemical:70e9}});
 assert.ok(calls.industries.some(d=>d.industry==='Chemical'));assert.ok(!calls.research.some(r=>r.name==='Hi-Tech R&D Laboratory'));
});

test('office growth plans affordable increments when the full target exceeds startup capital',async()=>{
 const source=await readFile(new URL('../corporation-manager.js',import.meta.url),'utf8');
 assert.ok(source.includes('if(add>3&&cost>growthBank){add=3;'));
 assert.ok(source.includes('(office.size+add)/Math.max(1,office.size)'));
});

test('a development office can use retained setup cash for an affordable three-person expansion',async()=>{
 const {calls}=await cycle({cash:12e9,savedGrowthBank:1,officeStepCost:4e9,office:{size:3,numEmployees:3,avgEnergy:100,avgMorale:100,employeeJobs:{}}});
 assert.ok(calls.upgrades.some(name=>name.startsWith('office:Dining/')));
});


test('retained capital funds growth despite a depleted bank and low current profit',async()=>{
 const {calls}=await cycle({cash:8e9,revenue:45000,expenses:34000,savedGrowthBank:0,upgradeCosts:{'Smart Factories':100e6}});
 assert.ok(calls.upgrades.includes('Smart Factories'));
});

test('cash-funded upkeep returns a healthy funded office to productive assignments',async()=>{
 const {calls,funds}=await cycle({cash:8e9,revenue:45000,expenses:34000,savedGrowthBank:0,office:{size:30,numEmployees:30,avgEnergy:95.5,avgMorale:95.5,maxEnergy:100,maxMorale:100,employeeJobs:{Intern:8}}});
 assert.ok(calls.tea.some(t=>t.division==='Dining'));assert.ok(calls.parties.length>0);
 assert.ok(!calls.jobs.some(a=>a[0]==='Dining'&&a[1]==='Sector-12'&&a[2]==='Intern'&&a[3]>0));
 assert.ok(funds>0.7e9);
});

test('profitable headquarters can expand beyond the old thirty-seat cash threshold',async()=>{
 const {calls}=await cycle({cash:100e9,savedGrowthBank:0,divisionProfit:20e6,officeStepCost:100e6,office:{size:30,numEmployees:30,avgEnergy:100,avgMorale:100,employeeJobs:{}}});
 assert.ok(calls.upgrades.some(n=>n.startsWith('office:Dining/')&&n.endsWith(':3')));
});

test('boost startup orders remain blocked by confirmed unsold output',async()=>{
 const {calls}=await cycle({cash:8e9,revenue:45000,expenses:34000,material:{stored:1e6,productionAmount:100,actualSellAmount:0}});
 assert.ok(!calls.inputs.some(a=>['Hardware','Robots','AI Cores','Real Estate'].includes(a[2])&&a[3]>0));
});


test('extra HQ growth is held when mature products have a confirmed sales backlog',async()=>{
 const {calls}=await cycle({cash:100e9,savedGrowthBank:0,divisionProfit:20e6,officeStepCost:100e6,products:['Manual Product'],productData:{stored:1e6,productionAmount:100,actualSellAmount:0},office:{size:30,numEmployees:30,avgEnergy:100,avgMorale:100,employeeJobs:{}}});
 assert.ok(!calls.upgrades.some(n=>n.startsWith('office:Dining/')));
});


test('an observed low-quality-cost laboratory unlock need not wait for twice its price',async()=>{
 const {calls}=await cycle({researchPoints:15000,researchCost:10000,scienceFactor:.1,researchSample:{points:14990,spent:0,at:Date.now()-10000}});
 assert.ok(calls.research.some(r=>r.division==='Dining'&&r.name==='Hi-Tech R&D Laboratory'));
 const unknown=await cycle({researchPoints:15000,researchCost:10000,scienceFactor:.1});
 assert.equal(unknown.calls.research.length,0);
});

test('TA pair can unlock early on complete observed pricing pressure while retaining points',async()=>{
 const locations=Object.fromEntries(['Agri','Chem','Dining'].flatMap(division=>['Sector-12','Aevum','Volhaven','Chongqing','New Tokyo','Ishima'].map(city=>[division+'/'+city,{division,city,ready:true,sellThrough:.5,backlog:true}])));
 const {calls}=await cycle({researchPoints:100000,scienceFactor:.1,researchCosts:{'Market-TA.I':20000,'Market-TA.II':50000},researched:['Hi-Tech R&D Laboratory'],researchSample:{points:99990,spent:0,at:Date.now()-10000},marketSample:{scope:JSON.stringify([1,'Test Corp']),at:Date.now(),locations}});
 assert.ok(calls.research.some(r=>r.division==='Dining'&&r.name==='Market-TA.I'));
 assert.ok(calls.research.some(r=>r.division==='Dining'&&r.name==='Market-TA.II'));
});

test('HQ payback uses native per-second division profit without another cycle divisor',async()=>{
 const {calls}=await cycle({cash:100e9,savedGrowthBank:0,divisionProfit:200000,officeStepCost:100e6,office:{size:30,numEmployees:30,avgEnergy:100,avgMorale:100,employeeJobs:{}}});
 assert.ok(calls.upgrades.some(n=>n.startsWith('office:Dining/')));
});


test('observed production value buys Drones and Assembly as one funded ordered package',async()=>{
 const cities=['Sector-12','Aevum','Volhaven','Chongqing','New Tokyo','Ishima'];
 const locations=Object.fromEntries(cities.map(city=>['Dining/'+city,{division:'Dining',city,ready:true,sellThrough:1,backlog:false}]));
 const {calls}=await cycle({researchPoints:40000,scienceFactor:.1,researchCosts:{Drones:5000,'Drones - Assembly':25000},researched:['Hi-Tech R&D Laboratory','Market-TA.I','Market-TA.II'],researchSample:{points:39990,spent:0,at:Date.now()-10000},marketSample:{scope:JSON.stringify([1,'Test Corp']),at:Date.now(),locations}});
 assert.deepEqual(calls.research.filter(r=>r.division==='Dining').map(r=>r.name),['Drones','Drones - Assembly']);
});

test('an unfunded production package does not buy its zero-effect unlock alone',async()=>{
 const {calls}=await cycle({researchPoints:30000,researchCosts:{Drones:5000,'Drones - Assembly':25000},researched:['Hi-Tech R&D Laboratory','Market-TA.I','Market-TA.II']});
 assert.ok(!calls.research.some(r=>r.name==='Drones'));
});

test('a rejected prerequisite stops the package before its follow-on research',async()=>{
 const {calls}=await cycle({researchPoints:150000,researchCosts:{Drones:5000,'Drones - Assembly':25000},researchFail:'Drones',researched:['Hi-Tech R&D Laboratory','Market-TA.I','Market-TA.II']});
 assert.ok(!calls.research.some(r=>r.name==='Drones - Assembly'));
});


test('production outranks cheap observed tea savings instead of upkeep taking automatic priority',async()=>{
 const cities=['Sector-12','Aevum','Volhaven','Chongqing','New Tokyo','Ishima'],locations=Object.fromEntries(cities.map(city=>['Dining/'+city,{division:'Dining',city,ready:true,sellThrough:1,backlog:false}]));
 const {calls}=await cycle({divisionProfit:1e6,researchPoints:40000,scienceFactor:.1,researchCosts:{AutoBrew:12000,Drones:5000,'Drones - Assembly':25000},researched:['Hi-Tech R&D Laboratory','Market-TA.I','Market-TA.II'],researchSample:{points:39990,spent:0,at:Date.now()-10000},upkeepSample:[30000,20000,10000].map(age=>({at:Date.now()-age,tea:30000,party:0})),marketSample:{scope:JSON.stringify([1,'Test Corp']),at:Date.now(),locations}});
 assert.deepEqual(calls.research.filter(r=>r.division==='Dining').map(r=>r.name),['Drones','Drones - Assembly']);
});

test('large observed upkeep savings can outrank production using the same planner',async()=>{
 const cities=['Sector-12','Aevum','Volhaven','Chongqing','New Tokyo','Ishima'],locations=Object.fromEntries(cities.map(city=>['Dining/'+city,{division:'Dining',city,ready:true,sellThrough:1,backlog:false}]));
 const {calls}=await cycle({divisionProfit:1e6,researchPoints:40000,scienceFactor:.1,researchCosts:{AutoBrew:12000,Drones:5000,'Drones - Assembly':25000},researched:['Hi-Tech R&D Laboratory','Market-TA.I','Market-TA.II'],researchSample:{points:39990,spent:0,at:Date.now()-10000},upkeepSample:[30000,20000,10000].map(age=>({at:Date.now()-age,tea:2000000,party:0})),marketSample:{scope:JSON.stringify([1,'Test Corp']),at:Date.now(),locations}});
 assert.deepEqual(calls.research.filter(r=>r.division==='Dining').map(r=>r.name),['AutoBrew']);
});

test('upkeep research observations persist actual charges for the next decision',async()=>{
 const {calls,files}=await cycle({cash:8e9,revenue:45000,expenses:34000,office:{size:30,numEmployees:30,avgEnergy:95.5,avgMorale:95.5,employeeJobs:{Intern:8}}});
 const saved=JSON.parse(files['tasks/corporation-research-state.json']);
 const paid=calls.tea.filter(t=>t.division==='Dining').reduce((sum,t)=>sum+t.cost,0);
 assert.equal(saved.upkeep.Dining.at(-1).tea,paid);assert.ok(saved.upkeep.Dining.at(-1).party>=0);assert.ok(paid>0);
});


test('paired upkeep restores a simultaneous deficit as one research package',async()=>{
 const {calls,files}=await cycle({cash:1e9,divisionProfit:1e6,researchPoints:40000,scienceFactor:.1,researchCosts:{AutoBrew:12000,AutoPartyManager:15000},researched:['Hi-Tech R&D Laboratory','Market-TA.I','Market-TA.II'],researchSample:{points:39990,spent:0,at:Date.now()-10000},office:{size:30,numEmployees:30,avgEnergy:70,avgMorale:70,maxEnergy:100,maxMorale:100,employeeJobs:{Intern:8}}});
 assert.deepEqual(calls.research.filter(r=>r.division==='Dining').map(r=>r.name),['AutoPartyManager','AutoBrew']);
 const saved=JSON.parse(files['tasks/corporation-research-state.json']);assert.equal(saved.divisions.Dining.spent,27000);
 const status=JSON.parse(files['tasks/corporation-status.json']);assert.equal(status.researchDecisions.Dining.complete,true);assert.equal(status.researchDecisions.Dining.name,'AutoBrew + AutoPartyManager');
});

test('a failed first upkeep research cannot trigger the second half of the pair',async()=>{
 const {calls,files}=await cycle({cash:1e9,divisionProfit:1e6,researchPoints:40000,scienceFactor:.1,researchCosts:{AutoBrew:12000,AutoPartyManager:15000},researchFail:'AutoPartyManager',researched:['Hi-Tech R&D Laboratory','Market-TA.I','Market-TA.II'],researchSample:{points:39990,spent:0,at:Date.now()-10000},office:{size:30,numEmployees:30,avgEnergy:70,avgMorale:70,employeeJobs:{Intern:8}}});
 assert.ok(!calls.research.some(r=>r.division==='Dining'));
 const status=JSON.parse(files['tasks/corporation-status.json']);assert.equal(status.researchDecisions.Dining.complete,false);
});


test('warehouse-less material offices research using existing staff without office expansion',async()=>{
 const office={size:3,numEmployees:3,avgEnergy:100,avgMorale:100,employeeJobs:{Operations:1,Engineer:1,Business:1},employeeProductionByJob:{}};
 const {calls}=await cycle({cash:1e9,office,warehouseAvailable:(d,city)=>!(d==='Agri'&&city==='Aevum')});
 const assigned=calls.jobs.filter(([d,city,,n])=>d==='Agri'&&city==='Aevum'&&n>0);
 assert.deepEqual(assigned,[['Agri','Aevum','Research & Development',3]]);
 assert.ok(!calls.upgrades.some(x=>x.startsWith('office:Agri/Aevum')));
});

test('product history persists separately and completion updates the restored product record',async()=>{
 const old={name:'Custom Brand',city:'Aevum',startedAt:Date.now()-60000,research:100,employees:9};
 const {files}=await cycle({products:['Custom Brand'],productMetricSample:{Dining:{...old,research:999}},productHistorySample:{Dining:{'Custom Brand':old,'Retired':{name:'Retired'}}}});
 const saved=JSON.parse(files['tasks/corporation-product-metrics.json']);
 assert.equal(saved.productsByDivision.Dining['Custom Brand'].research,100);
 assert.ok(saved.productsByDivision.Dining['Custom Brand'].developmentMs>=60000);
 assert.equal(saved.productsByDivision.Dining.Retired,undefined);
 // A new launch may replace the latest pointer without erasing the older product's history.
 assert.ok(Object.keys(saved.productsByDivision.Dining).length>=2);
});
