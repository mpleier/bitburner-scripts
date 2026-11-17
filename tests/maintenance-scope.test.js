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

test('sleeve control follows the lease scope instead of treating any lease as a global hold', async () => {
  const {sleeveControlAllowed} = await import('../sleeve-policy.js');
  const controller = (payload) => ({
    read: (file) => file === 'tasks/automation-maintenance.json' ? JSON.stringify(payload) : '',
    isRunning: () => true,
  });
  const leaseFor = (scripts, extra = {}) => controller({ownerPid: 7, expiresAt: Date.now() + 30000, scripts, ...extra});
  // Reloading gangs.js or daemon.js once froze every sleeve task; the lease names what it replaces.
  assert.equal(sleeveControlAllowed(leaseFor(['gangs.js']), 7, 'sleeve.js'), true);
  assert.equal(sleeveControlAllowed(leaseFor(['daemon.js', 'stats.js']), 7, 'sleeve.js'), true);
  assert.equal(sleeveControlAllowed(leaseFor(['/sleeve.js']), 7, 'sleeve.js'), false, 'a leading slash must not defeat the match');
  // A lease that names no scripts is a legacy global hold, and an expired or orphaned lease is no hold at all.
  assert.equal(sleeveControlAllowed(leaseFor(undefined), 7, 'sleeve.js'), false);
  assert.equal(sleeveControlAllowed(leaseFor([]), 7, 'sleeve.js'), false);
  assert.equal(sleeveControlAllowed(leaseFor(['sleeve.js'], {expiresAt: Date.now() - 1}), 7, 'sleeve.js'), true);
  assert.equal(sleeveControlAllowed({read: () => '', isRunning: () => true}, 7, 'sleeve.js'), true);
  // The parent pid and pause flag still gate independently of the lease.
  assert.equal(sleeveControlAllowed({...leaseFor(['gangs.js']), isRunning: () => false}, 7, 'sleeve.js'), false);
  assert.equal(sleeveControlAllowed({read: (file) => file.startsWith('remote-control/paused/') ? 'true' : '', isRunning: () => true}, 7, 'sleeve.js'), false);
});

test('the maintenance lease stops being published once demand outlives its bound', async () => {
  const {maintenanceLease} = await import('../runtime-policy.js');
  const now = 1_000_000;
  const first = maintenanceLease({ownerPid: 7, scripts: ['gangs.js'], now});
  assert.deepEqual(first.lease, {ownerPid: 7, expiresAt: now + 30000, scripts: ['gangs.js']});
  assert.equal(first.startedAt, now, 'continuous demand starts counting on the first pass that asks for it');
  assert.equal(first.suppressed, false);
  // Renewing inside the bound keeps the lease alive at its original start time.
  const renew = maintenanceLease({ownerPid: 7, scripts: ['gangs.js'], startedAt: first.startedAt, now: now + 60000});
  assert.deepEqual(renew.lease, {ownerPid: 7, expiresAt: now + 90000, scripts: ['gangs.js']});
  assert.equal(renew.startedAt, now);
  // Past the bound nothing is published, and the caller is told it was suppressed.
  const stuck = maintenanceLease({ownerPid: 7, scripts: ['gangs.js'], startedAt: first.startedAt, now: now + 120001});
  assert.equal(stuck.lease, null);
  assert.equal(stuck.suppressed, true);
  assert.equal(stuck.startedAt, now, 'the suppression keeps reporting the same start, so the warning names a real age');
  // Demand that clears resets the clock, so the next reload gets a fresh budget.
  const cleared = maintenanceLease({ownerPid: 7, scripts: [], startedAt: first.startedAt, now: now + 90000});
  assert.deepEqual(cleared, {startedAt: 0, lease: null, suppressed: false});
  const later = maintenanceLease({ownerPid: 7, scripts: ['stats.js'], startedAt: cleared.startedAt, now: now + 200000});
  assert.equal(later.lease.expiresAt, now + 230000);
  assert.equal(later.suppressed, false);
});
