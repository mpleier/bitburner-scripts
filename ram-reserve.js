/** Set the home RAM reserve (GB) that every headroom-aware planner honours: autopilot's charging,
 *  cloud purchase demand, contract delivery, gang monitor launches and manager capacity.
 *  The value is read from home-ram-reserve.txt in GB, not bytes.
 *  Usage: run ram-reserve.js <GB>   (no argument prints the current reserve and free RAM) */
export async function main(ns) {
  const maximum = ns.getServerMaxRam('home');
  const used = ns.getServerUsedRam('home');
  const current = Number(ns.read('home-ram-reserve.txt'));
  const raw = ns.args[0];
  if (raw === undefined) {
    ns.tprint(`home-ram-reserve.txt = ${Number.isFinite(current) ? current : 0} GB | home ${maximum} GB, free ${(maximum - used).toFixed(1)} GB`);
    return;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    ns.tprint(`usage: run ram-reserve.js <GB> (0-${maximum}); current reserve ${Number.isFinite(current) ? current : 0} GB`);
    return;
  }
  await ns.write('home-ram-reserve.txt', String(Math.round(value)), 'w');
  const saved = Number(ns.read('home-ram-reserve.txt'));
  ns.tprint(`home-ram-reserve.txt = ${saved} GB | home ${maximum} GB, free ${(maximum - used).toFixed(1)} GB`);
}
