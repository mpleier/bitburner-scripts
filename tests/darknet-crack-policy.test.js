import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTH_FAILURE, TIMED_OUT, RETRY_AFTER_MS, DARKNET_CODE_FILES, candidatePasswords } from '../darknet-crack-policy.js';

const source = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('response codes and the retry window match the game', () => {
  assert.equal(AUTH_FAILURE, 401);
  assert.equal(TIMED_OUT, 408);
  assert.equal(RETRY_AFTER_MS, 10 * 60_000);
});

test('the deploy list is deduplicated and carries every worker dependency', () => {
  assert.equal(new Set(DARKNET_CODE_FILES).size, DARKNET_CODE_FILES.length);
  assert.ok(Object.isFrozen(DARKNET_CODE_FILES), 'both entrypoints share this list, so it must not be mutated');
  for (const file of ['darknet-node.js', 'darknet-solvers.js', 'darknet-crack-policy.js', 'darknet-feedback.js', 'darknet-auth.js', 'tasks/dnet-cache-context.json'])
    assert.ok(DARKNET_CODE_FILES.includes(file), file + ' must be deployed to darknet workers');
});

test('both entrypoints sync the shared list instead of keeping their own copy', () => {
  for (const file of ['darknet-node.js', 'darknet-manager.js']) {
    assert.match(source(file), /const codeFiles = DARKNET_CODE_FILES;/);
    assert.match(source(file), /candidatePasswords/);
  }
});

test('a host with no password accepts the empty string', () => {
  assert.deepEqual(candidatePasswords({ modelId: 'ZeroLogon', passwordLength: 0, passwordFormat: 'numeric' }, ['x']), ['']);
});

test('a password stated in a log outranks every heuristic', () => {
  const details = { modelId: 'NIL', passwordLength: 3, passwordFormat: 'numeric' };
  assert.equal(candidatePasswords(details, ['111', '222'], { stated: '456' })[0], '456');
});

test('digits mined from the clue lead on numeric hosts', () => {
  const details = { modelId: 'NIL', passwordLength: 3, passwordFormat: 'numeric', data: 'a1b2c3', passwordHint: 'type the numbers' };
  assert.equal(candidatePasswords(details, [])[0], '123');
});

test('candidates that cannot match the length or format are filtered out', () => {
  const details = { modelId: 'NIL', passwordLength: 4, passwordFormat: 'numeric' };
  const candidates = candidatePasswords(details, ['abcd', '1234', '12']);
  assert.ok(candidates.includes('1234'));
  assert.equal(candidates.includes('abcd'), false);
  assert.equal(candidates.includes('12'), false);
});
