import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coreDivisionName} from '../corporation-policy.js';

const industries = {Food: 'Agriculture', Chemicals: 'Chemical', Smokes: 'Tobacco'};
const industryOf = name => industries[name];

test('a division created by hand is adopted by industry, not by our preferred name', () => {
  // The corporation UI asks the player to name the division; the cycle addresses "Agri"/"Chem"/"Tobacco" directly.
  assert.equal(coreDivisionName(['Food'], industryOf, 'Agriculture', 'Agri'), 'Food');
  assert.equal(coreDivisionName(['Other', 'Chemicals'], industryOf, 'Chemical', 'Chem'), 'Chemicals');
  assert.equal(coreDivisionName(['Smokes'], industryOf, 'Tobacco', 'Tobacco'), 'Smokes');
});

test('the preferred name is kept when no division owns the industry yet, so creation still works', () => {
  assert.equal(coreDivisionName([], industryOf, 'Agriculture', 'Agri'), 'Agri');
  assert.equal(coreDivisionName(['Chemicals'], industryOf, 'Agriculture', 'Agri'), 'Agri');
  assert.equal(coreDivisionName(null, industryOf, 'Agriculture', 'Agri'), 'Agri');
});

test('an unreadable division never wins the adoption and never throws', () => {
  const throws = name => { if (name === 'Broken') throw new Error('API error'); return 'Agriculture'; };
  assert.equal(coreDivisionName(['Broken'], throws, 'Agriculture', 'Agri'), 'Agri');
  assert.equal(coreDivisionName(['Broken', 'Food'], throws, 'Agriculture', 'Agri'), 'Food');
});

test('the manager adopts core divisions before the cycle touches them', () => {
  const src = readFileSync(new URL('../corporation-manager.js', import.meta.url), 'utf8');
  assert.match(src, /let agri = "Agri";/);
  assert.match(src, /let chem = "Chem";/);
  assert.match(src, /let tobacco = "Tobacco";/);
  assert.match(src, /const adoptCore=\(industry,current\)=>coreDivisionName\(divisions\(\),n=>safe\(`Read \$\{n\} industry`,\(\)=>c\.getDivision\(n\)\)\?\.industry,industry,current\);/);
  assert.match(src, /agri=adoptCore\('Agriculture',agri\);/);
  assert.match(src, /chem=adoptCore\('Chemical',chem\);/);
  // The adoption must run before the first createDivision/expand call of the cycle.
  const adopt = src.indexOf("agri=adoptCore('Agriculture',agri);");
  const create = src.indexOf('createDivision("Agriculture", agri);');
  assert.ok(adopt > 0 && create > adopt, 'adoption must precede division creation');
});
