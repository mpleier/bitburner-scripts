import {runtimeHash} from './runtime-policy.js';
export function contractKey(c){return JSON.stringify([c.hostname,c.contract,c.type,runtimeHash(c.dataJson)]);}
export function solverVersion(metadata){return runtimeHash(metadata.map(m=>m.name+':'+m.solver.toString()).join('\n'));}
export function contractAllowed(validation,version,type){return validation?.version===version&&validation.types?.[type]?.state==='passed';}
export function contractCoverage(nativeTypes,metadata){const names=new Set(metadata.map(m=>m.name));return nativeTypes.map(type=>({type,supported:names.has(type)}));}

/** Collection is a read optimization only; dispatch and the worker recheck permission before attempting. */
export function contractCollectionPlan(contracts, validation) {
 const validationReady=typeof validation?.version==='string'&&validation.version.length>0&&
  !!validation.types&&typeof validation.types==='object'&&!Array.isArray(validation.types);
 const eligible=validationReady?contracts.filter(c=>typeof c.type==='string'&&validation.types[c.type]?.state==='passed'):[];
 return {validationReady,eligible,deferred:contracts.length-eligible.length,
  reason:!validationReady?'waiting-for-validation':eligible.length?'ready':'no-validated-contracts'};
}
