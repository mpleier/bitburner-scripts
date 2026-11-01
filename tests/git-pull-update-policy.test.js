import test from 'node:test';
import assert from 'node:assert/strict';
import {liveStatePaths, replaceableUpdatePath} from '../git-pull.js';

test('updates never replace live game state that shares a repository filename', () => {
  for (const path of ['reserve.txt', '/reserve.txt', 'home-ram-reserve.txt', 'darknet-passwords.txt'])
    assert.equal(replaceableUpdatePath(path), false, path);
  for (const path of ['darknet-candidates.txt', 'daemon.js', 'Tasks/ram-manager.js', 'helpers.js.config.txt'])
    assert.equal(replaceableUpdatePath(path), true, path);
  assert.deepEqual([...liveStatePaths].sort(), ['darknet-passwords.txt', 'home-ram-reserve.txt', 'reserve.txt']);
});
