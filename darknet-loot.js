/**
 * Loot helper for a darknet server: opens .cache files left on this server and
 * runs phishing attacks for money and charisma. Kept apart from the scout so the
 * scout stays small enough for low-RAM servers (openCache 2 GB, phishing 2 GB).
 * Phishing payout scales with threads, so the scout starts this with whatever
 * RAM is left over.
 */
export async function main(ns) {
  ns.disableLog("ALL");
  const self = ns.getHostname();
  while (true) {
    try {
      for (const file of ns.ls(self, ".cache")) {
        try {
          const result = ns.dnet.openCache(file, true);
          ns.print(`Opened ${file}: ${JSON.stringify(result)}`);
        } catch (error) { ns.print(`Could not open ${file}: ${String(error)}`); }
      }
      // Most attempts fail (code 455); only report the ones that pay out.
      const result = await ns.dnet.phishingAttack();
      if (result?.success) ns.print(`Phishing succeeded: ${result.message ?? "reward received"}`);
    } catch (error) {
      ns.print(`Loot helper recovered: ${String(error)}`);
      await ns.sleep(5_000);
    }
    await ns.sleep(100);
  }
}
