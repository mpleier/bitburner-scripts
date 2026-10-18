import test from 'node:test';
import assert from 'node:assert/strict';
import { getBackdoorCandidates } from '../Tasks/backdoor-all-servers.js';
import { main as backdoorOne } from '../Tasks/backdoor-all-servers.js.backdoor-one.js';

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
        args: ['CSEC'],read:()=>'',getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),pid:9,write(){},getScriptName:()=> 'Tasks/backdoor-all-servers.js.backdoor-one.js',
        singularity: { getCurrentServer:()=> 'CSEC',installBackdoor: async () => installed.push(true) },
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
        args: ['pserv-owned'],read:()=>'',getResetInfo:()=>({lastNodeReset:1,lastAugReset:2}),pid:9,write(){},getScriptName:()=> 'Tasks/backdoor-all-servers.js.backdoor-one.js',
        singularity: { getCurrentServer:()=> 'pserv-owned',installBackdoor: async () => { throw new Error('server is your server'); } },
        print: message => printed.push(message),
        toast: (...args) => toasts.push(args),
    };

    await assert.doesNotReject(backdoorOne(ns));
    assert.match(printed[0], /Could not backdoor pserv-owned/);
    assert.deepEqual(toasts, [['Could not backdoor pserv-owned; will retry later.', 'warning']]);
});
