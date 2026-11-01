import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {relativeWorkerDependencies} from '../worker-dependency-policy.js';

test('worker dependency graphs follow relative imports, deduplicate cycles and normalize paths', () => {
  const files = {
    'daemon.js': "import {x} from './helpers.js';",
    'helpers.js': "import {a} from './home-ram-policy.js';\nimport {b} from './bitnode-fallbacks.js';",
    'home-ram-policy.js': "import './helpers.js';",
    'Remote/hack-target.js': "import {p} from './hgw-telemetry.js';",
    'Remote/hgw-telemetry.js': '',
    'Tasks/entry.js': "import '../helpers.js';",
  };
  const read = file => files[file] || '';
  assert.deepEqual(relativeWorkerDependencies('daemon.js', read), ['helpers.js', 'home-ram-policy.js', 'bitnode-fallbacks.js']);
  assert.deepEqual(relativeWorkerDependencies('Remote/hack-target.js', read), ['Remote/hgw-telemetry.js']);
  assert.deepEqual(relativeWorkerDependencies('Tasks/entry.js', read), ['helpers.js', 'home-ram-policy.js', 'bitnode-fallbacks.js']);
  assert.deepEqual(relativeWorkerDependencies('Remote/hgw-telemetry.js', read), []);
});

test('every HGW worker declares the shared telemetry module as a deployable dependency', () => {
  const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  for (const worker of ['Remote/hack-target.js', 'Remote/grow-target.js', 'Remote/weak-target.js', 'Remote/manualhack-target.js'])
    assert.deepEqual(relativeWorkerDependencies(worker, read), ['Remote/hgw-telemetry.js'], worker);
  const daemon = read('daemon.js');
  assert.match(daemon, /relativeWorkerDependencies\(tool\.name, file => ns\.read\(file\)\)/);
  assert.match(daemon, /addDependency\(getFilePath\(dependency\)\)/);
});
