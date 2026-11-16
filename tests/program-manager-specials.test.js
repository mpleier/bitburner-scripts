import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../Tasks/program-manager.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

test('Formulas.exe is bought, but never at the expense of the augmentation basket', () => {
  // It unlocks ns.formulas for HGW projection, bladeburner economics, combat XP value and gang quotes.
  assert.match(source, /const optionalPrograms=\['Formulas\.exe'\];/);
  assert.match(source, /for\(const program of \[\.\.\.programNames,\.\.\.optionalPrograms\]\)\{/);
  // A 25% margin means a quiet moment cannot spend 5b that the augmentation basket needed.
  assert.match(source, /const margin=optionalPrograms\.includes\(program\)\?cost\*0\.25:0;/);
  assert.match(source, /if\(ns\.getPlayer\(\)\.money-cost-margin<reserve\)\{nextCost=Math\.min\(nextCost,cost\+margin\);continue;\}/);
  // The manager must keep running until the optional program is owned too, or it would exit before affording it.
  assert.match(source, /if\(!keepRunning\|\|\[\.\.\.programNames,\.\.\.optionalPrograms\]\.every\(p=>ns\.fileExists\(p,'home'\)\)\)return;/);
  // Purchases still go through the native dark-web path and the cash-spending achievement gate.
  assert.match(source, /ns\.singularity\.getDarkwebProgramCost\(program\)/);
  assert.match(source, /ns\.singularity\.purchaseProgram\(program\)/);
  assert.match(source, /achievementActionAllowed\(ns,'cashSpending'\)/);
});
