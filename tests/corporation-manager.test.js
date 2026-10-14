import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../corporation-manager.js';

/** Run a real manager cycle against a minimal game API, then stop at nextUpdate. */
async function cycle({ exportCost = 20e9, cash = 3e12, wallet = 100, nodeCost = 3,
    products = [], upgradeCosts = {}, lastProductAt = 0, playerReserve = 0, office = null, expenses = 0, phases = [], advertCost = Infinity, salePrice = 'MP', extraDivision = null, material = {}, warehouse = {}, warehouseCost = Infinity, smartSupply = true, researchPoints = 0, researchCost = Infinity, researched = [], researchNames = [],industryCosts = {} } = {}) {
  const stop = new Error('test cycle complete');
  const calls = { inputs: [], research: [], expanded: [], industries: [], exports: [], products: [], retired: [], nodes: 0, upgrades: [], logs: [], unlocks: [], tea: [], parties: [], jobs: [], adverts: [], sales: [] };
  const unlocked = new Set(['Warehouse API', 'Smart Supply']);
  if (office) unlocked.add('Office API');
  if (!smartSupply) unlocked.delete('Smart Supply');
  let phaseIndex = 0;
  const cities = ['Sector-12', 'Aevum', 'Volhaven', 'Chongqing', 'New Tokyo', 'Ishima'];
  const divisions = Object.fromEntries(['Agri', 'Chem', 'Dining'].map(name => [name, {
    name, industry: name === 'Agri' ? 'Agriculture' : name === 'Chem' ? 'Chemical' : 'Restaurant', cities, products: name === 'Dining' ? [...products] : [], researchPoints,
    makesProducts: name === 'Dining', maxProducts: 3,
  }]));
  if (extraDivision) divisions[extraDivision.name] = { cities, products: [], researchPoints, maxProducts: 3, ...extraDivision };
  let funds = cash, money = wallet;
  const researchByDivision=new Map();
  const researchSet=division=>{if(!researchByDivision.has(division))researchByDivision.set(division,new Set(researched));return researchByDivision.get(division);};
  const c = {
    getConstants: () => ({ dividendMaxRate: 1, researchNamesBase: researchNames }),
    hasCorporation: () => true,
    getCorporation: () => ({ name: 'Test Corp', funds, divisions: Object.keys(divisions), valuation: 0, public: false, expenses, prevState: phases[phaseIndex] }),
    getDivision: name => ({ ...divisions[name], products: [...divisions[name].products] }),
    expandIndustry: (industry,name)=>{funds-=industryCosts[industry]||0;divisions[name]={name,industry,cities:['Sector-12'],products:[],maxProducts:3,makesProducts:industry==='Tobacco',researchPoints:0};calls.industries.push({industry,name});},
    getIndustryData: industry => ({ startingCost:industryCosts[industry]||0,requiredMaterials: industry === 'Agriculture' ? { Water: 0.5, Chemicals: 0.2 } : industry === 'Chemical' ? { Water: 0.5, Plants: 1 } : industry === 'Restaurant' ? { Food: 1, Water: 0.5 } : { Water: 0.2 }, producedMaterials: industry === 'Water Utilities' ? ['Water'] : industry === 'Chemical' ? ['Chemicals'] : industry === 'Agriculture' ? ['Plants','Food'] : [] }),
    hasUnlock: name => unlocked.has(name),
    getUnlockCost: name => name === 'Export' ? exportCost : Infinity,
    purchaseUnlock: name => {
      if (funds < exportCost) throw new Error('unaffordable unlock');
      funds -= exportCost; unlocked.add(name); calls.unlocks.push(name);
    },
    hasWarehouse: () => true,
    getWarehouse: () => ({ size: 100, sizeUsed: 0, ...warehouse }),
    getUpgradeWarehouseCost: () => warehouseCost,
    upgradeWarehouse: division => { funds -= warehouseCost; calls.upgrades.push('warehouse:'+division); },
    setSmartSupply: () => {},
    getMaterial: () => ({ stored: 1e9, marketPrice: 1, productionAmount: 1, desiredSellPrice: salePrice, ...material }),
    getMaterialData: () => ({ size: 1, baseMarkup: 3.75 }),
    buyMaterial: (...args) => calls.inputs.push(args), sellMaterial: (...args) => calls.sales.push(args), sellProduct: () => {},
    getOffice: () => office ? {...office} : null, getOfficeSizeUpgradeCost: () => Infinity,
    setJobAssignment: (...args) => { calls.jobs.push(args); return true; },
    buyTea: (division,city) => { const cost=office.numEmployees*500000;if(cost>funds)throw new Error('unaffordable tea');funds-=cost;calls.tea.push({division,city,cost});return true; },
    throwParty: (division,city,cost) => {if(cost*office.numEmployees>funds)throw new Error('unaffordable party');funds-=cost*office.numEmployees;calls.parties.push(cost);return 1+cost/1e7;},
    hasResearched: (division, name) => researchSet(division).has(name), getResearchCost: () => researchCost,
    research: (division, name) => {calls.research.push({ division, name });researchSet(division).add(name);},
    expandCity: (division, city) => { divisions[division].cities.push(city); calls.expanded.push({division,city}); },
    getHireAdVertCost: () => advertCost, hireAdVert: division => {funds-=advertCost;calls.adverts.push(division);},
    getInvestmentOffer: () => ({ round: 1, funds: 0 }),
    getUpgradeLevel: () => 0,
    getUpgradeLevelCost: name => upgradeCosts[name] ?? Infinity,
    levelUpgrade: name => {
      funds -= upgradeCosts[name]; calls.upgrades.push(name);
    },
    getProduct: (_division, _city, name) => ({ name, developmentProgress: 100, effectiveRating: Number(name.match(/\d+$/)?.[0]) || 0 }),
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
    corporation: c, pid: 1, ps: () => [],
    getResetInfo: () => ({ currentNode: 3, ownedSF: new Map([[9, 1]]), lastNodeReset: 1 }),
    getScriptName: () => 'corporation-manager.js',
    read: file => file === 'reserve.txt' ? String(playerReserve) : JSON.stringify({ at: lastProductAt, nodeReset: 1, corporation: 'Test Corp' }),
    write: async () => {},
    getPlayer: () => ({ money }),
    format: { number: String },
    disableLog: () => {}, print: text => calls.logs.push(text), tprint: () => {},
    sleep: async () => { throw stop; },
    hacknet: {
      numNodes: () => calls.nodes, getPurchaseNodeCost: () => nodeCost,
      purchaseNode: () => { money -= nodeCost; return calls.nodes++; },
      getNodeStats: () => ({ level: 1, ram: 1, cores: 1, cache: 4, hashCapacity: 100 }),
      numHashes: () => 0, hashCost: () => Infinity,
      getLevelUpgradeCost: () => nodeCost,
      getRamUpgradeCost: () => nodeCost,
      getCoreUpgradeCost: () => nodeCost,
      upgradeLevel: () => { money -= nodeCost; },
      upgradeRam: () => { money -= nodeCost; },
      upgradeCore: () => { money -= nodeCost; },
    },
  };
  await assert.rejects(main(ns), error => error === stop);
  return { calls, funds, money };
}

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
  assert.equal(calls.products[0].cost, 20e9);
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
  const { calls } = await cycle({ products: ['Apex Dining 1', 'Apex Dining 2', 'Apex Dining 3'] });
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
  const { calls } = await cycle({ extraDivision: { name: 'Other Products', industry: 'Tobacco', makesProducts: true,
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
  assert.ok(!calls.research.some(item=>item.name==='Go-Juice'));
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
