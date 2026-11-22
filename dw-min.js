export async function main(ns) {
  await ns.write('tasks/dw-min.json', '{"stage":"ok","args":' + JSON.stringify(ns.args.map(String)) + '}', 'w');
  ns.tprint('DW_MIN ok');
}
