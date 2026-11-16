import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const creds = readFileSync(new URL('../darknet-credentials.js', import.meta.url), 'utf8');
const daemon = readFileSync(new URL('../daemon.js', import.meta.url), 'utf8');

test('credentials are only stored for servers that exist', () => {
  // Guessed tokens (reversed names, '0', padding) grew the bundle to 49,561 entries / 1.87 MB,
  // which was then copied to 91 darknet hosts (191 MB) and pushed the save to 267 MB.
  assert.match(creds, /if\(ns\.serverExists\(host\)===false\)return;/);
});

test('the credential bundle compacts itself when it grows past the threshold', () => {
  // The cap must sit in commit(): a refresh-time cap is undone by the home merge of host reports.
  assert.match(creds, /const commit=async\(\)=>\{/);
  assert.match(creds, /if\(home&&local\.size>2000\)\{/);
  assert.match(creds, /slice\(0,2000\)/);
  assert.ok(creds.indexOf('local.size>2000')>creds.indexOf('const commit=async()=>{'));
});

test('dead credential archives are pruned on a schedule', () => {
  assert.match(daemon, /interval: 900000, name: "cleanup-leaks\.js", minRamReq: 8,/);
  assert.match(daemon, /args: \['--purge-home-archives'\]/);
  assert.match(daemon, /shouldRun: \(\) => ns\.ls\('home', 'tasks\/credential-archive-'\)\.length > 2/);
});
