import {bladeburnerSnapshotWorkers,bladeburnerSnapshotBatch} from './bladeburner-snapshot-source.js';

/** Leave headroom above the measured 51.1-GB batch; constrained homes run one small child at a time. */
export function bladeburnerSnapshotPlan(availableRam){
 return Number.isFinite(availableRam)&&availableRam>=64?[bladeburnerSnapshotBatch]:bladeburnerSnapshotWorkers;
}

/** Reject partial, stale, reset-mismatched or city-mismatched multi-worker observations. */
export function mergeBladeburnerSnapshots(records,reset,startedAt,now=Date.now()){
 if(!Array.isArray(records)||!records.length||records.length>5||!Number.isFinite(startedAt)||startedAt>now)throw Error('Invalid city snapshot transaction');
 const fields=['capabilities','stats','maintenance','squads','trainingVitals','currentCity','population','communities','chaos'],result={},city=records[0]?.city;
 if(typeof city!=='string'||!city)throw Error('Unknown city snapshot location');
 for(const record of records){
  if(!Number.isFinite(record?.at)||record.at<startedAt||record.at>now||now-record.at>=15000||record.city!==city||
   ![record.nodeReset,record.augReset].every(v=>Number.isFinite(v)&&v>=0)||record.nodeReset!==reset?.lastNodeReset||record.augReset!==reset?.lastAugReset||!record.data||typeof record.data!=='object'||Array.isArray(record.data))throw Error('City snapshot changed or expired; retry next pass');
  for(const [key,value] of Object.entries(record.data)){
   if(!fields.includes(key)||Object.hasOwn(result,key))throw Error('Invalid or duplicate city snapshot field');
   result[key]=value;
  }
 }
 if(fields.some(key=>!Object.hasOwn(result,key))||result.currentCity!==city)throw Error('Incomplete city snapshot; retry next pass');
 return result;
}

/** Sequential children preserve RAM headroom. Failures never publish a partial merged snapshot. */
export async function readBladeburnerSnapshot(ns,read,cities,target,reset){
 let available=0;try{available=Math.max(0,ns.getServerMaxRam('home')-ns.getServerUsedRam('home'));}catch{}
 const plan=bladeburnerSnapshotPlan(available),startedAt=Date.now(),records=[],args=[JSON.stringify(cities),target||''];
 for(const worker of plan)records.push(await read(ns,worker.source,'/Temp/bladeburner-city-state-'+worker.name+'.txt',args));
 return mergeBladeburnerSnapshots(records,reset,startedAt);
}
