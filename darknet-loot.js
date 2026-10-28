import {cacheContextFile,cacheRewardReset,cacheRewardFile,recordDarknetCache} from './darknet-reward-policy.js';
/**
 * Loot helper for a darknet server: opens .cache files left on this server and
 * runs phishing attacks for money and charisma. Kept apart from the scout so the
 * scout stays small enough for low-RAM servers (openCache 2 GB, phishing 2 GB).
 * Phishing payout scales with threads, so the scout starts this with whatever
 * RAM is left over.
 */
export function lootResizeRequested(text, pid, now=Date.now()) {
  try { const r=JSON.parse(text); return r.pid===pid && Number.isFinite(r.at) && r.at<=now && now-r.at<=45000 && Number.isFinite(r.expiresAt) && r.expiresAt>now && r.expiresAt<=r.at+45000; } catch { return false; }
}
export async function main(ns) {
  ns.disableLog("ALL");
  const self = ns.getHostname();
  while (true) {
    try {
      for (const file of ns.ls(self, ".cache")) {
        try {
          const result = ns.dnet.openCache(file, true);
          if (result?.success) await ns.write('tasks/dnet-last-cache.json', JSON.stringify({at:Date.now()}), 'w');
          if(result?.success)try{
            let previous;try{previous=JSON.parse(ns.read(cacheRewardFile(self)));}catch{}
            const reward=recordDarknetCache(previous,result,{host:self,pid:ns.pid,at:Date.now(),reset:cacheRewardReset(ns.read(cacheContextFile))});
            await ns.write(cacheRewardFile(self),JSON.stringify(reward),'w');
          }catch(error){ns.print('Cache reward report deferred: '+String(error));}
          ns.print(`${self}: opened ${file}: ${JSON.stringify(result)}`);
        } catch (error) { ns.print(`${self}: could not open ${file}: ${String(error)}`); }
      }
      // Most attempts fail (code 455); only report the ones that pay out.
      const result = await ns.dnet.phishingAttack();
      if (result?.success) ns.print(`Phishing succeeded: ${result.message ?? "reward received"}`);
    } catch (error) {
      ns.print(`Loot helper recovered: ${String(error)}`);
      await ns.sleep(5_000);
    }
    if (lootResizeRequested(ns.read('tasks/dnet-loot-resize.json'), ns.pid)) {
      ns.print('Phishing action complete; yielding RAM for scout reallocation.');
      return;
    }
    await ns.sleep(100);
  }
}
