import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {replaySourceHashes,assertReplaySourcesUnchanged,replayProvenance} from './go-replay-provenance.js';
try{
 const sources=replaySourceHashes();
 const {validGoReplay}=await import('../go-replay-policy.js');
 const {benchmarkGoReplay,replayArguments}=await import('./go-replay-benchmark-core.js');
 const options=replayArguments(process.argv.slice(2));let corpus;
 if(options.input){const raw=readFileSync(options.input,'utf8');if(raw.length>60000)throw Error('Replay input exceeds 60000 characters');corpus=JSON.parse(raw);}
 else{
  const directory=process.env.BITBURNER_REMOTE_API_DIR||join(homedir(),'Documents','Codex','bitburner-remote-api');
  const result=spawnSync(process.execPath,[join(directory,'control.cjs'),'automation.goReplay','[]','--wait','20'],{encoding:'utf8',timeout:30000,maxBuffer:128*1024});
  if(result.error||result.status!==0)throw Error(result.error?.message||'Remote replay query failed');
  const lines=result.stdout.trim().split(/\r?\n/),response=JSON.parse(lines.at(-1));if(response.state!=='completed'||response.result?.state!=='ready')throw Error(response.error||'No current native Go samples yet; retry after normal play records one');corpus=response.result.replay;
 }
 if(!validGoReplay(corpus))throw Error('Invalid native Go replay corpus');
 const result=benchmarkGoReplay(corpus);
 assertReplaySourcesUnchanged(sources,replaySourceHashes());
 const provenance=replayProvenance(corpus,sources);
 if(options.save)writeFileSync(options.save,JSON.stringify(corpus,null,2)+'\n');
 console.log(JSON.stringify({...result,provenance},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
