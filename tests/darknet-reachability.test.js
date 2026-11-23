import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {darknetDirectlyReachable,stasisLinkedDetails} from '../darknet-throughput-policy.js';

const source = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('a darknet host is only reachable through a direct link, a stasis link or an installed backdoor', () => {
  assert.equal(darknetDirectlyReachable('alpha', {hasSession:false}, ['alpha','beta']), true);
  assert.equal(darknetDirectlyReachable('gamma', {}, ['alpha','beta']), false);
  assert.equal(darknetDirectlyReachable('gamma', {hasStasisLink:true}, []), true);
  assert.equal(darknetDirectlyReachable('gamma', {backdoorInstalled:true}, []), true);
  assert.equal(darknetDirectlyReachable('gamma', {}, null), false);
  assert.equal(darknetDirectlyReachable('gamma', undefined, undefined), false);
});

test('live stasis links are merged into server details before the reachability gate', () => {
  const details = {hasSession: false};
  assert.equal(stasisLinkedDetails(details, 'gamma', ['gamma']).hasStasisLink, true);
  assert.equal(stasisLinkedDetails(details, 'delta', ['gamma']), details);
  assert.equal(darknetDirectlyReachable('gamma', stasisLinkedDetails(details, 'gamma', ['gamma']), []), true);
});

test('the manager refuses to spend password attempts on hosts it cannot reach', () => {
  const manager = source('darknet-manager.js');
  const start = manager.indexOf('const authenticate = async (host, details, saved, candidates) => {');
  assert.ok(start > 0, 'authenticate() must still exist');
  const body = manager.slice(start, start + 2500);
  const gate = body.indexOf('darknetDirectlyReachable(host, details, neighbours)');
  const firstAttempt = body.indexOf('trySavedPassword(host');
  assert.ok(gate > 0, 'authenticate() must gate on a direct connection');
  assert.ok(firstAttempt > gate, 'the gate must run before any password is tried');
  assert.match(body, /leaving authentication to the adjacent worker/);
});

test('both darknet workers share one reachability rule instead of an inline copy', () => {
  for (const file of ['darknet-manager.js', 'darknet-node.js']) {
    const text = source(file);
    assert.match(text, /darknetDirectlyReachable/, file + ' must use the shared rule');
    assert.doesNotMatch(text, /hasStasisLink === true \|\| d\?\.backdoorInstalled === true \|\|/, file + ' still has an inline copy');
  }
});
