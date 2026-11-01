import test from 'node:test';
import assert from 'node:assert/strict';
import {bitNodeTooltip} from '../bitnode-overview-policy.js';
test('current BitNode tooltip names the run, next reward and actual conditions',()=>{
 const text=bitNodeTooltip(11,1,{ScriptHackMoney:.1,CompanyWorkMoney:.5,HackingLevelMultiplier:1,DaedalusAugsRequirement:30,DarknetLabyrinthRewardsTheRedPill:0,StaneksGiftExtraSize:-1});
 assert.match(text,/BitNode 11.2 — The Big Crash/);assert.match(text,/Completion earns Source-File 11 level 2/);assert.match(text,/Script Hack Money: ×0.1/);assert.match(text,/Daedalus entry: 30 augmentations/);assert.match(text,/Red Pill: no/);assert.match(text,/extra grid size: -1/);assert.doesNotMatch(text,/Hacking Level:/);
});
test('unavailable data is explicit and capped rewards do not promise a fourth Source File level',()=>{
 assert.match(bitNodeTooltip(11,3),/maximum level/);assert.match(bitNodeTooltip(11,3),/not available/);assert.match(bitNodeTooltip(12,3),/level 4/);
});
