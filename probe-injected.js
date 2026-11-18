function unused(api) {
  return [api.getDivision, api.getOffice, api.buyMaterial];
}
export async function main(ns) {
  ns.tprint(`injected probe ${unused ? 'loaded' : 'x'}`);
}
