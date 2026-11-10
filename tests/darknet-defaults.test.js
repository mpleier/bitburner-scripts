import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCandidates, passwordLengthMatches} from '../darknet-solvers.js';
import {defaultSettingsDictionary} from '../darknet-dictionaries.js';

test('default-password devices use exactly the game dictionary', () => {
  assert.deepEqual([...defaultSettingsDictionary], ['admin', 'password', '0000', '12345']);
  assert.deepEqual(modelCandidates({modelId: 'FreshInstall_1.0', passwordLength: 5, passwordFormat: 'alphabetic'}), ['admin', 'password', '0000', '12345']);
});

test('buffer overflow uses the mask character twice the buffer length', () => {
  const candidates = modelCandidates({modelId: 'Pr0verFl0', passwordLength: 6});
  assert.deepEqual(candidates, ['■'.repeat(12)]);
  assert.equal(passwordLengthMatches({modelId: 'Pr0verFl0', passwordLength: 6}, '■'.repeat(12)), true);
  assert.equal(passwordLengthMatches({modelId: 'Pr0verFl0', passwordLength: 6}, '■'.repeat(6)), true);
  assert.ok(!candidates.includes('A'.repeat(12)), 'the mask must be the game\u2019s \u25a0 character, not a plain letter');
});
