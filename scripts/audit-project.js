import {readdir,readFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {auditImports,auditApis,auditDynamicRam,apiReferences,estimateRam} from './audit-core.js';
export async function projectSources(root=process.cwd()){
 const files=new Map();async function collect(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const file=join(dir,entry.name);if(entry.isDirectory()){if(!['node_modules','.git','tests','scripts','tasks','Temp','temp','remote-control','pc-controller'].includes(entry.name))await collect(file);}else if(entry.name.endsWith('.js'))files.set(relative(root,file).replaceAll('\\','/'),await readFile(file,'utf8'));}}
 await collect(root);return files;
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/audit-project.js')){
 const files=await projectSources(),surface=JSON.parse(await readFile(new URL('./api-surface.json',import.meta.url),'utf8'));
 let compatibility={};try{compatibility=JSON.parse(await readFile(new URL('./api-compatibility.json',import.meta.url),'utf8'));}catch{}
 const mode=process.argv[2]||'all',results=[];
 if(['all','imports'].includes(mode))results.push(auditImports(files));
 if(['all','api'].includes(mode))results.push(auditApis(files,surface,compatibility));
 if(['all','ram'].includes(mode))results.push(auditDynamicRam(files,surface));
 const problems=results.flatMap(r=>r.problems),coverage=results.flatMap(r=>r.coverage||[]);
 for(const p of problems)console.error(p.file+': '+p.kind+': '+p.detail);
 if(mode==='ram'){
  for(const file of ['host-manager.js','Tasks/ram-manager.js','Tasks/contractor.js.solver.js']){
   const refs=apiReferences(file,files.get(file)||'').references;
   console.log(file+' direct/generated API subtotals (not total native RAM): '+[1,2,3].map(l=>'SF4.'+l+' '+estimateRam(refs,surface,l).ram+' GB').join(' | '));
  }
 }
 console.log(mode+' audit: '+files.size+' deployable files, '+problems.length+' problems.');
 if(coverage.length)console.log(coverage.length+' indirect/generated-source observations require native compilation or runtime checks; no complete RAM guarantee is claimed.');
 if(problems.length)process.exitCode=1;
}
