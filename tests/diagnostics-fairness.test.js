import {boundedDiagnostics, freshValue} from '../diagnostics-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const isBlank = value => value && typeof value === 'object' && value.truncated === true && Object.keys(value).length === 1;

/** Mirrors the live automation.status shape: two heavy blocks first, then a long tail of small ones. */
function payload() {
 const heavy = fields => {
  const out = {};
  for (let i = 0; i < fields; i++) {
   out['field' + i] = {at: i, counts: {operations: i, overruns: i}, nested: {a: i, b: [i, i + 1]}};
  }
  return out;
 };
 const blocks = {go: heavy(90), dashboard: heavy(120)};
 for (let i = 0; i < 30; i++) blocks['block' + i] = {at: i, state: 'idle', counts: {a: i}};
 return blocks;
}

test('a heavy head no longer starves the tail of the status payload', () => {
 const result = boundedDiagnostics(payload(), true, 65536);
 const blank = Object.keys(result).filter(key => key !== '_diagnostics' && isBlank(result[key]));
 assert.deepEqual(blank, [], 'every block kept at least some content');
 for (let i = 0; i < 30; i++) assert.ok(result['block' + i].state === 'idle', 'block' + i + ' survived with its own fields');
});

test('the node budget is reported per capped block instead of hidden in deep paths', () => {
 const result = boundedDiagnostics(payload(), true, 65536);
 assert.ok(Array.isArray(result._diagnostics.droppedBlocks));
 assert.ok(Array.isArray(result._diagnostics.omitted));
});

test('byte-limit evictions are named in _diagnostics.omitted', () => {
 const result = boundedDiagnostics(payload(), true, 4000);
 assert.ok(result._diagnostics.omitted.length > 0, 'dropped blocks are listed by name');
 for (const key of result._diagnostics.omitted) assert.ok(!(key in result), key + ' was actually removed');
});

test('scalar and array payloads stay wrapped and bounded', () => {
 assert.deepEqual(boundedDiagnostics(5, true, 1024).value, 5);
 const array = boundedDiagnostics([1, 2, 3], true, 1024);
 assert.ok(Array.isArray(array.value));
});

const reset = {lastAugReset: 200, lastNodeReset: 100};

test('freshValue nulls a block written by a previous run', () => {
 assert.equal(freshValue({augReset: 199, at: Date.now()}, reset), null);
 assert.equal(freshValue({nodeReset: 99, at: Date.now()}, reset), null);
 assert.equal(freshValue({augReset: 200, nodeReset: 100, at: Date.now()}, reset).augReset, 200);
});

test('freshValue nulls an over-age block and passes one without stamps', () => {
 assert.equal(freshValue({at: Date.now() - 60000}, reset, 1000), null);
 assert.ok(freshValue({at: Date.now()}, reset, 60000));
 assert.deepEqual(freshValue({state: 'no-stamps'}, reset, 1000), {state: 'no-stamps'});
 assert.equal(freshValue(null, reset), null);
 assert.equal(freshValue(7, reset), 7);
});

test('the dashboard gates the blocks that described the previous run', () => {
 const source = read('reliability-manager.js');
 for (const block of ['hackingDrain', 'nodeRoute', 'speed', 'hgw', 'overview']) {
  assert.match(source, new RegExp(block + ': freshValue|' + block + ':freshValue'), block + ' is gated by freshValue');
 }
 assert.match(source, /budgets: \(b => b && \{ \.\.\.b, at: b\.at \?\? b\.epoch \?\? null \}|budgets:\(b=>b&&\{\.\.\.b,at:b\.at\?\?b\.epoch\?\?null\}/, 'budgets carries a timestamp');
});

test('the status command gates xpMeasurement so a previous run cannot report rates', () => {
 assert.match(read('remote-api-command.js'), /xpMeasurement:\(r=>r\?freshValue\(r,ns\.getResetInfo\(\)\):null\)\(read\("tasks\/xp-measurement\.json"\)\)/);
 assert.match(read('remote-api-command.js'), /const freshValue=\('\+freshValue\.toString\(\)\+'\)/, 'freshValue is inlined into the sandboxed expression');
});

test('a disabled tool that is actually running reports running, not blocked:disabled', () => {
 const source = read('daemon.js');
 const marker = source.indexOf('(launched outside the daemon)');
 assert.ok(marker > 0, 'the disable branch resolves a live owner');
 const start = source.lastIndexOf("if (options['disable-script'].includes(tool.name))", marker);
 assert.ok(start > 0, 'disable branch exists');
 const branch = source.slice(start, marker + 400);
 assert.match(branch, /whichServerIsRunning\(ns, tool\.name, false\)/, 'the disable branch checks liveness first');
 assert.match(branch, /tool\.lastOutcome = 'running'/, 'a live process is reported as running');
 assert.ok(branch.indexOf("tool.lastOutcome = 'running'") < branch.indexOf("blocked('disabled')"), 'running wins over the disable reason');
});
