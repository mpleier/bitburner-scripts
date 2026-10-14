import {discoverScanNetwork} from './scan-policy.js';
/** Push home scripts to rooted servers. Restart existing instances only with --restart. */
export function deployableSyncFile(file) {
 const path=String(file).replace(/^\/+/, '');
 return /\.(?:js|ns|script)$/.test(path)&&!/(^|\/)(Temp|tasks|remote-control|tests|scripts|node_modules|\.git)\//.test(path);
}
export async function main(ns) {
 const options=ns.flags([['restart',false]]);
 for(const name of ['scan','scp'])ns.disableLog(name);
 const network=discoverScanNetwork(host=>ns.scan(host));
 const files=ns.ls('home').filter(deployableSyncFile);
 for(const host of network.hosts) {
  if(host==='home'||!ns.hasRootAccess(host))continue;
  const running=options.restart?ns.ps(host).filter(p=>files.includes(p.filename)):[];
  // Home remains authoritative; never copy remote contents back over local scripts.
  if(!await ns.scp(files,host,'home')){ns.print('Could not sync scripts to '+host);continue;}
  if(options.restart)for(const p of running) {
   if(!ns.kill(p.pid))continue;
   const pid=ns.exec(p.filename,host,p.threads,...p.args);
   ns.print(pid?'Restarted '+p.filename+' on '+host:'Could not restart '+p.filename+' on '+host+'; check available RAM.');
  }
 }
}
