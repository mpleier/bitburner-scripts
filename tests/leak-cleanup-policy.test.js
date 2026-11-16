import test from 'node:test';
import assert from 'node:assert/strict';
import {pidOwner, staleOwnerFiles, staleResultFiles, staleTempCaches, staleReceipts, staleDarknetState} from '../leak-cleanup-policy.js';

test('pidOwner only claims files that carry an owning pid', () => {
    assert.equal(pidOwner('tasks/runtime/42.json'), 42);
    assert.equal(pidOwner('tasks/hash-worker-status/7.json'), null);
    assert.equal(pidOwner('tasks/hash-worker-status-7.json'), 7);
    assert.equal(pidOwner('tasks/hgw-drain-13.json'), 13);
    // A temp query receipt is live data: its writer always exits before the caller reads it,
    // so liveness says nothing about whether the receipt is still needed.
    assert.equal(pidOwner('Temp/ns-ls.txt.result-275.txt'), null);
    assert.equal(pidOwner('tasks/dashboard.json'), null);
    assert.equal(pidOwner('Temp/getAugs.txt'), null);
    assert.equal(pidOwner('remote-control/results/x.json'), null);
});

test('staleOwnerFiles keeps live pids and respects the bound', () => {
    const names = ['tasks/runtime/1.json', 'tasks/runtime/2.json', 'tasks/runtime/3.json', 'tasks/dashboard.json'];
    assert.deepEqual(staleOwnerFiles(names, new Set([1])), ['tasks/runtime/2.json', 'tasks/runtime/3.json']);
    assert.deepEqual(staleOwnerFiles(names, new Set([1]), 1), ['tasks/runtime/2.json']);
    assert.deepEqual(staleOwnerFiles(names, [], 50), ['tasks/runtime/1.json', 'tasks/runtime/2.json', 'tasks/runtime/3.json']);
});

test('staleOwnerFiles never prunes an in-flight temp query receipt', () => {
    const names = ['Temp/stock-symbols.txt.result-149.txt', 'Temp/ns-getPlayer.txt.result-7.txt'];
    assert.deepEqual(staleOwnerFiles(names, [], 50), []);
    assert.deepEqual(staleOwnerFiles(names, new Set([7]), 50), []);
});

test('staleReceipts reclaims only abandoned receipts, and only by age', () => {
    const now = 5_000_000;
    const entries = [
        {name: 'Temp/stock-symbols.txt.result-149.txt', mtime: now - 1000},   // fresh: caller still reading
        {name: 'Temp/ns-getPlayer.txt.result-163.txt', mtime: now - 700_000}, // abandoned by a killed caller
        {name: 'Temp/ns-getPlayer.txt.result-164.txt'},                       // unknown mtime: leave it alone
        {name: 'Temp/stock-symbols.txt', mtime: now - 700_000},               // not a receipt
        {name: 'Temp/ns-ls.txt.123456.js', mtime: now - 700_000},             // temp script, not a receipt
    ];
    assert.deepEqual(staleReceipts(entries, now), ['Temp/ns-getPlayer.txt.result-163.txt']);
    assert.deepEqual(staleReceipts(entries, now, {keepMs: 0}), ['Temp/stock-symbols.txt.result-149.txt', 'Temp/ns-getPlayer.txt.result-163.txt']);
    assert.deepEqual(staleReceipts(entries, now, {max: 1}), ['Temp/ns-getPlayer.txt.result-163.txt']);
    assert.deepEqual(staleReceipts(entries, Number.NaN), []);
});

test('staleResultFiles only prunes old receipts inside the results directory', () => {
    const now = 1_000_000;
    const entries = [
        { name: 'remote-control/results/current.json', mtime: now - 1000 },
        { name: 'remote-control/results/old.json', mtime: now - 700_000 },
        { name: 'remote-control/results/unknown.json' },
        { name: 'tasks/dashboard.json', mtime: now - 900_000 },
    ];
    assert.deepEqual(staleResultFiles(entries, now), ['remote-control/results/old.json', 'remote-control/results/unknown.json']);
    assert.deepEqual(staleResultFiles(entries, now, { keepMs: 2_000_000 }), ['remote-control/results/unknown.json']);
});

test('staleTempCaches never touches scripts or fresh caches', () => {
    const now = 2_000_000;
    const entries = [
        { name: 'Temp/ns-ls.txt', mtime: now - 7_200_000 },
        { name: 'Temp/fresh.txt', mtime: now - 1000 },
        { name: 'Temp/job.js', mtime: now - 7_200_000 },
        { name: 'tasks/state.json', mtime: now - 7_200_000 },
    ];
    assert.deepEqual(staleTempCaches(entries, now), ['Temp/ns-ls.txt']);
});

test('dark net receipts are host-owned, not PID-owned, and are reclaimed by age',()=>{
 // A darknet hostname can be numeric; it is still not a PID, and deleting a live host's receipt
 // loses that host's reward accounting.
 assert.equal(pidOwner('tasks/dnet-cache-rewards-123.json'),null);
 assert.equal(pidOwner('tasks/dnet-cache-rewards-ecorp-hub.json'),null);
 const now=10_000_000, old=now-7*3600*1000, fresh=now-60_000;
 const entries=[
  {name:'tasks/dnet-survey-ecorp-hub.json',mtime:old},
  {name:'tasks/dnet-solver-zero_day.json',mtime:old},
  {name:'tasks/dnet-cache-rewards-123.json',mtime:old},
  {name:'tasks/dnet-survey-live-host.json',mtime:fresh},
  {name:'tasks/dnet-cache-rewards-summary.json',mtime:old},
  {name:'tasks/dnet-cache-context.json',mtime:old},
  {name:'tasks/dnet-charisma-goal.json',mtime:old},
  {name:'tasks/dnet-storm-result.json',mtime:old},
  {name:'tasks/dnet-frontier.json',mtime:old},
  {name:'tasks/dnet-survey-unknown-mtime.json'},
  {name:'tasks/gang-growth.json',mtime:old},
 ];
 const stale=staleDarknetState(entries,now,{keepMs:6*3600*1000,max:10});
 assert.deepEqual(stale.sort(),['tasks/dnet-cache-rewards-123.json','tasks/dnet-solver-zero_day.json','tasks/dnet-survey-ecorp-hub.json']);
 assert.equal(staleDarknetState(entries,now,{keepMs:6*3600*1000,max:1}).length,1);
 assert.deepEqual(staleDarknetState(entries,now,{keepMs:24*3600*1000,max:10}),[]);
});
