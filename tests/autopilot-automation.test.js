import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {autopilotSourceFiles,installedAugmentationsFromReset,daemonArgumentsChanged,autopilotOptionsError,autopilotStockReserve,priorityAugmentationReady} from '../autopilot-policy.js';
test('autopilot reads owned Source Files without requiring SF4 and preserves disabled overrides',()=>{
 const reset={currentNode:3,ownedSF:new Map([[1,3],[4,1],[10,2]]),bitNodeOptions:{sourceFileOverrides:new Map([[4,0]])}};
 assert.deepEqual(autopilotSourceFiles(reset,false),{1:3,4:1,10:2});
 assert.deepEqual(autopilotSourceFiles(reset,true),{1:3,3:1,10:2});
 assert.equal(autopilotSourceFiles({currentNode:4,ownedSF:{1:1}},true)[4],3);
});
test('installed augmentation cache reads the native reset map without expensive Singularity calls',()=>{
 assert.deepEqual(installedAugmentationsFromReset({ownedAugs:new Map([["The Red Pill",1],["NeuroFlux Governor",25],['Missing',0]])}),['The Red Pill','NeuroFlux Governor']);
 assert.deepEqual(installedAugmentationsFromReset({ownedAugs:{Genesis:1}}),['Genesis']);
});
test('daemon restarts when numeric RAM reservations change even when the flag remains present',()=>{
 assert.equal(daemonArgumentsChanged(['--reserved-ram',1e100],['--reserved-ram',512]),true);
 assert.equal(daemonArgumentsChanged(['--reserved-ram',512],[]),true);
 assert.equal(daemonArgumentsChanged(['--reserved-ram',512],['--reserved-ram',512]),false);
 assert.equal(daemonArgumentsChanged(['--reserved-ram',512,'--reserved-ram',1e100],['--reserved-ram',1e100]),false);
});
test('daemon comparisons ignore harmless order and recovery padding changes but notice removed options',()=>{
 assert.equal(daemonArgumentsChanged(['--disable-script','a','--disable-script','b','--recovery-thread-padding',1],['--recovery-thread-padding',2,'--disable-script','b','--disable-script','a']),false);
 assert.equal(daemonArgumentsChanged(['--xp-only'],[]),true);
 assert.equal(daemonArgumentsChanged(['--disable-script','a'],['--disable-script','b']),true);
 assert.equal(daemonArgumentsChanged(['--queue-delay',50],['--queue-delay',2000]),true);
});
test('autopilot rejects invalid timing and count settings before persisting them',()=>{
 const settings={'interval':2000,'interval-check-scripts':10000,'xp-mode-interval-minutes':55,'high-hack-threshold':8000,'install-countdown':300000,'time-before-boosting-best-hack-server':900000,'reduced-aug-requirement-per-hour':.5,'xp-mode-duration-minutes':5,'spend-hashes-on-server-hacking-threshold':.1,'install-at-aug-count':8,'install-at-aug-plus-nf-count':12,'wait-for-4s-threshold':.9};
 assert.equal(autopilotOptionsError(settings),null);
 for(const extra of [{interval:0},{'install-at-aug-count':1.5},{'install-countdown':NaN},{'xp-mode-duration-minutes':60}])assert.ok(autopilotOptionsError({...settings,...extra}));
});
test('stock reserve leaves startup cash available before the API unlock',()=>{
 assert.equal(autopilotStockReserve(1e6,0,0,false),800000);
 assert.equal(autopilotStockReserve(1e6,0,0,true),8e9);
 assert.equal(autopilotStockReserve(1e15,0,0,true),1e12);
});
test('autopilot preserves manager ownership, casino priority, Black Ops and purchase retries',async()=>{
 const source=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/unlockedSFs\[4\] \|\| 0 == 3/);
 assert.match(source,/if \(ns.ps\('home'\).some\(process =>.*casino.*\)\) return true/);
 assert.match(source,/pending: reservedPurchase > 0/);
 assert.match(source,/if \(!pid\) return setStatus\(ns, 'Faction manager could not start/);
 assert.match(source,/autopilot-blackop.txt/);
 assert.match(source,/await ns.write\(configPath/);
 assert.match(source,/--disable-script', corporationScript/);
});

test('priority installation recognizes both affordable and already queued Simulacrum',()=>{
 const priority=["The Blade's Simulacrum"];
 assert.equal(priorityAugmentationReady(priority,{affordable_augs:priority}),true);
 assert.equal(priorityAugmentationReady(priority,{awaiting_install_augs:priority}),true);
 assert.equal(priorityAugmentationReady(priority,{installed_augs:priority,awaiting_install_augs:priority}),false);
 assert.equal(priorityAugmentationReady(priority,{awaiting_install_augs:["The Shadow's Simulacrum"]}),false);
 assert.equal(priorityAugmentationReady([], {awaiting_install_augs:priority}),false);
 assert.equal(priorityAugmentationReady(priority,{}),false);
 assert.equal(priorityAugmentationReady(priority,null),false);
 assert.equal(priorityAugmentationReady(priority,undefined),false);
 assert.equal(priorityAugmentationReady(null,{affordable_augs:priority}),false);
});
test('autopilot defaults to installing Simulacrum through the guarded reset path',async()=>{
 const source=await readFile(new URL('../autopilot.js',import.meta.url),'utf8');
 assert.ok(source.includes(`['install-for-augs', ["The Red Pill", "The Blade's Simulacrum"]]`));
 assert.ok(source.includes("priorityAugmentationReady(options['install-for-augs'], facman)"));
 assert.ok(source.includes('await shouldDelayInstall(ns, player, facman)'));
});
