import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../corporation-manager.js';

/** Run a real manager cycle against a minimal game API, then stop at nextUpdate. */
async function cycle({ exportCost = 20e9, cash = 3e12, wallet = 100, nodeCost = 3,
    products = [], upgradeCosts = {}, lastProductAt = 0, playerReserve = 0, office = null, expenses = 0, phases = [], advertCost = Infinity, salePrice = 'MP' } = {}) {
  const stop = new Error('test cycle complete');
  const calls = { exports: [], products: [], retired: [], nodes: 0, upgrades: [], logs: [], unlocks: [], tea: [], parties: [], jobs: [], adverts: [], sales: [] };
  const unlocked = new Set(['Warehouse API', 'Smart Supply']);
  if (office) unlocked.add('Office API');
  let phaseIndex = 0;
  const cities = ['Sector-12', 'Aevum', 'Volhaven', 'Chongqing', 'New Tokyo', 'Ishima'];
  const divisions = Object.fromEntries(['Agri', 'Chem', 'Dining'].map(name => [name, {
    name, cities, products: name === 'Dining' ? [...products] : [], researchPoints: 0,
    makesProducts: name === 'Dining', maxProducts: 3,
  }]));
  let funds = cash, money = wallet;
  const c = {
    getConstants: () => ({ dividendMaxRate: 1 }),
    hasCorporation: () => true,
    getCorporation: () => ({ name: 'Test Corp', funds, divisions: Object.keys(divisions), valuation: 0, public: false, expenses, prevState: phases[phaseIndex] }),
    getDivision: name => ({ ...divisions[name], products: [...divisions[name].products] }),
    hasUnlock: name => unlocked.has(name),
    getUnlockCost: name => name === 'Export' ? exportCost : Infinity,
    purchaseUnlock: name => {
      if (funds < exportCost) throw new Error('unaffordable unlock');
      funds -= exportCost; unlocked.add(name); calls.unlocks.push(name);
    },
    hasWarehouse: () => true,
    getWarehouse: () => ({ size: 100, sizeUsed: 0 }),
    setSmartSupply: () => {},
    getMaterial: () => ({ stored: 1e9, marketPrice: 1, productionAmount: 1, desiredSellPrice: salePrice }),
    getMaterialData: () => ({ size: 1 }),
    buyMaterial: () => {}, sellMaterial: (...args) => calls.sales.push(args), sellProduct: () => {},
    getOffice: () => office ? {...office} : null, getOfficeSizeUpgradeCost: () => Infinity,
    setJobAssignment: (...args) => { calls.jobs.push(args); return true; },
    buyTea: (division,city) => { const cost=office.numEmployees*500000;if(cost>funds)throw new Error('unaffordable tea');funds-=cost;calls.tea.push({division,city,cost});return true; },
    throwParty: (division,city,cost) => {if(cost*office.numEmployees>funds)throw new Error('unaffordable party');funds-=cost*office.numEmployees;calls.parties.push(cost);return 1+cost/1e7;},
    hasResearched: () => false, getResearchCost: () => Infinity,
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
test('material pricing reuses the existing market multiplier after restart',async()=>{
 const {calls}=await cycle({salePrice:'MP*3'});
 assert.ok(calls.sales.length>0);assert.equal(calls.sales[0][4],'MP*2.5');
});
