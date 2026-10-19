import ts from 'typescript';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const file=process.argv[2];if(!file)throw Error('Usage: node scripts/generate-api-surface.js path/to/NetscriptDefinitions.d.ts');
const text=readFileSync(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),interfaces=new Map();
source.forEachChild(n=>{if(ts.isInterfaceDeclaration(n))interfaces.set(n.name.text,n);});
const paths={},costs={};
function members(name,seen=new Set()){
 if(seen.has(name))return [];seen.add(name);const node=interfaces.get(name);if(!node)return [];
 return [...(node.heritageClauses||[]).flatMap(h=>h.types.flatMap(t=>members(t.expression.getText(source),seen))),...node.members];
}
function collect(name,prefix='',depth=0){
 if(depth>4)return;
 for(const m of members(name)){
  if(!m.name)continue;const key=m.name.getText(source).replace(/^['"]|['"]$/g,''),path=prefix+key;
  const nested=ts.isPropertySignature(m)&&m.type&&ts.isTypeReferenceNode(m.type)?m.type.typeName.getText(source):null;
  if(nested&&interfaces.has(nested)){paths[path]='namespace';collect(nested,path+'.',depth+1);}
  else if(ts.isMethodSignature(m)||m.type&&ts.isFunctionTypeNode(m.type)){
   paths[path]='function';const doc=m.getFullText(source),ram=doc.match(/RAM cost:\s*([\d.]+)\s*GB([^\r\n]*)/);
   if(ram)costs[path]={base:Number(ram[1]),singularityScaled:/16\/4\/1/.test(ram[2])};
  }else paths[path]='property';
 }
}
collect('NS');if(Object.keys(paths).length<100)throw Error('Definitions did not provide a usable NS interface');
const result={schemaVersion:1,source:'Definitions exported by the connected Bitburner Remote API',sha256:createHash('sha256').update(text).digest('hex'),paths,costs};
writeFileSync(resolve('scripts/api-surface.json'),JSON.stringify(result,null,2)+'\n');
console.log('Generated '+Object.keys(paths).length+' API paths and '+Object.keys(costs).length+' documented RAM costs.');
