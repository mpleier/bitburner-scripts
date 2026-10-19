import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { main as shutdown } from '../kill-all-scripts.js';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function fixture(host = 'home') {
    const actions = [], warnings = [], processes = new Map([
        ['home', [{ pid: host === 'home' ? 1 : 2 }, { pid: 3 }]],
        ['remote', [{ pid: host === 'remote' ? 1 : 4 }]]
    ]);
    const ns = { pid: 1, print() {}, getHostname: () => host,
        scan: h => h === 'home' ? ['remote'] : ['home'],
        ps: h => [...(processes.get(h) || [])],
        kill: pid => { actions.push(pid); for (const [h, ps] of processes) processes.set(h, ps.filter(p => p.pid !== pid)); return true; },
        sleep: async () => {}, tprint: s => warnings.push(s),
        rm: () => assert.fail('shutdown must preserve source files'),
        ls: () => assert.fail('shutdown must not enumerate files') };
    return { ns, actions, warnings, processes };
}

test('shutdown stops home controllers first and preserves itself and all files', async () => {
    for (const host of ['home', 'remote']) {
        const f = fixture(host); await shutdown(f.ns);
        assert.equal(f.actions.includes(1), false);
        assert.deepEqual(f.actions.slice(0, host === 'home' ? 1 : 2), host === 'home' ? [3] : [2, 3]);
        assert.deepEqual([...f.processes.values()].flat().map(p => p.pid), [1]);
        assert.deepEqual(f.warnings, []);
    }
});
test('shutdown revisits hosts for workers launched during a delayed exit', async () => {
    const f = fixture(); let sleeps = 0;
    f.ns.sleep = async () => { if (++sleeps === 1) f.processes.get('remote').push({ pid: 9 }); };
    await shutdown(f.ns); assert.ok(f.actions.includes(9)); assert.equal(sleeps, 2);
});
test('shutdown bounds retries and reports workers that cannot be killed', async () => {
    const f = fixture(); let sleeps = 0; f.ns.kill = () => false; f.ns.sleep = async () => { sleeps++; };
    await shutdown(f.ns); assert.equal(sleeps, 100); assert.equal(f.warnings.length, 1);
    assert.match(f.warnings[0], /home:3/); assert.match(f.warnings[0], /remote:4/);
});
test('shutdown tolerates a cloud host disappearing during its scan', async () => {
    const f = fixture(); const ps = f.ns.ps;
    f.ns.ps = h => { if (h === 'remote') throw new Error('deleted host'); return ps(h); };
    await shutdown(f.ns); assert.deepEqual(f.actions, [3]);
});

async function daemonHarness(startup, extras = {}) {
    const source = await readFile(new URL('../daemon.js', import.meta.url), 'utf8');
    const start = source.indexOf('    async function startup_withRetries(ns) {');
    const end = source.indexOf('    // Start daemon.js', start);
    let sleeps = 0; const logs = [];
    const ns = { getScriptName: () => 'daemon.js', sleep: async () => { sleeps++; } };
    await new AsyncFunction('ns', 'startup', 'isScriptPaused', 'maintenanceRequested', 'log', 'getErrorInfo',
        source.slice(start, end) + ';await startup_withRetries(ns);')(
        ns, startup, extras.paused || (() => false), extras.maintenance || (() => false),
        (ns, s) => logs.push(s), String);
    return { sleeps, logs };
}
test('daemon successful run-once or pause exit never repeats startup', async () => {
    let calls = 0; const r = await daemonHarness(async () => { calls++; });
    assert.equal(calls, 1); assert.equal(r.sleeps, 0);
});
test('daemon retries transient failures, with exactly five total attempts', async () => {
    let calls = 0; const r = await daemonHarness(async () => { calls++; throw new Error('temporary'); });
    assert.equal(calls, 5); assert.equal(r.sleeps, 4); assert.match(r.logs.at(-1), /ERROR/);
    calls = 0; const success = await daemonHarness(async () => { if (++calls < 3) throw new Error('temporary'); });
    assert.equal(calls, 3); assert.equal(success.sleeps, 2);
});
test('daemon pauses before retrying and never retries game stop signals', async () => {
    let calls = 0;
    await daemonHarness(async () => { calls++; throw new Error('retry'); }, { paused: () => calls > 0 });
    assert.equal(calls, 1);
    calls = 0; const r = await daemonHarness(async () => { calls++; throw { env: { stopFlag: true } }; });
    assert.equal(calls, 1); assert.equal(r.sleeps, 0);
});
test('daemon waits for maintenance before startup', async () => {
    let checks = 0, calls = 0;
    const r = await daemonHarness(async () => { calls++; }, { maintenance: () => ++checks < 3 });
    assert.equal(calls, 1); assert.equal(r.sleeps, 2);
});

test('autopilot rechecks its pause and maintenance before each iteration', async () => {
    const source = await readFile(new URL('../autopilot.js', import.meta.url), 'utf8');
    const start = source.indexOf('        while (keepRunning) {');
    const end = source.indexOf('\n    }', start);
    const loop = source.slice(start, end);
    let paused = false, maintenance = true, loops = 0, sleeps = 0, startups = 0;
    await new AsyncFunction('ns','automationHeartbeat','isScriptPaused','maintenanceRequested','startUp','mainLoop','log','getErrorInfo','shouldWeKeepRunning',
        'let startUpRan=false,keepRunning=true;const options={interval:1};' + loop)(
        { getScriptName: () => 'autopilot.js', sleep: async () => { if (++sleeps === 1) maintenance = false; else paused = true; } },
        () => {}, () => paused, () => maintenance, async () => { startups++; return true; },
        async () => { loops++; return true; }, () => {}, String, () => true);
    assert.equal(startups, 1); assert.equal(loops, 1); assert.equal(sleeps, 2);
});
test('autopilot cannot launch children after its own pause or during maintenance', async () => {
    const source = await readFile(new URL('../autopilot.js', import.meta.url), 'utf8');
    const start = source.indexOf('    function launchScriptHelper(');
    const end = source.indexOf('    let lastStatusLog', start);
    for (const mode of ['pause', 'maintenance']) {
        const result = new Function('ns','isScriptPaused','maintenanceRequested', source.slice(start, end) + ';return launchScriptHelper(ns,"daemon.js");')(
            { getScriptName: () => 'autopilot.js' }, (ns,s) => mode === 'pause' && s === 'autopilot.js', () => mode === 'maintenance');
        assert.equal(result, 0);
    }
});
