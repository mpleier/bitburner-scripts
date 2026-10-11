import test from 'node:test';
import assert from 'node:assert/strict';
import { getBackdoorCandidates } from '../Tasks/backdoor-all-servers.js';
import { main as backdoorOne } from '../Tasks/backdoor-all-servers.js.backdoor-one.js';
import corporationPolicy from '../pc-controller/corporation-policy.cjs';

test('backdoor candidate filter excludes home, player-owned, hacknet, and daemon servers', () => {
    const servers = [
        'home', 'pserv-alpha', 'pserv-legacy', 'hacknet-server-0',
        'daemon-helper', 'n00dles', 'CSEC', 'I.I.I.I'
    ];

    assert.deepEqual(
        getBackdoorCandidates(servers, ['pserv-alpha', 'pserv-legacy']),
        ['n00dles', 'CSEC', 'I.I.I.I']
    );
});

test('candidate filtering handles an empty server list', () => {
    assert.deepEqual(getBackdoorCandidates([]), []);
});

test('backdoor worker reports a successful install', async () => {
    const installed = [];
    const toasts = [];
    const ns = {
        args: ['CSEC'],
        singularity: { installBackdoor: async () => installed.push(true) },
        toast: (...args) => toasts.push(args),
    };

    await backdoorOne(ns);
    assert.deepEqual(installed, [true]);
    assert.deepEqual(toasts, [['Backdoored CSEC', 'success']]);
});

test('backdoor worker handles install failure without throwing', async () => {
    const printed = [];
    const toasts = [];
    const ns = {
        args: ['pserv-owned'],
        singularity: { installBackdoor: async () => { throw new Error('server is your server'); } },
        print: message => printed.push(message),
        toast: (...args) => toasts.push(args),
    };

    await assert.doesNotReject(backdoorOne(ns));
    assert.match(printed[0], /Could not backdoor pserv-owned/);
    assert.deepEqual(toasts, [['Could not backdoor pserv-owned; will retry later.', 'warning']]);
});

test('corporation controller only sells completed products in active cities', () => {
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
