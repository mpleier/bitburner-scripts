/** The Dark Net workers sync `DARKNET_CODE_FILES` to every host they run on, so a module that is
 *  imported but not listed deploys a host that cannot load its own entrypoint. That is how a
 *  stasis-linked host ended up reported as unreachable: the code was there, its dependency was not.
 *
 *  The scout (`darknet-node.js`) is what runs remotely — `refreshDarknetScouts` scps the list and
 *  execs it on each host — so its transitive imports must be exactly deployable. The coordinator
 *  (`darknet-manager.js`) is supervised on home by `daemon.js` and reads its imports from the home
 *  filesystem, so pulling its home-only policy modules into the remote list would only add sync
 *  traffic and RAM to 20+ darknet hosts. It is therefore checked for resolvable imports, not for
 *  deployability. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DARKNET_CODE_FILES} from '../darknet-crack-policy.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const relativePath = file => relative(root, file).split('\\').join('/');

function localImports(file) {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/from\s+['"](\.[^'"]*)['"]/g)].map(match => relativePath(resolve(dirname(file), match[1])));
}

/** Every repository file reachable through relative imports, excluding the entrypoint itself. */
function reachable(entry, seen = new Set()) {
  for (const file of localImports(resolve(root, entry))) {
    if (seen.has(file)) continue;
    seen.add(file);
    reachable(file, seen);
  }
  return seen;
}

test('the scout deploys every module it imports, transitively', () => {
  const deployed = new Set(DARKNET_CODE_FILES);
  const missing = [...reachable('darknet-node.js')].filter(file => !deployed.has(file)).sort();
  assert.deepEqual(missing, [], 'darknet-node.js runs on darknet hosts, so its imports have to be in DARKNET_CODE_FILES');
});

test('every deployed module imports only deployed modules', () => {
  const deployed = new Set(DARKNET_CODE_FILES);
  const escapes = DARKNET_CODE_FILES
    .filter(file => file.endsWith('.js'))
    .flatMap(file => [...reachable(file)].filter(imported => !deployed.has(imported)).map(imported => `${file} -> ${imported}`))
    .sort();
  assert.deepEqual(escapes, []);
});

test('the coordinator imports resolve, since it runs from home', () => {
  const imported = [...reachable('darknet-manager.js')];
  assert.ok(imported.length > 0, 'expected the coordinator to import its policy modules');
  assert.deepEqual(imported.filter(file => !existsSync(resolve(root, file))), []);
});

// `tasks/dnet-cache-context.json` is written by the coordinator at startup and only synced once it
// exists, so it is runtime data rather than repository content.
test('every deployed script exists', () => {
  const scripts = DARKNET_CODE_FILES.filter(file => file.endsWith('.js'));
  assert.deepEqual(scripts.filter(file => !existsSync(resolve(root, file))), []);
});
