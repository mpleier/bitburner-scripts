import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCandidates} from '../darknet-solvers.js';
import {dogNameDictionary} from '../darknet-dictionaries.js';

test('dog-name devices use exactly the game dictionary', () => {
  assert.deepEqual([...dogNameDictionary], ['fido', 'spot', 'rover', 'max']);
  assert.deepEqual(modelCandidates({modelId: 'Laika4', passwordLength: 4, passwordFormat: 'alphabetic'}), ['fido', 'spot', 'rover', 'max']);
});

test('sorted-echo permutations are bounded to the lengths the RMS solver does not handle', () => {
  // Length 5 leaks the sorted digits and is cheap to permute; longer puzzles use RMS recovery.
  assert.ok(modelCandidates({modelId: 'PHP 5.4', passwordLength: 5, data: '00123'}).length > 1);
  assert.deepEqual(modelCandidates({modelId: 'PHP 5.4', passwordLength: 8, data: '00012345'}), []);
  assert.deepEqual(modelCandidates({modelId: 'PHP 5.4', passwordLength: 6, data: '000123'}), []);
});
