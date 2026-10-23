import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const suite=readFileSync(new URL('./go-speed.test.js',import.meta.url),'utf8');
const runner=readFileSync(new URL('../scripts/benchmark-go.js',import.meta.url),'utf8');
test('Go CPU comparisons are optional while correctness tests remain enabled',()=>{
 const declaration=suite.match(/^const goCpuBenchmark=.*;$/m)?.[0];assert.ok(declaration);
 for(const value of [undefined,'0','1']){let registered;vm.runInNewContext(declaration+";goCpuBenchmark('cpu',()=>{});",{process:{env:{BITBURNER_GO_BENCHMARKS:value}},test:(name,options)=>{registered=options;}});assert.equal(registered.skip,value!=='1');}
 assert.equal(/\btest\('[^'\n]*microbenchmark/.test(suite),false);assert.ok(suite.includes("test('chain-ID move evaluation matches copying simulation"));
});
function runBenchmarkMock(response){
 let call;const process={execPath:'node',env:{marker:'preserved'}};
 vm.runInNewContext(runner.replace(/^import .*;\r?$/gm,'').replaceAll('import.meta.url',JSON.stringify('file:///repo/scripts/benchmark-go.js')),{URL,fileURLToPath:()=>'/repo/tests/go-speed.test.js',spawnSync:(...args)=>{call=args;return response;},process,console:{error(){}}});
 return {call,process};
}
test('Go benchmark command selects only CPU comparisons and preserves environment',()=>{
 const {call,process}=runBenchmarkMock({status:0});assert.equal(call[0],'node');assert.deepEqual(Array.from(call[1]),['--test','--test-concurrency=1','--test-name-pattern=microbenchmark','/repo/tests/go-speed.test.js']);assert.equal(call[2].env.BITBURNER_GO_BENCHMARKS,'1');assert.equal(call[2].env.marker,'preserved');assert.equal(call[2].stdio,'inherit');assert.equal(process.exitCode,0);
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));assert.equal(pkg.scripts['bench:go'],'node scripts/benchmark-go.js');
});
test('Go benchmark command propagates test failures and launch failures',()=>{assert.equal(runBenchmarkMock({status:7}).process.exitCode,7);assert.equal(runBenchmarkMock({status:null,error:{message:'launch failed'}}).process.exitCode,1);});
