/** @param {NS} ns */
export async function main(ns) {
  const chunks = globalThis.webpackChunkbitburner;
  if (!globalThis.webpack_require && !chunks?.push) {
    ns.print('Developer console unavailable: this build does not expose the module loader.');
    return;
  }
  if (!globalThis.webpack_require) chunks.push([[-1], {}, loader => { globalThis.webpack_require = loader; }]);
  const loader = globalThis.webpack_require;
  if (!loader?.m) return;
  Object.keys(loader.m).forEach(key => Object.values(loader(key)).forEach(page => page?.toPage?.('Dev')));
}
