import {codingContractTypesMetadata,findAnswer} from './Tasks/contractor.js.solver.js';
import {solverVersion,contractCoverage} from './contract-policy.js';
import {jsonReplacer} from './helpers.js';
import {registerAutomation,automationHeartbeat} from './runtime-policy.js';
import {isScriptPaused} from './automation-control.js';
export async function main(ns){
 ns.disableLog('ALL');if(ns.getHostname()!=='home'||isScriptPaused(ns,ns.getScriptName())||ns.ps('home').some(p=>p.filename===ns.getScriptName()&&p.pid!==ns.pid))return;
 registerAutomation(ns);const version=solverVersion(codingContractTypesMetadata),created=new Set();
 ns.atExit(()=>{for(const file of created)try{ns.rm(file,'home');}catch{}});
 let status;try{status=JSON.parse(ns.read('tasks/contract-validation.json'));}catch{}if(status?.version!==version||!status.types||typeof status.types!=='object'||Array.isArray(status.types))status={version,types:{}};
 for(const [type,verdict]of Object.entries(status.types))if(!verdict||typeof verdict!=='object'||!['passed','failed','retrying','unsupported'].includes(verdict.state))delete status.types[type];
 while(!isScriptPaused(ns,ns.getScriptName())){
  automationHeartbeat(ns);
  try{
   const catalog=ns.codingcontract.getContractTypes(),coverage=contractCoverage(catalog,codingContractTypesMetadata);
   status={...status,at:Date.now(),pid:ns.pid,state:'validating',coverage,error:null};
   for(const {type,supported}of coverage){
    if(isScriptPaused(ns,ns.getScriptName()))break;
    if(!supported){status.types[type]={state:'unsupported'};continue;}
    if(['passed','failed'].includes(status.types[type]?.state)||status.types[type]?.retryAt>Date.now())continue;
    let passed=0,error=null,solverFailed=false;
    for(let sample=0;sample<3;sample++){
     let file;
     try{file=ns.codingcontract.createDummyContract(type,'home');if(!file)throw Error('Dummy contract creation unavailable');created.add(file);
      const data=ns.codingcontract.getData(file,'home');let answer;
      try{answer=findAnswer({type,dataJson:JSON.stringify(data,jsonReplacer)});}catch(e){solverFailed=true;throw e;}
      if(answer===null||answer===undefined){solverFailed=true;throw Error('Solver returned no answer');}
      if(!ns.codingcontract.attempt(answer,file,'home')){solverFailed=true;throw Error('Solver failed a dummy sample');}passed++;
     }catch(e){error=String(e);break;}finally{if(file){ns.rm(file,'home');created.delete(file);}}
     automationHeartbeat(ns);await ns.sleep(25);
    }
    status.types[type]={state:passed===3?'passed':solverFailed?'failed':'retrying',samples:passed,error,retryAt:passed===3||solverFailed?null:Date.now()+300000,at:Date.now()};
    ns.write('tasks/contract-validation.json',JSON.stringify(status),'w');
   }
   status.state=Object.values(status.types).some(t=>t.state==='retrying')?'waiting-for-retry':'complete';status.at=Date.now();status.pid=ns.pid;ns.write('tasks/contract-validation.json',JSON.stringify(status),'w');
  }catch(error){status.state='unavailable';status.error=String(error);status.at=Date.now();ns.write('tasks/contract-validation.json',JSON.stringify(status),'w');}
  await ns.sleep(60000);
 }
}
