import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareResetBackup} from '../reset-backup.js';

function fixture({answerOn = 1, status = 'saved'} = {}) {
  const files = new Map();
  const requests = [];
  const ns = {
    pid: 4242,
    getResetInfo: () => ({currentNode: 15, lastAugReset: 111, lastNodeReset: 222}),
    read: file => files.get(file) || '',
    sleep: async () => {},
    print: () => {},
    write: async (file, value) => {
      files.set(file, value);
      if (file !== 'tasks/save-backup-request.json') return;
      const request = JSON.parse(value);
      requests.push(request);
      if (requests.length >= answerOn) {
        files.set('tasks/save-backup-receipt.json', JSON.stringify({
          id: request.id, status, bytes: status === 'saved' ? 1024 : 0, at: Date.now(),
        }));
      }
    },
  };
  // The export path needs Singularity; leaving it absent exercises the caught-failure branch.
  ns.singularity = {};
  return {ns, requests, files};
}

test('a request the listener misses is retried inside one budget', async () => {
  const {ns, requests, files} = fixture({answerOn: 2});
  const result = await prepareResetBackup(ns, 'augmentation reset', 400);
  assert.equal(requests.length, 2, 'the first silent window must be followed by a retry');
  assert.notEqual(requests[0].id, requests[1].id, 'each attempt uses its own request id');
  assert.equal(result.backup, 'saved');
  assert.equal(result.receipt.id, requests[1].id);
  assert.ok(files.has('tasks/reset-backup-status.json'));
});

test('every request expires inside the listeners one-minute window', async () => {
  const {ns, requests} = fixture({answerOn: 99});
  const before = Date.now();
  const result = await prepareResetBackup(ns, 'BitNode departure', 400);
  assert.equal(result.backup, 'unavailable');
  assert.ok(requests.length >= 1);
  for (const request of requests) {
    assert.ok(request.expiresAt <= before + 60000, 'the listener rejects expiries beyond a minute');
    assert.ok(request.expiresAt > before, 'an expired-before-send request would be ignored');
  }
});

test('a failed receipt stops the retry loop immediately', async () => {
  const {ns, requests} = fixture({answerOn: 1, status: 'failed'});
  const result = await prepareResetBackup(ns, 'Red Pill installation', 400);
  assert.equal(requests.length, 1, 'a definitive failure must not be retried');
  assert.equal(result.backup, 'unavailable');
  assert.equal(result.receipt.status, 'failed');
});
