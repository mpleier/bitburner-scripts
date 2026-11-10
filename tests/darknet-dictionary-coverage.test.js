import test from 'node:test';
import assert from 'node:assert/strict';
import {EUCountries, defaultSettingsDictionary, dogNameDictionary, commonPasswordDictionary} from '../darknet-dictionaries.js';

test('EU devices use exactly the official country list', () => {
  assert.equal(EUCountries.length, 27);
  for (const name of ['Austria', 'Republic of Cyprus', 'Czech Republic', 'Netherlands', 'Sweden']) assert.ok(EUCountries.includes(name), name);
  // Short aliases are not in the game's generator, so they would only waste guesses.
  assert.ok(!EUCountries.includes('Cyprus'));
  assert.ok(!EUCountries.includes('Czechia'));
  assert.equal(new Set(EUCountries).size, EUCountries.length);
});

test('every dictionary is unique and matches the game-sized set', () => {
  assert.deepEqual([...defaultSettingsDictionary], ['admin', 'password', '0000', '12345']);
  assert.deepEqual([...dogNameDictionary], ['fido', 'spot', 'rover', 'max']);
  assert.equal(commonPasswordDictionary.length, 93);
  assert.ok(commonPasswordDictionary.includes('123456'));
  assert.ok(commonPasswordDictionary.includes('matrix'));
  for (const dictionary of [defaultSettingsDictionary, dogNameDictionary, EUCountries, commonPasswordDictionary]) {
    assert.equal(new Set(dictionary).size, dictionary.length, 'dictionaries must not repeat entries');
  }
});
