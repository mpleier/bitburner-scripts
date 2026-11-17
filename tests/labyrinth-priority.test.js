import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manager = readFileSync(new URL('../darknet-manager.js', import.meta.url), 'utf8');
const node = readFileSync(new URL('../darknet-node.js', import.meta.url), 'utf8');

test('an unsolved labyrinth is reported as the top priority every cycle', () => {
  // A navigator stuck at 0 moves used to be a single quiet log line among hundreds.
  assert.match(manager, /const unsolvedMazes=snapshot\.navigators\.filter\(n=>n&&n\.phase!=='solved'\);/);
  assert.match(manager, /const labyrinthPending=unsolvedMazes\.length>0\|\|snapshot\.surveys\.some\(r=>r&&r\.modelId==='\(The Labyrinth\)'&&!r\.rooted\);/);
  assert.match(manager, /note\('labyrinth:priority','TOP PRIORITY labyrinth: '/);
});

test('anchor and migration housekeeping waits while the labyrinth is pending', () => {
  assert.match(manager, /if\(!labyrinthPending\)await coordinateDarknetAnchors\(ns,reports,passwords,reset,values\);/);
});

test('the navigator evicts the loot collector rather than waiting for RAM', () => {
  // The maze is the BitNode-15 route to The Red Pill; cache collection can resume afterwards.
  assert.match(node, /if\(ram>0&&capacity<ram&&loot\)\{try\{ns\.kill\(loot\.pid\);\}catch\{\}capacity=ns\.getServerMaxRam\(source\)-ns\.getServerUsedRam\(source\);\}/);
  assert.ok(node.indexOf('ns.kill(loot.pid)') < node.indexOf("host+':maze-ram'"));
});

test('an unsolved maze is a deployment target, with the host its navigator occupies', () => {
  // Only rooted labyrinths used to reach the deployment set, so an unsolved maze never got a worker.
  assert.match(manager, /if \(report\.modelId === '\(The Labyrinth\)' && !report\.rooted\) targets\.add\(report\.host\);/);
  assert.match(manager, /targets\.add\(n\.target\);/);
  assert.match(manager, /if \(typeof n\.host === 'string' && n\.host\) targets\.add\(n\.host\);/);
});

test('the labyrinth target survives a manager restart', () => {
  assert.match(manager, /tasks\/dnet-labyrinth-target\.json/);
});

test('the persisted labyrinth host re-enters the target set on the next cycle', () => {
  assert.match(manager, /const saved = JSON\.parse\(ns\.read\('tasks\/dnet-labyrinth-target\.json'\)\);/);
  assert.match(manager, /saved\.nodeReset === ns\.getResetInfo\(\)\.lastNodeReset/);
  assert.match(manager, /Date\.now\(\) - saved\.at < 21600000\) targets\.add\(saved\.host\)/);
});
