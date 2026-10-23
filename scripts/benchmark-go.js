import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Run diagnostic CPU comparisons separately from correctness tests.
const file=fileURLToPath(new URL('../tests/go-speed.test.js',import.meta.url));
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-name-pattern=microbenchmark',file],{
 stdio:'inherit',env:{...process.env,BITBURNER_GO_BENCHMARKS:'1'}
});
if(result.error)console.error(result.error.message);
process.exitCode=result.status??1;
