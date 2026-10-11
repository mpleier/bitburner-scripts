"use strict";

function scoreTarget(server, hackingLevel) {
  if (!server.hasAdminRights || server.requiredHackingLevel > hackingLevel || server.moneyMax <= 0) return -1;

  const chance = Math.max(0, Math.min(1, Number(server.hackChance) || 0));
  const cycleSeconds = Number(server.weakenTime ?? server.batchTime ?? server.hackTime);
  if (!(cycleSeconds > 0) || !Number.isFinite(cycleSeconds)) return -1;

  const expectedStolen = server.moneyMax * 0.5 * chance;
  const income = expectedStolen / (cycleSeconds / 1000);
  const securityGap = Math.max(0, (server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0));
  const moneyRatio = Math.min(1, (server.moneyAvailable ?? 0) / Math.max(1, server.moneyMax));
  const prepPenalty = (1 / (1 + securityGap)) * (0.1 + 0.9 * moneyRatio);
  return income * prepPenalty;
}

function distribute(actions, hostRams, scriptRam, hostCores = {}, options = {}) {
  const placements = [];
  const usedThisBatch = {};
  const minWorkerCores = Number(options.minWorkerCores) || 1;
  const homeReserveGb = Math.max(0, Number(options.homeReserveGb) || 0);
  for (const host of Object.keys(hostRams)) usedThisBatch[host] = 0;

  const hosts = Object.keys(hostRams)
    .filter((host) => (hostCores[host] ?? 1) >= minWorkerCores)
    .sort((a, b) => (hostRams[b].max - hostRams[b].used) - (hostRams[a].max - hostRams[a].used));
  if (!hosts.length) return null;

  for (const action of actions) {
    let remaining = Number(action.threads);
    const perThread = Number(scriptRam[action.script]);
    if (!Number.isInteger(remaining) || remaining < 0 || !Number.isFinite(perThread) || perThread <= 0) return null;

    for (const host of hosts) {
      if (remaining <= 0) break;
      const info = hostRams[host];
      const reserve = host === "home" ? Math.min(homeReserveGb, Math.floor(info.max * 0.25)) : 0;
      // info.used is a live snapshot and already includes all running scripts,
      // including in-flight batches. Only subtract allocations from this plan.
      const free = info.max - info.used - usedThisBatch[host] - reserve;
      const take = Math.min(Math.floor(Math.max(0, free) / perThread), remaining);
      if (take > 0) {
        placements.push({ ...action, host, threads: take });
        usedThisBatch[host] += take * perThread;
        remaining -= take;
      }
    }
    if (remaining > 0) return null;
  }
  return placements;
}

module.exports = { scoreTarget, distribute };
