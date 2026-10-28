import {cacheContextFile,cacheRewardReset,cacheRewardFile,recordDarknetCache} from './darknet-reward-policy.js';
/**
 * One-shot cache opener: opens every .cache file on the server it runs on, then
 * exits. openCache only works on the current server, and costs 2 GB, so the
 * scout starts this whenever a cache file appears (they are left behind when a
 * server's blocked RAM is freed, or dropped by phishing) instead of keeping
 * that cost in the scout itself.
 */
export async function main(ns) {
  ns.disableLog("ALL");
  const self = ns.getHostname();
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
    } catch (error) {
      ns.print(`${self}: could not open ${file}: ${String(error)}`);
    }
  }
}
