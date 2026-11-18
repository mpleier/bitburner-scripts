function unused(ns) {
  return [ns.corporation.getDivision, ns.corporation.getOffice, ns.corporation.buyMaterial];
}
export async function main(ns) {
  ns.tprint(`static probe ${unused ? 'loaded' : 'x'}`);
}
