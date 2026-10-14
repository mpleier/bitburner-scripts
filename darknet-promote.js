import { stockSignalFile, chooseStockPromotion } from './darknet-stock-policy.js';
/** One thread per server; refresh positions before each volatility promotion. */
export async function main(ns) {
  ns.disableLog('ALL');
  const host = ns.getHostname();
  while (true) {
    try {
      if (!(await ns.scp(stockSignalFile, host, 'home'))) return;
      const symbol = chooseStockPromotion(JSON.parse(ns.read(stockSignalFile)));
      if (!symbol) return;
      const result = await ns.dnet.promoteStock(symbol);
      if (result?.success) ns.print(`Promoted held stock ${symbol}.`);
      else if (![408, 455].includes(Number(result?.code))) return;
    } catch (error) { ns.print(`Stock promotion waiting: ${String(error)}`); return; }
    await ns.sleep(1000);
  }
}
