import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {release,cpus} from 'node:os';
const sourceFiles=['go-policy.js','go-replay-policy.js','scripts/go-replay-benchmark-core.js','scripts/benchmark-go-replay.js','scripts/go-replay-provenance.js'];
const sha256=value=>createHash('sha256').update(value).digest('hex');
/** Fixed local source inventory; normalize line endings for portable fingerprints. */
export function replaySourceHashes(read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')){
 return Object.fromEntries(sourceFiles.map(file=>{const source=read(file);if(typeof source!=='string'||!source.length)throw Error('Missing replay source: '+file);return [file,sha256(source.replace(/\r\n?/g,'\n'))];}));
}
export function assertReplaySourcesUnchanged(before,after){
 if(sourceFiles.some(file=>typeof before?.[file]!=='string'||before[file]!==after?.[file]))throw Error('Replay sources changed during the run; retry with stable files');
}
export function replayProvenance(corpus,sources){
 assertReplaySourcesUnchanged(sources,sources);
 const processors=cpus();
 return {schemaVersion:1,createdAt:new Date().toISOString(),hashAlgorithm:'sha256',sourceNormalization:'CRLF/CR to LF',sources:{...sources},corpusHash:sha256(JSON.stringify(corpus)),runtime:{node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,osRelease:release(),cpuModel:processors[0]?.model||null,logicalCpus:processors.length}};
}
