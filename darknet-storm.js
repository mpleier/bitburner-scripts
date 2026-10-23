import {darknetContractDisposition} from './darknet-contract-policy.js';
import { stormRequestFile, stormResultFile, stormReadiness, surveyFile } from './darknet-storm-policy.js';
/** One shot on the server holding the seed; no expensive API added to low-RAM scouts. */
export async function main(ns) {
  ns.disableLog('ALL');
  let request, outcome = { success: false, reason: 'Dispatch deferred by safety checks' };
  try {
    if (!(await ns.scp(stormRequestFile, ns.getHostname(), 'home'))) return;
    request = JSON.parse(ns.read(stormRequestFile));
    const now = Date.now(), host = ns.getHostname();
    if (typeof request.id !== 'string' || !request.id || !Number.isFinite(request.at) || now < request.at || now - request.at > 30000 || request.host !== host ||
        request.reset !== ns.getResetInfo().lastNodeReset) return;
    const options={stalled:request.mode==='stalled',frontier:request.frontier||[]};
    const decision = stormReadiness(request.reports, request.roots, now,options);
    if (!decision.ready || decision.seedHost !== host || decision.signature !== request.signature) return;
    // Recheck all surveyed hosts immediately before consuming the seed.
    // New caches, contracts, restarts, or maintenance cancel this dispatch.
    // ns.read is local: retrieve current home controls immediately before the native call.
    // Missing files mean no control flag; a failed copy or malformed maintenance record defers safely.
    if(ns.ps('home').some(p=>/contractor|contract-solver/i.test(p.filename)))return;
    // Reread each scout's current home survey; stale idle snapshots cannot hide new work.
    const surveyedHosts=new Set(JSON.parse(decision.signature).map(row=>row[0]));
    let fresh=[],acknowledged=false;
    for(let attempt=0;attempt<24&&Date.now()-request.at<25000;attempt++){
      fresh=[];
      for(const report of request.reports.filter(r=>surveyedHosts.has(r.host))){
        const file=surveyFile(report.host);
        if(!(await ns.scp(file,host,'home')))return;
        const current=JSON.parse(ns.read(file));
        if(current.pid!==report.pid||current.host!==report.host)return;
        fresh.push({...current,live:ns.ps(report.host).some(p=>p.pid===current.pid&&p.filename==='darknet-node.js')});
      }
      acknowledged=fresh.length>0&&fresh.every(r=>r.stormHoldId===request.id&&r.at>=request.at&&r.busy===false);
      if(acknowledged)break;
      await ns.sleep(1000);
    }
    if(!acknowledged)return;
    const current=stormReadiness(fresh,request.roots,Date.now(),options);
    if(!current.ready||current.signature!==request.signature||current.progressSignature!==decision.progressSignature)return;
    for(const frontier of decision.frontier){
      if(ns.dnet.getServerDetails(frontier).hasSession!==false||ns.ps(frontier).length>0)return;
    }
    const surveyed = new Set(JSON.parse(request.signature).map(row => row[0]));
    for (const report of request.reports.filter(report => surveyed.has(report.host))) {
      if (!ns.ps(report.host).some(p => p.pid === report.pid && p.filename === 'darknet-node.js') || ns.dnet.getServerDetails(report.host).blockedRam!==0 ||
          ns.ps(report.host).some(p => ['darknet-cache.js','darknet-stasis.js','darknet-migrate.js'].includes(p.filename)||/contractor|contract-solver/i.test(p.filename)) ||
          ns.ls(report.host).some(file => file.endsWith('.cache')) ||
          JSON.stringify(ns.ls(report.host).filter(f=>f.endsWith('.cct')).sort())!==JSON.stringify([...(report.contractFiles||[])].sort())) return;
    }
    for (const file of ['tasks/automation-maintenance.json', 'remote-control/paused/darknet-manager.js.txt']) {
      if (!ns.fileExists(file, 'home')) continue;
      if (!(await ns.scp(file, host, 'home'))) { outcome.reason = 'Home control sync failed'; return; }
      const text = ns.read(file);
      if (file.endsWith('.txt')) {
        if (text.trim() === 'true') { outcome.reason = 'Dark Net manager paused'; return; }
      } else {
        const maintenance = JSON.parse(text || '{}');
        if (maintenance.expiresAt > Date.now() && ns.isRunning(maintenance.ownerPid)) {
          outcome.reason = 'Automation maintenance'; return;
        }
      }
    }
    if(ns.ps('home').some(p=>/contractor|contract-solver/i.test(p.filename)))return;
    if(fresh.some(r=>r.contracts>0)){
      for(const file of ['tasks/contracts-status.json','tasks/contract-validation.json'])if(!(await ns.scp(file,host,'home')))return;
      const disposition=darknetContractDisposition(fresh,JSON.parse(ns.read('tasks/contracts-status.json')),JSON.parse(ns.read('tasks/contract-validation.json')),ns.getResetInfo(),Date.now());
      if(!disposition.allow)return;
    }
    const files = ns.ls(host), info = ns.dnet.getServerDetails(host);
    const expected = request.reports.find(report => report.host === host);
    const neighbours = ns.dnet.probe().filter(name => name !== host).sort();
    if (!files.includes('STORM_SEED.exe') || files.some(file => file.endsWith('.cache')) || info.blockedRam !== 0 ||
        JSON.stringify(neighbours) !== JSON.stringify([...expected.neighbours].sort()) ||
        ns.ps(host).some(p => ['darknet-cache.js','darknet-stasis.js','darknet-migrate.js'].includes(p.filename))) return;
    if (Date.now() - request.at > 30000 || request.reset !== ns.getResetInfo().lastNodeReset) return;
    // Income/cache evidence may change while scouts finish their current work.
    if(!Number.isFinite(request.income)||request.income<0||(()=>{const current=ns.getMoneySources().sinceInstall.darknet,tolerance=request.incomeTolerance===undefined?0:request.incomeTolerance;return !Number.isFinite(current)||!Number.isFinite(tolerance)||tolerance<0||current<request.income||current-request.income>tolerance;})()||!Number.isFinite(request.lastCacheAt)||fresh.some(r=>!Number.isFinite(r.lastCacheAt)||r.lastCacheAt>request.lastCacheAt))return;
    const result = ns.dnet.unleashStormSeed();
    outcome = { success: result?.success === true, reason: result?.message || String(result?.code || 'Webstorm triggered') };
    ns.print(`StormSeed: ${result.success ? 'webstorm triggered; scouts will rebuild exploration' : result.message || result.code}`);
  } catch (error) {
    outcome.reason = String(error);
    ns.print(`StormSeed deferred: ${String(error)}`);
  } finally {
    if (typeof request?.id === 'string' && request.host === ns.getHostname()) {
      const receipt = { id: request.id, host: request.host, reset: request.reset, at: Date.now(), ...outcome };
      try {
        await ns.write(stormResultFile, JSON.stringify(receipt), 'w');
        for (let attempt = 0; attempt < 3; attempt++) {
          if (await ns.scp(stormResultFile, 'home', ns.getHostname())) break;
          await ns.sleep(50);
        }
      } catch { /* Missing receipt permits a short retry, never an assumed successful storm. */ }
    }
  }
}
