import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {main as authWorker} from '../darknet-auth.js';
import {main as bleedWorker} from '../darknet-bleed.js';

test('the authentication worker makes one native call and writes the result for the parent', async () => {
  const calls = [];
  const ns = {
    args: ['target-host', 'secret', '/Temp/call.json'],
    dnet: {authenticate: async (host, password) => { calls.push(['auth', host, password]); return {success: false, code: 401}; }},
    write: async (file, text) => calls.push(['write', file, JSON.parse(text)]),
  };
  await authWorker(ns);
  assert.deepEqual(calls[0], ['auth', 'target-host', 'secret']);
  assert.equal(calls[1][1], '/Temp/call.json');
  assert.equal(calls[1][2].code, 401);
});

test('the heartbleed worker forwards log options and reports the scraped logs', async () => {
  const calls = [];
  const ns = {
    args: ['target-host', JSON.stringify({peek: true, logsToCapture: 5}), '/Temp/call.json'],
    dnet: {heartbleed: async (host, options) => { calls.push([host, options]); return {success: true, logs: ['entry']}; }},
    write: async (_file, text) => calls.push(['write', JSON.parse(text)]),
  };
  await bleedWorker(ns);
  assert.deepEqual(calls[0], ['target-host', {peek: true, logsToCapture: 5}]);
  assert.deepEqual(calls[1][1].logs, ['entry']);
});

test('a failed native call is reported instead of thrown so the parent can fall back', async () => {
  const writes = [];
  const ns = {args: ['host', 'pw', '/Temp/call.json'], dnet: {authenticate: async () => { throw Error('offline'); }}, write: async (_f, text) => writes.push(JSON.parse(text))};
  await authWorker(ns);
  assert.equal(writes[0].success, false);
  assert.match(writes[0].message, /darknet-auth worker: Error: offline/);
});

test('the scout borrows free RAM for threaded calls and never starves the loot helper', () => {
  const src = readFileSync(new URL('../darknet-node.js', import.meta.url), 'utf8');
  assert.match(src, /const authWorker = 'darknet-auth\.js', bleedWorker = 'darknet-bleed\.js'/);
  assert.match(src, /const threads = workerThreads\(authWorker\);/);
  assert.match(src, /if \(threads >= 4\)/);
  assert.match(src, /const delegated = await runWorker\(authWorker, threads, \[host, password\]\)/);
  assert.match(src, /delegated \? \(delegated\.success \? await claimSession\(host, password\) : delegated\)/);
  assert.match(src, /const result = await runWorker\(file, threads, values\);/);
  assert.match(src, /withLootPaused\(\(\)=>solveFeedbackPassword/);
  assert.match(src, /if \(workerThreads\(authWorker\) >= 4 \|\| workerThreads\(authWorker, helperRam\) < 4\) return fn\(\);/);
  assert.match(src, /ns\.exec\(lootFile, host, loot\.threads \|\| 1\)/);
  assert.match(src, /"darknet-auth\.js", "darknet-bleed\.js"/);
});

test('the manager prunes stale darknet heartbeats within a bounded per-cycle budget', () => {
  const src = readFileSync(new URL('../darknet-manager.js', import.meta.url), 'utf8');
  assert.match(src, /let lastHeartbeatPrune = 0;/);
  assert.match(src, /if \(pruned >= 1500\) break;/);
  assert.match(src, /record\.at > pruneNow - 6 \* 3600000/);
  assert.match(src, /if \(ns\.rm\(file, 'home'\)\) pruned\+\+;/);
  assert.match(src, /"darknet-auth\.js", "darknet-bleed\.js"/);
});
