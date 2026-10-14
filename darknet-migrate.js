/** Short-lived migration attempts. The target already contains a running scout. */
export async function main(ns) {
  ns.disableLog('ALL');
  const target = String(ns.args[0] || '');
  if (!target || target === ns.getHostname()) return;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const details = ns.dnet.getServerDetails(target);
      if (details.isOnline === false || !details.isConnectedToCurrentServer || details.isStationary ||
          ns.dnet.getStasisLinkedServers().includes(target) || !ns.ps(target).some(p => p.filename === 'darknet-node.js')) return;
      const result = await ns.dnet.induceServerMigration(target);
      if (!result?.success) return;
      if (result.progress >= 1) { ns.print(`Migration charged for ${target}; its scout will explore from the new location.`); return; }
    } catch (error) { ns.print(`Migration waiting: ${String(error)}`); return; }
  }
}
