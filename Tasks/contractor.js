import {readSharedNetwork} from '../network-snapshot-policy.js';
import {contractCollectionPlan} from '../contract-policy.js';
import {reconcileContractDelivery,dispatchContractDelivery} from '../contract-delivery-policy.js';
import { instanceCount, getFilePath, getNsDataThroughFile, disableLogs, log } from '../helpers.js'
const scriptSolver = getFilePath("/Tasks/contractor.js.solver.js");

/** @param {NS} ns **/
export async function main(ns) {
    if(ns.getHostname()!=='home')return ns.print('Contract collection is owned by home; only leased solver workers run remotely.');
    // Prevent multiple instances of this script from being started
    if (await instanceCount(ns, "home", false, false) > 1)
        return log(ns, 'Another instance is already running. Shutting down...');

    const previous=await reconcileContractDelivery(ns);
    if(previous.busy)return ns.print('Contract worker is still running or delivering results.');
    disableLogs(ns, ["scan"]);
    ns.print("Getting server list...");
    const cached=readSharedNetwork(ns);
    const reset=ns.getResetInfo();
    const servers = [...(cached?.servers ?? await getNsDataThroughFile(ns, 'scanAllServers(ns)'))];
    // Shared hacking inventory may omit Dark Net: include fresh surveyed reward hosts.
    for(const file of ns.ls('home','tasks/dnet-survey-'))try{
        const report=JSON.parse(ns.read(file));
        if(typeof report.host==='string'&&Number.isFinite(report.at)&&report.at>=reset.lastAugReset&&report.at<=Date.now()&&Date.now()-report.at<=90000&&!servers.includes(report.host))servers.push(report.host);
    }catch{}
    ns.print(`Got ${servers.length} servers. Searching for contracts on each...`);
    // Retrieve all contracts and convert them to objects with the required information to solve
    const contractsDb = servers.map(hostname => {try{return {hostname,contracts:ns.ls(hostname,'.cct')};}catch{return {hostname,contracts:[]};}})
        .filter(o => o.contracts.length > 0)
        .map(o => o.contracts.map(contract => ({ contract, hostname: o.hostname }))).flat();
    if (contractsDb.length == 0){if(ns.getHostname()==='home')await ns.write('tasks/contracts-status.json',JSON.stringify({at:Date.now(),queued:0,types:[]}), 'w');return ns.print('Found no contracts to solve.');}

    let validation;try{validation=JSON.parse(ns.read('tasks/contract-validation.json'));}catch{}
    const status=(ready,reason,job={},dataErrors=0)=>ns.write('tasks/contracts-status.json',JSON.stringify({
        at:Date.now(),discovered:contractsDb.length,queued:ready.length,deferred:contractsDb.length-ready.length,
        nodeReset:reset.lastNodeReset,augReset:reset.lastAugReset,validationVersion:validation?.version,contracts:contractsDb.slice(0,256).map(c=>({host:c.hostname,file:c.contract,type:c.type??null})),
        dataErrors,types:[...new Set(contractsDb.map(c=>c.type).filter(Boolean))],
        solverPid:job.pid||0,solverHost:job.host??null,jobId:job.jobId??null,reason}),'w');
    if(!contractCollectionPlan([],validation).validationReady){
        await status([],'waiting-for-validation');return ns.print('Contract collection deferred: waiting for solver validation.');
    }
    // Read types first. Only independently validated types need potentially large input payloads.
    const contractsDictCommand = (batch,command,tempName) => getNsDataThroughFile(ns,
        `Object.fromEntries(JSON.parse(ns.args[0]).map(c => [JSON.stringify([c.hostname,c.contract]), (()=>{try{return ${command};}catch{return null;}})()]))`,
        tempName,[JSON.stringify(batch)]);
    const dictContractTypes = await contractsDictCommand(contractsDb,'ns.codingcontract.getContractType(c.contract, c.hostname)','/Temp/contract-types.txt');
    contractsDb.forEach(c=>c.type=dictContractTypes[JSON.stringify([c.hostname,c.contract])]);
    const plan=contractCollectionPlan(contractsDb,validation);
    if(!plan.eligible.length){await status([],plan.reason);return ns.print('Contract collection deferred: no validated contract types.');}
    const dictContractDataStrings = await contractsDictCommand(plan.eligible,'JSON.stringify(ns.codingcontract.getData(c.contract, c.hostname), jsonReplacer)','/Temp/contract-data-stringified.txt');
    const ready=plan.eligible.filter(c=>{
        const data=dictContractDataStrings[JSON.stringify([c.hostname,c.contract])];
        if(typeof data!=='string')return false;
        c.dataJson=data;return true;
    });
    const dataErrors=plan.eligible.length-ready.length;
    if(!ready.length){await status([],'contract-data-unavailable',{},dataErrors);return ns.print('Contract collection deferred: inputs disappeared or could not be read.');}
    const job=await dispatchContractDelivery(ns,scriptSolver,ready,servers);
    if(!job.pid)ns.print('Contract solver deferred: '+job.reason);
    else ns.print('Contract solver running on '+job.host+' (PID '+job.pid+', '+job.count+' contracts).');
    await status(ready,job.reason??'running',job,dataErrors);
}
