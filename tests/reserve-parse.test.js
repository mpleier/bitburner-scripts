import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReserve, main} from '../reserve.js';

test('reserve parsing accepts scaled amounts and rejects malformed or negative values', () => {
  assert.equal(parseReserve('250k'), 250000);
  assert.equal(parseReserve('5b'), 5e9);
  assert.equal(parseReserve('0'), 0);
  for (const bad of ['5x', '$5b', '', '-1', 'Infinity', undefined])
    assert.equal(parseReserve(bad), null, String(bad));
});

test('an invalid reserve argument leaves reserve.txt untouched and reports the error', async () => {
  let written;
  const messages = [];
  const ns = {args: ['5x'], write: (file, value) => { written = [file, value]; }, tprint: message => messages.push(message)};
  await main(ns);
  assert.equal(written, undefined);
  assert.match(messages[0], /ERROR: Could not parse "5x"/);
});
