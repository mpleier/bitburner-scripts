import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manager = readFileSync(new URL('../darknet-manager.js', import.meta.url), 'utf8');

test('darknet per-host state is pruned on an hour, not six', () => {
  // A survey is written per host per cycle, and the UI only reads the newest 600 files; a six-hour window
  // parked thousands of records (3,481 in the live save) for data nothing would ever read again.
  assert.match(manager, /record\.at > pruneNow - 3600000/);
  assert.doesNotMatch(manager, /record\.at > pruneNow - 6 \* 3600000/);
});

test('the prune keeps its bounded per-cycle budget and skips deliberate caches', () => {
  assert.match(manager, /for \(const file of ns\.ls\('home', 'tasks\/dnet-'\)\)/);
  assert.match(manager, /if \(pruned >= 1500\) break;/);
  assert.match(manager, /-\(cache\|solver\|phishing\|loot\|navigator\|anchor\|storm\)/);
});
