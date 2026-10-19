import ts from 'typescript';
import {apiReferences,estimateRam,parseScript} from './audit-core.js';
export function schedulingMinima(source){
 const result=new Map(),tree=parseScript('daemon.js',source);
 function visit(n){if(ts.isObjectLiteralExpression(n)){
  const fields=new Map(n.properties.filter(ts.isPropertyAssignment).map(p=>[p.name.getText(tree).replace(/['"]/g,''),p.initializer]));
  const name=fields.get('name'),ram=fields.get('minRamReq');if(name&&ram&&ts.isStringLiteralLike(name)&&ts.isNumericLiteral(ram))result.set(name.text.replace(/^\//,''),Number(ram.text));
 }ts.forEachChild(n,visit);}visit(tree);return result;
}
/** Bounds refer to current parent allocation plus one serialized child, not the entire network. */
export function checkNativeRamBudgets(native,definitions,groups,minima){
 const scripts=new Map(native.scripts.map(s=>[s.script,s.ram])),level=native.sourceFile4;
 if(!Number.isInteger(level)||level<0)return {ok:false,groups:[],reason:'Native preflight did not provide active SF4 metadata'};
 const rows=[];
 for(const group of groups){
  const parent=scripts.get(group.parent);if(!(parent>0))continue;
  const refs=apiReferences(group.parent+'#worker',group.worker).references,worker=estimateRam(refs,definitions,level);
  const declared=minima.get(group.parent),budget=Math.max(parent,declared||0),required=Math.round((parent+worker.ram)*100)/100;
  const ready=worker.unknown.length===0&&declared!==undefined&&required<=budget+.001;
  rows.push({script:group.parent,parentRam:parent,workerRam:worker.ram,required,schedulerBudget:declared??null,sourceFile4:level,status:worker.unknown.length?'unverified-costs':declared===undefined?'no-explicit-worker-budget':ready?'ready':'insufficient-worker-budget'});
 }
 return {ok:rows.length>0&&rows.every(r=>r.status==='ready'),groups:rows,reason:rows.length?'Documented API costs for known serialized workers; native compilation remains required':'No selected entrypoints have declared worker groups'};
}
