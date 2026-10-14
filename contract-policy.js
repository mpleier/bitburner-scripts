import {runtimeHash} from './runtime-policy.js';
export function contractKey(c){return JSON.stringify([c.hostname,c.contract,c.type,runtimeHash(c.dataJson)]);}
export function solverVersion(metadata){return runtimeHash(metadata.map(m=>m.name+':'+m.solver.toString()).join('\n'));}
export function contractAllowed(validation,version,type){return validation?.version===version&&validation.types?.[type]?.state==='passed';}
export function contractCoverage(nativeTypes,metadata){const names=new Set(metadata.map(m=>m.name));return nativeTypes.map(type=>({type,supported:names.has(type)}));}
