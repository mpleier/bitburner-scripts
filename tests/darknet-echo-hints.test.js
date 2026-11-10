import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCandidates} from '../darknet-solvers.js';

test('echo hints reveal the password for every template the game uses', () => {
  // Templates from ServerGenerator.getEchoVulnConfig, all of the form "<template> <password>".
  const cases = [
    ['The password is 482', '482'],
    ['The PIN is 85', '85'],
    ['Remember to use 731', '731'],
    ["It's set to 71", '71'],
    ['The key is 253', '253'],
    ['The secret is 900', '900'],
  ];
  for (const [passwordHint, expected] of cases) {
    const candidates = modelCandidates({modelId: 'DeskMemo_3.1', passwordLength: expected.length, passwordFormat: 'numeric', passwordHint, data: ''});
    assert.ok(candidates.includes(expected), passwordHint + ' -> ' + JSON.stringify(candidates));
  }
});
