import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {replaySourceHashes,assertReplaySourcesUnchanged,replayProvenance} from '../scripts/go-replay-provenance.js';
const hash=value=>createHash('sha256').update(value).digest('hex');

test('replay fingerprints use a fixed source inventory and normalize only line endings',()=>{
 const seen=[],lf=replaySourceHashes(file=>{seen.push(file);return 'a\nb\n';});
 assert.deepEqual(seen,['go-policy.js','go-replay-policy.js','scripts/go-replay-benchmark-core.js','scripts/benchmark-go-replay.js','scripts/go-replay-provenance.js']);
 assert.deepEqual(replaySourceHashes(()=> 'a\r\nb\r'),lf);assert.equal(lf['go-policy.js'],hash('a\nb\n'));
 assert.notDeepEqual(replaySourceHashes(()=> 'a \nb\n'),lf);
 assert.throws(()=>replaySourceHashes(()=>''),/Missing replay source/);assert.throws(()=>replaySourceHashes(()=>{throw Error('unreadable');}),/unreadable/);
});
test('source stability checks reject missing and changed files',()=>{
 const before=replaySourceHashes(()=> 'source');assert.doesNotThrow(()=>assertReplaySourcesUnchanged(before,{...before}));
 for(const file of Object.keys(before)){assert.throws(()=>assertReplaySourcesUnchanged(before,{...before,[file]:'changed'}),/changed during/);const after={...before};delete after[file];assert.throws(()=>assertReplaySourcesUnchanged(before,after),/changed during/);}
 assert.throws(()=>assertReplaySourcesUnchanged({},{}),/changed during/);
});
test('provenance records exact corpus content, source hashes and runtime without local paths',()=>{
 const corpus={samples:[{board:['.'],valid:[[false]]}]},sources=replaySourceHashes(()=> 'source'),stamp=replayProvenance(corpus,sources);
 assert.equal(stamp.corpusHash,hash(JSON.stringify(corpus)));assert.equal(stamp.hashAlgorithm,'sha256');assert.equal(stamp.runtime.node,process.version);assert.equal(stamp.runtime.v8,process.versions.v8);assert.equal(stamp.runtime.arch,process.arch);assert.equal(stamp.runtime.platform,process.platform);assert.ok(Number.isFinite(Date.parse(stamp.createdAt)));assert.ok(stamp.runtime.logicalCpus>0);
 sources['go-policy.js']='changed';assert.notEqual(stamp.sources['go-policy.js'],'changed');corpus.samples[0].valid[0][0]=true;assert.notEqual(replayProvenance(corpus,replaySourceHashes(()=> 'source')).corpusHash,stamp.corpusHash);
 assert.equal(JSON.stringify(stamp).includes(process.cwd()),false);
});
test('offline CLI produces verifiable provenance and keeps exported corpora compatible',()=>{
 const directory=mkdtempSync(join(tmpdir(),'go-replay-stamp-'));
 try{
  const input=join(directory,'input corpus.json'),saved=join(directory,'saved corpus.json'),now=Date.now();
  const corpus={schemaVersion:1,source:'native-go-snapshot',nodeReset:1,augReset:2,at:now,samples:[{at:now,opponent:'Tetrads',currentPlayer:'Black',historyLength:0,board:Array(5).fill('.....'),valid:Array.from({length:5},()=>Array(5).fill(true))}]};
  writeFileSync(input,JSON.stringify(corpus));
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/benchmark-go-replay.js',import.meta.url)),'--input',input,'--save',saved],{encoding:'utf8',timeout:15000,maxBuffer:128*1024,cwd:directory});
  assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout);assert.equal(report.samples,1);assert.equal(report.cases[0].identical,true);assert.deepEqual(report.provenance.sources,replaySourceHashes());assert.equal(report.provenance.corpusHash,hash(JSON.stringify(corpus)));assert.deepEqual(JSON.parse(readFileSync(saved,'utf8')),corpus);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
