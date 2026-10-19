import ts from 'typescript';
import {posix} from 'node:path';
export function parseScript(file,source){return ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);}
function names(node){if(ts.isIdentifier(node))return [node.text];if(ts.isObjectBindingPattern(node)||ts.isArrayBindingPattern(node))return node.elements.flatMap(e=>ts.isBindingElement(e)?names(e.name):[]);return [];}
export function moduleInfo(file,text){
 const source=parseScript(file,text),imports=[],reexports=[],exports=new Set();
 for(const node of source.statements){
  if(ts.isImportDeclaration(node)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
   const c=node.importClause,requested=[];if(c?.name)requested.push('default');
   if(c?.namedBindings&&ts.isNamedImports(c.namedBindings))for(const n of c.namedBindings.elements)requested.push((n.propertyName||n.name).text);
   imports.push({path:node.moduleSpecifier.text,names:requested});
  }
  if(ts.isExportDeclaration(node)){
   const requested=node.exportClause&&ts.isNamedExports(node.exportClause)?node.exportClause.elements.map(n=>({from:(n.propertyName||n.name).text,to:n.name.text})):node.exportClause&&ts.isNamespaceExport(node.exportClause)?[{from:'*',to:node.exportClause.name.text}]:null;
   if(node.moduleSpecifier)reexports.push({path:node.moduleSpecifier.text,names:requested});else for(const n of requested||[])exports.add(n.to);
  }
  if(node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)){
   if(node.modifiers.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword))exports.add('default');
   else if(node.name)exports.add(node.name.text);
   else if(ts.isVariableStatement(node))for(const d of node.declarationList.declarations)for(const name of names(d.name))exports.add(name);
  }
  if(ts.isExportAssignment(node))exports.add('default');
 }
 return {file,source,imports,reexports,exports};
}
export function resolveGameImport(file,spec){
 const path=posix.normalize(spec.startsWith('.')?posix.join(posix.dirname(file),spec):spec.replace(/^\//,''));
 return path==='..'||path.startsWith('../')||path.includes(':')?null:path;
}
export function auditImports(files){
 const modules=new Map([...files].map(([file,text])=>[file,moduleInfo(file,text)])),problems=[];
 const exported=(file,seen=new Set())=>{
  if(seen.has(file))return new Set();seen.add(file);const m=modules.get(file);if(!m)return new Set();const result=new Set(m.exports);
  for(const re of m.reexports){const target=resolveGameImport(file,re.path),available=exported(target,new Set(seen));if(re.names){for(const n of re.names)if(n.from==='*'||available.has(n.from))result.add(n.to);}else for(const n of available)if(n!=='default')result.add(n);}
  return result;
 };
 for(const [file,m]of modules)for(const edge of [...m.imports,...m.reexports.map(r=>({path:r.path,names:r.names?.map(n=>n.from).filter(n=>n!=='*')||[]}))]){
  const target=resolveGameImport(file,edge.path);
  if(!target||!modules.has(target)){problems.push({file,kind:'missing-module',detail:edge.path});continue;}
  const available=exported(target);for(const name of edge.names)if(!available.has(name))problems.push({file,kind:'missing-export',detail:target+' does not export '+name});
 }
 return {modules,problems};
}
/** Literal generated workers are parsed too. Indirect/computed calls remain explicitly unverified. */
export function apiReferences(file,text,{generated=true}={}){
 const references=new Set(),uncertain=new Set(),source=parseScript(file,text);
 function visit(node,aliases=new Map()){
  if(ts.isFunctionLike(node)||ts.isBlock(node))aliases=new Map(aliases);
  if(ts.isFunctionLike(node))for(const param of node.parameters||[])for(const name of names(param.name))aliases.delete(name);
  const path=n=>{
   if(ts.isIdentifier(n))return n.text==='ns'?'':aliases.get(n.text)??null;
   if(ts.isPropertyAccessExpression(n)){const p=path(n.expression);return p===null?null:(p?p+'.':'')+n.name.text;}
   if(ts.isElementAccessExpression(n)){const p=path(n.expression);if(p===null)return null;if(n.argumentExpression&&ts.isStringLiteralLike(n.argumentExpression))return (p?p+'.':'')+n.argumentExpression.text;uncertain.add('computed API member');}
   return null;
  };
  if(ts.isVariableDeclaration(node)&&!node.initializer)for(const name of names(node.name))aliases.delete(name);
  if(ts.isVariableDeclaration(node)&&node.initializer){
   const p=path(node.initializer);
   if(p!==null){if(ts.isIdentifier(node.name))aliases.set(node.name.text,p);else if(ts.isObjectBindingPattern(node.name))for(const e of node.name.elements)if(ts.isIdentifier(e.name))aliases.set(e.name.text,(p?p+'.':'')+(e.propertyName?.getText(source)||e.name.text));}else for(const name of names(node.name))aliases.delete(name);
  }
  if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
   const p=path(node),parent=node.parent;
   if(p!==null&&p&&!['args','enums'].includes(p.split('.')[0])&&!(ts.isPropertyAccessExpression(parent)&&parent.expression===node)&&!(ts.isElementAccessExpression(parent)&&parent.expression===node))references.add(p);
  }
  if(generated&&(ts.isStringLiteralLike(node)||ts.isNoSubstitutionTemplateLiteral(node))&&/\bns\./.test(node.text)){
   const snippet=parseScript(file+'#generated',node.text);
   if(!snippet.parseDiagnostics.length){const result=apiReferences(file,node.text,{generated:false});for(const p of result.references)references.add(p);for(const p of result.uncertain)uncertain.add(p);}
   else if(/^(?:\s*ns\.|\s*function\b)/.test(node.text))uncertain.add('generated source needs native compilation');
  }
  ts.forEachChild(node,child=>visit(child,aliases));
 }
 visit(source);if(references.has('dynamicImport'))uncertain.add('dynamic imports need runtime RAM verification');
 return {references,uncertain};
}
export function auditApis(files,surface,compatibility={}){
 const problems=[],coverage=[];
 for(const [file,text]of files){const result=apiReferences(file,text);for(const path of result.references)if(!(path in surface.paths)&&!compatibility[file]?.[path])problems.push({file,kind:'unknown-api',detail:'ns.'+path});for(const detail of result.uncertain)coverage.push({file,detail});}
 return {problems,coverage};
}
export function estimateRam(references,surface,level=3){
 let ram=1.6;const unknown=[];
 for(const path of new Set(references)){
  if(surface.paths[path]!=='function')continue;
  const cost=surface.costs[path];if(!cost){unknown.push(path);continue;}
  ram+=cost.base*(cost.singularityScaled?(level>=3?1:level===2?4:16):1);
 }
 return {ram:Math.round(ram*100)/100,unknown};
}
export function auditDynamicRam(files,surface){
 const {modules}=auditImports(files),problems=[],coverage=[];
 const dependencies=(file,includeDynamic,seen=new Set())=>{
  if(seen.has(file))return new Set();seen.add(file);const info=modules.get(file);if(!info)return new Set();const refs=apiReferences(file,files.get(file),{generated:false}).references;
  let edges=info.imports.map(i=>i.path);
  if(includeDynamic){const s=info.source;function walk(n){if(ts.isCallExpression(n)&&n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0])&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='dynamicImport')edges.push(n.arguments[0].text);ts.forEachChild(n,walk);}walk(s);}
  for(const spec of edges)for(const ref of dependencies(resolveGameImport(file,spec),includeDynamic,seen))refs.add(ref);return refs;
 };
 for(const [file]of files){const staticRefs=dependencies(file,false),chargedRefs=dependencies(file,true),missing=[...chargedRefs].filter(p=>!staticRefs.has(p)&&surface.paths[p]==='function'&&(surface.costs[p]?.base||0)>0);
  if(missing.length)problems.push({file,kind:'unreserved-dynamic-ram',detail:missing.join(', ')});
  const refs=apiReferences(file,files.get(file));if(refs.uncertain.size)coverage.push({file,detail:[...refs.uncertain].join('; ')});
 }
 return {problems,coverage};
}
