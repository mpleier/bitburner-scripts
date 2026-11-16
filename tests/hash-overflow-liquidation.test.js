import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../spend-hacknet-hashes.js', import.meta.url), 'utf8');

test('hashes that would overflow are converted to money instead of parked', () => {
  // The capacity branch used to report 'saving' and continue, skipping the sell-for-money fallback below it, so
  // a nearly-full pool (17,020 of 17,024) sat idle while production kept adding hashes.
  const branch = src.indexOf("await report('saving',{reason:'Overflow becomes cash automatically;");
  assert.ok(branch > 0, 'the saving branch must exist');
  const liquidation = src.lastIndexOf('await fnSpendHashes([sellForMoney], false);', branch);
  assert.ok(liquidation > 0 && liquidation < branch, 'liquidation must run before the saving report');
  const window = src.slice(liquidation - 260, branch);
  assert.match(window, /if \(remaining < hashesEarnedNextTick\) \{/, 'only overflow triggers the extra sale');
  assert.match(window, /currentHashes = lastHashBalance = ns\.hacknet\.numHashes\(\);/);
});

test('the capacity-upgrade path keeps its own sell-height fallback', () => {
  assert.ok((src.match(/await fnSpendHashes\(\[sellForMoney\], false\);/g) || []).length >= 2,
    'both the overflow branch and the capacity path convert leftovers to cash');
});
