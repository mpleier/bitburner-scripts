import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../corporation-manager.js';

/** Run a real manager cycle against a minimal game API, then stop at nextUpdate. */
async function cycle({ exportCost = 20e9, cash = 3e12, wallet = 100, nodeCost = 3,
    products = [], upgradeCosts = {}, lastProductAt = 0 } = {}) {
  const stop = new Error('test cycle complete');
  const calls = { exports: [], products: [], retired: [], nodes: 0, upgrades: [], logs: [], unlocks: [] };
  const unlocked = new Set(['Warehouse API', 'Smart Supply']);
  const cities = ['Sector-12', 'Aevum', 'Volhaven', 'Chongqing', 'New Tokyo', 'Ishima'];
  const divisions = Object.fromEntries(['Agri', 'Chem', 'Dining'].map(name => [name, {
    name, cities, products: name === 'Dining' ? [...products] : [], researchPoints: 0,
    makesProducts: name === 'Dining', maxProducts: 3,
  }]));
  let funds = cash, money = wallet;
  const c = {
    getConstants: () => ({ dividendMaxRate: 1 }),
    hasCorporation: () => true,
    getCorporation: () => ({ name: 'Test Corp', funds, divisions: Object.keys(divisions), valuation: 0, public: false }),
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
    getMaterial: () => ({ stored: 1e9, marketPrice: 1, productionAmount: 1 }),
    getMaterialData: () => ({ size: 1 }),
    buyMaterial: () => {}, sellMaterial: () => {}, sellProduct: () => {},
    hasResearched: () => false, getResearchCost: () => Infinity,
    getHireAdVertCost: () => Infinity,
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
    nextUpdate: async () => { throw stop; },
  };
  const ns = {
    corporation: c,
    getResetInfo: () => ({ currentNode: 3, ownedSF: new Map([[9, 1]]), lastNodeReset: 1 }),
    read: () => JSON.stringify({ at: lastProductAt, nodeReset: 1, corporation: 'Test Corp' }),
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
