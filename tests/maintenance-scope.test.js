import test from 'node:test';
import assert from 'node:assert/strict';
import {maintenanceRequested} from '../runtime-policy.js';

const lease = (file, payload = {}, running = true) => ({
  read: () => JSON.stringify({ownerPid: 1, expiresAt: Date.now() + 30000, ...payload}),
  isRunning: () => running,
  getScriptName: () => file,
});

test('a scoped maintenance lease pauses only the script being replaced', () => {
  const scoped = {scripts: ['gangs.js']};
  assert.equal(maintenanceRequested(lease('gangs.js', scoped)), true);
  assert.equal(maintenanceRequested(lease('darknet-manager.js', scoped)), false);
  assert.equal(maintenanceRequested(lease('/gangs.js', scoped)), true, 'a leading slash must not defeat the match');
  // An explicit caller name wins over the derived one.
  assert.equal(maintenanceRequested(lease('gangs.js', scoped), 'daemon.js'), false);
});

test('legacy or unscoped leases still pause everything', () => {
  assert.equal(maintenanceRequested(lease('daemon.js')), true);
  assert.equal(maintenanceRequested(lease('daemon.js', {scripts: []})), true);
  // Harnesses without getScriptName keep the old blanket behaviour rather than exploding.
  const bare = {read: () => JSON.stringify({ownerPid: 1, expiresAt: Date.now() + 30000, scripts: ['x.js']}), isRunning: () => true};
  assert.equal(maintenanceRequested(bare), true);
});

test('a stale or owner-dead lease is inert for every caller', () => {
  assert.equal(maintenanceRequested(lease('gangs.js', {scripts: ['gangs.js']}, false)), false);
  assert.equal(maintenanceRequested({
    read: () => JSON.stringify({ownerPid: 1, expiresAt: 0, scripts: ['gangs.js']}),
    isRunning: () => true,
    getScriptName: () => 'gangs.js',
  }), false);
  assert.equal(maintenanceRequested({read: () => { throw Error('no file'); }, isRunning: () => true, getScriptName: () => 'x.js'}), false);
});
