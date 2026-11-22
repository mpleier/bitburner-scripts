/** @param {NS} ns */
export async function main(ns) {
  const keys = [];
  const walk = (obj, prefix) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'function') keys.push(prefix + k);
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, prefix + k + '.');
    }
  };
  walk(ns, '');
  const out = {
    at: Date.now(),
    dnet: keys.filter((k) => k.includes('dnet')),
    lab: keys.filter((k) => /lab|maze|stasis/i.test(k)),
  };
  await ns.write('tasks/api-enumerate.json', JSON.stringify(out), 'w');
}
