/**
 * One-shot trigger: install augmentations after a labyrinth cache is recovered.
 *
 * The labyrinth hostname changes with the Dark Net network. This scans cache
 * receipts and identifies the current labyrinth by its server model, so a new
 * name such as ub3r_l4byr1nth works without editing the trigger.
 *
 * The daemon runs this periodically. It exits immediately unless a receipt
 * exists for the current augmentation run and has not already triggered an
 * install. The marker persists across reset.
 */
export async function main(ns) {
  const requestedHost = typeof ns.args[0] === 'string' && ns.args[0] ? ns.args[0] : '';
  const reset = ns.getResetInfo();
  if (ns.isRunning('ascend.js')) return;

  const candidates = [];
  if (requestedHost) {
    candidates.push(requestedHost);
  } else {
    for (const file of ns.ls('home', 'tasks/dnet-cache-rewards-')) {
      if (!file.endsWith('.json') || file.includes('summary')) continue;
      try {
        const receipt = JSON.parse(ns.read(file));
        if (!receipt?.host || !Number.isFinite(receipt.at)) continue;
        const modelId = ns.dnet.getServerDetails(receipt.host).modelId;
        if (modelId === '(The Labyrinth)') candidates.push(receipt.host);
      } catch { }
    }
  }

  const receipts = [];
  for (const host of [...new Set(candidates)]) {
    try {
      const receipt = JSON.parse(ns.read('tasks/dnet-cache-rewards-' + encodeURIComponent(host) + '.json'));
      if (receipt?.host === host && Number.isFinite(receipt.at) &&
          receipt.nodeReset === reset.lastNodeReset && receipt.augReset === reset.lastAugReset) {
        receipts.push(receipt);
      }
    } catch { }
  }
  receipts.sort((a, b) => b.at - a.at);

  for (const receipt of receipts) {
    const host = receipt.host;
    const markerFile = 'tasks/dnet-cache-install-' + encodeURIComponent(host) + '.json';
    let marker;
    try { marker = JSON.parse(ns.read(markerFile)); } catch { }
    if (Number.isFinite(marker?.receiptAt) && marker.receiptAt >= receipt.at) continue;
    if (ns.isRunning('ascend.js')) return;

    // ascend.js performs the faction purchase pass, then installs and resets.
    const pid = ns.run('ascend.js', 1, '--install-augmentations', true, '--on-reset-script', 'daemon.js');
    if (!pid) return;

    ns.write(markerFile, JSON.stringify({
      host,
      receiptAt: receipt.at,
      nodeReset: reset.lastNodeReset,
      augReset: reset.lastAugReset,
      requestedAt: Date.now(),
      pid,
    }), 'w');
    ns.print(`${host}: labyrinth cache recovered; requested augmentation installation via ascend.js (pid ${pid}).`);
    return;
  }
}
