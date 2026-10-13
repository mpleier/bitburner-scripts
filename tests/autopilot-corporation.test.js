import test from 'node:test';
import assert from 'node:assert/strict';
import { superviseCorporationManager } from '../autopilot.js';

function fixture({ lease = '', maxRam = 128, usedRam = 24, requiredRam = 80, exists = true, pid = 42 } = {}) {
    const launches = [];
    return {
        launches,
        ns: {
            read: () => lease,
            fileExists: () => exists,
            getScriptRam: () => requiredRam,
            getServerMaxRam: () => maxRam,
            getServerUsedRam: () => usedRam,
            exec: (...args) => { launches.push(args); return pid; },
        },
    };
}

test('autopilot starts the manager below 256 GB in BN3 and resumes after it exits', () => {
    const { ns, launches } = fixture();
    assert.equal(superviseCorporationManager(ns, { currentNode: 3 }).status, 'started');
    assert.deepEqual(launches[0], ['corporation-manager.js', 'home', { threads: 1, preventDuplicates: true }]);
    assert.equal(superviseCorporationManager(ns, { currentNode: 3, runningScripts: [{ filename: 'corporation-manager.js' }] }).status, 'running');
    assert.equal(launches.length, 1);
    assert.equal(superviseCorporationManager(ns, { currentNode: 3, runningScripts: [] }).status, 'started');
    assert.equal(launches.length, 2);
});

test('corporation supervision respects Source File access and the disable option', () => {
    const { ns, launches } = fixture();
    assert.equal(superviseCorporationManager(ns, { currentNode: 1 }).status, 'unavailable');
    assert.equal(superviseCorporationManager(ns, { currentNode: 3, enabled: false }).status, 'disabled');
    assert.equal(launches.length, 0);
    assert.equal(superviseCorporationManager(ns, { currentNode: 1, sourceFile3: 1 }).status, 'started');
});

test('obsolete PC leases cannot block in-game corporation management', () => {
    const { ns, launches } = fixture({ lease: JSON.stringify({ owner: 'pc-controller', expiresAt: 200 }) });
    assert.equal(superviseCorporationManager(ns, { currentNode: 3 }).status, 'started');
    assert.equal(launches.length, 1);
});

test('startup waits for real free RAM or missing files and can retry a failed exec', () => {
    const lowRam = fixture({ usedRam: 80 });
    assert.equal(superviseCorporationManager(lowRam.ns, { currentNode: 3 }).status, 'waiting-for-ram');
    assert.equal(lowRam.launches.length, 0);
    assert.equal(superviseCorporationManager(fixture({ exists: false }).ns, { currentNode: 3 }).status, 'missing-script');
    const rejected = fixture({ pid: 0 });
    assert.equal(superviseCorporationManager(rejected.ns, { currentNode: 3 }).status, 'launch-failed');
    assert.equal(superviseCorporationManager(rejected.ns, { currentNode: 3 }).status, 'launch-failed');
    assert.equal(rejected.launches.length, 2);
});
