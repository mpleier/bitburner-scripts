import {phishingReportFile,recordPhishingAttempt} from './darknet-throughput-policy.js';
import {cacheContextFile,cacheRewardReset} from './darknet-reward-policy.js';
/**
 * Phishing helper for a darknet server: runs phishing attacks for money and charisma. Kept apart from the scout so
 * the scout stays small enough for low-RAM servers. Opening .cache files is darknet-cache.js's job — keeping that
 * call here cost 2 GB of per-thread static RAM, which is the difference between one and two phishing threads on a
 * 16 GB host.
 * Phishing payout scales with threads, so the scout starts this with whatever RAM is left over.
 */
export function lootResizeRequested(text, pid, now=Date.now()) {
  try { const r=JSON.parse(text); return r.pid===pid && Number.isFinite(r.at) && r.at<=now && now-r.at<=45000 && Number.isFinite(r.expiresAt) && r.expiresAt>now && r.expiresAt<=r.at+45000; } catch { return false; }
}
export async function main(ns) {
  ns.disableLog("ALL");
  const self = ns.getHostname();
  let metrics=null,lastReport=0;
  const threads=ns.getRunningScript()?.threads||1;
  const publish=async(force=false)=>{
    if(!metrics||(!force&&Date.now()-lastReport<30000))return;
    try{await ns.write(phishingReportFile(self),JSON.stringify(metrics),'w');lastReport=Date.now();}catch(error){ns.print('Phishing report deferred: '+String(error));}
  };
  const record=(result,started)=>{try{metrics=recordPhishingAttempt(metrics,result,{host:self,pid:ns.pid,threads,reset:cacheRewardReset(ns.read(cacheContextFile)),started,at:Date.now()});}catch{/* No current reset context: do not publish mixed-reset counts. */}};
  while (true) {
    try {
      // Caches are opened by darknet-cache.js, which the scout starts whenever this host holds a .cache. Keeping
      // openCache here cost 2 GB of this file's static RAM per thread — a third of a 16 GB host's spare RAM —
      // and a second copy of a job the thin opener already does.
      // Most attempts fail (code 455); only report the ones that pay out.
      const started=Date.now();let result;
      try{result=await ns.dnet.phishingAttack();record(result,started);}
      catch(error){record(null,started);await publish();throw error;}
      await publish();
      if (result?.success) ns.print(`Phishing succeeded: ${result.message ?? "reward received"}`);
    } catch (error) {
      ns.print(`Loot helper recovered: ${String(error)}`);
      await ns.sleep(5_000);
    }
    if (lootResizeRequested(ns.read('tasks/dnet-loot-resize.json'), ns.pid)) {
      await publish(true);
      ns.print('Phishing action complete; yielding RAM for scout reallocation.');
      return;
    }
    await ns.sleep(100);
  }
}
