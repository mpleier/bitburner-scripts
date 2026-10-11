import test from 'node:test';
import assert from 'node:assert/strict';
import corporationPolicy from '../pc-controller/corporation-policy.cjs';
import hackingPolicy from '../pc-controller/hacking-policy.cjs';

test('only sells completed products in active division cities', () => {
    const division = {
        name: 'Dining',
        cities: ['Sector-12', 'Aevum'],
        products: ['Apex Dining 1', 'Apex Dining 2'],
        productInfo: {
            'Apex Dining 1': { developmentProgress: 100 },
            'Apex Dining 2': { developmentProgress: 74 },
        },
    };

    assert.deepEqual(corporationPolicy.readyProductSales(division, ['Sector-12', 'Aevum', 'Volhaven']), [
        ['Dining', 'Sector-12', 'Apex Dining 1', 'MAX', 'MP', true],
        ['Dining', 'Aevum', 'Apex Dining 1', 'MAX', 'MP', true],
    ]);
});

test('does not schedule sales when development data is absent', () => {
    const division = { name: 'Dining', cities: ['Sector-12'], products: ['New Product'] };
    assert.deepEqual(corporationPolicy.readyProductSales(division, ['Sector-12']), []);
});

test('buys office tea only when morale or energy needs recovery', () => {
    assert.equal(corporationPolicy.shouldBuyTea({ avgEnergy: 100, avgMorale: 100 }), false);
    assert.equal(corporationPolicy.shouldBuyTea({ avgEnergy: 94, avgMorale: 100 }), true);
    assert.equal(corporationPolicy.shouldBuyTea({ avgEnergy: 100, avgMorale: 94 }), true);
});

test('game and PC corporation snapshots compare stable controller inputs', () => {
    const snapshot = {
        available: true,
        hasCorporation: true,
        currentNode: 3,
        sourceFile3: 0,
        corporation: { name: 'Apex Holdings', divisions: ['Agri'] },
        divisions: { Agri: { industry: 'Agriculture', cities: ['Sector-12'], products: [], offices: {}, warehouses: {}, productInfo: {} } },
        unlocks: { 'Warehouse API': true, 'Office API': true, 'Smart Supply': false },
        unlockCosts: {}, industryCosts: {}, upgradeCosts: {}, upgradeLevels: {}, officeCosts: {}, warehouseCosts: {}, offer: null,
    };
    assert.deepEqual(corporationPolicy.compareSnapshots(snapshot, structuredClone(snapshot)), []);
    const other = structuredClone(snapshot);
    other.divisions.Agri.cities = ['Aevum'];
    assert.equal(corporationPolicy.compareSnapshots(snapshot, other)[0].path, 'divisions.Agri.cities');
});

test('hacking target ranking accounts for success chance and full batch time', () => {
    const base = {
        hasAdminRights: true,
        requiredHackingLevel: 1,
        moneyMax: 1_000_000,
        moneyAvailable: 1_000_000,
        hackDifficulty: 1,
        minDifficulty: 1,
    };
    const fastTarget = { ...base, hackChance: 1, weakenTime: 10_000, hackTime: 1_000 };
    const slowTarget = { ...base, hackChance: 0.5, weakenTime: 20_000, hackTime: 1_000 };

    assert.equal(hackingPolicy.scoreTarget(fastTarget, 100), 50_000);
    assert.equal(hackingPolicy.scoreTarget(slowTarget, 100), 12_500);
    assert.equal(hackingPolicy.scoreTarget({ ...fastTarget, hasAdminRights: false }, 100), -1);
});

test('RAM planner trusts live used RAM and preserves home reserve', () => {
    const placements = hackingPolicy.distribute(
        [{ script: 'hack.js', threads: 1, arg: 'n00dles' }],
        { home: { max: 10, used: 6 } },
        { 'hack.js': 2 },
        { home: 1 },
        { homeReserveGb: 3 },
    );
    assert.deepEqual(placements, [{ script: 'hack.js', threads: 1, arg: 'n00dles', host: 'home' }]);
});

test('RAM planner counts earlier actions from the same plan', () => {
    const placements = hackingPolicy.distribute(
        [
            { script: 'hack.js', threads: 1 },
            { script: 'grow.js', threads: 1 },
        ],
        { server: { max: 3, used: 0 } },
        { 'hack.js': 2, 'grow.js': 2 },
        { server: 1 },
    );
    assert.equal(placements, null);
});
